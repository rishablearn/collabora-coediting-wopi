# Collabora Online Standalone with LDAP/LTPA

A complete standalone deployment of **Collabora Online** with enterprise authentication support, web interface, and file storage—**no OwnCloud or NextCloud required**.

## 🚀 Features

- **Standalone Collabora Online** - Full office suite (Writer, Calc, Impress)
- **Enterprise Authentication** - LDAP, Active Directory, and LTPA2 SSO support
- **Multiple Auth Modes** - Local, LDAP, LTPA, or Hybrid authentication
- **IBM WebSphere SSO** - LTPA2 token integration for single sign-on
- **File Storage** - Local file storage with quota management
- **Modern Web UI** - React-based document manager
- **Whitelabel Support** - Customizable branding, colors, and logos
- **WOPI Protocol** - Complete WOPI server implementation
- **Docker Deployment** - Containerized for easy deployment
- **SSL/TLS Ready** - Nginx reverse proxy with HTTPS
- **Existing SSL Support** - Import your own SSL certificates

## 📋 Prerequisites

- **Linux Distribution** (any of the following):
  - Ubuntu 20.04+, Debian 11+
  - RHEL 8+, CentOS Stream 8+, Rocky Linux 8+, AlmaLinux 8+
  - Fedora 37+
  - openSUSE Leap 15+, SLES 15+
  - Amazon Linux 2/2023
- **Docker Engine** 20.10+
- **Docker Compose** v2.0+
- **Domain name** with DNS pointing to your server
- **Minimum specs**: 4GB RAM, 2 CPU cores, 20GB storage

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS (443)
┌─────────────────────────▼───────────────────────────────────┐
│                    Nginx Reverse Proxy                       │
│              (SSL termination, routing)                      │
└──────┬──────────────┬──────────────────┬────────────────────┘
       │              │                  │
       ▼              ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Web Frontend │ │ WOPI Server  │ │ Collabora Online │
│   (React)    │ │  (Node.js)   │ │     (CODE)       │
└──────────────┘ └──────┬───────┘ └──────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
     ┌──────────────┐        ┌──────────────┐
     │  PostgreSQL  │        │    Redis     │
     │  (Database)  │        │  (Sessions)  │
     └──────────────┘        └──────────────┘
```

## 📁 Project Structure

```
collabora-standalone/
├── docker-compose.yml      # Main Docker Compose configuration
├── .env.example           # Environment variables template
├── nginx/
│   ├── nginx.conf         # Nginx main configuration
│   └── conf.d/
│       └── default.conf   # Server block configuration
├── ssl/                   # SSL certificates (generated)
├── wopi-server/           # Custom WOPI server
│   ├── Dockerfile
│   ├── package.json
│   ├── db/
│   │   └── init.sql       # Database schema
│   └── src/
│       ├── index.js       # Entry point
│       ├── routes/        # API routes
│       ├── middleware/    # Auth middleware
│       └── utils/         # Utilities
├── web-frontend/          # React web application
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── pages/         # Page components
│       └── components/    # UI components
└── scripts/
    ├── setup.sh           # Initial setup
    ├── deploy.sh          # Deployment script
    ├── backup.sh          # Backup script
    └── ssl-letsencrypt.sh # Let's Encrypt setup
```

## 🚀 Quick Start

### 1. Clone and Setup

```bash
# Clone or download the project
cd collabora-standalone

# Make scripts executable
chmod +x scripts/*.sh

# (Optional) Install Docker if not already installed
./scripts/install-docker.sh

# Run setup script
./scripts/setup.sh
```

The setup script will:
- Detect your Linux distribution automatically
- Check prerequisites (Docker, Docker Compose, OpenSSL)
- Generate secure secrets
- Configure SSL certificates (self-signed, import existing, or skip)
- Configure authentication mode (Local, LDAP, LTPA, or Hybrid)
- Configure the environment

## 🔐 Authentication Modes

This deployment supports multiple authentication methods:

| Mode | Description |
|------|-------------|
| **Local** | Database users with email/password (default) |
| **LDAP** | Active Directory or OpenLDAP authentication |
| **LTPA** | IBM WebSphere LTPA2 Single Sign-On |
| **LDAP+LTPA** | Combined SSO with LDAP user validation |
| **Hybrid** | LDAP with local fallback |

### LDAP Configuration

```env
AUTH_MODE=ldap
LDAP_URL=ldap://ldap.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_BIND_DN=cn=service,dc=example,dc=com
LDAP_BIND_PASSWORD=your-password
```

### LTPA2 SSO Configuration

```env
AUTH_MODE=ltpa
LTPA_SECRET_KEY=your-base64-encoded-key
LTPA_COOKIE_NAME=LtpaToken2
LTPA_REALM=defaultRealm
```

### LDAP + LTPA Combined Configuration

```env
AUTH_MODE=ldap_ltpa

# LDAP for user validation
LDAP_URL=ldap://ldap.example.com:389
LDAP_BASE_DN=dc=example,dc=com

# LTPA for SSO
LTPA_SECRET_KEY=your-base64-encoded-key
LTPA_COOKIE_NAME=LtpaToken2
```

### Uploading LTPA Keys File

You can upload your `ltpa.keys` file with password:
- **During setup**: Option 5 prompts for ltpa.keys path and password
- **Via Admin API**: `POST /api/admin/ltpa/upload` with file and password
- **Manual config**: `POST /api/admin/ltpa/configure` with extracted keys

📚 **See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for detailed configuration guides.**

## 🎨 Whitelabeling / Custom Branding

Customize the application to match your organization's branding:

### Quick Customization

1. **Edit the configuration:**
   ```bash
   nano web-frontend/src/config/whitelabel.config.js
   ```

2. **Add your logo:**
   ```bash
   cp your-logo.svg web-frontend/public/branding/logo.svg
   ```

3. **Rebuild and deploy:**
   ```bash
   docker compose build web-frontend
   docker compose up -d web-frontend
   ```

### What Can Be Customized

| Element | Description |
|---------|-------------|
| **Logo** | Header logo, login page logo, favicon |
| **Colors** | Primary brand color, secondary colors, status colors |
| **App Name** | Application name throughout the UI |
| **Typography** | Font family and sizes |
| **UI Elements** | Border radius, animations, dark mode |
| **Text Labels** | Button text, navigation labels, page titles |
| **Features** | Toggle registration, social login, etc. |

📚 **See [docs/WHITELABELING.md](docs/WHITELABELING.md) for the complete whitelabeling guide.**

## � Security

### Generating Secrets

Before deployment, generate secure secrets:

```bash
# Automated (recommended)
./scripts/generate-secrets.sh

# Or manually
openssl rand -hex 32  # For JWT_SECRET, WOPI_SECRET
openssl rand -base64 24  # For passwords
```

### Security Features

- **Secret Validation** - Server validates all secrets on startup
- **Password Hashing** - bcrypt with cost factor 12
- **Password Strength** - Visual indicator during registration
- **Rate Limiting** - Configurable request limits
- **Audit Logging** - Track user actions

📚 **See [docs/SECURITY.md](docs/SECURITY.md) for the complete security guide.**

## 📄 File Format Support

### Supported Formats

| Type | Create | Edit | Export |
|------|--------|------|--------|
| **Documents** | `.odt`, `.docx` | `.odt`, `.docx`, `.doc`, `.rtf`, `.txt` | All + PDF |
| **Spreadsheets** | `.ods`, `.xlsx` | `.ods`, `.xlsx`, `.xls`, `.csv` | All + PDF |
| **Presentations** | `.odp`, `.pptx` | `.odp`, `.pptx`, `.ppt` | All + PDF |
| **Drawings** | `.odg` | `.odg` | PDF |

### Features

- **Create** - New documents in ODF or MS Office formats
- **Edit** - Full editing with Collabora Online
- **Export** - Convert and download in different formats
- **Save As** - Create copies with format conversion

📚 **See [docs/FILE-FORMATS.md](docs/FILE-FORMATS.md) for the complete file format guide.**

## 🔒 SSL Certificates

### Using Existing Certificates

During setup, select option 2 to import your existing SSL certificates:

```bash
./scripts/setup.sh
# Select: 2) Import existing certificates
# Provide paths to your certificate and key files
```

Or manually copy certificates:

```bash
cp /path/to/your/fullchain.pem ssl/fullchain.pem
cp /path/to/your/privkey.pem ssl/privkey.pem
chmod 600 ssl/privkey.pem
```

### 2. Deploy

```bash
./scripts/deploy.sh
```

### 3. Access

- **Web Application**: `https://your-domain.com`
- **Collabora Admin**: `https://your-domain.com/browser/dist/admin/admin.html`

## 📖 Detailed Installation Guide

### Step 1: Prepare Ubuntu Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose (if not included)
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### Step 2: Configure DNS

Point your domain to your server's IP address:

```
collabora.yourdomain.com  A  your-server-ip
```

### Step 3: Download and Configure

```bash
# Create project directory
mkdir -p /opt/collabora
cd /opt/collabora

# Download project files (or clone from your repository)
# ...

# Run setup
./scripts/setup.sh
```

### Step 4: Configure Environment

Edit `.env` file to customize settings:

```bash
nano .env
```

Key settings:
- `DOMAIN` - Your domain name
- `COLLABORA_ADMIN_USER` - Admin username for Collabora
- `COLLABORA_ADMIN_PASSWORD` - Admin password (auto-generated)
- `MAX_UPLOAD_SIZE` - Maximum file upload size
- `STORAGE_QUOTA_PER_USER` - Storage quota per user (in bytes)

### Step 5: SSL Certificates

**For Production (Let's Encrypt):**

```bash
./scripts/ssl-letsencrypt.sh
```

**For Testing (Self-signed):**

The setup script generates self-signed certificates automatically.

### Step 6: Deploy

```bash
./scripts/deploy.sh
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOMAIN` | Your domain name | - |
| `COLLABORA_ADMIN_USER` | Collabora admin username | admin |
| `COLLABORA_ADMIN_PASSWORD` | Collabora admin password | (generated) |
| `JWT_SECRET` | JWT signing secret | (generated) |
| `WOPI_SECRET` | WOPI token secret | (generated) |
| `POSTGRES_USER` | Database username | collabora |
| `POSTGRES_PASSWORD` | Database password | (generated) |
| `POSTGRES_DB` | Database name | collabora_db |
| `MAX_UPLOAD_SIZE` | Max upload size | 100M |
| `STORAGE_QUOTA_PER_USER` | User storage quota | 5368709120 (5GB) |
| `SESSION_TIMEOUT` | Session timeout (seconds) | 86400 |

### Collabora Settings

Additional Collabora settings can be configured via environment variables in `docker-compose.yml`:

```yaml
environment:
  - dictionaries=en_US,de_DE,fr_FR  # Spellcheck languages
  - extra_params=--o:ssl.enable=false --o:ssl.termination=true
```

## 📚 API Documentation

### Authentication

#### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securepassword",
  "displayName": "John Doe"
}
```

#### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}

# Response
{
  "user": { ... },
  "token": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Files

#### List Files
```bash
GET /api/files
Authorization: Bearer <token>

# Query params
?folderId=<uuid>  # Optional folder filter
&search=<query>   # Optional search
```

#### Upload File
```bash
POST /api/files/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <file>
folderId: <uuid>  # Optional
```

#### Create Document
```bash
POST /api/files/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Document",
  "type": "document|spreadsheet|presentation",
  "folderId": "<uuid>"  # Optional
}
```

#### Get Edit URL
```bash
GET /api/files/:id/edit
Authorization: Bearer <token>

# Response
{
  "editUrl": "https://domain/browser/<hash>/cool.html?WOPISrc=...",
  "accessToken": "...",
  "permission": "edit|view"
}
```

## 🔒 Security

### Recommendations for Production

1. **Use Let's Encrypt certificates**
   ```bash
   ./scripts/ssl-letsencrypt.sh
   ```

2. **Configure firewall**

   *Ubuntu/Debian (UFW):*
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

   *RHEL/CentOS/Fedora (firewalld):*
   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

3. **Change default admin credentials**
   Update `.env` with strong passwords

4. **Enable rate limiting**
   Already configured in Nginx and API

5. **Regular backups**
   ```bash
   # Add to crontab
   0 2 * * * /opt/collabora/scripts/backup.sh
   ```

6. **Keep containers updated**
   ```bash
   docker compose pull
   docker compose up -d
   ```

## 🛠️ Maintenance

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f collabora
docker compose logs -f wopi-server
```

### Backup

```bash
./scripts/backup.sh
```

Backups are stored in `./backups/` directory.

### Restore

```bash
# Restore database
gunzip -c backups/database_TIMESTAMP.sql.gz | docker compose exec -T postgres psql -U collabora collabora_db

# Restore documents
docker run --rm \
  -v collabora-standalone_document-storage:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/documents_TIMESTAMP.tar.gz -C /data
```

### Update

```bash
# Pull latest images
docker compose pull

# Rebuild custom images
docker compose build --no-cache

# Restart services
docker compose up -d
```

## 🐛 Troubleshooting

### Common Issues

**1. Collabora not loading documents**

Check WOPI server connectivity:
```bash
curl http://localhost:3000/health
curl http://localhost:9980/hosting/capabilities
```

**2. SSL certificate errors**

Verify certificates:
```bash
openssl x509 -in ssl/fullchain.pem -text -noout
```

**3. Database connection issues**

Check PostgreSQL:
```bash
docker compose exec postgres psql -U collabora -d collabora_db -c "SELECT 1"
```

**4. Permission denied errors**

Check volume permissions:
```bash
docker compose exec wopi-server ls -la /storage
```

### Debug Mode

Enable verbose logging:
```bash
# In .env
LOG_LEVEL=debug

# Restart
docker compose restart wopi-server
```

## 📄 License

This project is licensed under the MIT License. See LICENSE file for details.

Collabora Online is licensed under the Mozilla Public License v2.0.

## 🤝 Support

- **Documentation**: This README
- **Issues**: Create a GitHub issue
- **Collabora Documentation**: https://sdk.collaboraonline.com/

## 🙏 Acknowledgments

- [Collabora Online](https://www.collaboraoffice.com/)
- [LibreOffice](https://www.libreoffice.org/)
- [WOPI Protocol](https://docs.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/)
