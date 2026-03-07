const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../db/pool');
const { generateAccessToken } = require('../utils/crypto');
const { buildEditorUrl } = require('../services/discovery');
const logger = require('../utils/logger');

const router = express.Router();
const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';

/**
 * GET /api/shared/:token
 * Get shared file info and editor URL
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

    // Generate access token for WOPI
    const accessToken = generateAccessToken(
      share.file_id,
      share.shared_by, // Use sharer's ID for anonymous access
      share.permission,
      {
        displayName: 'Guest',
        email: '',
        authSource: 'share',
        shareToken: token
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
      expiresAt: share.expires_at
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
