const express = require('express');
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const ltpaKeysService = require('../services/ltpaKeys');
const ldapService = require('../services/ldap');
const ltpaService = require('../services/ltpa');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for LTPA keys file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB max
  fileFilter: (req, file, cb) => {
    // Accept .keys files or any text file
    if (file.originalname.endsWith('.keys') || file.mimetype.startsWith('text/')) {
      cb(null, true);
    } else {
      cb(new Error('Only .keys files are allowed'), false);
    }
  }
});

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * GET /api/admin/auth/status
 * Get current authentication configuration status
 */
router.get('/auth/status', async (req, res) => {
  try {
    const authMode = process.env.AUTH_MODE || 'local';
    
    const status = {
      authMode,
      ldap: {
        configured: !!process.env.LDAP_URL,
        url: process.env.LDAP_URL ? process.env.LDAP_URL.replace(/:[^:]*@/, ':***@') : null,
        baseDN: process.env.LDAP_BASE_DN || null
      },
      ltpa: await ltpaKeysService.getStatus()
    };

    // Test LDAP connection if configured
    if (status.ldap.configured && (authMode === 'ldap' || authMode === 'ldap_ltpa' || authMode === 'hybrid')) {
      const ldapTest = await ldapService.testConnection();
      status.ldap.connectionTest = ldapTest;
    }

    // Test LTPA configuration if configured
    if (status.ltpa.configured && (authMode === 'ltpa' || authMode === 'ldap_ltpa')) {
      const ltpaTest = ltpaService.testConfiguration();
      status.ltpa.configurationTest = ltpaTest;
    }

    res.json(status);
  } catch (error) {
    logger.error('Error getting auth status', { error: error.message });
    res.status(500).json({ error: 'Failed to get authentication status' });
  }
});

/**
 * POST /api/admin/ltpa/upload
 * Upload and configure LTPA keys file
 */
router.post('/ltpa/upload', upload.single('keysFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No keys file provided' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'LTPA keys password is required' });
    }

    const keysContent = req.file.buffer.toString('utf8');
    
    // Parse and store the keys
    const result = await ltpaKeysService.storeKeys(keysContent, password);

    // Get the parsed configuration
    const config = await ltpaKeysService.loadConfig();

    // Update environment variables in runtime
    if (config && config.desKey) {
      process.env.LTPA_SECRET_KEY = config.desKey;
      process.env.LTPA_REALM = config.realm;
      if (config.publicKey) process.env.LTPA_PUBLIC_KEY = config.publicKey;
      if (config.privateKey) process.env.LTPA_PRIVATE_KEY = config.privateKey;

      // Reinitialize LTPA service with new keys
      ltpaService.config.secretKey = config.desKey;
      ltpaService.config.realm = config.realm;
      ltpaService.keys = ltpaService.deriveKeys();
    }

    logger.info('LTPA keys uploaded and configured', { 
      realm: result.realm,
      uploadedBy: req.user.username 
    });

    res.json({
      success: true,
      message: 'LTPA keys configured successfully',
      realm: result.realm,
      version: result.version
    });
  } catch (error) {
    logger.error('LTPA keys upload failed', { error: error.message });
    res.status(500).json({ 
      error: 'Failed to configure LTPA keys',
      details: error.message 
    });
  }
});

/**
 * POST /api/admin/ltpa/configure
 * Configure LTPA with manual key input
 */
router.post('/ltpa/configure', async (req, res) => {
  try {
    const { secretKey, publicKey, privateKey, realm, cookieName } = req.body;

    if (!secretKey) {
      return res.status(400).json({ error: 'LTPA secret key is required' });
    }

    // Store configuration
    const config = {
      desKey: secretKey,
      publicKey: publicKey || '',
      privateKey: privateKey || '',
      realm: realm || 'defaultRealm',
      version: '2',
      creationDate: new Date().toISOString()
    };

    await ltpaKeysService.storeKeys(config, null);

    // Update environment variables
    process.env.LTPA_SECRET_KEY = secretKey;
    process.env.LTPA_REALM = realm || 'defaultRealm';
    if (publicKey) process.env.LTPA_PUBLIC_KEY = publicKey;
    if (privateKey) process.env.LTPA_PRIVATE_KEY = privateKey;
    if (cookieName) process.env.LTPA_COOKIE_NAME = cookieName;

    // Reinitialize LTPA service
    ltpaService.config.secretKey = secretKey;
    ltpaService.config.realm = realm || 'defaultRealm';
    if (cookieName) ltpaService.config.cookieName = cookieName;
    ltpaService.keys = ltpaService.deriveKeys();

    // Test the configuration
    const testResult = ltpaService.testConfiguration();

    logger.info('LTPA manually configured', { 
      realm: config.realm,
      configuredBy: req.user.username 
    });

    res.json({
      success: true,
      message: 'LTPA configured successfully',
      realm: config.realm,
      test: testResult
    });
  } catch (error) {
    logger.error('LTPA configuration failed', { error: error.message });
    res.status(500).json({ error: 'Failed to configure LTPA' });
  }
});

/**
 * GET /api/admin/ltpa/status
 * Get LTPA configuration status
 */
router.get('/ltpa/status', async (req, res) => {
  try {
    const status = await ltpaKeysService.getStatus();
    
    // Add runtime test
    if (status.configured) {
      status.runtimeTest = ltpaService.testConfiguration();
    }

    res.json(status);
  } catch (error) {
    logger.error('Error getting LTPA status', { error: error.message });
    res.status(500).json({ error: 'Failed to get LTPA status' });
  }
});

/**
 * DELETE /api/admin/ltpa/config
 * Remove LTPA configuration
 */
router.delete('/ltpa/config', async (req, res) => {
  try {
    await ltpaKeysService.deleteConfig();

    // Clear environment variables
    delete process.env.LTPA_SECRET_KEY;
    delete process.env.LTPA_PUBLIC_KEY;
    delete process.env.LTPA_PRIVATE_KEY;

    // Reset LTPA service
    ltpaService.config.secretKey = '';
    ltpaService.keys = null;

    logger.info('LTPA configuration removed', { removedBy: req.user.username });

    res.json({ success: true, message: 'LTPA configuration removed' });
  } catch (error) {
    logger.error('Error removing LTPA config', { error: error.message });
    res.status(500).json({ error: 'Failed to remove LTPA configuration' });
  }
});

/**
 * GET /api/admin/ldap/test
 * Test LDAP connection
 */
router.get('/ldap/test', async (req, res) => {
  try {
    if (!process.env.LDAP_URL) {
      return res.status(400).json({ error: 'LDAP not configured' });
    }

    const result = await ldapService.testConnection();
    res.json(result);
  } catch (error) {
    logger.error('LDAP test failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/ldap/test-user
 * Test LDAP user lookup
 */
router.post('/ldap/test-user', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    const exists = await ldapService.userExistsInLDAP(username);
    const userInfo = exists ? await ldapService.getUserFromLDAP(username) : null;

    res.json({
      username,
      found: exists,
      userInfo: userInfo ? {
        email: userInfo.email,
        displayName: userInfo.displayName,
        groups: userInfo.groups?.length || 0
      } : null
    });
  } catch (error) {
    logger.error('LDAP user test failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
