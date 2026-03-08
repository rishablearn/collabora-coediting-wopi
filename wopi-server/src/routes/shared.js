const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../db/pool');
const { generateAccessToken } = require('../utils/crypto');
const { buildEditorUrl } = require('../services/discovery');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';

// Configuration: require auth for edit shares (can be disabled via env)
const REQUIRE_AUTH_FOR_EDIT = process.env.SHARE_EDIT_REQUIRES_AUTH !== 'false';

/**
 * GET /api/shared/:token/info
 * Get share info without authentication (to check if auth is required)
 */
router.get('/:token/info', async (req, res) => {
  try {
    const { token } = req.params;

    const shareResult = await pool.query(
      `SELECT fs.permission, fs.expires_at, f.original_filename, f.mime_type,
              u.display_name as owner_name
       FROM file_shares fs
       JOIN files f ON fs.file_id = f.id
       JOIN users u ON f.owner_id = u.id
       WHERE fs.share_token = $1 
       AND f.is_deleted = false
       AND (fs.expires_at IS NULL OR fs.expires_at > NOW())`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ error: 'Share not found or expired' });
    }

    const share = shareResult.rows[0];
    const requiresAuth = share.permission === 'edit' && REQUIRE_AUTH_FOR_EDIT;

    res.json({
      fileName: share.original_filename,
      mimeType: share.mime_type,
      permission: share.permission,
      ownerName: share.owner_name,
      requiresAuth,
      expiresAt: share.expires_at
    });
  } catch (error) {
    logger.error('Get share info error:', error);
    res.status(500).json({ error: 'Failed to get share info' });
  }
});

/**
 * GET /api/shared/:token
 * Get shared file info and editor URL
 * For edit permission: requires authentication
 * For view permission: allows anonymous access
 */
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find share by token
    const shareResult = await pool.query(
      `SELECT fs.*, f.id as file_id, f.original_filename, f.mime_type, f.storage_path,
              u.display_name as owner_name
       FROM file_shares fs
       JOIN files f ON fs.file_id = f.id
       JOIN users u ON f.owner_id = u.id
       WHERE fs.share_token = $1 
       AND f.is_deleted = false
       AND (fs.expires_at IS NULL OR fs.expires_at > NOW())`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ error: 'Share not found or expired' });
    }

    const share = shareResult.rows[0];

    // Check if authentication is required for edit shares
    if (share.permission === 'edit' && REQUIRE_AUTH_FOR_EDIT) {
      // Try to authenticate the user from token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Authentication required',
          message: 'Edit access to shared documents requires you to sign in.',
          requiresAuth: true
        });
      }

      // Verify the token
      const jwt = require('jsonwebtoken');
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = decoded;
        logger.info('Authenticated user accessing edit share', { 
          username: decoded.username, 
          shareToken: req.params.token 
        });
      } catch (jwtErr) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          message: 'Please sign in again to access this document.',
          requiresAuth: true
        });
      }
    }

    // Determine user info for WOPI token
    let userId, displayName, email, authSource;
    
    if (req.user) {
      // Authenticated user
      userId = req.user.id;
      displayName = req.user.display_name || req.user.username;
      email = req.user.email || '';
      authSource = 'authenticated_share';
    } else {
      // Anonymous/guest access (view only)
      userId = share.shared_by;
      displayName = 'Guest';
      email = '';
      authSource = 'anonymous_share';
    }

    // Generate access token for WOPI
    const accessToken = generateAccessToken(
      share.file_id,
      userId,
      share.permission,
      {
        displayName,
        email,
        authSource,
        shareToken: req.params.token
      }
    );

    // Build Collabora URL
    const editUrl = await buildEditorUrl(
      share.file_id,
      share.original_filename,
      accessToken,
      share.permission
    );

    res.json({
      fileId: share.file_id,
      fileName: share.original_filename,
      mimeType: share.mime_type,
      permission: share.permission,
      ownerName: share.owner_name,
      editUrl,
      expiresAt: share.expires_at,
      user: req.user ? { 
        username: req.user.username, 
        displayName 
      } : null
    });
  } catch (error) {
    logger.error('Get shared file error:', error);
    res.status(500).json({ error: 'Failed to get shared file' });
  }
});

/**
 * GET /api/shared/:token/download
 * Download shared file
 */
router.get('/:token/download', async (req, res) => {
  try {
    const { token } = req.params;

    // Find share by token
    const shareResult = await pool.query(
      `SELECT f.original_filename, f.mime_type, f.storage_path
       FROM file_shares fs
       JOIN files f ON fs.file_id = f.id
       WHERE fs.share_token = $1 
       AND f.is_deleted = false
       AND (fs.expires_at IS NULL OR fs.expires_at > NOW())`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ error: 'Share not found or expired' });
    }

    const file = shareResult.rows[0];
    const filePath = path.join(STORAGE_PATH, file.storage_path);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found on storage' });
    }

    res.download(filePath, file.original_filename);
  } catch (error) {
    logger.error('Download shared file error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

module.exports = router;
