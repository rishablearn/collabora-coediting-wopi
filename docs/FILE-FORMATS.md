# Supported File Formats

This document describes the file formats supported by Collabora Standalone for creation, editing, and export.

## Table of Contents

- [Overview](#overview)
- [Document Formats](#document-formats)
- [Spreadsheet Formats](#spreadsheet-formats)
- [Presentation Formats](#presentation-formats)
- [Drawing Formats](#drawing-formats)
- [Export/Save As](#exportsave-as)
- [API Reference](#api-reference)

---

## Overview

Collabora Online supports a wide range of document formats through LibreOffice's conversion capabilities. Files can be:

- **Created** - Start with a blank document in your preferred format
- **Uploaded** - Import existing files from your computer
- **Edited** - Full editing capabilities with auto-save
- **Exported** - Convert and download in different formats
- **Save As** - Create copies in different formats

---

## Document Formats

### Supported for Editing

| Format | Extension | MIME Type | Create | Edit | Export |
|--------|-----------|-----------|--------|------|--------|
| ODF Text | `.odt` | `application/vnd.oasis.opendocument.text` | ✅ | ✅ | ✅ |
| Word Document | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | ✅ | ✅ | ✅ |
| Word 97-2003 | `.doc` | `application/msword` | ❌ | ✅ | ✅ |
| Rich Text | `.rtf` | `application/rtf` | ❌ | ✅ | ✅ |
| Plain Text | `.txt` | `text/plain` | ❌ | ✅ | ✅ |
| HTML | `.html` | `text/html` | ❌ | ✅ | ✅ |

### Export-Only Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| PDF | `.pdf` | Portable Document Format (read-only export) |

---

## Spreadsheet Formats

### Supported for Editing

| Format | Extension | MIME Type | Create | Edit | Export |
|--------|-----------|-----------|--------|------|--------|
| ODF Spreadsheet | `.ods` | `application/vnd.oasis.opendocument.spreadsheet` | ✅ | ✅ | ✅ |
| Excel Document | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ✅ | ✅ | ✅ |
| Excel 97-2003 | `.xls` | `application/vnd.ms-excel` | ❌ | ✅ | ✅ |
| CSV | `.csv` | `text/csv` | ❌ | ✅ | ✅ |

### Export-Only Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| PDF | `.pdf` | Portable Document Format |

---

## Presentation Formats

### Supported for Editing

| Format | Extension | MIME Type | Create | Edit | Export |
|--------|-----------|-----------|--------|------|--------|
| ODF Presentation | `.odp` | `application/vnd.oasis.opendocument.presentation` | ✅ | ✅ | ✅ |
| PowerPoint | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | ✅ | ✅ | ✅ |
| PowerPoint 97-2003 | `.ppt` | `application/vnd.ms-powerpoint` | ❌ | ✅ | ✅ |

### Export-Only Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| PDF | `.pdf` | Portable Document Format |

---

## Drawing Formats

### Supported for Editing

| Format | Extension | MIME Type | Create | Edit | Export |
|--------|-----------|-----------|--------|------|--------|
| ODF Drawing | `.odg` | `application/vnd.oasis.opendocument.graphics` | ✅ | ✅ | ✅ |

### Export-Only Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| PDF | `.pdf` | Portable Document Format |

---

## Export/Save As

### Using the Editor

Collabora Online provides built-in export functionality:

1. **File Menu** → **Download as** → Select format
2. **File Menu** → **Save As** → Choose name and format

### Using the API

#### Get Available Export Formats

```bash
GET /api/files/:id/export-formats
Authorization: Bearer <token>
```

Response:
```json
{
  "category": "document",
  "formats": [
    { "ext": "odt", "mime": "application/vnd.oasis.opendocument.text", "label": "ODF Document (.odt)" },
    { "ext": "docx", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "label": "Word Document (.docx)" },
    { "ext": "pdf", "mime": "application/pdf", "label": "PDF (.pdf)" }
  ]
}
```

#### Export a File

```bash
POST /api/files/:id/export
Authorization: Bearer <token>
Content-Type: application/json

{
  "format": "pdf"
}
```

Returns the converted file as a download.

#### Save As (Create Copy)

```bash
POST /api/files/:id/save-as
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Document Copy",
  "format": "docx",
  "folderId": "optional-folder-id"
}
```

Response:
```json
{
  "id": "new-file-uuid",
  "name": "My Document Copy.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 12345,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

---

## API Reference

### Get All Supported Formats

```bash
GET /api/files/formats
Authorization: Bearer <token>
```

Response:
```json
{
  "create": {
    "document": [
      { "ext": "odt", "mime": "...", "label": "ODF Document (.odt)", "default": true },
      { "ext": "docx", "mime": "...", "label": "Word Document (.docx)" }
    ],
    "spreadsheet": [...],
    "presentation": [...],
    "drawing": [...]
  },
  "export": {
    "document": [...],
    "spreadsheet": [...],
    "presentation": [...],
    "drawing": [...]
  },
  "supported": {
    "application/vnd.oasis.opendocument.text": "odt",
    ...
  }
}
```

### Create New Document

```bash
POST /api/files/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Document",
  "type": "document",
  "format": "docx",  // Optional: defaults to ODF format
  "folderId": "optional-folder-id"
}
```

Supported types:
- `document` - Text document (default: `.odt`, optional: `.docx`)
- `spreadsheet` - Spreadsheet (default: `.ods`, optional: `.xlsx`)
- `presentation` - Presentation (default: `.odp`, optional: `.pptx`)
- `drawing` - Drawing (default: `.odg`)

---

## Format Conversion Notes

### Best Practices

1. **Native Formats** - ODF formats (`.odt`, `.ods`, `.odp`) preserve all features
2. **MS Office** - DOCX/XLSX/PPTX have excellent compatibility
3. **Legacy Formats** - DOC/XLS/PPT work but may have minor formatting differences
4. **PDF Export** - Best for sharing final documents

### Conversion Limitations

- Some advanced formatting may change during conversion
- Macros are not preserved when converting between formats
- Embedded objects may be converted to images
- Custom fonts may be substituted if not available

### Recommended Workflow

1. **Create** documents in your preferred working format
2. **Edit** and save in the same format to preserve features
3. **Export** to PDF for distribution
4. **Convert** to other formats only when required by recipients

---

## Troubleshooting

### "Conversion failed" Error

- Ensure Collabora is running and accessible
- Check that the source file is not corrupted
- Verify the target format is supported for the document type

### Format Not Available

- Some formats are only available for specific document types
- PDF export is available for all document types
- Check the `/api/files/formats` endpoint for current support

### Quality Issues After Conversion

- Use native formats when possible
- For MS Office compatibility, use OOXML formats (`.docx`, `.xlsx`, `.pptx`)
- Test conversions before distributing important documents
