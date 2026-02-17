# Real-Time Co-Editing with WOPI and LTPA

This document describes the co-editing implementation for Collabora Online with LTPA-based authentication.

## Overview

The system enables multiple users to edit the same document simultaneously using:
- **WOPI Protocol** for document access and locking
- **LTPA Tokens** for user identity and SSO
- **FileUniqueId** for session grouping
- **File Sharing** for access control

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Browser   │────▶│    Nginx     │────▶│   Collabora     │
│  (User A)   │     │   Reverse    │     │   Online        │
└─────────────┘     │   Proxy      │     │                 │
                    └──────┬───────┘     └────────┬────────┘
┌─────────────┐            │                      │
│   Browser   │────────────┘                      │
│  (User B)   │                                   │
└─────────────┘                                   │
                                                  │ WOPI Requests
                    ┌──────────────┐              │
                    │  WOPI Server │◀─────────────┘
                    │  (Node.js)   │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
      ┌─────▼────┐   ┌─────▼────┐   ┌─────▼────┐
      │PostgreSQL│   │  Redis   │   │  Storage │
      │(metadata)│   │(sessions)│   │ (files)  │
      └──────────┘   └──────────┘   └──────────┘
```

## Key Components

### 1. WOPI Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wopi/files/{fileId}` | GET | CheckFileInfo - returns file metadata and co-editing capabilities |
| `/wopi/files/{fileId}/contents` | GET | GetFile - returns file content |
| `/wopi/files/{fileId}/contents` | POST | PutFile - saves file content |
| `/wopi/files/{fileId}` | POST | Lock operations (LOCK, UNLOCK, REFRESH_LOCK, etc.) |

### 2. CheckFileInfo Response

The CheckFileInfo response includes critical fields for co-editing:

```json
{
  "FileUniqueId": "abc123...",       // Groups users into same editing session
  "UserId": "user-uuid",
  "UserFriendlyName": "John Doe",
  "UserCanWrite": true,
  "SupportsLocks": true,
  "SupportsUpdate": true,
  "SupportsCoAuthoring": true,
  "LockValue": "lock-id-if-locked"
}
```

### 3. FileUniqueId

The `FileUniqueId` is critical for co-editing. It tells Collabora which users are editing the same document:

```javascript
function generateFileUniqueId(fileId, version) {
  const hash = crypto.createHash('sha256');
  hash.update(`${fileId}:${version}`);
  return hash.digest('hex').substring(0, 32);
}
```

Users with the same `FileUniqueId` are grouped into the same editing session.

### 4. Lock Operations

WOPI locking prevents conflicts during co-editing:

| Operation | Header | Description |
|-----------|--------|-------------|
| LOCK | X-WOPI-Lock | Acquire a lock |
| UNLOCK | X-WOPI-Lock | Release a lock |
| REFRESH_LOCK | X-WOPI-Lock | Extend lock duration |
| GET_LOCK | - | Get current lock ID |
| UNLOCK_AND_RELOCK | X-WOPI-OldLock, X-WOPI-Lock | Atomically replace lock |

## LTPA Integration

### Token Flow

1. User authenticates via LTPA (Domino SSO)
2. LTPA token stored in cookie
3. WOPI access token generated with user info
4. Collabora passes access token in WOPI requests
5. WOPI server extracts user identity for `UserFriendlyName`

### Access Token Structure

```javascript
{
  fileId: "file-uuid",
  userId: "user-uuid",
  permissions: "edit",
  displayName: "John Doe",        // From LTPA
  email: "john@example.com",      // From LDAP
  authSource: "ltpa",
  sessionId: "random-session-id",
  timestamp: 1234567890
}
```

## File Sharing

### Permission Levels

| Permission | Read | Write | Share |
|------------|------|-------|-------|
| view | ✓ | ✗ | ✗ |
| edit | ✓ | ✓ | ✗ |
| admin | ✓ | ✓ | ✓ |

### Access Check Flow

```javascript
const accessInfo = await sharingService.checkFileAccess(fileId, userId);
// Returns: { hasAccess, canRead, canWrite, canShare, accessType }
```

Access types:
- `owner` - File owner (full access)
- `shared` - Direct share to user
- `link` - Access via share link
- `public` - Public share

## Configuration

### Environment Variables

```bash
# WOPI Configuration
WOPI_SECRET=your-secret-key
DOMAIN=your-domain.com

# LTPA Configuration
LTPA_SECRET_KEY=base64-encoded-key
LTPA_COOKIE_NAME=LtpaToken2
LTPA_REALM=defaultRealm
LTPA_DOMINO_USER_FORMAT=cn

# Authentication Mode
AUTH_MODE=ldap_ltpa
```

### Collabora Configuration (coolwsd.xml)

Key settings for co-editing:

```xml
<storage>
  <wopi allow="true">
    <host allow="true">wopi-server</host>
    <reuse_cookies type="bool">true</reuse_cookies>
  </wopi>
</storage>

<per_document>
  <max_concurrency>100</max_concurrency>
</per_document>
```

## Testing Co-Editing

### Manual Test

1. Open the same document in two browser tabs (different users)
2. Both users should see each other's cursors
3. Changes should sync in real-time

### Verify WOPI Responses

```bash
# Check FileUniqueId is consistent for same file
curl -H "Authorization: Bearer $TOKEN" \
  https://your-domain.com/wopi/files/$FILE_ID

# Both users should get the same FileUniqueId
```

### Debug Logging

Enable debug logging:

```bash
DEBUG_LDAP=true
DEBUG_LTPA=true
LOG_LEVEL=debug
```

## Troubleshooting

### Users Not Seeing Each Other

1. Check `FileUniqueId` is same for both users
2. Verify both users have `UserCanWrite: true`
3. Check lock conflicts in logs

### Lock Conflicts

1. Check `X-WOPI-Lock` headers in responses
2. Verify lock expiration (30 minutes default)
3. Look for 409 Conflict responses

### LTPA Token Issues

1. Enable `DEBUG_LTPA=true`
2. Check token expiration
3. Verify LTPA secret key matches Domino

## API Reference

### Create Share

```bash
POST /api/files/{fileId}/share
Content-Type: application/json

{
  "email": "user@example.com",
  "permission": "edit"
}
```

### Get Active Editors

```bash
GET /api/files/{fileId}/editors

# Response
{
  "editors": [
    { "userId": "...", "displayName": "John", "lastActivity": "..." }
  ]
}
```

## Database Schema

### file_shares Table

```sql
CREATE TABLE file_shares (
  id UUID PRIMARY KEY,
  file_id UUID REFERENCES files(id),
  shared_by UUID REFERENCES users(id),
  shared_with UUID REFERENCES users(id),
  share_token VARCHAR(255),
  permission VARCHAR(50),  -- view, edit, admin
  expires_at TIMESTAMP,
  is_public BOOLEAN
);
```

### file_locks Table

```sql
CREATE TABLE file_locks (
  id UUID PRIMARY KEY,
  file_id UUID UNIQUE REFERENCES files(id),
  lock_id VARCHAR(255),
  locked_by UUID REFERENCES users(id),
  expires_at TIMESTAMP
);
```

### active_sessions Table

```sql
CREATE TABLE active_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  file_id UUID REFERENCES files(id),
  session_token VARCHAR(255),
  last_activity TIMESTAMP
);
```
