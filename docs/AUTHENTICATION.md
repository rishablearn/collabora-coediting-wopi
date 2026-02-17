# Authentication Guide

This document covers the authentication options available in Collabora Standalone with LTPA.

## Authentication Modes

The application supports four authentication modes, configured via the `AUTH_MODE` environment variable:

| Mode | Description |
|------|-------------|
| `local` | Database users only (default) |
| `ldap` | LDAP/Active Directory authentication |
| `ltpa` | IBM WebSphere LTPA2 Single Sign-On |
| `hybrid` | LDAP authentication with local fallback |

## Local Authentication

Default mode using the PostgreSQL database for user management.

```env
AUTH_MODE=local
```

Users register and login with email/password stored in the database.

---

## LDAP Authentication

Authenticate users against an LDAP directory (Active Directory, OpenLDAP, etc.).

### Configuration

```env
AUTH_MODE=ldap

# LDAP Server
LDAP_URL=ldap://ldap.example.com:389
# For LDAPS: ldaps://ldap.example.com:636

# Base DN for searches
LDAP_BASE_DN=dc=example,dc=com

# Service account for binding (optional for anonymous bind)
LDAP_BIND_DN=cn=service,ou=users,dc=example,dc=com
LDAP_BIND_PASSWORD=your-service-password

# User search configuration
LDAP_USER_SEARCH_BASE=ou=users
LDAP_USER_SEARCH_FILTER=(uid={{username}})

# Attribute mappings
LDAP_USERNAME_ATTR=uid
LDAP_EMAIL_ATTR=mail
LDAP_DISPLAY_NAME_ATTR=cn

# Admin group (users in this group get admin role)
LDAP_ADMIN_GROUP=cn=admins,ou=groups,dc=example,dc=com

# TLS settings
LDAP_TLS_REJECT_UNAUTHORIZED=true
```

### Active Directory Configuration

For Microsoft Active Directory:

```env
LDAP_URL=ldap://dc.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_BIND_DN=CN=ServiceAccount,OU=Users,DC=example,DC=com
LDAP_USER_SEARCH_BASE=OU=Users
LDAP_USER_SEARCH_FILTER=(sAMAccountName={{username}})
LDAP_USERNAME_ATTR=sAMAccountName
LDAP_EMAIL_ATTR=mail
LDAP_DISPLAY_NAME_ATTR=displayName
LDAP_ADMIN_GROUP=CN=Domain Admins,CN=Users,DC=example,DC=com
```

### OpenLDAP Configuration

```env
LDAP_URL=ldap://openldap.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_USER_SEARCH_BASE=ou=people
LDAP_USER_SEARCH_FILTER=(uid={{username}})
LDAP_USERNAME_ATTR=uid
LDAP_EMAIL_ATTR=mail
LDAP_DISPLAY_NAME_ATTR=cn
```

### How LDAP Authentication Works

1. User submits username/password
2. Server binds to LDAP with service account
3. Searches for user by username
4. Attempts to bind as the user with provided password
5. If successful, creates/updates local user record
6. Issues JWT token for session

---

## LTPA2 Single Sign-On

Integrate with IBM WebSphere or Liberty servers using LTPA2 tokens.

### What is LTPA?

Lightweight Third-Party Authentication (LTPA) is a token-based SSO mechanism used by IBM WebSphere Application Server and Liberty. When users authenticate to a WebSphere application, they receive an encrypted LTPA token cookie that can be shared across trusted applications.

### Configuration

```env
AUTH_MODE=ltpa

# LTPA Secret Key (from ltpa.keys file, base64 encoded)
LTPA_SECRET_KEY=your-base64-encoded-secret

# Cookie settings
LTPA_COOKIE_NAME=LtpaToken2
LTPA_REALM=defaultRealm

# Token expiration (seconds)
LTPA_TOKEN_EXPIRATION=7200

# Trusted domains for SSO (comma-separated)
LTPA_TRUSTED_DOMAINS=.example.com,.internal.example.com
```

### Extracting LTPA Keys from WebSphere

1. **WebSphere Console:**
   - Navigate to Security → Global security → LTPA
   - Export the LTPA keys to a file

2. **From ltpa.keys file:**
   ```bash
   # The key file contains entries like:
   # com.ibm.websphere.ltpa.3DESKey=<base64-encoded-key>
   
   grep "3DESKey" ltpa.keys | cut -d'=' -f2
   ```

3. **Using wsadmin:**
   ```python
   AdminTask.exportLTPAKeys('-ltpaKeyFile /tmp/ltpa.keys -ltpaKeyPassword mypassword')
   ```

### How LTPA2 SSO Works

1. User authenticates to WebSphere application
2. WebSphere sets `LtpaToken2` cookie
3. User accesses Collabora application
4. Server reads LTPA cookie
5. Decrypts and validates token using shared key
6. Extracts username and creates session
7. User is automatically logged in

### LTPA Token Flow

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser   │────▶│    WebSphere    │────▶│   Set Cookie    │
└─────────────┘     │   Application   │     │   LtpaToken2    │
                    └─────────────────┘     └────────┬────────┘
                                                     │
                    ┌─────────────────┐              │
                    │    Collabora    │◀─────────────┘
                    │   Application   │   Cookie sent
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Validate LTPA  │
                    │  Create Session │
                    └─────────────────┘
```

---

## LDAP + LTPA Combined Authentication

The most powerful enterprise mode - combines LTPA2 Single Sign-On with LDAP user validation.

```env
AUTH_MODE=ldap_ltpa
```

### How It Works

1. User authenticates to WebSphere application
2. WebSphere sets LTPA2 token cookie
3. User accesses Collabora application
4. Server validates LTPA token
5. **Server verifies user exists in LDAP** (additional security)
6. User session created with LDAP attributes

### Configuration

```env
AUTH_MODE=ldap_ltpa

# LDAP Settings (for user validation)
LDAP_URL=ldap://ldap.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_BIND_DN=cn=service,dc=example,dc=com
LDAP_BIND_PASSWORD=your-password
LDAP_USER_SEARCH_BASE=ou=users
LDAP_USER_SEARCH_FILTER=(uid={{username}})

# LTPA Settings (for SSO)
LTPA_SECRET_KEY=your-base64-encoded-key
LTPA_COOKIE_NAME=LtpaToken2
LTPA_REALM=defaultRealm
```

### Benefits

- **Single Sign-On**: Users don't need to login again
- **LDAP Validation**: Only users in LDAP directory can access
- **Attribute Sync**: User info (email, name) synced from LDAP
- **Security**: Dual validation prevents unauthorized access

---

## Hybrid Authentication

Combines LDAP with local fallback for maximum flexibility.

```env
AUTH_MODE=hybrid
```

### Authentication Order

1. Try LDAP authentication first
2. If LDAP fails or user not found, try local database
3. Local admin accounts always work as fallback

This is useful for:
- Gradual migration from local to LDAP
- Service accounts that shouldn't be in LDAP
- Emergency access when LDAP is unavailable

---

## LTPA Keys File Management

### Uploading LTPA Keys via Setup Script

During setup, select option 5 (LDAP + LTPA Combined) and provide the path to your `ltpa.keys` file:

```bash
./scripts/setup.sh

# When prompted:
# Path to LTPA keys file (ltpa.keys): /path/to/your/ltpa.keys
# LTPA Keys Password: ********
```

### Uploading LTPA Keys via Admin API

After deployment, administrators can upload LTPA keys via the API:

```bash
# Upload ltpa.keys file
curl -X POST https://your-domain/api/admin/ltpa/upload \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "keysFile=@/path/to/ltpa.keys" \
  -F "password=your-ltpa-keys-password"
```

### Manual LTPA Configuration

Configure LTPA keys manually without the keys file:

```bash
curl -X POST https://your-domain/api/admin/ltpa/configure \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secretKey": "your-base64-3des-key",
    "publicKey": "optional-public-key",
    "privateKey": "optional-private-key",
    "realm": "defaultRealm",
    "cookieName": "LtpaToken2"
  }'
```

### Check LTPA Status

```bash
curl https://your-domain/api/admin/ltpa/status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### LTPA Keys File Location

When uploaded, LTPA keys are stored securely in:
- Docker volume: `ltpa-config`
- Container path: `/app/config/ltpa/`

---

## SSL Certificates

### Using Existing Certificates

During setup, select option 2 to import existing certificates:

```bash
./scripts/setup.sh

# When prompted:
# SSL Certificate Options:
#   1) Generate self-signed certificates (for testing)
#   2) Import existing certificates
#   3) Skip (configure later)
# Select option [1-3]: 2
```

### Manual Certificate Setup

Copy your certificates to the `ssl/` directory:

```bash
# Certificate chain (your cert + intermediate + root)
cp /path/to/your/fullchain.pem ssl/fullchain.pem

# Private key
cp /path/to/your/privkey.pem ssl/privkey.pem

# Set proper permissions
chmod 644 ssl/fullchain.pem
chmod 600 ssl/privkey.pem
```

### Let's Encrypt Certificates

```bash
# Using certbot
certbot certonly --standalone -d collabora.example.com

# Copy certificates
cp /etc/letsencrypt/live/collabora.example.com/fullchain.pem ssl/
cp /etc/letsencrypt/live/collabora.example.com/privkey.pem ssl/
```

### Certificate Requirements

- **Format:** PEM encoded
- **fullchain.pem:** Should include server certificate + intermediate certificates
- **privkey.pem:** Private key (RSA or ECDSA)

---

## Testing Authentication

### Test LDAP Connection

```bash
# Using ldapsearch
ldapsearch -x -H ldap://ldap.example.com:389 \
  -D "cn=service,dc=example,dc=com" \
  -W -b "dc=example,dc=com" "(uid=testuser)"
```

### Test LTPA Configuration

The application provides a health endpoint that includes auth status:

```bash
curl -k https://your-domain/health
```

### Debug Logging

Enable debug logging to troubleshoot authentication:

```env
LOG_LEVEL=debug
```

View logs:
```bash
docker compose logs -f wopi-server | grep -i "auth\|ldap\|ltpa"
```

---

## Security Best Practices

1. **Use LDAPS (port 636)** for production LDAP connections
2. **Store LTPA keys securely** - never commit to version control
3. **Use strong service account passwords** for LDAP bind
4. **Enable TLS certificate verification** (`LDAP_TLS_REJECT_UNAUTHORIZED=true`)
5. **Limit LTPA trusted domains** to only necessary domains
6. **Rotate LTPA keys periodically** and update all participating applications
7. **Use hybrid mode** for emergency local admin access

---

## Troubleshooting

### LDAP Connection Failed

```
Error: LDAP service bind failed
```

- Verify LDAP URL is reachable
- Check bind DN and password
- Ensure firewall allows connection

### LTPA Token Invalid

```
Error: Invalid LTPA token
```

- Verify LTPA_SECRET_KEY matches WebSphere configuration
- Check token hasn't expired
- Ensure cookie domain is correct

### User Not Found in LDAP

```
Warning: LDAP user not found
```

- Check LDAP_USER_SEARCH_BASE and LDAP_USER_SEARCH_FILTER
- Verify user exists in LDAP directory
- Test with ldapsearch command

### Certificate Errors

```
Error: self signed certificate
```

- Set `LDAP_TLS_REJECT_UNAUTHORIZED=false` for testing only
- Add CA certificate to trusted store for production
