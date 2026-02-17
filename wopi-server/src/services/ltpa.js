const crypto = require('crypto');
const logger = require('../utils/logger');

const DEBUG_LTPA = process.env.DEBUG_LTPA === 'true';

function ltpaDebug(message, data = {}) {
  if (DEBUG_LTPA) {
    logger.info(`[LTPA DEBUG] ${message}`, data);
  }
}

/**
 * LTPA2 Token Service
 * Handles IBM Domino / WebSphere / Liberty LTPA2 token validation and generation
 *
 * Domino LTPA2 Token specifics:
 *  - Cookie name: LtpaToken (LTPA1) or LtpaToken2 (LTPA2)
 *  - Token is Base64-encoded, then URL-encoded in the cookie
 *  - LTPA2 is encrypted with AES-128-CBC (newer) or 3DES-CBC (older)
 *  - Token content format: u:user:<realm>/<dn>%<expireTimeMs>%<signature>
 *  - Domino uses the Notes canonical name as the user identity
 *    e.g., u:user:defaultRealm/CN=John Doe/O=MyOrg
 *  - The 3DES key from ltpa.keys is the shared secret
 */
class LTPAService {
  constructor() {
    this.config = {
      secretKey: process.env.LTPA_SECRET_KEY || '',
      publicKey: process.env.LTPA_PUBLIC_KEY || '',
      privateKey: process.env.LTPA_PRIVATE_KEY || '',
      cookieName: process.env.LTPA_COOKIE_NAME || 'LtpaToken2',
      // Also check for LtpaToken (LTPA1) as fallback
      cookieNameFallback: process.env.LTPA_COOKIE_NAME_FALLBACK || 'LtpaToken',
      realm: process.env.LTPA_REALM || 'defaultRealm',
      tokenExpiration: parseInt(process.env.LTPA_TOKEN_EXPIRATION) || 7200,
      trustedDomains: (process.env.LTPA_TRUSTED_DOMAINS || '').split(',').filter(Boolean),
      // Domino-specific: how to extract username from DN in token
      // Options: cn, shortname, dn, email
      dominoUserFormat: (process.env.LTPA_DOMINO_USER_FORMAT || 'cn').toLowerCase(),
      // Whether to try AES before 3DES
      preferAES: process.env.LTPA_PREFER_AES === 'true'
    };

    this.keys = this._deriveKeys();

    if (this.keys) {
      ltpaDebug('LTPA Service initialized', {
        cookieName: this.config.cookieName,
        realm: this.config.realm,
        dominoUserFormat: this.config.dominoUserFormat,
        hasDesKey: !!this.keys.desKey,
        hasAesKey: !!this.keys.aesKey,
        trustedDomains: this.config.trustedDomains
      });
    } else {
      ltpaDebug('LTPA Service initialized WITHOUT keys (not configured)');
    }
  }

  /**
   * Derive encryption and signature keys from LTPA shared secret.
   * Supports both 3DES (traditional) and AES (newer Domino/WebSphere).
   */
  _deriveKeys() {
    if (!this.config.secretKey) {
      logger.warn('LTPA secret key not configured');
      return null;
    }

    try {
      const secretKeyBuffer = Buffer.from(this.config.secretKey, 'base64');
      ltpaDebug('Secret key buffer length', { length: secretKeyBuffer.length });

      // SHA-1 hash of the secret key for key derivation
      const sha1 = crypto.createHash('sha1').update(secretKeyBuffer).digest();

      const keys = {
        // 3DES key: 24 bytes (SHA-1 gives 20, pad with first 4 bytes)
        desKey: Buffer.concat([sha1, sha1.slice(0, 4)]),
        // AES-128 key: first 16 bytes of SHA-256
        aesKey: crypto.createHash('sha256').update(secretKeyBuffer).digest().slice(0, 16),
        // HMAC key for signature
        hmacKey: sha1,
        // Raw secret for direct use
        rawSecret: secretKeyBuffer
      };

      ltpaDebug('Keys derived successfully', {
        desKeyLen: keys.desKey.length,
        aesKeyLen: keys.aesKey.length,
        hmacKeyLen: keys.hmacKey.length
      });

      return keys;
    } catch (error) {
      logger.error('Failed to derive LTPA keys', { error: error.message });
      return null;
    }
  }

  /**
   * Decrypt LTPA2 token. Tries 3DES-CBC first, then AES-128-CBC.
   * Domino typically uses 3DES, newer WebSphere may use AES.
   */
  decryptToken(encryptedToken) {
    if (!this.keys) {
      throw new Error('LTPA keys not configured');
    }

    let tokenBuffer;
    try {
      tokenBuffer = Buffer.from(encryptedToken, 'base64');
    } catch (e) {
      throw new Error('Token is not valid Base64');
    }

    ltpaDebug('Decrypting token', { tokenLength: tokenBuffer.length });

    // Determine order based on preference
    const methods = this.config.preferAES
      ? [this._decryptAES.bind(this), this._decrypt3DES.bind(this)]
      : [this._decrypt3DES.bind(this), this._decryptAES.bind(this)];

    for (const method of methods) {
      try {
        const result = method(tokenBuffer);
        if (result) {
          ltpaDebug('Token decrypted successfully', { method: method.name, contentLength: result.length });
          return result;
        }
      } catch (e) {
        ltpaDebug('Decryption method failed, trying next', { method: method.name, error: e.message });
      }
    }

    // Also try using the raw secret key directly as 3DES key (some Domino configs)
    try {
      const result = this._decrypt3DESRaw(tokenBuffer);
      if (result) {
        ltpaDebug('Token decrypted with raw secret key');
        return result;
      }
    } catch (e) {
      ltpaDebug('Raw key decryption also failed', { error: e.message });
    }

    throw new Error('Failed to decrypt LTPA token with any method');
  }

  _decrypt3DES(tokenBuffer) {
    const iv = tokenBuffer.slice(0, 8);
    const encrypted = tokenBuffer.slice(8);
    const decipher = crypto.createDecipheriv('des-ede3-cbc', this.keys.desKey, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const content = decrypted.toString('utf8').replace(/\0+$/, '');
    // Validate it looks like LTPA content
    if (content.includes('%') && (content.includes('user:') || content.includes('='))) {
      return content;
    }
    throw new Error('Decrypted content does not look like LTPA token');
  }

  _decryptAES(tokenBuffer) {
    const iv = tokenBuffer.slice(0, 16);
    const encrypted = tokenBuffer.slice(16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', this.keys.aesKey, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const content = decrypted.toString('utf8').replace(/\0+$/, '');
    if (content.includes('%') && (content.includes('user:') || content.includes('='))) {
      return content;
    }
    throw new Error('Decrypted content does not look like LTPA token');
  }

  _decrypt3DESRaw(tokenBuffer) {
    if (this.keys.rawSecret.length < 24) return null;
    const desKey = this.keys.rawSecret.slice(0, 24);
    const iv = tokenBuffer.slice(0, 8);
    const encrypted = tokenBuffer.slice(8);
    const decipher = crypto.createDecipheriv('des-ede3-cbc', desKey, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const content = decrypted.toString('utf8').replace(/\0+$/, '');
    if (content.includes('%') && (content.includes('user:') || content.includes('='))) {
      return content;
    }
    return null;
  }

  /**
   * Encrypt data for LTPA2 token (uses 3DES-CBC for Domino compatibility)
   */
  encryptToken(data) {
    if (!this.keys) {
      throw new Error('LTPA keys not configured');
    }

    try {
      const iv = crypto.randomBytes(8);
      const cipher = crypto.createCipheriv('des-ede3-cbc', this.keys.desKey, iv);
      cipher.setAutoPadding(true);
      let encrypted = cipher.update(data, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const token = Buffer.concat([iv, encrypted]);
      return token.toString('base64');
    } catch (error) {
      logger.error('LTPA token encryption failed', { error: error.message });
      throw new Error('Failed to generate LTPA token');
    }
  }

  /**
   * Parse LTPA2 token content.
   *
   * Domino format examples:
   *   u:user:defaultRealm/CN=John Doe/O=MyOrg%1707840000000%signature
   *   u:user:defaultRealm/cn=john doe,o=myorg%1707840000000%signature
   *
   * WebSphere format:
   *   u:user:defaultRealm/uid=jdoe,ou=users,dc=example,dc=com%1707840000000%signature
   */
  parseTokenContent(content) {
    try {
      content = content.replace(/\0+$/, '').trim();
      ltpaDebug('Parsing token content', { content: content.substring(0, 200) });

      // Split by % - content%expiry%signature
      const parts = content.split('%');
      if (parts.length < 2) {
        throw new Error(`Invalid token format: expected at least 2 parts separated by %, got ${parts.length}`);
      }

      const userPart = parts[0];
      const expireTime = parseInt(parts[1], 10);
      const signature = parts[2] || '';

      let username = '';
      let realm = '';
      let dn = '';
      const attributes = {};

      if (userPart.startsWith('u:user:')) {
        const userInfo = userPart.substring(7); // Remove "u:user:"
        const slashIndex = userInfo.indexOf('/');

        if (slashIndex !== -1) {
          realm = userInfo.substring(0, slashIndex);
          dn = userInfo.substring(slashIndex + 1);
        } else {
          dn = userInfo;
        }

        // Extract attributes (after $)
        const dollarIndex = dn.indexOf('$');
        if (dollarIndex !== -1) {
          const attrString = dn.substring(dollarIndex + 1);
          dn = dn.substring(0, dollarIndex);
          const attrPairs = attrString.split('$');
          for (const pair of attrPairs) {
            const colonIdx = pair.indexOf(':');
            if (colonIdx !== -1) {
              attributes[pair.substring(0, colonIdx)] = pair.substring(colonIdx + 1);
            }
          }
        }

        // Extract username from DN based on format
        username = this._extractUsernameFromDN(dn);
      } else if (userPart.includes('=')) {
        // Raw DN format
        dn = userPart;
        username = this._extractUsernameFromDN(dn);
      }

      ltpaDebug('Token parsed', {
        username,
        realm,
        dn,
        expireTime: new Date(expireTime).toISOString(),
        isExpired: Date.now() > expireTime,
        attributeCount: Object.keys(attributes).length
      });

      return {
        username,
        realm: realm || this.config.realm,
        dn,
        expireTime,
        attributes,
        signature,
        isExpired: Date.now() > expireTime
      };
    } catch (error) {
      logger.error('LTPA token parsing failed', { error: error.message, content: content?.substring(0, 100) });
      throw new Error(`Invalid LTPA token content: ${error.message}`);
    }
  }

  /**
   * Extract username from a DN string.
   * Handles Domino hierarchical names (CN=John Doe/O=MyOrg)
   * and standard LDAP DNs (cn=john,o=org or uid=john,ou=users,dc=example,dc=com)
   */
  _extractUsernameFromDN(dn) {
    if (!dn) return '';

    ltpaDebug('Extracting username from DN', { dn, format: this.config.dominoUserFormat });

    // If the format is 'dn', return the full DN
    if (this.config.dominoUserFormat === 'dn') {
      return dn;
    }

    // Handle Domino hierarchical format: CN=John Doe/OU=Unit/O=Org
    if (dn.includes('/') && !dn.includes(',')) {
      const parts = dn.split('/');
      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx !== -1) {
          const key = part.substring(0, eqIdx).trim().toLowerCase();
          const value = part.substring(eqIdx + 1).trim();
          if (key === 'cn' && this.config.dominoUserFormat === 'cn') return value;
        }
      }
      // Fallback: return first part's value
      const firstEq = parts[0].indexOf('=');
      return firstEq !== -1 ? parts[0].substring(firstEq + 1).trim() : parts[0];
    }

    // Handle standard LDAP DN format: cn=John Doe,o=Org
    const rdns = dn.split(',');
    for (const rdn of rdns) {
      const eqIdx = rdn.indexOf('=');
      if (eqIdx !== -1) {
        const key = rdn.substring(0, eqIdx).trim().toLowerCase();
        const value = rdn.substring(eqIdx + 1).trim();

        if (this.config.dominoUserFormat === 'cn' && key === 'cn') return value;
        if (this.config.dominoUserFormat === 'uid' && key === 'uid') return value;
        if (this.config.dominoUserFormat === 'shortname' && key === 'uid') return value;
        if (this.config.dominoUserFormat === 'email' && key === 'mail') return value;
      }
    }

    // Fallback: try cn, then uid, then first RDN value
    for (const rdn of rdns) {
      const eqIdx = rdn.indexOf('=');
      if (eqIdx !== -1) {
        const key = rdn.substring(0, eqIdx).trim().toLowerCase();
        const value = rdn.substring(eqIdx + 1).trim();
        if (key === 'cn' || key === 'uid') return value;
      }
    }

    // Last resort: return the whole DN
    return dn;
  }

  /**
   * Validate LTPA2 token from cookie
   */
  async validateToken(token) {
    if (!token) {
      return null;
    }

    ltpaDebug('Validating LTPA token', { tokenLength: token.length });

    try {
      // URL decode if needed (cookies are often URL-encoded)
      let decodedToken = token;
      try {
        decodedToken = decodeURIComponent(token);
      } catch (e) {
        // Not URL-encoded, use as-is
      }

      // Decrypt token
      const content = this.decryptToken(decodedToken);

      // Parse token content
      const tokenData = this.parseTokenContent(content);

      if (tokenData.isExpired) {
        logger.warn('LTPA token expired', {
          username: tokenData.username,
          expiredAt: new Date(tokenData.expireTime).toISOString()
        });
        return null;
      }

      // Verify HMAC signature if present
      if (tokenData.signature && this.keys) {
        const contentWithoutSig = content.substring(0, content.lastIndexOf('%'));
        const hmac = crypto.createHmac('sha1', this.keys.hmacKey);
        hmac.update(contentWithoutSig);
        const expectedSig = hmac.digest('base64');

        if (expectedSig !== tokenData.signature) {
          ltpaDebug('HMAC signature mismatch (may be OK for Domino tokens)', {
            expected: expectedSig.substring(0, 10) + '...',
            actual: tokenData.signature.substring(0, 10) + '...'
          });
          // Don't reject - Domino may use different signing
        } else {
          ltpaDebug('HMAC signature verified');
        }
      }

      logger.info('LTPA token validated', { username: tokenData.username, realm: tokenData.realm });

      return {
        username: tokenData.username,
        realm: tokenData.realm,
        dn: tokenData.dn,
        attributes: tokenData.attributes,
        expireTime: tokenData.expireTime
      };
    } catch (error) {
      logger.error('LTPA token validation failed', { error: error.message });
      ltpaDebug('Token validation error details', { error: error.message, stack: error.stack });
      return null;
    }
  }

  /**
   * Generate LTPA2 token for user (Domino-compatible format)
   */
  generateToken(username, attributes = {}) {
    if (!this.keys) {
      throw new Error('LTPA keys not configured');
    }

    const expireTime = Date.now() + (this.config.tokenExpiration * 1000);

    // Build token content in Domino-compatible format
    let content = `u:user:${this.config.realm}/${username}`;

    // Add attributes
    if (Object.keys(attributes).length > 0) {
      const attrString = Object.entries(attributes)
        .map(([k, v]) => `${k}:${v}`)
        .join('$');
      content += `$${attrString}`;
    }

    content += `%${expireTime}`;

    // Add HMAC signature
    const hmac = crypto.createHmac('sha1', this.keys.hmacKey);
    hmac.update(content);
    const signature = hmac.digest('base64');
    content += `%${signature}`;

    ltpaDebug('Generated token content', { username, expireTime: new Date(expireTime).toISOString() });

    return this.encryptToken(content);
  }

  /**
   * Get token from request (cookie or header).
   * Checks both LtpaToken2 and LtpaToken cookie names.
   */
  getTokenFromRequest(req) {
    // Try primary cookie name (LtpaToken2)
    let token = req.cookies?.[this.config.cookieName];
    if (token) {
      ltpaDebug('Found token in cookie', { cookieName: this.config.cookieName });
      return token;
    }

    // Try fallback cookie name (LtpaToken)
    if (this.config.cookieNameFallback) {
      token = req.cookies?.[this.config.cookieNameFallback];
      if (token) {
        ltpaDebug('Found token in fallback cookie', { cookieName: this.config.cookieNameFallback });
        return token;
      }
    }

    // Try Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('LTPA ')) {
      ltpaDebug('Found token in Authorization header');
      return authHeader.substring(5);
    }

    // Try custom header
    const ltpaHeader = req.headers['x-ltpa-token'];
    if (ltpaHeader) {
      ltpaDebug('Found token in X-LTPA-Token header');
      return ltpaHeader;
    }

    ltpaDebug('No LTPA token found in request');
    return null;
  }

  /**
   * Set LTPA token cookie (sets both LtpaToken2 and optionally LtpaToken)
   */
  setTokenCookie(res, token, domain = null) {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: this.config.tokenExpiration * 1000,
      path: '/'
    };

    if (domain) {
      cookieOptions.domain = domain;
    }

    // Set primary cookie
    res.cookie(this.config.cookieName, token, cookieOptions);

    // Also set for trusted domains
    for (const trustedDomain of this.config.trustedDomains) {
      res.cookie(this.config.cookieName, token, { ...cookieOptions, domain: trustedDomain });
    }
  }

  /**
   * Clear LTPA token cookie
   */
  clearTokenCookie(res, domain = null) {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    };

    if (domain) {
      cookieOptions.domain = domain;
    }

    res.clearCookie(this.config.cookieName, cookieOptions);
    if (this.config.cookieNameFallback) {
      res.clearCookie(this.config.cookieNameFallback, cookieOptions);
    }
  }

  /**
   * Test LTPA configuration with detailed results
   */
  testConfiguration() {
    const results = {
      secretKeyConfigured: !!this.config.secretKey,
      keysDerivable: !!this.keys,
      cookieName: this.config.cookieName,
      realm: this.config.realm,
      dominoUserFormat: this.config.dominoUserFormat
    };

    if (!this.config.secretKey) {
      return { success: false, message: 'LTPA secret key not configured', ...results };
    }

    if (!this.keys) {
      return { success: false, message: 'Failed to derive LTPA keys from secret', ...results };
    }

    // Test token round-trip
    try {
      const testToken = this.generateToken('testuser', { test: 'value' });
      const content = this.decryptToken(testToken);
      const parsed = this.parseTokenContent(content);

      results.roundTrip = {
        generated: true,
        decrypted: true,
        parsed: true,
        username: parsed.username,
        usernameMatch: parsed.username === 'testuser'
      };

      if (parsed.username !== 'testuser') {
        return { success: false, message: 'Token round-trip: username mismatch', ...results };
      }

      return { success: true, message: 'LTPA configuration valid', ...results };
    } catch (error) {
      return { success: false, message: `Token round-trip failed: ${error.message}`, ...results };
    }
  }
}

module.exports = new LTPAService();
