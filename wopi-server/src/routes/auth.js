const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticateToken, generateToken, generateRefreshToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const ldapService = require('../services/ldap');
const ltpaService = require('../services/ltpa');

const router = express.Router();
const AUTH_MODE = process.env.AUTH_MODE || 'local'; // local, ldap, ltpa, ldap_ltpa, hybrid

logger.info('Auth routes initialized', { authMode: AUTH_MODE });

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3, max: 50 }).trim().escape(),
  body('password').isLength({ min: 8 }),
  body('displayName').optional().trim().escape()
];

// Login validation - accept either email or username
const loginValidation = [
  body('password').exists(),
  body().custom((value) => {
    if (!value.email && !value.username) {
      throw new Error('Email or username is required');
    }
    return true;
  })
];

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Registration validation failed', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, username, password, displayName } = req.body;
    logger.info('Registration attempt', { email, username });

    // Test database connection first
    try {
      await pool.query('SELECT 1');
    } catch (dbErr) {
      logger.error('Database connection test failed:', dbErr.message);
      return res.status(503).json({ error: 'Database unavailable' });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      logger.info('Registration rejected - user exists', { email, username });
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, username, display_name, role, created_at`,
      [email, username, passwordHash, displayName || username]
    );

    const user = result.rows[0];
    logger.info('User created', { userId: user.id, email });

    // Create root folder for user (non-critical, don't fail registration if this fails)
    try {
      await pool.query(
        'INSERT INTO folders (owner_id, name) VALUES ($1, $2)',
        [user.id, 'My Documents']
      );
    } catch (folderErr) {
      logger.warn('Failed to create root folder for user', { userId: user.id, error: folderErr.message });
    }

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Log audit (non-critical)
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, action, resource_type, details, ip_address) 
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, 'REGISTER', 'user', JSON.stringify({ email }), req.ip]
      );
    } catch (auditErr) {
      logger.warn('Failed to log audit for registration', { userId: user.id, error: auditErr.message });
    }

    logger.info(`User registered successfully: ${email}`);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      token,
      refreshToken
    });
  } catch (error) {
    logger.error('Registration error:', error.message, { 
      stack: error.stack,
      code: error.code,
      detail: error.detail 
    });
    
    // Handle specific database errors
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email or username already exists' });
    }
    if (error.code === 'ECONNREFUSED' || error.code === '57P03') {
      return res.status(503).json({ error: 'Database connection failed' });
    }
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Database not initialized. Please run database migrations.' });
    }
    
    res.status(500).json({ 
      error: 'Registration failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user (supports local, LDAP, LTPA, ldap_ltpa, and hybrid modes)
 * Accepts: { email, password } or { username, password }
 */
router.post('/login', loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, username } = req.body;
    const loginIdentifier = username || email;
    let user = null;
    let authSource = 'local';

    logger.info('Login attempt', { 
      loginIdentifier, 
      authMode: AUTH_MODE,
      hasEmail: !!email,
      hasUsername: !!username
    });

    // Try LDAP authentication if enabled
    if (['ldap', 'hybrid', 'ldap_ltpa'].includes(AUTH_MODE)) {
      logger.info('Attempting LDAP authentication', { 
        loginIdentifier, 
        authMode: AUTH_MODE,
        ldapUrl: process.env.LDAP_URL 
      });
      
      try {
        const ldapUser = await ldapService.authenticate(loginIdentifier, password);
        if (ldapUser) {
          logger.info('LDAP authentication successful', { 
            username: ldapUser.username,
            email: ldapUser.email,
            isDomino: ldapUser.isDomino
          });
          authSource = AUTH_MODE === 'ldap_ltpa' ? 'ldap_ltpa' : 'ldap';
          // Find or create user from LDAP
          user = await findOrCreateLDAPUser(ldapUser);
        } else {
          logger.warn('LDAP authentication returned null', { loginIdentifier });
        }
      } catch (ldapErr) {
        logger.error('LDAP authentication error', { 
          error: ldapErr.message,
          hint: ldapErr.hint,
          loginIdentifier 
        });
        // Only fall through to local auth if in hybrid mode
        if (AUTH_MODE !== 'hybrid') {
          return res.status(401).json({ 
            error: 'Authentication failed',
            details: process.env.NODE_ENV !== 'production' ? ldapErr.message : undefined,
            hint: process.env.NODE_ENV !== 'production' ? ldapErr.hint : undefined
          });
        }
      }
    }

    // Try local authentication if LDAP failed or not enabled
    if (!user && (AUTH_MODE === 'local' || AUTH_MODE === 'hybrid')) {
      const result = await pool.query(
        'SELECT * FROM users WHERE (email = $1 OR username = $1) AND is_active = true',
        [loginIdentifier]
      );

      if (result.rows.length > 0) {
        const localUser = result.rows[0];
        // Skip password check for LDAP/LTPA users (they have placeholder hashes)
        if (localUser.auth_source === 'local' || !localUser.auth_source) {
          const validPassword = await bcrypt.compare(password, localUser.password_hash);
          if (validPassword) {
            user = localUser;
            authSource = 'local';
          }
        }
      }
    }

    if (!user) {
      logger.warn('Login failed - invalid credentials', { loginIdentifier, authMode: AUTH_MODE });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Generate LTPA token if in LTPA-enabled modes
    let ltpaToken = null;
    if (['ltpa', 'ldap_ltpa', 'hybrid'].includes(AUTH_MODE)) {
      try {
        ltpaToken = ltpaService.generateToken(user.username, {
          mail: user.email,
          cn: user.display_name
        });
        ltpaService.setTokenCookie(res, ltpaToken);
        logger.info('LTPA token generated and set as cookie', { username: user.username });
      } catch (ltpaErr) {
        logger.warn('Failed to generate LTPA token', { error: ltpaErr.message });
      }
    }

    // Log audit
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, action, resource_type, details, ip_address) 
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, 'LOGIN', 'user', JSON.stringify({ email: user.email, authSource }), req.ip]
      );
    } catch (auditErr) {
      logger.warn('Failed to log audit for login', { error: auditErr.message });
    }

    logger.info('Login successful', { 
      userId: user.id, 
      email: user.email, 
      authSource,
      hasLtpaToken: !!ltpaToken
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      token,
      refreshToken,
      authSource
    });
  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Login failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * Find or create user from LDAP authentication
 */
async function findOrCreateLDAPUser(ldapUser) {
  try {
    let result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [ldapUser.username]
    );

    if (result.rows.length > 0) {
      // Update existing user with LDAP info
      await pool.query(
        'UPDATE users SET display_name = $1, auth_source = $2 WHERE id = $3',
        [ldapUser.displayName, 'ldap', result.rows[0].id]
      );
      return result.rows[0];
    }

    // Create new user from LDAP
    result = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name, role, auth_source, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [ldapUser.username, ldapUser.email, 'LDAP_AUTH', ldapUser.displayName, ldapUser.role, 'ldap']
    );

    // Create root folder for new user
    if (result.rows.length > 0) {
      await pool.query(
        'INSERT INTO folders (owner_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [result.rows[0].id, 'My Documents']
      );
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error finding/creating LDAP user', { error: error.message });
    throw error;
  }
}

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const token = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({ token, refreshToken: newRefreshToken });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, username, display_name, role, storage_quota, storage_used, created_at, last_login
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      storageQuota: user.storage_quota,
      storageUsed: user.storage_used,
      createdAt: user.created_at,
      lastLogin: user.last_login
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (invalidate session)
 */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, ip_address) 
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'LOGOUT', 'user', req.ip]
    );

    // Clear active sessions
    await pool.query(
      'DELETE FROM active_sessions WHERE user_id = $1',
      [req.user.id]
    );

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * PUT /api/auth/password
 * Change password
 */
router.put('/password', authenticateToken, [
  body('currentPassword').exists(),
  body('newPassword').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, req.user.id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, ip_address) 
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'PASSWORD_CHANGE', 'user', req.ip]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
