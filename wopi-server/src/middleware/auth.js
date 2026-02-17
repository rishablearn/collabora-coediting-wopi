const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const logger = require('../utils/logger');
const ltpaService = require('../services/ltpa');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const AUTH_MODE = process.env.AUTH_MODE || 'local'; // local, ldap, ltpa, ldap_ltpa, hybrid

/**
 * Middleware to authenticate JWT tokens
 * Supports: local, ldap, ltpa, ldap_ltpa (combined), hybrid
 */
async function authenticateToken(req, res, next) {
  // Try LTPA token first if enabled (ltpa, ldap_ltpa, or hybrid modes)
  if (AUTH_MODE === 'ltpa' || AUTH_MODE === 'ldap_ltpa' || AUTH_MODE === 'hybrid') {
    const ltpaToken = ltpaService.getTokenFromRequest(req);
    if (ltpaToken) {
      const ltpaUser = await ltpaService.validateToken(ltpaToken);
      if (ltpaUser) {
        // For ldap_ltpa mode, validate user exists in LDAP
        if (AUTH_MODE === 'ldap_ltpa') {
          const ldapService = require('../services/ldap');
          const ldapValid = await ldapService.userExistsInLDAP(ltpaUser.username);
          if (!ldapValid) {
            logger.warn('LTPA user not found in LDAP', { username: ltpaUser.username });
            // Continue to try other auth methods
          } else {
            const user = await findOrCreateLTPAUser(ltpaUser, 'ldap_ltpa');
            if (user) {
              req.user = user;
              req.authMethod = 'ldap_ltpa';
              return next();
            }
          }
        } else {
          // Standard LTPA mode
          const user = await findOrCreateLTPAUser(ltpaUser, 'ltpa');
          if (user) {
            req.user = user;
            req.authMethod = 'ltpa';
            return next();
          }
        }
      }
    }
  }

  // Try JWT token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch user from database
    const result = await pool.query(
      'SELECT id, email, username, display_name, role, is_active, auth_source FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = user;
    req.authMethod = user.auth_source || 'local';
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    logger.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * Find or create user from LTPA token data
 * @param {Object} ltpaUser - User data from LTPA token
 * @param {string} authSource - Authentication source (ltpa, ldap_ltpa)
 */
async function findOrCreateLTPAUser(ltpaUser, authSource = 'ltpa') {
  try {
    // Try to find existing user
    let result = await pool.query(
      'SELECT id, email, username, display_name, role, is_active FROM users WHERE username = $1',
      [ltpaUser.username]
    );

    if (result.rows.length > 0) {
      // Update auth source and last login
      await pool.query(
        'UPDATE users SET auth_source = $1, last_login = CURRENT_TIMESTAMP WHERE id = $2',
        [authSource, result.rows[0].id]
      );
      return result.rows[0];
    }

    // Create new user from LTPA
    const email = ltpaUser.attributes?.mail || `${ltpaUser.username}@${ltpaUser.realm || 'ltpa.local'}`;
    const displayName = ltpaUser.attributes?.cn || ltpaUser.username;

    result = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, role, auth_source, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (username) DO UPDATE SET last_login = CURRENT_TIMESTAMP, auth_source = $6
       RETURNING id, email, username, display_name, role, is_active`,
      [ltpaUser.username, email, 'EXTERNAL_AUTH', displayName, 'user', authSource]
    );

    // Create root folder for new user
    if (result.rows.length > 0) {
      await pool.query(
        'INSERT INTO folders (owner_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [result.rows[0].id, 'My Documents']
      );
    }

    logger.info('Created user from LTPA', { username: ltpaUser.username, authSource });
    return result.rows[0];
  } catch (error) {
    logger.error('Error finding/creating LTPA user', { error: error.message });
    return null;
  }
}

/**
 * Middleware to check admin role
 */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, username, display_name, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length > 0 && result.rows[0].is_active) {
      req.user = result.rows[0];
    }
  } catch (error) {
    // Ignore token errors for optional auth
  }

  next();
}

/**
 * Generate JWT token for user
 */
function generateToken(user) {
  return jwt.sign(
    { 
      userId: user.id, 
      email: user.email,
      role: user.role 
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Generate refresh token
 */
function generateRefreshToken(user) {
  return jwt.sign(
    { userId: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth,
  generateToken,
  generateRefreshToken
};
