# Security Configuration Guide

This document outlines security best practices and configuration for the Collabora Standalone deployment.

## Table of Contents

- [Secret Management](#secret-management)
- [Generating Secure Secrets](#generating-secure-secrets)
- [Environment Variables](#environment-variables)
- [Password Policies](#password-policies)
- [Security Validation](#security-validation)
- [Production Checklist](#production-checklist)

---

## Secret Management

### Required Secrets

The following secrets **must** be configured before deployment:

| Secret | Purpose | Minimum Length |
|--------|---------|----------------|
| `JWT_SECRET` | Signs authentication tokens | 32 characters (64 hex) |
| `WOPI_SECRET` | Encrypts WOPI access tokens | 32 characters (64 hex) |
| `POSTGRES_PASSWORD` | Database authentication | 12 characters |
| `COLLABORA_ADMIN_PASSWORD` | Collabora admin console | 12 characters |

### Conditional Secrets

These are required based on your authentication mode:

| Secret | Required When | Purpose |
|--------|---------------|---------|
| `LDAP_BIND_PASSWORD` | `AUTH_MODE=ldap` or `hybrid` | LDAP service account |
| `LTPA_SECRET_KEY` | `AUTH_MODE=ltpa` | LTPA token encryption |

---

## Generating Secure Secrets

### Automated Generation (Recommended)

Run the provided script to generate all secrets automatically:

```bash
./scripts/generate-secrets.sh
```

Options:
- `-o, --output FILE` - Write to specified file (default: .env)
- `-f, --force` - Overwrite existing .env file
- `-p, --print` - Print secrets to stdout only
- `-h, --help` - Show help message

### Manual Generation

Generate individual secrets using OpenSSL:

```bash
# For JWT_SECRET and WOPI_SECRET (64 hex characters)
openssl rand -hex 32

# For passwords (24 base64 characters)
openssl rand -base64 24
```

### Example Output

```bash
$ openssl rand -hex 32
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456

$ openssl rand -base64 24
K9mN2xPqR7sT4uV1wXyZ3aBcDeF5
```

---

## Environment Variables

### Security-Critical Variables

```bash
# .env file

# Authentication tokens - REQUIRED
JWT_SECRET=<64-character-hex-string>
WOPI_SECRET=<64-character-hex-string>

# Database - REQUIRED
POSTGRES_PASSWORD=<secure-password>

# Collabora Admin - RECOMMENDED
COLLABORA_ADMIN_PASSWORD=<secure-password>

# LDAP (if using LDAP auth)
LDAP_BIND_PASSWORD=<ldap-service-password>

# LTPA (if using LTPA auth)
LTPA_SECRET_KEY=<ltpa-secret-from-websphere>
```

### Important Notes

1. **Never commit `.env` to version control** - It's already in `.gitignore`
2. **Use different secrets for each environment** - Dev, staging, production
3. **Rotate secrets periodically** - Especially after team changes
4. **Store backups securely** - Use a password manager or vault

---

## Password Policies

### User Passwords

The application enforces the following password requirements:

- **Minimum length**: 8 characters
- **Recommended**: Mix of uppercase, lowercase, numbers, and symbols

### Password Strength Indicator

The registration form includes a visual password strength indicator:

| Level | Requirements |
|-------|-------------|
| Weak | Less than 8 characters |
| Fair | 8+ characters |
| Good | 8+ characters with mixed case and numbers |
| Strong | 8+ characters with mixed case, numbers, and symbols |

### Password Storage

- Passwords are hashed using **bcrypt** with a cost factor of 12
- Plain text passwords are never stored or logged
- Password hashes are stored in the `password_hash` column

---

## Security Validation

### Startup Validation

The server validates all secrets on startup:

```
✓ All secrets validated successfully
```

If secrets are missing or insecure, you'll see:

```
========================================
SECURITY CONFIGURATION ERROR
========================================
The following secrets are missing or insecure:

  • [REQUIRED] JWT_SECRET appears to contain an insecure or default value
  • [REQUIRED] WOPI_SECRET is not set

To fix this:
  1. Run: ./scripts/generate-secrets.sh
  2. Or manually generate secrets with: openssl rand -hex 32
  3. Update your .env file with the generated values
========================================
```

### Development Mode

In development (`NODE_ENV=development`), the server will start with warnings but won't fail. **Never run production with insecure secrets.**

### Production Mode

In production (`NODE_ENV=production`), the server will **refuse to start** if secrets are invalid.

---

## Production Checklist

Before deploying to production, verify:

### Secrets

- [ ] `JWT_SECRET` is a unique 64-character hex string
- [ ] `WOPI_SECRET` is a unique 64-character hex string
- [ ] `POSTGRES_PASSWORD` is a strong, unique password
- [ ] `COLLABORA_ADMIN_PASSWORD` is a strong password
- [ ] All LDAP/LTPA secrets are configured (if applicable)
- [ ] `.env` file is not committed to version control

### Environment

- [ ] `NODE_ENV=production` is set
- [ ] `DOMAIN` is set to your actual domain
- [ ] SSL certificates are valid and not self-signed
- [ ] Rate limiting is enabled

### Access Control

- [ ] Admin endpoints are protected
- [ ] Database is not exposed publicly
- [ ] Redis is not exposed publicly
- [ ] Firewall rules are configured

### Monitoring

- [ ] Logs are being collected
- [ ] Audit trail is enabled
- [ ] Health checks are configured
- [ ] Alerts are set up for failures

---

## Security Best Practices

### 1. Use HTTPS Everywhere

Always use HTTPS in production. The nginx configuration handles SSL termination.

### 2. Keep Dependencies Updated

Regularly update dependencies to patch security vulnerabilities:

```bash
# Check for updates
npm audit

# Update packages
npm update
```

### 3. Limit Network Exposure

- Keep databases and Redis on internal networks
- Use firewall rules to restrict access
- Only expose ports 80 and 443 publicly

### 4. Monitor and Audit

- Review audit logs regularly
- Monitor for failed login attempts
- Set up alerts for suspicious activity

### 5. Backup Securely

- Encrypt database backups
- Store backups in a separate location
- Test backup restoration periodically

---

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** open a public issue
2. Email the maintainers directly
3. Provide detailed steps to reproduce
4. Allow time for a fix before disclosure

---

## Additional Resources

- [OWASP Security Guidelines](https://owasp.org/www-project-web-security-testing-guide/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security](https://docs.docker.com/engine/security/)
