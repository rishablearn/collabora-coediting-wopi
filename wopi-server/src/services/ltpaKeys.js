const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * LTPA Keys File Management Service
 * Handles parsing, storing, and managing IBM WebSphere LTPA keys files
 */
class LTPAKeysService {
  constructor() {
    this.keysDir = process.env.LTPA_KEYS_DIR || '/app/config/ltpa';
    this.keysFile = path.join(this.keysDir, 'ltpa.keys');
    this.configFile = path.join(this.keysDir, 'ltpa-config.json');
  }

  /**
   * Parse LTPA keys file content
   * Format: property=value pairs, password encrypted
   * @param {string} content - Raw content of ltpa.keys file
   * @param {string} password - Password to decrypt the keys
   */
  parseKeysFile(content, password) {
    const keys = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      keys[key] = value;
    }

    // Extract the important keys
    const result = {
      version: keys['com.ibm.websphere.ltpa.version'] || '1',
      realm: keys['com.ibm.websphere.ltpa.Realm'] || 'defaultRealm',
      // 3DES key used for LTPA2 token encryption
      desKey: keys['com.ibm.websphere.ltpa.3DESKey'] || '',
      // Public key for signature verification
      publicKey: keys['com.ibm.websphere.ltpa.PublicKey'] || '',
      // Private key for token generation
      privateKey: keys['com.ibm.websphere.ltpa.PrivateKey'] || '',
      // Creation timestamp
      creationDate: keys['com.ibm.websphere.CreationDate'] || new Date().toISOString(),
      // Expiration
      expiration: keys['com.ibm.websphere.ltpa.Expiration'] || ''
    };

    // If password provided, try to decrypt keys
    if (password && result.privateKey) {
      try {
        result.decryptedPrivateKey = this.decryptKey(result.privateKey, password);
      } catch (err) {
        logger.warn('Could not decrypt private key', { error: err.message });
      }
    }

    return result;
  }

  /**
   * Decrypt LTPA key using password
   * WebSphere uses password-based encryption
   */
  decryptKey(encryptedKey, password) {
    try {
      // WebSphere uses a specific key derivation
      const keyBuffer = Buffer.from(password, 'utf8');
      const hash = crypto.createHash('sha1').update(keyBuffer).digest();
      
      // Use derived key for decryption
      const encrypted = Buffer.from(encryptedKey, 'base64');
      
      // Try AES decryption (newer WebSphere)
      try {
        const decipher = crypto.createDecipheriv(
          'aes-128-cbc',
          hash.slice(0, 16),
          Buffer.alloc(16, 0)
        );
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('base64');
      } catch {
        // Fall back to 3DES (older WebSphere)
        const desKey = Buffer.concat([hash, hash.slice(0, 4)]);
        const decipher = crypto.createDecipheriv(
          'des-ede3-cbc',
          desKey,
          Buffer.alloc(8, 0)
        );
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('base64');
      }
    } catch (error) {
      logger.error('Key decryption failed', { error: error.message });
      throw new Error('Failed to decrypt LTPA key with provided password');
    }
  }

  /**
   * Store LTPA keys configuration
   */
  async storeKeys(keysData, password) {
    try {
      // Ensure directory exists
      await fs.mkdir(this.keysDir, { recursive: true });

      // Parse the keys file if raw content provided
      let parsedKeys;
      if (typeof keysData === 'string') {
        parsedKeys = this.parseKeysFile(keysData, password);
      } else {
        parsedKeys = keysData;
      }

      // Store configuration (excluding sensitive decrypted keys in plain text)
      const config = {
        realm: parsedKeys.realm,
        version: parsedKeys.version,
        desKey: parsedKeys.desKey,
        publicKey: parsedKeys.publicKey,
        creationDate: parsedKeys.creationDate,
        configuredAt: new Date().toISOString(),
        // Store encrypted private key
        privateKey: parsedKeys.privateKey
      };

      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));

      // Also store the raw keys file for backup
      if (typeof keysData === 'string') {
        await fs.writeFile(this.keysFile, keysData);
      }

      logger.info('LTPA keys stored successfully', { realm: config.realm });

      return {
        success: true,
        realm: config.realm,
        version: config.version,
        message: 'LTPA keys configured successfully'
      };
    } catch (error) {
      logger.error('Failed to store LTPA keys', { error: error.message });
      throw error;
    }
  }

  /**
   * Load stored LTPA configuration
   */
  async loadConfig() {
    try {
      const content = await fs.readFile(this.configFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // No config file exists
      }
      throw error;
    }
  }

  /**
   * Check if LTPA keys are configured
   */
  async isConfigured() {
    try {
      const config = await this.loadConfig();
      return config && config.desKey;
    } catch {
      return false;
    }
  }

  /**
   * Get LTPA configuration status
   */
  async getStatus() {
    try {
      const config = await this.loadConfig();
      if (!config) {
        return {
          configured: false,
          message: 'LTPA keys not configured'
        };
      }

      return {
        configured: true,
        realm: config.realm,
        version: config.version,
        configuredAt: config.configuredAt,
        hasPublicKey: !!config.publicKey,
        hasPrivateKey: !!config.privateKey
      };
    } catch (error) {
      return {
        configured: false,
        error: error.message
      };
    }
  }

  /**
   * Generate environment variables from stored config
   * Useful for updating runtime configuration
   */
  async getEnvVars() {
    const config = await this.loadConfig();
    if (!config) {
      return null;
    }

    return {
      LTPA_SECRET_KEY: config.desKey,
      LTPA_PUBLIC_KEY: config.publicKey,
      LTPA_PRIVATE_KEY: config.privateKey,
      LTPA_REALM: config.realm
    };
  }

  /**
   * Delete stored LTPA configuration
   */
  async deleteConfig() {
    try {
      await fs.unlink(this.configFile).catch(() => {});
      await fs.unlink(this.keysFile).catch(() => {});
      logger.info('LTPA configuration deleted');
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete LTPA config', { error: error.message });
      throw error;
    }
  }
}

module.exports = new LTPAKeysService();
