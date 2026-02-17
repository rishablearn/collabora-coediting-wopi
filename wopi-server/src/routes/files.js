const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');
const { generateAccessToken, generateFileId } = require('../utils/crypto');
const logger = require('../utils/logger');
const { buildEditorUrl } = require('../services/discovery');

const router = express.Router();
const STORAGE_PATH = process.env.STORAGE_PATH || '/storage';

/**
 * Create a minimal valid ODF file buffer
 * ODF files are ZIP archives with specific structure
 */
function createMinimalODF(type, mimeType) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  
  // Add mimetype file (must be first and uncompressed)
  zip.addFile('mimetype', Buffer.from(mimeType));
  
  // Add manifest
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeType}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  zip.addFile('META-INF/manifest.xml', Buffer.from(manifest));
  
  // Add content based on type
  let content;
  if (type === 'document') {
    content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" 
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body><office:text><text:p/></office:text></office:body>
</office:document-content>`;
  } else if (type === 'spreadsheet') {
    content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" 
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
  <office:body><office:spreadsheet>
    <table:table table:name="Sheet1"><table:table-row><table:table-cell/></table:table-row></table:table>
  </office:spreadsheet></office:body>
</office:document-content>`;
  } else if (type === 'presentation') {
    content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" 
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.2">
  <office:body><office:presentation>
    <draw:page draw:name="Slide 1"/>
  </office:presentation></office:body>
</office:document-content>`;
  }
  zip.addFile('content.xml', Buffer.from(content));
  
  return zip.toBuffer();
}

// Supported document types
const SUPPORTED_TYPES = {
  // Documents
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/html': 'html',
  // Spreadsheets
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  // Presentations
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  // Drawings
  'application/vnd.oasis.opendocument.graphics': 'odg',
  // PDF
  'application/pdf': 'pdf'
};

// Extension to MIME type mapping (reverse lookup)
const EXT_TO_MIME = Object.entries(SUPPORTED_TYPES).reduce((acc, [mime, ext]) => {
  acc[ext] = mime;
  return acc;
}, {});

// Export format configurations
const EXPORT_FORMATS = {
  document: [
    { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', label: 'ODF Document (.odt)' },
    { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word Document (.docx)' },
    { ext: 'doc', mime: 'application/msword', label: 'Word 97-2003 (.doc)' },
    { ext: 'rtf', mime: 'application/rtf', label: 'Rich Text (.rtf)' },
    { ext: 'txt', mime: 'text/plain', label: 'Plain Text (.txt)' },
    { ext: 'pdf', mime: 'application/pdf', label: 'PDF (.pdf)' },
    { ext: 'html', mime: 'text/html', label: 'HTML (.html)' },
  ],
  spreadsheet: [
    { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', label: 'ODF Spreadsheet (.ods)' },
    { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel Document (.xlsx)' },
    { ext: 'xls', mime: 'application/vnd.ms-excel', label: 'Excel 97-2003 (.xls)' },
    { ext: 'csv', mime: 'text/csv', label: 'CSV (.csv)' },
    { ext: 'pdf', mime: 'application/pdf', label: 'PDF (.pdf)' },
  ],
  presentation: [
    { ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation', label: 'ODF Presentation (.odp)' },
    { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (.pptx)' },
    { ext: 'ppt', mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint 97-2003 (.ppt)' },
    { ext: 'pdf', mime: 'application/pdf', label: 'PDF (.pdf)' },
  ],
  drawing: [
    { ext: 'odg', mime: 'application/vnd.oasis.opendocument.graphics', label: 'ODF Drawing (.odg)' },
    { ext: 'pdf', mime: 'application/pdf', label: 'PDF (.pdf)' },
  ]
};

// Map MIME types to document categories
const MIME_TO_CATEGORY = {
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/msword': 'document',
  'application/rtf': 'document',
  'text/plain': 'document',
  'text/html': 'document',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-excel': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.oasis.opendocument.graphics': 'drawing',
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userDir = path.join(STORAGE_PATH, req.user.id);
    try {
      await fs.mkdir(userDir, { recursive: true });
      cb(null, userDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const fileId = generateFileId();
    const ext = path.extname(file.originalname);
    cb(null, `${fileId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE) * 1024 * 1024 || 100 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const mimeType = file.mimetype;
    if (SUPPORTED_TYPES[mimeType] || mimeType.startsWith('text/')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  }
});

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/files
 * List user's files
 */
router.get('/', async (req, res) => {
  try {
    const { folderId, search, sort = 'updated_at', order = 'desc' } = req.query;
    
    let query = `
      SELECT f.id, f.original_filename, f.mime_type, f.size, f.version, 
             f.created_at, f.updated_at, f.parent_folder_id,
             u.display_name as owner_name
      FROM files f
      JOIN users u ON f.owner_id = u.id
      WHERE f.owner_id = $1 AND f.is_deleted = false
    `;
    const params = [req.user.id];
    let paramIndex = 2;

    if (folderId) {
      query += ` AND f.parent_folder_id = $${paramIndex}`;
      params.push(folderId);
      paramIndex++;
    } else {
      query += ` AND f.parent_folder_id IS NULL`;
    }

    if (search) {
      query += ` AND f.original_filename ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Validate sort column
    const validSorts = ['original_filename', 'size', 'created_at', 'updated_at'];
    const sortColumn = validSorts.includes(sort) ? sort : 'updated_at';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortColumn} ${sortOrder}`;

    const result = await pool.query(query, params);

    // Also get folders
    let foldersQuery = `
      SELECT id, name, created_at, updated_at, parent_id
      FROM folders
      WHERE owner_id = $1
    `;
    const folderParams = [req.user.id];

    if (folderId) {
      foldersQuery += ` AND parent_id = $2`;
      folderParams.push(folderId);
    } else {
      foldersQuery += ` AND parent_id IS NULL`;
    }

    foldersQuery += ` ORDER BY name ASC`;

    const foldersResult = await pool.query(foldersQuery, folderParams);

    res.json({
      folders: foldersResult.rows.map(f => ({
        id: f.id,
        name: f.name,
        type: 'folder',
        createdAt: f.created_at,
        updatedAt: f.updated_at,
        parentId: f.parent_id
      })),
      files: result.rows.map(f => ({
        id: f.id,
        name: f.original_filename,
        mimeType: f.mime_type,
        size: parseInt(f.size),
        version: f.version,
        type: 'file',
        createdAt: f.created_at,
        updatedAt: f.updated_at,
        parentFolderId: f.parent_folder_id,
        ownerName: f.owner_name
      }))
    });
  } catch (error) {
    logger.error('List files error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

/**
 * POST /api/files/upload
 * Upload a new file
 */
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      logger.error('Multer upload error:', err.message, { code: err.code });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 100MB.' });
      }
      if (err.message === 'Unsupported file type') {
        return res.status(415).json({ error: 'Unsupported file type' });
      }
      return res.status(500).json({ error: 'Upload failed', details: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    logger.info('Upload request received', { 
      hasFile: !!req.file, 
      userId: req.user?.id,
      contentType: req.headers['content-type']
    });

    if (!req.file) {
      logger.warn('No file in upload request');
      return res.status(400).json({ error: 'No file provided' });
    }

    const { folderId } = req.body;
    logger.info('Processing upload', { filename: req.file.originalname, size: req.file.size });

    // Check storage quota
    const userResult = await pool.query(
      'SELECT storage_quota, storage_used FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (user.storage_used + req.file.size > user.storage_quota) {
      // Delete uploaded file
      await fs.unlink(req.file.path);
      return res.status(413).json({ error: 'Storage quota exceeded' });
    }

    // Create file record
    const fileId = uuidv4();
    const storagePath = path.relative(STORAGE_PATH, req.file.path);

    const result = await pool.query(
      `INSERT INTO files (id, owner_id, filename, original_filename, mime_type, size, storage_path, parent_folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        fileId,
        req.user.id,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        storagePath,
        folderId || null
      ]
    );

    // Update user storage
    await pool.query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [req.file.size, req.user.id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'FILE_UPLOAD', 'file', fileId, JSON.stringify({ filename: req.file.originalname }), req.ip]
    );

    const file = result.rows[0];

    res.status(201).json({
      id: file.id,
      name: file.original_filename,
      mimeType: file.mime_type,
      size: parseInt(file.size),
      version: file.version,
      createdAt: file.created_at,
      updatedAt: file.updated_at
    });
  } catch (error) {
    logger.error('Upload error:', error.message, { 
      stack: error.stack,
      code: error.code,
      userId: req.user?.id 
    });
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ 
      error: 'Upload failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/files/:id
 * Get file details
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, u.display_name as owner_name
       FROM files f
       JOIN users u ON f.owner_id = u.id
       WHERE f.id = $1 AND f.is_deleted = false`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check access
    if (file.owner_id !== req.user.id) {
      // Check if shared
      const shareResult = await pool.query(
        'SELECT * FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [file.id, req.user.id]
      );
      if (shareResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({
      id: file.id,
      name: file.original_filename,
      mimeType: file.mime_type,
      size: parseInt(file.size),
      version: file.version,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      ownerName: file.owner_name,
      ownerId: file.owner_id
    });
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

/**
 * GET /api/files/:id/edit
 * Get Collabora edit URL
 */
router.get('/:id/edit', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check access and determine permission
    let permission = 'view';
    if (file.owner_id === req.user.id) {
      permission = 'edit';
    } else {
      const shareResult = await pool.query(
        'SELECT permission FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [file.id, req.user.id]
      );
      if (shareResult.rows.length > 0) {
        permission = shareResult.rows[0].permission;
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Generate WOPI access token with user info for co-editing
    const accessToken = generateAccessToken(file.id, req.user.id, permission, {
      displayName: req.user.display_name || req.user.username,
      email: req.user.email,
      authSource: req.user.auth_source || 'local',
      ldapDn: req.user.ldap_dn
    });

    // Build Collabora URL using discovery service
    const collaboraUrl = await buildEditorUrl(
      file.id,
      file.original_filename,
      accessToken,
      permission
    );

    res.json({
      editUrl: collaboraUrl,
      accessToken,
      permission,
      fileId: file.id,
      fileName: file.original_filename
    });
  } catch (error) {
    logger.error('Get edit URL error:', error);
    res.status(500).json({ error: 'Failed to generate edit URL' });
  }
});

/**
 * GET /api/files/:id/download
 * Download a file
 */
router.get('/:id/download', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check access
    if (file.owner_id !== req.user.id) {
      const shareResult = await pool.query(
        'SELECT * FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [file.id, req.user.id]
      );
      if (shareResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const filePath = path.join(STORAGE_PATH, file.storage_path);

    res.download(filePath, file.original_filename);
  } catch (error) {
    logger.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * DELETE /api/files/:id
 * Delete a file (soft delete)
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Soft delete
    await pool.query(
      'UPDATE files SET is_deleted = true WHERE id = $1',
      [file.id]
    );

    // Update storage
    await pool.query(
      'UPDATE users SET storage_used = storage_used - $1 WHERE id = $2',
      [file.size, req.user.id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'FILE_DELETE', 'file', file.id, req.ip]
    );

    res.json({ message: 'File deleted' });
  } catch (error) {
    logger.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * POST /api/files/:id/share
 * Share a file
 */
router.post('/:id/share', async (req, res) => {
  try {
    const { email, permission = 'view', isPublic = false, expiresIn } = req.body;

    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];
    let sharedWith = null;
    let shareToken = null;

    if (isPublic) {
      // Generate public share token
      shareToken = generateFileId();
    } else if (email) {
      // Find user by email
      const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      sharedWith = userResult.rows[0].id;
    } else {
      return res.status(400).json({ error: 'Email or public share required' });
    }

    const expiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000)
      : null;

    const shareResult = await pool.query(
      `INSERT INTO file_shares (file_id, shared_by, shared_with, share_token, permission, is_public, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [file.id, req.user.id, sharedWith, shareToken, permission, isPublic, expiresAt]
    );

    const share = shareResult.rows[0];
    const domain = process.env.DOMAIN || 'localhost';

    res.status(201).json({
      id: share.id,
      shareUrl: shareToken ? `https://${domain}/shared/${shareToken}` : null,
      permission: share.permission,
      expiresAt: share.expires_at
    });
  } catch (error) {
    logger.error('Share error:', error);
    res.status(500).json({ error: 'Failed to share file' });
  }
});

/**
 * POST /api/files/folder
 * Create a new folder
 */
router.post('/folder', async (req, res) => {
  try {
    const { name, parentId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Folder name required' });
    }

    const result = await pool.query(
      `INSERT INTO folders (owner_id, name, parent_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, name, parentId || null]
    );

    const folder = result.rows[0];

    res.status(201).json({
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_id,
      createdAt: folder.created_at
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Folder already exists' });
    }
    logger.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

/**
 * GET /api/files/formats
 * Get supported file formats for creation and export
 */
router.get('/formats', (req, res) => {
  res.json({
    create: {
      document: [
        { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', label: 'ODF Document (.odt)', default: true },
        { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word Document (.docx)' },
      ],
      spreadsheet: [
        { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', label: 'ODF Spreadsheet (.ods)', default: true },
        { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel Document (.xlsx)' },
      ],
      presentation: [
        { ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation', label: 'ODF Presentation (.odp)', default: true },
        { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (.pptx)' },
      ],
      drawing: [
        { ext: 'odg', mime: 'application/vnd.oasis.opendocument.graphics', label: 'ODF Drawing (.odg)', default: true },
      ]
    },
    export: EXPORT_FORMATS,
    supported: SUPPORTED_TYPES
  });
});

/**
 * POST /api/files/create
 * Create a new empty document
 */
router.post('/create', async (req, res) => {
  try {
    const { name, type, folderId, format } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type required' });
    }

    // Determine file extension and template
    const templates = {
      // ODF formats (native)
      document: { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text' },
      spreadsheet: { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
      presentation: { ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation' },
      drawing: { ext: 'odg', mime: 'application/vnd.oasis.opendocument.graphics' },
      // MS Office formats
      'document-docx': { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      'spreadsheet-xlsx': { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      'presentation-pptx': { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    };

    // Support format parameter for specific format selection
    const templateKey = format ? `${type}-${format}` : type;
    let template = templates[templateKey] || templates[type];
    
    if (!template) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const filename = name.endsWith(`.${template.ext}`) ? name : `${name}.${template.ext}`;
    const fileId = uuidv4();
    const storageFilename = `${fileId}.${template.ext}`;
    const userDir = path.join(STORAGE_PATH, req.user.id);
    const filePath = path.join(userDir, storageFilename);
    const storagePath = path.join(req.user.id, storageFilename);

    // Create user directory
    await fs.mkdir(userDir, { recursive: true });

    // Copy template or create minimal ODF file
    const templatePath = path.join(__dirname, '..', '..', 'templates', `empty.${template.ext}`);
    try {
      await fs.copyFile(templatePath, filePath);
    } catch {
      // Create minimal valid ODF file if template doesn't exist
      const minimalODF = createMinimalODF(type, template.mime);
      await fs.writeFile(filePath, minimalODF);
    }

    const stats = await fs.stat(filePath);

    // Create file record
    const result = await pool.query(
      `INSERT INTO files (id, owner_id, filename, original_filename, mime_type, size, storage_path, parent_folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [fileId, req.user.id, storageFilename, filename, template.mime, stats.size, storagePath, folderId || null]
    );

    const file = result.rows[0];

    // Generate edit URL using discovery service with user info for co-editing
    const accessToken = generateAccessToken(file.id, req.user.id, 'edit', {
      displayName: req.user.display_name || req.user.username,
      email: req.user.email,
      authSource: req.user.auth_source || 'local',
      ldapDn: req.user.ldap_dn
    });
    const editUrl = await buildEditorUrl(
      file.id,
      file.original_filename,
      accessToken,
      'edit'
    );

    res.status(201).json({
      id: file.id,
      name: file.original_filename,
      mimeType: file.mime_type,
      editUrl,
      createdAt: file.created_at
    });
  } catch (error) {
    logger.error('Create document error:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

/**
 * GET /api/files/:id/export-formats
 * Get available export formats for a specific file
 */
router.get('/:id/export-formats', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT mime_type FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mimeType = result.rows[0].mime_type;
    const category = MIME_TO_CATEGORY[mimeType];

    if (!category) {
      return res.json({ formats: [] });
    }

    res.json({
      category,
      formats: EXPORT_FORMATS[category] || []
    });
  } catch (error) {
    logger.error('Get export formats error:', error);
    res.status(500).json({ error: 'Failed to get export formats' });
  }
});

/**
 * POST /api/files/:id/export
 * Export/convert a file to a different format
 * This creates a converted copy via Collabora's conversion service
 */
router.post('/:id/export', async (req, res) => {
  try {
    const { format } = req.body; // Target format extension (e.g., 'pdf', 'docx')

    if (!format) {
      return res.status(400).json({ error: 'Target format required' });
    }

    // Get file info
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check access
    if (file.owner_id !== req.user.id) {
      const shareResult = await pool.query(
        'SELECT * FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [file.id, req.user.id]
      );
      if (shareResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get the target MIME type
    const targetMime = EXT_TO_MIME[format];
    if (!targetMime) {
      return res.status(400).json({ error: 'Unsupported target format' });
    }

    // Read the source file
    const filePath = path.join(STORAGE_PATH, file.storage_path);
    const fileContent = await fs.readFile(filePath);

    // Call Collabora's conversion service
    const collaboraUrl = process.env.COLLABORA_URL || 'http://collabora:9980';
    const convertUrl = `${collaboraUrl}/cool/convert-to/${format}`;

    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', fileContent, {
      filename: file.original_filename,
      contentType: file.mime_type
    });

    const response = await fetch(convertUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Collabora conversion failed:', { status: response.status, error: errorText });
      return res.status(500).json({ error: 'Conversion failed' });
    }

    const convertedBuffer = Buffer.from(await response.arrayBuffer());

    // Generate filename with new extension
    const baseName = file.original_filename.replace(/\.[^/.]+$/, '');
    const newFilename = `${baseName}.${format}`;

    // Set headers for download
    res.set({
      'Content-Type': targetMime,
      'Content-Disposition': `attachment; filename="${newFilename}"`,
      'Content-Length': convertedBuffer.length
    });

    res.send(convertedBuffer);

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'FILE_EXPORT', 'file', file.id, JSON.stringify({ format }), req.ip]
    );
  } catch (error) {
    logger.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * POST /api/files/:id/save-as
 * Save a copy of the file with a new name/format
 */
router.post('/:id/save-as', async (req, res) => {
  try {
    const { name, format, folderId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'New name required' });
    }

    // Get source file
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const sourceFile = result.rows[0];

    // Check access
    if (sourceFile.owner_id !== req.user.id) {
      const shareResult = await pool.query(
        'SELECT * FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [sourceFile.id, req.user.id]
      );
      if (shareResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Determine target format
    const sourceExt = sourceFile.original_filename.split('.').pop().toLowerCase();
    const targetExt = format || sourceExt;
    const targetMime = EXT_TO_MIME[targetExt] || sourceFile.mime_type;

    // Read source file
    const sourcePath = path.join(STORAGE_PATH, sourceFile.storage_path);
    let fileContent = await fs.readFile(sourcePath);

    // Convert if different format requested
    if (format && format !== sourceExt) {
      const collaboraUrl = process.env.COLLABORA_URL || 'http://collabora:9980';
      const convertUrl = `${collaboraUrl}/cool/convert-to/${format}`;

      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileContent, {
        filename: sourceFile.original_filename,
        contentType: sourceFile.mime_type
      });

      const response = await fetch(convertUrl, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      if (!response.ok) {
        return res.status(500).json({ error: 'Conversion failed' });
      }

      fileContent = Buffer.from(await response.arrayBuffer());
    }

    // Create new file
    const newFileId = uuidv4();
    const newFilename = name.endsWith(`.${targetExt}`) ? name : `${name}.${targetExt}`;
    const storageFilename = `${newFileId}.${targetExt}`;
    const userDir = path.join(STORAGE_PATH, req.user.id);
    const newFilePath = path.join(userDir, storageFilename);
    const storagePath = path.join(req.user.id, storageFilename);

    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(newFilePath, fileContent);

    const stats = await fs.stat(newFilePath);

    // Check storage quota
    const userResult = await pool.query(
      'SELECT storage_quota, storage_used FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (user.storage_used + stats.size > user.storage_quota) {
      await fs.unlink(newFilePath);
      return res.status(413).json({ error: 'Storage quota exceeded' });
    }

    // Create file record
    const fileResult = await pool.query(
      `INSERT INTO files (id, owner_id, filename, original_filename, mime_type, size, storage_path, parent_folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [newFileId, req.user.id, storageFilename, newFilename, targetMime, stats.size, storagePath, folderId || null]
    );

    // Update user storage
    await pool.query(
      'UPDATE users SET storage_used = storage_used + $1 WHERE id = $2',
      [stats.size, req.user.id]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, 'FILE_SAVE_AS', 'file', newFileId, JSON.stringify({ 
        sourceId: sourceFile.id, 
        newName: newFilename,
        format: targetExt 
      }), req.ip]
    );

    const newFile = fileResult.rows[0];

    res.status(201).json({
      id: newFile.id,
      name: newFile.original_filename,
      mimeType: newFile.mime_type,
      size: parseInt(newFile.size),
      createdAt: newFile.created_at
    });
  } catch (error) {
    logger.error('Save-as error:', error);
    res.status(500).json({ error: 'Save-as failed' });
  }
});

/**
 * GET /api/files/:id/editors
 * Get active editors for a file (co-editing awareness)
 */
router.get('/:id/editors', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];

    // Check access
    if (file.owner_id !== req.user.id) {
      const shareResult = await pool.query(
        'SELECT * FROM file_shares WHERE file_id = $1 AND shared_with = $2',
        [file.id, req.user.id]
      );
      if (shareResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get active editors (active in last 5 minutes)
    const editorsResult = await pool.query(
      `SELECT s.user_id, u.display_name, u.email, s.last_activity
       FROM active_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.file_id = $1 AND s.last_activity > NOW() - INTERVAL '5 minutes'
       ORDER BY s.last_activity DESC`,
      [req.params.id]
    );

    res.json({
      fileId: file.id,
      fileName: file.original_filename,
      editorCount: editorsResult.rows.length,
      editors: editorsResult.rows.map(e => ({
        userId: e.user_id,
        displayName: e.display_name,
        email: e.email,
        lastActivity: e.last_activity
      }))
    });
  } catch (error) {
    logger.error('Get editors error:', error);
    res.status(500).json({ error: 'Failed to get editors' });
  }
});

/**
 * GET /api/files/:id/shares
 * Get all shares for a file
 */
router.get('/:id/shares', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    const sharesResult = await pool.query(
      `SELECT fs.id, fs.permission, fs.is_public, fs.share_token, fs.expires_at, fs.created_at,
              u.email as shared_with_email, u.display_name as shared_with_name
       FROM file_shares fs
       LEFT JOIN users u ON fs.shared_with = u.id
       WHERE fs.file_id = $1`,
      [req.params.id]
    );

    const domain = process.env.DOMAIN || 'localhost';

    res.json({
      shares: sharesResult.rows.map(s => ({
        id: s.id,
        permission: s.permission,
        isPublic: s.is_public,
        shareUrl: s.share_token ? `https://${domain}/shared/${s.share_token}` : null,
        sharedWith: s.shared_with_email ? {
          email: s.shared_with_email,
          displayName: s.shared_with_name
        } : null,
        expiresAt: s.expires_at,
        createdAt: s.created_at
      }))
    });
  } catch (error) {
    logger.error('Get shares error:', error);
    res.status(500).json({ error: 'Failed to get shares' });
  }
});

/**
 * DELETE /api/files/:id/shares/:shareId
 * Remove a share
 */
router.delete('/:id/shares/:shareId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    await pool.query(
      'DELETE FROM file_shares WHERE id = $1 AND file_id = $2',
      [req.params.shareId, req.params.id]
    );

    res.json({ message: 'Share removed' });
  } catch (error) {
    logger.error('Delete share error:', error);
    res.status(500).json({ error: 'Failed to remove share' });
  }
});

module.exports = router;
