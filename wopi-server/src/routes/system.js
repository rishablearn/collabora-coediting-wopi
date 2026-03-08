const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const ldapService = require('../services/ldap');
const pool = require('../db/pool');
const logger = require('../utils/logger');

const router = express.Router();

// System admin group configuration (from env)
const SYSTEM_ADMIN_GROUP = process.env.SYSTEM_ADMIN_GROUP || 'LocalDomainAdmins';
const SYSTEM_ADMIN_GROUPS_EXTRA = process.env.SYSTEM_ADMIN_GROUPS_EXTRA || '';

// Build list of all admin group patterns
function getAdminGroupPatterns() {
  const patterns = new Set();
  
  // Add primary group
  patterns.add(SYSTEM_ADMIN_GROUP.toLowerCase());
  
  // Add extra groups from env (comma-separated)
  if (SYSTEM_ADMIN_GROUPS_EXTRA) {
    SYSTEM_ADMIN_GROUPS_EXTRA.split(',').forEach(g => {
      const trimmed = g.trim().toLowerCase();
      if (trimmed) patterns.add(trimmed);
    });
  }
  
  // Add common admin group names as fallback
  ['localdomainadmins', 'domain admins', 'administrators'].forEach(p => patterns.add(p));
  
  return Array.from(patterns);
}

const ADMIN_GROUP_PATTERNS = getAdminGroupPatterns();
logger.info('System admin group patterns configured', { patterns: ADMIN_GROUP_PATTERNS });

// Ensure ldap_groups column exists (run migration if needed)
async function ensureLdapGroupsColumn() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'ldap_groups'
        ) THEN
          ALTER TABLE users ADD COLUMN ldap_groups TEXT[] DEFAULT '{}';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'system_admin'
        ) THEN
          ALTER TABLE users ADD COLUMN system_admin BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);
    logger.info('Database columns verified/created: ldap_groups, system_admin');
  } catch (err) {
    logger.warn('Could not verify database columns', { error: err.message });
  }
}

// Run migration on module load
ensureLdapGroupsColumn();

/**
 * Extract simple group name from LDAP DN format
 * Handles: "CN=LocalDomainAdmins", "CN=LocalDomainAdmins,O=Org", "LocalDomainAdmins"
 */
function extractGroupName(groupDN) {
  if (!groupDN) return '';
  
  // Try to extract CN value (works for AD, Domino, OpenLDAP)
  const cnMatch = groupDN.match(/^cn=([^,\/]+)/i) || groupDN.match(/cn=([^,\/]+)/i);
  if (cnMatch) {
    return cnMatch[1].trim().toLowerCase();
  }
  
  return groupDN.trim().toLowerCase();
}

/**
 * Check if a group name matches any admin patterns
 * Supports:
 * - HCL Domino flat format: CN=LocalDomainAdmins (no DC)
 * - Active Directory: CN=Domain Admins,CN=Builtin,DC=example,DC=com
 * - OpenLDAP: cn=admins,ou=groups,dc=example,dc=com
 */
function isAdminGroup(groupName) {
  if (!groupName) return false;
  
  // Extract the simple name from the group DN
  const simpleName = extractGroupName(groupName);
  const groupLower = groupName.toLowerCase();
  
  // Check against all configured patterns
  return ADMIN_GROUP_PATTERNS.some(pattern => {
    // Direct simple name match
    if (simpleName === pattern) return true;
    
    // Full DN contains the pattern
    if (groupLower.includes(pattern)) return true;
    
    // CN format match (for Domino/AD)
    if (groupLower.includes(`cn=${pattern}`)) return true;
    
    // Check if pattern's simple name matches
    const patternSimple = extractGroupName(pattern);
    if (simpleName === patternSimple) return true;
    
    return false;
  });
}

/**
 * Middleware to check if user is a system administrator (LocalDomainAdmins)
 */
async function requireSystemAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    logger.info('Checking system admin access', { 
      userId: req.user.id, 
      username: req.user.username,
      role: req.user.role,
      authSource: req.user.auth_source
    });

    // Check if user is local admin with role
    if (req.user.role === 'admin') {
      req.isSystemAdmin = true;
      logger.info('System admin access granted via admin role', { username: req.user.username });
      return next();
    }

    // For any LDAP-based auth, check group membership directly
    const authSource = req.user.auth_source || '';
    if (authSource.includes('ldap') || authSource.includes('ltpa') || authSource === 'domino' || authSource === 'EXTERNAL_AUTH') {
      try {
        const isInAdminGroup = await ldapService.isUserInGroup(req.user.username, SYSTEM_ADMIN_GROUP);
        if (isInAdminGroup) {
          req.isSystemAdmin = true;
          logger.info('System admin access granted via LDAP group', { username: req.user.username });
          return next();
        }
      } catch (ldapErr) {
        logger.warn('LDAP group check failed, trying cached groups', { error: ldapErr.message });
      }
    }

    // Check cached group membership from user record (with fallback if column doesn't exist)
    let cachedGroups = [];
    try {
      const groupResult = await pool.query(
        'SELECT ldap_groups FROM users WHERE id = $1',
        [req.user.id]
      );
      cachedGroups = groupResult.rows[0]?.ldap_groups || [];
      logger.info('Checking cached groups', { username: req.user.username, cachedGroups });
    } catch (dbErr) {
      // Column might not exist yet - that's okay
      logger.warn('Could not read cached groups (column may not exist)', { error: dbErr.message });
    }
    
    if (cachedGroups.length > 0) {
      const hasAdminGroup = cachedGroups.some(g => isAdminGroup(g));
      if (hasAdminGroup) {
        req.isSystemAdmin = true;
        logger.info('System admin access granted via cached groups', { username: req.user.username });
        return next();
      }
    }

    // Try getting fresh groups from LDAP and check
    try {
      const userGroups = await ldapService.getUserGroups(req.user.username);
      logger.info('Fresh LDAP groups retrieved', { username: req.user.username, groups: userGroups });
      
      if (userGroups && userGroups.length > 0) {
        // Check if user is in admin group
        const hasAdminGroup = userGroups.some(g => isAdminGroup(g));
        
        // Try to cache the groups for future use (ignore errors)
        try {
          await pool.query(
            'UPDATE users SET ldap_groups = $1 WHERE id = $2',
            [userGroups, req.user.id]
          );
        } catch (cacheErr) {
          logger.warn('Could not cache LDAP groups', { error: cacheErr.message });
        }
        
        if (hasAdminGroup) {
          req.isSystemAdmin = true;
          logger.info('System admin access granted via fresh LDAP groups', { username: req.user.username });
          return next();
        }
      }
    } catch (groupErr) {
      logger.warn('Failed to get fresh LDAP groups', { error: groupErr.message });
    }

    logger.warn('System admin access denied', { 
      userId: req.user.id, 
      username: req.user.username,
      authSource: req.user.auth_source,
      requiredGroup: SYSTEM_ADMIN_GROUP 
    });
    
    return res.status(403).json({ 
      error: 'System administrator access required',
      message: `You must be a member of the ${SYSTEM_ADMIN_GROUP} group to access this feature.`
    });
  } catch (error) {
    logger.error('Error checking system admin status', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to verify administrator status' });
  }
}

// All system routes require authentication
router.use(authenticateToken);

/**
 * GET /api/system/access-check
 * Check if current user has system admin access
 */
router.get('/access-check', async (req, res) => {
  try {
    let hasAccess = false;
    let reason = '';
    let userGroups = [];

    logger.info('Access check for user', { 
      username: req.user.username, 
      role: req.user.role,
      authSource: req.user.auth_source 
    });

    // Check if user has admin role - automatically grant access
    if (req.user.role === 'admin') {
      hasAccess = true;
      reason = 'Administrator role';
    }

    // For any user, try to get LDAP groups
    if (!hasAccess) {
      const authSource = req.user.auth_source || '';
      
      // Try live LDAP lookup
      try {
        const isInAdminGroup = await ldapService.isUserInGroup(req.user.username, SYSTEM_ADMIN_GROUP);
        userGroups = await ldapService.getUserGroups(req.user.username);
        
        if (isInAdminGroup) {
          hasAccess = true;
          reason = `Member of ${SYSTEM_ADMIN_GROUP}`;
        } else if (userGroups.some(g => isAdminGroup(g))) {
          hasAccess = true;
          reason = 'Member of admin group';
        }
        
        // Cache groups if we got them
        if (userGroups.length > 0) {
          await pool.query(
            'UPDATE users SET ldap_groups = $1 WHERE id = $2',
            [userGroups, req.user.id]
          ).catch(() => {});
        }
      } catch (ldapErr) {
        logger.warn('LDAP lookup failed, checking cached', { error: ldapErr.message });
      }
      
      // Check cached groups if LDAP failed
      if (!hasAccess) {
        try {
          const groupResult = await pool.query(
            'SELECT ldap_groups FROM users WHERE id = $1',
            [req.user.id]
          );
          
          const cachedGroups = groupResult.rows[0]?.ldap_groups || [];
          if (cachedGroups.length > 0) {
            userGroups = cachedGroups;
            if (cachedGroups.some(g => isAdminGroup(g))) {
              hasAccess = true;
              reason = 'Cached group membership';
            }
          }
        } catch (dbErr) {
          logger.warn('Could not read cached groups', { error: dbErr.message });
        }
      }
    }

    res.json({
      hasAccess,
      reason,
      user: req.user.username,
      role: req.user.role,
      authSource: req.user.auth_source,
      requiredGroup: SYSTEM_ADMIN_GROUP,
      configuredPatterns: ADMIN_GROUP_PATTERNS,
      userGroups: userGroups.slice(0, 20), // Return first 20 groups for debugging
      userGroupsSimple: userGroups.slice(0, 20).map(g => extractGroupName(g)) // Extracted names
    });
  } catch (error) {
    logger.error('Access check error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to check access' });
  }
});

/**
 * GET /api/system/audit-logs
 * Get audit logs for co-editing and file operations
 * Available to all authenticated users
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const { 
      action = 'all',
      resourceType = 'all',
      userId,
      fileId,
      limit = 50,
      offset = 0,
      startDate,
      endDate 
    } = req.query;

    let query = `
      SELECT 
        a.id,
        a.user_id,
        a.action,
        a.resource_type,
        a.resource_id,
        a.details,
        a.ip_address,
        a.created_at,
        u.display_name as user_name,
        u.email as user_email,
        f.original_filename as file_name
      FROM audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN files f ON a.resource_id::uuid = f.id AND a.resource_type = 'file'
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action !== 'all') {
      query += ` AND a.action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (resourceType !== 'all') {
      query += ` AND a.resource_type = $${paramIndex}`;
      params.push(resourceType);
      paramIndex++;
    }

    if (userId) {
      query += ` AND a.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (fileId) {
      query += ` AND a.resource_id = $${paramIndex}`;
      params.push(fileId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND a.created_at >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      query += ` AND a.created_at <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    const statsResult = await pool.query(`
      SELECT action, COUNT(*) as count
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY action
      ORDER BY count DESC
    `);

    res.json({
      logs: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name || 'Unknown',
        userEmail: row.user_email,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        fileName: row.file_name,
        details: row.details,
        ipAddress: row.ip_address,
        createdAt: row.created_at
      })),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: parseInt(offset) + parseInt(limit) < total,
      stats: statsResult.rows
    });
  } catch (error) {
    logger.error('Error getting audit logs', { error: error.message });
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

/**
 * GET /api/system/active-sessions
 * Get currently active editing sessions
 * Available to all authenticated users
 */
router.get('/active-sessions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.user_id,
        s.file_id,
        s.session_token,
        s.ip_address,
        s.user_agent,
        s.last_activity,
        u.display_name as user_name,
        u.email as user_email,
        f.original_filename as file_name
      FROM active_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN files f ON s.file_id = f.id
      WHERE s.last_activity > NOW() - INTERVAL '30 minutes'
      ORDER BY s.last_activity DESC
    `);

    const sessionsByFile = {};
    result.rows.forEach(row => {
      if (!sessionsByFile[row.file_id]) {
        sessionsByFile[row.file_id] = {
          fileId: row.file_id,
          fileName: row.file_name,
          editors: []
        };
      }
      sessionsByFile[row.file_id].editors.push({
        userId: row.user_id,
        userName: row.user_name || 'Unknown',
        userEmail: row.user_email,
        lastActivity: row.last_activity,
        ipAddress: row.ip_address
      });
    });

    res.json({
      sessions: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name || 'Unknown',
        userEmail: row.user_email,
        fileId: row.file_id,
        fileName: row.file_name,
        lastActivity: row.last_activity,
        ipAddress: row.ip_address
      })),
      byFile: Object.values(sessionsByFile),
      totalSessions: result.rows.length,
      totalFiles: Object.keys(sessionsByFile).length
    });
  } catch (error) {
    logger.error('Error getting active sessions', { error: error.message });
    res.status(500).json({ error: 'Failed to get active sessions' });
  }
});

// All routes below require system admin access
router.use(requireSystemAdmin);

/**
 * GET /api/system/health
 * Comprehensive health check for all services
 */
router.get('/health', async (req, res) => {
  const health = {
    timestamp: new Date().toISOString(),
    overall: 'healthy',
    services: {}
  };

  // 1. Database health
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const latency = Date.now() - start;
    
    const dbStats = await pool.query(`
      SELECT 
        (SELECT count(*) FROM users) as users_count,
        (SELECT count(*) FROM files WHERE is_deleted = false) as files_count,
        (SELECT count(*) FROM active_sessions WHERE last_activity > NOW() - INTERVAL '1 hour') as active_sessions
    `);
    
    health.services.database = {
      status: 'healthy',
      latency: `${latency}ms`,
      stats: dbStats.rows[0]
    };
  } catch (error) {
    health.services.database = { status: 'unhealthy', error: error.message };
    health.overall = 'degraded';
  }

  // 2. Redis health
  try {
    const redis = require('redis');
    const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    const start = Date.now();
    await client.ping();
    const latency = Date.now() - start;
    const info = await client.info('memory');
    await client.disconnect();
    
    health.services.redis = {
      status: 'healthy',
      latency: `${latency}ms`,
      memoryUsed: info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown'
    };
  } catch (error) {
    health.services.redis = { status: 'unhealthy', error: error.message };
    health.overall = 'degraded';
  }

  // 3. Collabora health
  try {
    const collaboraUrl = process.env.COLLABORA_URL || 'http://collabora:9980';
    const start = Date.now();
    const response = await fetch(`${collaboraUrl}/hosting/capabilities`, { 
      timeout: 5000,
      signal: AbortSignal.timeout(5000)
    });
    const latency = Date.now() - start;
    
    if (response.ok) {
      const capabilities = await response.json();
      health.services.collabora = {
        status: 'healthy',
        latency: `${latency}ms`,
        version: capabilities.convert?.available ? 'CODE' : 'Unknown',
        capabilities: {
          convert: capabilities.convert?.available || false,
          hasMobileSupport: capabilities.hasMobileSupport || false,
          hasProxyPrefix: capabilities.hasProxyPrefix || false
        }
      };
    } else {
      health.services.collabora = { status: 'degraded', statusCode: response.status };
      health.overall = 'degraded';
    }
  } catch (error) {
    health.services.collabora = { status: 'unhealthy', error: error.message };
    health.overall = 'degraded';
  }

  // 4. LDAP health
  if (process.env.LDAP_URL) {
    try {
      const ldapTest = await ldapService.testConnection();
      health.services.ldap = {
        status: ldapTest.success ? 'healthy' : 'unhealthy',
        serverType: ldapService.config.serverType,
        baseDN: ldapService.config.baseDN,
        ...ldapTest
      };
      if (!ldapTest.success) health.overall = 'degraded';
    } catch (error) {
      health.services.ldap = { status: 'unhealthy', error: error.message };
      health.overall = 'degraded';
    }
  } else {
    health.services.ldap = { status: 'not_configured' };
  }

  // 5. Storage health
  try {
    const storagePath = process.env.STORAGE_PATH || '/storage';
    const stats = await fs.stat(storagePath);
    
    // Check write permission
    const testFile = path.join(storagePath, '.healthcheck');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    
    health.services.storage = {
      status: 'healthy',
      path: storagePath,
      writable: true
    };
  } catch (error) {
    health.services.storage = { status: 'unhealthy', error: error.message };
    health.overall = 'degraded';
  }

  // 6. WOPI endpoints health
  try {
    const domain = process.env.DOMAIN || 'localhost';
    health.services.wopi = {
      status: 'healthy',
      endpoints: {
        files: `/wopi/files/{file_id}`,
        contents: `/wopi/files/{file_id}/contents`
      },
      baseUrl: `https://${domain}/wopi`
    };
  } catch (error) {
    health.services.wopi = { status: 'unhealthy', error: error.message };
  }

  res.json(health);
});

/**
 * GET /api/system/versions
 * Get version information for all components
 */
router.get('/versions', async (req, res) => {
  const versions = {
    timestamp: new Date().toISOString(),
    components: {}
  };

  // Node.js version
  versions.components.nodejs = {
    version: process.version,
    platform: process.platform,
    arch: process.arch
  };

  // Application version
  try {
    const packageJson = require('../../package.json');
    versions.components.application = {
      name: packageJson.name,
      version: packageJson.version
    };
  } catch {
    versions.components.application = { version: 'unknown' };
  }

  // PostgreSQL version
  try {
    const result = await pool.query('SELECT version()');
    versions.components.postgresql = {
      version: result.rows[0].version.split(' ')[1]
    };
  } catch (error) {
    versions.components.postgresql = { error: error.message };
  }

  // Redis version
  try {
    const redis = require('redis');
    const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    const info = await client.info('server');
    await client.disconnect();
    
    versions.components.redis = {
      version: info.match(/redis_version:(\S+)/)?.[1] || 'unknown'
    };
  } catch (error) {
    versions.components.redis = { error: error.message };
  }

  // Collabora version
  try {
    const collaboraUrl = process.env.COLLABORA_URL || 'http://collabora:9980';
    const response = await fetch(`${collaboraUrl}/hosting/capabilities`, {
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      versions.components.collabora = {
        productName: data.productName || 'Collabora Online',
        productVersion: data.productVersion || 'unknown'
      };
    }
  } catch (error) {
    versions.components.collabora = { error: error.message };
  }

  res.json(versions);
});

/**
 * GET /api/system/config
 * Get current configuration (sanitized)
 */
router.get('/config', async (req, res) => {
  try {
    // Read .env file if exists
    let envConfig = {};
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = await fs.readFile(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          envConfig[key] = value;
        }
      });
    } catch {
      // .env might not exist, use process.env
    }

    // Configuration categories
    const config = {
      general: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        DOMAIN: process.env.DOMAIN || 'localhost',
        PORT: process.env.PORT || '3000',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info'
      },
      authentication: {
        AUTH_MODE: process.env.AUTH_MODE || 'local',
        SESSION_TIMEOUT: process.env.SESSION_TIMEOUT || '86400',
        JWT_EXPIRY: '24h'
      },
      ldap: {
        LDAP_URL: process.env.LDAP_URL ? '***configured***' : 'not configured',
        LDAP_BASE_DN: process.env.LDAP_BASE_DN || '',
        LDAP_SERVER_TYPE: process.env.LDAP_SERVER_TYPE || 'auto',
        LDAP_USER_SEARCH_BASE: process.env.LDAP_USER_SEARCH_BASE || '',
        LDAP_ADMIN_GROUP: process.env.LDAP_ADMIN_GROUP || 'cn=admins'
      },
      collabora: {
        COLLABORA_URL: process.env.COLLABORA_URL || 'http://collabora:9980',
        COLLABORA_ADMIN_USER: process.env.COLLABORA_ADMIN_USER ? '***set***' : 'not set',
        MAX_UPLOAD_SIZE: process.env.MAX_UPLOAD_SIZE || '100'
      },
      storage: {
        STORAGE_PATH: process.env.STORAGE_PATH || '/storage',
        DEFAULT_QUOTA: process.env.DEFAULT_QUOTA || '1073741824'
      },
      whitelabel: {
        APP_NAME: process.env.APP_NAME || 'Collabora Documents',
        APP_LOGO_URL: process.env.APP_LOGO_URL || '',
        PRIMARY_COLOR: process.env.PRIMARY_COLOR || '#0066cc',
        SECONDARY_COLOR: process.env.SECONDARY_COLOR || '#f0f4f8',
        FAVICON_URL: process.env.FAVICON_URL || '',
        SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || '',
        SUPPORT_URL: process.env.SUPPORT_URL || '',
        CUSTOM_CSS: process.env.CUSTOM_CSS || '',
        FOOTER_TEXT: process.env.FOOTER_TEXT || ''
      },
      security: {
        RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || '900',
        RATE_LIMIT_REQUESTS: process.env.RATE_LIMIT_REQUESTS || '100',
        CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
      }
    };

    res.json(config);
  } catch (error) {
    logger.error('Error getting config', { error: error.message });
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

/**
 * PUT /api/system/config
 * Update configuration settings
 */
router.put('/config', async (req, res) => {
  try {
    const { category, settings } = req.body;
    
    if (!category || !settings) {
      return res.status(400).json({ error: 'Category and settings required' });
    }

    // Allowed categories for modification
    const allowedCategories = ['whitelabel', 'general', 'security'];
    if (!allowedCategories.includes(category)) {
      return res.status(403).json({ 
        error: 'Cannot modify this category',
        allowed: allowedCategories 
      });
    }

    // Read existing .env
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch {
      // Start with empty if doesn't exist
    }

    // Parse existing env
    const envLines = envContent.split('\n');
    const envMap = new Map();
    
    envLines.forEach((line, index) => {
      const match = line.match(/^([^#=]+)=/);
      if (match) {
        envMap.set(match[1].trim(), index);
      }
    });

    // Update or add settings
    Object.entries(settings).forEach(([key, value]) => {
      const envLine = `${key}=${value}`;
      if (envMap.has(key)) {
        envLines[envMap.get(key)] = envLine;
      } else {
        envLines.push(envLine);
      }
      // Update runtime
      process.env[key] = value;
    });

    // Write back
    await fs.writeFile(envPath, envLines.join('\n'));

    // Log the change
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'CONFIG_UPDATE', 'system', JSON.stringify({ category, keys: Object.keys(settings) }), req.ip]
    );

    logger.info('Configuration updated', { 
      category, 
      keys: Object.keys(settings),
      updatedBy: req.user.username 
    });

    res.json({ 
      success: true, 
      message: 'Configuration updated successfully',
      note: 'Some changes may require a service restart to take effect'
    });
  } catch (error) {
    logger.error('Error updating config', { error: error.message });
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * GET /api/system/logs
 * Get application logs with filtering
 */
router.get('/logs', async (req, res) => {
  try {
    const { 
      level = 'all', 
      search = '', 
      limit = 100,
      offset = 0,
      startDate,
      endDate 
    } = req.query;

    // Read from log files
    const logsDir = process.env.LOGS_PATH || path.join(process.cwd(), 'logs');
    const logFile = path.join(logsDir, 'combined.log');
    
    let logs = [];
    
    try {
      const logContent = await fs.readFile(logFile, 'utf8');
      const lines = logContent.split('\n').filter(line => line.trim());
      
      // Parse JSON logs
      logs = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line, level: 'info', timestamp: new Date().toISOString() };
        }
      }).reverse(); // Most recent first
    } catch {
      // If no log file, get from database audit log
      const result = await pool.query(`
        SELECT id, user_id, action, resource_type, resource_id, details, ip_address, created_at
        FROM audit_log
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), parseInt(offset)]);
      
      logs = result.rows.map(row => ({
        timestamp: row.created_at,
        level: 'info',
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: row.details,
        ip: row.ip_address,
        userId: row.user_id
      }));
    }

    // Apply filters
    let filtered = logs;
    
    if (level !== 'all') {
      filtered = filtered.filter(log => log.level === level);
    }
    
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(log => 
        JSON.stringify(log).toLowerCase().includes(searchLower)
      );
    }
    
    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter(log => new Date(log.timestamp) >= start);
    }
    
    if (endDate) {
      const end = new Date(endDate);
      filtered = filtered.filter(log => new Date(log.timestamp) <= end);
    }

    // Paginate
    const total = filtered.length;
    const paginated = filtered.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      logs: paginated,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: parseInt(offset) + parseInt(limit) < total
    });
  } catch (error) {
    logger.error('Error getting logs', { error: error.message });
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * GET /api/system/docker
 * Get Docker container status (if available)
 */
router.get('/docker', async (req, res) => {
  try {
    // Try to read docker-compose status via docker socket or compose file
    const containers = [
      { name: 'collabora', port: 9980, healthEndpoint: '/hosting/capabilities' },
      { name: 'wopi-server', port: 3000, healthEndpoint: '/health' },
      { name: 'postgres', port: 5432 },
      { name: 'redis', port: 6379 },
      { name: 'nginx', port: 443 }
    ];

    const status = await Promise.all(containers.map(async (container) => {
      const result = { name: container.name, status: 'unknown' };
      
      try {
        if (container.healthEndpoint) {
          const url = container.name === 'collabora' 
            ? `${process.env.COLLABORA_URL || 'http://collabora:9980'}${container.healthEndpoint}`
            : `http://${container.name}:${container.port}${container.healthEndpoint}`;
          
          const response = await fetch(url, { 
            signal: AbortSignal.timeout(3000)
          });
          result.status = response.ok ? 'running' : 'degraded';
          result.statusCode = response.status;
        } else if (container.name === 'postgres') {
          await pool.query('SELECT 1');
          result.status = 'running';
        } else if (container.name === 'redis') {
          const redis = require('redis');
          const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
          await client.connect();
          await client.ping();
          await client.disconnect();
          result.status = 'running';
        } else {
          result.status = 'unknown';
        }
      } catch (error) {
        result.status = 'unreachable';
        result.error = error.message;
      }
      
      return result;
    }));

    res.json({ containers: status });
  } catch (error) {
    logger.error('Error getting Docker status', { error: error.message });
    res.status(500).json({ error: 'Failed to get Docker status' });
  }
});

/**
 * POST /api/system/test-ldap
 * Test LDAP connection with specific settings
 */
router.post('/test-ldap', async (req, res) => {
  try {
    const result = await ldapService.testConnection();
    
    // Also get server info
    const serverInfo = {
      url: ldapService.config.url.replace(/:[^:]*@/, ':***@'),
      baseDN: ldapService.config.baseDN,
      serverType: ldapService.config.serverType,
      userSearchFilter: ldapService.config.userSearchFilter
    };

    res.json({ ...result, serverInfo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/system/stats
 * Get system statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = {};

    // User stats
    const userStats = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE is_active = true) as active_users,
        COUNT(*) FILTER (WHERE role = 'admin') as admin_users,
        COUNT(*) FILTER (WHERE auth_source = 'ldap' OR auth_source = 'ldap_ltpa') as ldap_users,
        COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '24 hours') as users_24h,
        COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '7 days') as users_7d
      FROM users
    `);
    stats.users = userStats.rows[0];

    // File stats
    const fileStats = await pool.query(`
      SELECT 
        COUNT(*) as total_files,
        SUM(size) as total_size,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as files_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as files_7d
      FROM files WHERE is_deleted = false
    `);
    stats.files = {
      ...fileStats.rows[0],
      total_size_formatted: formatBytes(parseInt(fileStats.rows[0].total_size) || 0)
    };

    // Session stats
    const sessionStats = await pool.query(`
      SELECT 
        COUNT(*) as active_sessions,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT file_id) as unique_files
      FROM active_sessions 
      WHERE last_activity > NOW() - INTERVAL '1 hour'
    `);
    stats.sessions = sessionStats.rows[0];

    // Storage stats
    const storageStats = await pool.query(`
      SELECT 
        SUM(storage_used) as total_used,
        SUM(storage_quota) as total_quota
      FROM users
    `);
    stats.storage = {
      used: parseInt(storageStats.rows[0].total_used) || 0,
      quota: parseInt(storageStats.rows[0].total_quota) || 0,
      used_formatted: formatBytes(parseInt(storageStats.rows[0].total_used) || 0),
      quota_formatted: formatBytes(parseInt(storageStats.rows[0].total_quota) || 0),
      percentage: Math.round((parseInt(storageStats.rows[0].total_used) / parseInt(storageStats.rows[0].total_quota)) * 100) || 0
    };

    res.json(stats);
  } catch (error) {
    logger.error('Error getting stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = router;
