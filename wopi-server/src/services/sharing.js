const pool = require('../db/pool');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * File Sharing Service
 * Handles file sharing logic and permission checks for WOPI co-editing
 */
class SharingService {
  /**
   * Check if a user has access to a file
   * Checks ownership, direct shares, and public shares
   * 
   * @param {string} fileId - The file ID
   * @param {string} userId - The user ID (can be null for public access)
   * @param {string} shareToken - Optional share token for public/link shares
   * @returns {Object} Access info including canRead, canWrite, accessType
   */
  async checkFileAccess(fileId, userId, shareToken = null) {
    try {
      // First check if user owns the file
      if (userId) {
        const ownerResult = await pool.query(
          'SELECT id, owner_id FROM files WHERE id = $1 AND is_deleted = false',
          [fileId]
        );

        if (ownerResult.rows.length > 0 && ownerResult.rows[0].owner_id === userId) {
          return {
            hasAccess: true,
            canRead: true,
            canWrite: true,
            canShare: true,
            accessType: 'owner',
            permission: 'admin'
          };
        }
      }

      // Check direct shares to user
      if (userId) {
        const shareResult = await pool.query(
          `SELECT permission, expires_at FROM file_shares 
           WHERE file_id = $1 AND shared_with = $2 
           AND (expires_at IS NULL OR expires_at > NOW())`,
          [fileId, userId]
        );

        if (shareResult.rows.length > 0) {
          const share = shareResult.rows[0];
          return {
            hasAccess: true,
            canRead: true,
            canWrite: share.permission === 'edit' || share.permission === 'admin',
            canShare: share.permission === 'admin',
            accessType: 'shared',
            permission: share.permission
          };
        }
      }

      // Check share token (public/link shares)
      if (shareToken) {
        const tokenResult = await pool.query(
          `SELECT permission, expires_at, password_hash, is_public FROM file_shares 
           WHERE file_id = $1 AND share_token = $2 
           AND (expires_at IS NULL OR expires_at > NOW())`,
          [fileId, shareToken]
        );

        if (tokenResult.rows.length > 0) {
          const share = tokenResult.rows[0];
          return {
            hasAccess: true,
            canRead: true,
            canWrite: share.permission === 'edit',
            canShare: false,
            accessType: share.is_public ? 'public' : 'link',
            permission: share.permission,
            requiresPassword: !!share.password_hash
          };
        }
      }

      // Check if file has any public share without token
      const publicResult = await pool.query(
        `SELECT permission FROM file_shares 
         WHERE file_id = $1 AND is_public = true 
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [fileId]
      );

      if (publicResult.rows.length > 0) {
        const share = publicResult.rows[0];
        return {
          hasAccess: true,
          canRead: true,
          canWrite: share.permission === 'edit',
          canShare: false,
          accessType: 'public',
          permission: share.permission
        };
      }

      // No access
      return {
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canShare: false,
        accessType: 'none',
        permission: null
      };
    } catch (error) {
      logger.error('Error checking file access', { fileId, userId, error: error.message });
      throw error;
    }
  }

  /**
   * Create a share for a file
   */
  async createShare(fileId, sharedBy, options = {}) {
    const {
      sharedWith = null,
      permission = 'view',
      isPublic = false,
      password = null,
      expiresAt = null
    } = options;

    const shareToken = crypto.randomBytes(32).toString('hex');
    const passwordHash = password ? await this._hashPassword(password) : null;

    const result = await pool.query(
      `INSERT INTO file_shares (file_id, shared_by, shared_with, share_token, permission, password_hash, expires_at, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [fileId, sharedBy, sharedWith, shareToken, permission, passwordHash, expiresAt, isPublic]
    );

    logger.info('Share created', { fileId, sharedBy, permission, isPublic });

    return {
      ...result.rows[0],
      shareUrl: this._buildShareUrl(shareToken)
    };
  }

  /**
   * Get all shares for a file
   */
  async getFileShares(fileId, ownerId) {
    const result = await pool.query(
      `SELECT fs.*, u.email as shared_with_email, u.display_name as shared_with_name
       FROM file_shares fs
       LEFT JOIN users u ON fs.shared_with = u.id
       WHERE fs.file_id = $1 AND (
         fs.shared_by = $2 OR 
         EXISTS (SELECT 1 FROM files f WHERE f.id = $1 AND f.owner_id = $2)
       )`,
      [fileId, ownerId]
    );

    return result.rows;
  }

  /**
   * Remove a share
   */
  async removeShare(shareId, userId) {
    const result = await pool.query(
      `DELETE FROM file_shares 
       WHERE id = $1 AND (
         shared_by = $2 OR 
         EXISTS (SELECT 1 FROM files f WHERE f.id = file_shares.file_id AND f.owner_id = $2)
       )
       RETURNING *`,
      [shareId, userId]
    );

    return result.rows[0];
  }

  /**
   * Get users currently editing a file (for co-editing awareness)
   */
  async getActiveEditors(fileId) {
    const result = await pool.query(
      `SELECT as2.user_id, u.display_name, u.email, as2.last_activity
       FROM active_sessions as2
       JOIN users u ON as2.user_id = u.id
       WHERE as2.file_id = $1 AND as2.last_activity > NOW() - INTERVAL '5 minutes'
       ORDER BY as2.last_activity DESC`,
      [fileId]
    );

    return result.rows;
  }

  /**
   * Record user session for co-editing tracking
   */
  async recordSession(userId, fileId, sessionToken, ipAddress, userAgent) {
    try {
      // First, try to ensure the unique constraint exists (migration)
      await this._ensureSessionTokenConstraint();
      
      await pool.query(
        `INSERT INTO active_sessions (user_id, file_id, session_token, ip_address, user_agent, last_activity)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (session_token) DO UPDATE SET 
           last_activity = NOW(),
           file_id = EXCLUDED.file_id,
           ip_address = EXCLUDED.ip_address,
           user_agent = EXCLUDED.user_agent`,
        [userId, fileId, sessionToken, ipAddress, userAgent]
      );
    } catch (error) {
      // If ON CONFLICT fails, try simple insert/update approach
      if (error.code === '42P10') {
        try {
          // Delete old session and insert new one
          await pool.query('DELETE FROM active_sessions WHERE session_token = $1', [sessionToken]);
          await pool.query(
            `INSERT INTO active_sessions (user_id, file_id, session_token, ip_address, user_agent, last_activity)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [userId, fileId, sessionToken, ipAddress, userAgent]
          );
          return;
        } catch (fallbackErr) {
          logger.warn('Fallback session insert also failed', { error: fallbackErr.message });
        }
      }
      // Log but don't throw - session tracking is non-critical
      logger.warn('Failed to record session', { 
        userId, 
        fileId, 
        error: error.message,
        code: error.code 
      });
    }
  }

  /**
   * Ensure session_token unique constraint exists (run migration if needed)
   */
  async _ensureSessionTokenConstraint() {
    if (this._constraintChecked) return;
    
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'active_sessions_session_token_key'
          ) THEN
            -- Add unique constraint if it doesn't exist
            ALTER TABLE active_sessions ADD CONSTRAINT active_sessions_session_token_key UNIQUE (session_token);
          END IF;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN duplicate_table THEN NULL;
        END $$;
      `);
      this._constraintChecked = true;
    } catch (err) {
      // Ignore errors - constraint might already exist or be named differently
      this._constraintChecked = true;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionToken) {
    try {
      await pool.query(
        'UPDATE active_sessions SET last_activity = NOW() WHERE session_token = $1',
        [sessionToken]
      );
    } catch (error) {
      logger.warn('Failed to update session activity', { sessionToken, error: error.message });
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions() {
    try {
      const result = await pool.query(
        "DELETE FROM active_sessions WHERE last_activity < NOW() - INTERVAL '1 hour' RETURNING id"
      );
      return result.rowCount;
    } catch (error) {
      logger.warn('Failed to cleanup expired sessions', { error: error.message });
      return 0;
    }
  }

  /**
   * Hash password for share protection
   */
  async _hashPassword(password) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verify share password
   */
  async verifySharePassword(shareId, password) {
    const result = await pool.query(
      'SELECT password_hash FROM file_shares WHERE id = $1',
      [shareId]
    );

    if (result.rows.length === 0 || !result.rows[0].password_hash) {
      return false;
    }

    const [salt, hash] = result.rows[0].password_hash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }

  /**
   * Build share URL
   */
  _buildShareUrl(shareToken) {
    const domain = process.env.DOMAIN || 'localhost';
    return `https://${domain}/share/${shareToken}`;
  }
}

module.exports = new SharingService();
