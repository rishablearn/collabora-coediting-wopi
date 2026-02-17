const crypto = require('crypto');
const CryptoJS = require('crypto-js');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get WOPI secret with validation
 */
function getWopiSecret() {
  const secret = process.env.WOPI_SECRET;
  if (!secret || secret.startsWith('CHANGE_ME') || secret.length < 32) {
    throw new Error('WOPI_SECRET is not configured or is insecure. Please generate a secure secret with: openssl rand -hex 32');
  }
  return secret;
}

/**
 * Generate a secure access token for WOPI
 * Enhanced to support LTPA user info for co-editing
 * 
 * @param {string} fileId - File ID
 * @param {string} userId - User ID
 * @param {string} permissions - Permission level (view, edit, admin)
 * @param {Object} userInfo - Additional user info for co-editing (displayName, email, authSource)
 */
function generateAccessToken(fileId, userId, permissions = 'view', userInfo = {}) {
  const payload = {
    fileId,
    userId,
    permissions,
    // User info for WOPI CheckFileInfo
    displayName: userInfo.displayName || userInfo.username || 'Unknown User',
    email: userInfo.email || '',
    authSource: userInfo.authSource || 'local', // local, ldap, ltpa
    ldapDn: userInfo.ldapDn || null,
    // Session tracking for co-editing
    sessionId: crypto.randomBytes(8).toString('hex'),
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex')
  };
  
  const secret = getWopiSecret();
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), secret).toString();
  return Buffer.from(encrypted).toString('base64url');
}

/**
 * Verify and decode access token
 */
function verifyAccessToken(token) {
  try {
    const secret = getWopiSecret();
    const encrypted = Buffer.from(token, 'base64url').toString();
    const decrypted = CryptoJS.AES.decrypt(encrypted, secret);
    const payload = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
    
    // Token expires after 24 hours
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - payload.timestamp > maxAge) {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Generate a random file ID
 */
function generateFileId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a lock ID for WOPI locking
 */
function generateLockId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a password using bcrypt-compatible method
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * Verify a password against a hash
 */
function verifyPassword(password, hash) {
  const [saltHex, keyHex] = hash.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const key = crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
  return key.toString('hex') === keyHex;
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateFileId,
  generateLockId,
  hashPassword,
  verifyPassword
};
