const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { verifyAccessToken, generateLockId } = require('../utils/crypto');
const sharingService = require('../services/sharing');
const ltpaService = require('../services/ltpa');
const logger = require('../utils/logger');

const router = express.Router();
const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';
const AUTH_MODE = process.env.AUTH_MODE || 'local';

/**
 * Generate FileUniqueId for co-editing session grouping
 * Uses file ID + version to ensure all users edit the same document version
 */
function generateFileUniqueId(fileId, version) {
  const hash = crypto.createHash('sha256');
  hash.update(`${fileId}:${version}`);
  return hash.digest('hex').substring(0, 32);
}

/**
 * WOPI CheckFileInfo
 * GET /wopi/files/:fileId
 * 
 * Enhanced for real-time co-editing:
 * - Returns FileUniqueId for session grouping
 * - Includes user info from LTPA token
 * - Supports sharing-based permissions
 */
router.get('/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const accessToken = req.query.access_token;

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify access token
    const tokenData = verifyAccessToken(accessToken);
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Validate LTPA token if in LTPA mode and token contains LTPA info
    if ((AUTH_MODE === 'ltpa' || AUTH_MODE === 'ldap_ltpa') && tokenData.authSource === 'ltpa') {
      const ltpaToken = ltpaService.getTokenFromRequest(req);
      if (ltpaToken) {
        const ltpaData = await ltpaService.validateToken(ltpaToken);
        if (!ltpaData) {
          logger.warn('LTPA token validation failed for WOPI request', { fileId, userId: tokenData.userId });
        }
      }
    }

    // Get file info
    const result = await pool.query(
      `SELECT f.*, u.display_name as owner_name, u.email as owner_email
       FROM files f
       JOIN users u ON f.owner_id = u.id
       WHERE f.id = $1 AND f.is_deleted = false`,
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check permissions using sharing service
    // Pass shareToken if this is a share-based access
    const shareToken = tokenData.shareToken || null;
    const accessInfo = await sharingService.checkFileAccess(fileId, tokenData.userId, shareToken);
    
    // Determine if user is owner
    const isOwner = tokenData.userId === file.owner_id;
    
    // Determine edit capability
    const tokenHasEdit = tokenData.permissions === 'edit' || tokenData.permissions === 'admin';
    const isShareAccess = tokenData.authSource === 'authenticated_share' || tokenData.authSource === 'anonymous_share' || tokenData.authSource === 'share';
    
    // Edit permission logic:
    // 1. Owner always can edit if token has edit permission
    // 2. Share-based access: use token permissions directly
    // 3. Other authenticated users: require both token AND accessInfo permission
    let canEdit = false;
    if (isOwner && tokenHasEdit) {
      canEdit = true;  // Owner always gets edit if token says so
    } else if (isShareAccess && tokenHasEdit) {
      canEdit = true;  // Share-based access with edit permission
    } else if (tokenHasEdit && accessInfo.canWrite) {
      canEdit = true;  // Other authenticated users with proper permissions
    }
    
    logger.info('WOPI CheckFileInfo permissions', {
      fileId,
      userId: tokenData.userId,
      isShareAccess,
      tokenPermissions: tokenData.permissions,
      accessInfoCanWrite: accessInfo.canWrite,
      canEdit,
      authSource: tokenData.authSource
    });

    // Get file stats
    const filePath = path.join(STORAGE_PATH, file.storage_path);
    let fileStats;
    try {
      fileStats = await fs.stat(filePath);
    } catch (err) {
      logger.error('File stat error:', err);
      return res.status(404).json({ error: 'File not found on storage' });
    }

    // Check for locks
    const lockResult = await pool.query(
      'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
      [fileId]
    );
    const isLocked = lockResult.rows.length > 0;
    const lockId = isLocked ? lockResult.rows[0].lock_id : null;

    // Get active editors for co-editing awareness (non-critical)
    let activeEditors = [];
    try {
      activeEditors = await sharingService.getActiveEditors(fileId);
    } catch (editorErr) {
      logger.warn('Failed to get active editors', { fileId, error: editorErr.message });
    }

    // Record this session for co-editing tracking (non-critical)
    try {
      await sharingService.recordSession(
        tokenData.userId,
        fileId,
        tokenData.sessionId || accessToken.substring(0, 32),
        req.ip,
        req.headers['user-agent']
      );
    } catch (sessionErr) {
      logger.warn('Failed to record session', { fileId, error: sessionErr.message });
    }

    // Get user display name from database if not in token
    let userDisplayName = tokenData.displayName;
    if (!userDisplayName || userDisplayName === 'Unknown User') {
      try {
        const userResult = await pool.query(
          'SELECT display_name, username, email FROM users WHERE id = $1',
          [tokenData.userId]
        );
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          userDisplayName = user.display_name || user.username || user.email || 'User';
        }
      } catch (err) {
        logger.warn('Failed to get user display name', { userId: tokenData.userId, error: err.message });
      }
    }
    
    // Build WOPI response with co-editing support
    const response = {
      // Basic file info
      BaseFileName: file.original_filename,
      OwnerId: file.owner_id,
      Size: parseInt(file.size),
      Version: file.version.toString(),
      LastModifiedTime: file.updated_at.toISOString(),
      
      // *** CO-EDITING CRITICAL: FileUniqueId groups users into same editing session ***
      FileUniqueId: generateFileUniqueId(fileId, file.version),
      
      // User identification (from LTPA/LDAP if available)
      // UserFriendlyName is shown in Collabora's editor UI for co-editing
      UserId: tokenData.userId,
      UserFriendlyName: userDisplayName || file.owner_name || 'User',
      UserExtraInfo: {
        email: tokenData.email || '',
        authSource: tokenData.authSource || 'local',
        isOwner: isOwner
      },
      
      // *** CO-EDITING PERMISSIONS ***
      UserCanWrite: canEdit,
      ReadOnly: !canEdit,
      UserCanRename: isOwner && canEdit,
      UserCanNotWriteRelative: !canEdit,
      
      // *** CO-EDITING CAPABILITIES ***
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsExtendedLockLength: true,
      SupportsUpdate: true,
      SupportsRename: isOwner,
      SupportsDeleteFile: isOwner,
      SupportsCoAuthoring: true,
      SupportedShareUrlTypes: ['ReadOnly', 'ReadWrite'],
      SupportsUserInfo: true,
      
      // Lock info (for conflict resolution)
      LockValue: lockId,
      
      // UI settings
      DisablePrint: false,
      DisableExport: false,
      DisableCopy: false,
      HidePrintOption: false,
      HideSaveOption: false,
      HideExportOption: false,
      EnableInsertRemoteImage: true,
      EnableShare: accessInfo.canShare,
      
      // File info
      FileExtension: path.extname(file.original_filename),
      
      // Additional properties
      IsAnonymousUser: false,
      PostMessageOrigin: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : '*',
      CloseButtonClosesWindow: true,
      
      // Co-editing info (custom extension)
      ActiveEditorCount: activeEditors.length,
      AccessType: accessInfo.accessType
    };

    logger.info('CheckFileInfo response', {
      fileId,
      userId: tokenData.userId,
      canEdit,
      activeEditors: activeEditors.length,
      fileUniqueId: response.FileUniqueId
    });

    res.json(response);
  } catch (error) {
    logger.error('CheckFileInfo error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * WOPI GetFile
 * GET /wopi/files/:fileId/contents
 */
router.get('/files/:fileId/contents', async (req, res) => {
  try {
    const { fileId } = req.params;
    const accessToken = req.query.access_token;

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const tokenData = verifyAccessToken(accessToken);
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Get file info
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];
    const filePath = path.join(STORAGE_PATH, file.storage_path);

    // Read and send file
    const fileContent = await fs.readFile(filePath);
    
    res.set({
      'Content-Type': file.mime_type,
      'Content-Disposition': `attachment; filename="${file.original_filename}"`,
      'X-WOPI-ItemVersion': file.version.toString()
    });
    
    res.send(fileContent);
  } catch (error) {
    logger.error('GetFile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * WOPI PutFile
 * POST /wopi/files/:fileId/contents
 */
router.post('/files/:fileId/contents', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  try {
    const { fileId } = req.params;
    const accessToken = req.query.access_token;
    const wopiLock = req.headers['x-wopi-lock'];

    logger.info('PutFile request', { fileId, hasBody: !!req.body, bodyLength: req.body?.length });
    
    if (!accessToken) {
      logger.warn('PutFile: No access token');
      return res.status(401).end();
    }

    const tokenData = verifyAccessToken(accessToken);
    if (!tokenData || (tokenData.permissions !== 'edit' && tokenData.permissions !== 'admin')) {
      logger.warn('PutFile: No edit permission', { permissions: tokenData?.permissions });
      return res.status(401).end();
    }

    // Get file info
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [fileId]
    );

    if (result.rows.length === 0) {
      logger.warn('PutFile: File not found', { fileId });
      return res.status(404).end();
    }

    const file = result.rows[0];

    // Check lock - but allow save if no lock or lock matches
    const lockResult = await pool.query(
      'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
      [fileId]
    );

    if (lockResult.rows.length > 0) {
      const existingLock = lockResult.rows[0];
      // Only reject if there's a lock mismatch AND a lock was provided
      if (wopiLock && existingLock.lock_id !== wopiLock) {
        logger.warn('PutFile: Lock mismatch', { fileId, expected: existingLock.lock_id, got: wopiLock });
        res.set('X-WOPI-Lock', existingLock.lock_id);
        return res.status(409).end();
      }
    }

    const filePath = path.join(STORAGE_PATH, file.storage_path);

    // Save version history
    const versionPath = `${file.storage_path}.v${file.version}`;
    await fs.copyFile(filePath, path.join(STORAGE_PATH, versionPath));
    
    await pool.query(
      `INSERT INTO file_versions (file_id, version, size, storage_path, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [fileId, file.version, file.size, versionPath, tokenData.userId]
    );

    // Write new content
    await fs.writeFile(filePath, req.body);
    const stats = await fs.stat(filePath);

    // Update file record
    const newVersion = file.version + 1;
    await pool.query(
      `UPDATE files SET size = $1, version = $2, updated_at = NOW() WHERE id = $3`,
      [stats.size, newVersion, fileId]
    );

    // Update user storage
    const sizeDiff = stats.size - file.size;
    await pool.query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [sizeDiff, file.owner_id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenData.userId, 'FILE_UPDATE', 'file', fileId, JSON.stringify({ version: newVersion })]
    );

    logger.info('PutFile success', { fileId, newVersion, size: stats.size });
    
    // WOPI spec: PutFile returns 200 OK with empty body
    res.set('X-WOPI-ItemVersion', newVersion.toString());
    res.status(200).end();
  } catch (error) {
    logger.error('PutFile error:', { error: error.message, stack: error.stack });
    // Return 500 with empty body for WOPI compliance
    res.status(500).end();
  }
});

/**
 * WOPI Lock operations and PUT_RELATIVE (SaveAs)
 * POST /wopi/files/:fileId
 * Note: express.raw() is needed for PUT_RELATIVE which sends file content in body
 */
router.post('/files/:fileId', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  try {
    const { fileId } = req.params;
    const accessToken = req.query.access_token;
    const wopiOverride = req.headers['x-wopi-override'];
    const wopiLock = req.headers['x-wopi-lock'];
    const wopiOldLock = req.headers['x-wopi-oldlock'];

    if (!accessToken) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const tokenData = verifyAccessToken(accessToken);
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Get file
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [fileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    switch (wopiOverride) {
      case 'LOCK':
        // Check for X-WOPI-OldLock for UNLOCK_AND_RELOCK operation
        if (wopiOldLock) {
          return await handleUnlockAndRelock(fileId, wopiOldLock, wopiLock, tokenData, res);
        }
        return await handleLock(fileId, wopiLock, tokenData, res);
      
      case 'GET_LOCK':
        return await handleGetLock(fileId, res);
      
      case 'REFRESH_LOCK':
        return await handleRefreshLock(fileId, wopiLock, res);
      
      case 'UNLOCK':
        return await handleUnlock(fileId, wopiLock, res);
      
      case 'PUT_RELATIVE':
        return await handlePutRelative(fileId, req, tokenData, res);
      
      case 'RENAME_FILE':
        return await handleRename(fileId, req.headers['x-wopi-requestedname'], tokenData, res);
      
      case 'DELETE':
        return await handleDelete(fileId, tokenData, res);
      
      case 'PUT_USER_INFO':
        return await handlePutUserInfo(fileId, req, tokenData, res);
      
      default:
        logger.warn('Unknown WOPI operation', { operation: wopiOverride, fileId });
        return res.status(400).json({ error: 'Unknown WOPI operation' });
    }
  } catch (error) {
    logger.error('WOPI operation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleLock(fileId, lockId, tokenData, res) {
  logger.info('WOPI Lock', { fileId, lockId });
  
  // Check existing lock
  const lockResult = await pool.query(
    'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
    [fileId]
  );

  if (lockResult.rows.length > 0) {
    const existingLock = lockResult.rows[0];
    if (existingLock.lock_id === lockId) {
      // Refresh existing lock
      await pool.query(
        'UPDATE file_locks SET expires_at = NOW() + INTERVAL \'30 minutes\' WHERE file_id = $1',
        [fileId]
      );
      res.set('X-WOPI-Lock', lockId);
      return res.status(200).end();
    } else {
      res.set('X-WOPI-Lock', existingLock.lock_id);
      return res.status(409).end();
    }
  }

  // Create new lock
  await pool.query(
    `INSERT INTO file_locks (file_id, lock_id, locked_by, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')
     ON CONFLICT (file_id) DO UPDATE SET lock_id = $2, locked_by = $3, expires_at = NOW() + INTERVAL '30 minutes'`,
    [fileId, lockId, tokenData.userId]
  );

  res.set('X-WOPI-Lock', lockId);
  res.status(200).end();
}

async function handleGetLock(fileId, res) {
  const lockResult = await pool.query(
    'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
    [fileId]
  );

  if (lockResult.rows.length > 0) {
    res.set('X-WOPI-Lock', lockResult.rows[0].lock_id);
  } else {
    res.set('X-WOPI-Lock', '');
  }

  res.status(200).end();
}

async function handleRefreshLock(fileId, lockId, res) {
  logger.info('WOPI RefreshLock', { fileId, lockId });
  
  const lockResult = await pool.query(
    'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
    [fileId]
  );

  if (lockResult.rows.length === 0) {
    res.set('X-WOPI-Lock', '');
    return res.status(409).end();
  }

  const existingLock = lockResult.rows[0];
  if (existingLock.lock_id !== lockId) {
    res.set('X-WOPI-Lock', existingLock.lock_id);
    return res.status(409).end();
  }

  await pool.query(
    'UPDATE file_locks SET expires_at = NOW() + INTERVAL \'30 minutes\' WHERE file_id = $1',
    [fileId]
  );

  res.set('X-WOPI-Lock', lockId);
  res.status(200).end();
}

async function handleUnlock(fileId, lockId, res) {
  logger.info('WOPI Unlock', { fileId, lockId });
  
  const lockResult = await pool.query(
    'SELECT * FROM file_locks WHERE file_id = $1',
    [fileId]
  );

  if (lockResult.rows.length === 0) {
    res.set('X-WOPI-Lock', '');
    return res.status(200).end();
  }

  const existingLock = lockResult.rows[0];
  if (existingLock.lock_id !== lockId) {
    res.set('X-WOPI-Lock', existingLock.lock_id);
    return res.status(409).end();
  }

  await pool.query('DELETE FROM file_locks WHERE file_id = $1', [fileId]);

  res.set('X-WOPI-Lock', '');
  res.status(200).end();
}

async function handleRename(fileId, newName, tokenData, res) {
  if (!newName) {
    return res.status(400).json({ error: 'New name required' });
  }

  await pool.query(
    'UPDATE files SET original_filename = $1 WHERE id = $2',
    [newName, fileId]
  );

  await pool.query(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenData.userId, 'FILE_RENAME', 'file', fileId, JSON.stringify({ newName })]
  );

  res.json({ Name: newName });
}

async function handleDelete(fileId, tokenData, res) {
  logger.info('WOPI Delete', { fileId });
  
  await pool.query(
    'UPDATE files SET is_deleted = true WHERE id = $1',
    [fileId]
  );

  await pool.query(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id)
     VALUES ($1, $2, $3, $4)`,
    [tokenData.userId, 'FILE_DELETE', 'file', fileId]
  );

  res.status(200).end();
}

/**
 * Handle PUT_RELATIVE - Save As functionality
 * Creates a new file with the content from Collabora
 */
async function handlePutRelative(fileId, req, tokenData, res) {
  try {
    logger.info('PUT_RELATIVE request', { 
      fileId, 
      hasBody: !!req.body, 
      bodyLength: req.body?.length,
      suggestedTarget: req.headers['x-wopi-suggestedtarget'],
      relativeTarget: req.headers['x-wopi-relativetarget']
    });
    
    const suggestedTarget = req.headers['x-wopi-suggestedtarget'];
    const relativeTarget = req.headers['x-wopi-relativetarget'];
    const overwriteRelative = req.headers['x-wopi-overwriterelativetarget'] === 'true';
    const fileSize = parseInt(req.headers['x-wopi-size']) || 0;

    // Get source file info
    const sourceResult = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [fileId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    const sourceFile = sourceResult.rows[0];

    // Determine target filename
    let targetName;
    if (relativeTarget) {
      // Use exact name specified
      targetName = relativeTarget;
    } else if (suggestedTarget) {
      if (suggestedTarget.startsWith('.')) {
        // Just extension change - keep original name, change extension
        const baseName = sourceFile.original_filename.replace(/\.[^/.]+$/, '');
        targetName = baseName + suggestedTarget;
      } else {
        targetName = suggestedTarget;
      }
    } else {
      return res.status(400).json({ error: 'No target filename specified' });
    }

    // Clean the filename
    targetName = targetName.replace(/[<>:"/\\|?*]/g, '_');

    // Check if file with same name exists in same folder
    const existingResult = await pool.query(
      `SELECT id FROM files 
       WHERE owner_id = $1 
       AND original_filename = $2 
       AND parent_folder_id IS NOT DISTINCT FROM $3
       AND is_deleted = false`,
      [sourceFile.owner_id, targetName, sourceFile.parent_folder_id]
    );

    if (existingResult.rows.length > 0 && !overwriteRelative) {
      // File exists and overwrite not allowed
      res.set('X-WOPI-ValidRelativeTarget', targetName);
      return res.status(409).json({ error: 'File already exists' });
    }

    // Get file content from request body
    const fileContent = req.body;

    // Create new file
    const newFileId = uuidv4();
    const ext = path.extname(targetName).slice(1) || 'odt';
    const storageFilename = `${newFileId}.${ext}`;
    const userDir = path.join(STORAGE_PATH, sourceFile.owner_id);
    const newFilePath = path.join(userDir, storageFilename);
    const storagePath = path.join(sourceFile.owner_id, storageFilename);

    // Determine MIME type from extension
    const mimeTypes = {
      'odt': 'application/vnd.oasis.opendocument.text',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
      'rtf': 'application/rtf',
      'txt': 'text/plain',
      'pdf': 'application/pdf',
      'ods': 'application/vnd.oasis.opendocument.spreadsheet',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'csv': 'text/csv',
      'odp': 'application/vnd.oasis.opendocument.presentation',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'ppt': 'application/vnd.ms-powerpoint',
      'odg': 'application/vnd.oasis.opendocument.graphics',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // Ensure directory exists
    await fs.mkdir(userDir, { recursive: true });

    // Write file
    await fs.writeFile(newFilePath, fileContent);
    const stats = await fs.stat(newFilePath);

    // If overwriting, delete old file first
    if (existingResult.rows.length > 0 && overwriteRelative) {
      await pool.query(
        'UPDATE files SET is_deleted = true WHERE id = $1',
        [existingResult.rows[0].id]
      );
    }

    // Create file record
    const fileResult = await pool.query(
      `INSERT INTO files (id, owner_id, filename, original_filename, mime_type, size, storage_path, parent_folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [newFileId, sourceFile.owner_id, storageFilename, targetName, mimeType, stats.size, storagePath, sourceFile.parent_folder_id]
    );

    // Update user storage
    await pool.query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [stats.size, sourceFile.owner_id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenData.userId, 'FILE_SAVE_AS', 'file', newFileId, JSON.stringify({ 
        sourceId: fileId, 
        targetName 
      })]
    );

    const newFile = fileResult.rows[0];
    const domain = process.env.DOMAIN || 'localhost';

    // Build response with URL to the new file
    const wopiSrc = `https://${domain}/wopi/files/${newFile.id}`;

    res.json({
      Name: newFile.original_filename,
      Url: wopiSrc,
      HostViewUrl: `https://${domain}/edit/${newFile.id}`,
      HostEditUrl: `https://${domain}/edit/${newFile.id}`
    });

    logger.info('PUT_RELATIVE completed', { 
      sourceId: fileId, 
      newId: newFile.id, 
      targetName 
    });
  } catch (error) {
    logger.error('PUT_RELATIVE error:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
}

/**
 * Handle UNLOCK_AND_RELOCK operation for co-editing
 * Atomically unlocks with old lock and creates new lock
 */
async function handleUnlockAndRelock(fileId, oldLockId, newLockId, tokenData, res) {
  logger.info('WOPI UnlockAndRelock', { fileId, oldLockId, newLockId });
  
  // Check existing lock matches old lock
  const lockResult = await pool.query(
    'SELECT * FROM file_locks WHERE file_id = $1 AND expires_at > NOW()',
    [fileId]
  );

  if (lockResult.rows.length === 0) {
    // No existing lock - create new one
    await pool.query(
      `INSERT INTO file_locks (file_id, lock_id, locked_by, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')
       ON CONFLICT (file_id) DO UPDATE SET lock_id = $2, locked_by = $3, expires_at = NOW() + INTERVAL '30 minutes'`,
      [fileId, newLockId, tokenData.userId]
    );
    res.set('X-WOPI-Lock', newLockId);
    return res.status(200).end();
  }

  const existingLock = lockResult.rows[0];
  if (existingLock.lock_id !== oldLockId) {
    // Old lock doesn't match
    res.set('X-WOPI-Lock', existingLock.lock_id);
    return res.status(409).end();
  }

  // Replace lock atomically
  await pool.query(
    `UPDATE file_locks SET lock_id = $1, locked_by = $2, expires_at = NOW() + INTERVAL '30 minutes' WHERE file_id = $3`,
    [newLockId, tokenData.userId, fileId]
  );

  logger.info('UNLOCK_AND_RELOCK completed', { fileId, oldLockId, newLockId, userId: tokenData.userId });

  res.set('X-WOPI-Lock', newLockId);
  res.status(200).end();
}

/**
 * Handle PUT_USER_INFO operation for co-editing
 * Stores user-specific info for the editing session
 */
async function handlePutUserInfo(fileId, req, tokenData, res) {
  try {
    let userInfo = {};
    try {
      userInfo = req.body ? JSON.parse(req.body.toString()) : {};
    } catch (e) {
      // Body might not be JSON
    }
    
    // Update session with user info
    await pool.query(
      `UPDATE active_sessions 
       SET last_activity = NOW()
       WHERE user_id = $1 AND file_id = $2`,
      [tokenData.userId, fileId]
    );

    logger.info('PUT_USER_INFO completed', { fileId, userId: tokenData.userId });

    res.status(200).end();
  } catch (error) {
    logger.error('PUT_USER_INFO error:', error);
    res.status(200).end(); // WOPI spec says to return 200 even on error
  }
}

module.exports = router;
