#!/bin/bash

# Collabora Online Standalone - Setup Script
# This script sets up the initial environment for deployment
# Supports: Ubuntu/Debian (apt), RHEL/CentOS/Fedora (yum/dnf), SUSE (zypper)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect OS and package manager
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME=$ID
        OS_VERSION=$VERSION_ID
        OS_PRETTY=$PRETTY_NAME
    elif [ -f /etc/redhat-release ]; then
        OS_NAME="rhel"
        OS_PRETTY=$(cat /etc/redhat-release)
    elif [ -f /etc/debian_version ]; then
        OS_NAME="debian"
        OS_PRETTY="Debian $(cat /etc/debian_version)"
    else
        OS_NAME="unknown"
        OS_PRETTY="Unknown Linux"
    fi

    # Detect package manager
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt"
        PKG_INSTALL="apt-get install -y"
        PKG_UPDATE="apt-get update"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
        PKG_INSTALL="dnf install -y"
        PKG_UPDATE="dnf check-update || true"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
        PKG_INSTALL="yum install -y"
        PKG_UPDATE="yum check-update || true"
    elif command -v zypper &> /dev/null; then
        PKG_MANAGER="zypper"
        PKG_INSTALL="zypper install -y"
        PKG_UPDATE="zypper refresh"
    else
        PKG_MANAGER="unknown"
    fi

    export OS_NAME OS_VERSION OS_PRETTY PKG_MANAGER PKG_INSTALL PKG_UPDATE
}

# Install package based on detected package manager
install_package() {
    local pkg_apt=$1
    local pkg_yum=$2
    local pkg_zypper=${3:-$2}

    if [ "$PKG_MANAGER" = "apt" ]; then
        sudo $PKG_INSTALL $pkg_apt
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        sudo $PKG_INSTALL $pkg_yum
    elif [ "$PKG_MANAGER" = "zypper" ]; then
        sudo $PKG_INSTALL $pkg_zypper
    else
        echo -e "${RED}Unknown package manager. Please install manually: $pkg_apt (Debian) or $pkg_yum (RHEL)${NC}"
        return 1
    fi
}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Collabora Online Standalone Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Detect OS
detect_os
echo -e "${BLUE}Detected OS: ${OS_PRETTY}${NC}"
echo -e "${BLUE}Package Manager: ${PKG_MANAGER}${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Note: Some operations may require sudo privileges${NC}"
fi

# Check prerequisites
echo -e "${GREEN}Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed.${NC}"
    echo ""
    echo "Install Docker using one of these methods:"
    echo ""
    if [ "$PKG_MANAGER" = "apt" ]; then
        echo "  # Ubuntu/Debian:"
        echo "  curl -fsSL https://get.docker.com -o get-docker.sh"
        echo "  sudo sh get-docker.sh"
    elif [ "$PKG_MANAGER" = "dnf" ]; then
        echo "  # Fedora:"
        echo "  sudo dnf install -y dnf-plugins-core"
        echo "  sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo"
        echo "  sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin"
        echo "  sudo systemctl enable --now docker"
    elif [ "$PKG_MANAGER" = "yum" ]; then
        echo "  # RHEL/CentOS:"
        echo "  sudo yum install -y yum-utils"
        echo "  sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo"
        echo "  sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin"
        echo "  sudo systemctl enable --now docker"
    else
        echo "  Visit: https://docs.docker.com/engine/install/"
    fi
    exit 1
fi
echo -e "  ✓ Docker installed"

# Check Docker Compose
if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed.${NC}"
    echo ""
    if [ "$PKG_MANAGER" = "apt" ]; then
        echo "  sudo apt-get install -y docker-compose-plugin"
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        echo "  sudo $PKG_INSTALL docker-compose-plugin"
        echo "  # Or standalone: https://docs.docker.com/compose/install/standalone/"
    fi
    exit 1
fi
echo -e "  ✓ Docker Compose installed"

# Check OpenSSL
if ! command -v openssl &> /dev/null; then
    echo -e "${YELLOW}OpenSSL not found. Attempting to install...${NC}"
    install_package "openssl" "openssl"
fi
echo -e "  ✓ OpenSSL installed"

echo ""

# Get domain name
read -p "Enter your domain name (e.g., collabora.example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain name is required${NC}"
    exit 1
fi

# Create .env file from template
echo -e "${GREEN}Creating environment configuration...${NC}"

if [ -f .env ]; then
    read -p ".env file already exists. Overwrite? (y/N): " OVERWRITE
    if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
        echo "Keeping existing .env file"
    else
        cp .env.example .env
    fi
else
    cp .env.example .env
fi

# Generate secure secrets (using hex to avoid special characters in sed)
JWT_SECRET=$(openssl rand -hex 32)
WOPI_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
# Use hex for admin password too, then take first 16 chars for readability
COLLABORA_ADMIN_PASSWORD=$(openssl rand -hex 8)

# Function to safely update .env values (handles special characters)
update_env_value() {
    local key=$1
    local value=$2
    local file=$3
    
    # Escape special characters for sed
    local escaped_value=$(printf '%s\n' "$value" | sed 's/[&/\]/\\&/g')
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^${key}=.*|${key}=${escaped_value}|" "$file"
    else
        sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$file"
    fi
}

# Function to comment out a line in .env file
comment_env_line() {
    local key=$1
    local file=$2
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^${key}=|# ${key}=|" "$file"
    else
        sed -i "s|^${key}=|# ${key}=|" "$file"
    fi
}

# Function to comment out all LDAP settings
comment_ldap_settings() {
    local file=$1
    local ldap_keys="LDAP_URL LDAP_BASE_DN LDAP_BIND_DN LDAP_BIND_PASSWORD LDAP_USER_SEARCH_BASE LDAP_USER_SEARCH_FILTER LDAP_GROUP_SEARCH_BASE LDAP_GROUP_SEARCH_FILTER LDAP_USERNAME_ATTR LDAP_EMAIL_ATTR LDAP_DISPLAY_NAME_ATTR LDAP_ADMIN_GROUP LDAP_SERVER_TYPE LDAP_TLS_REJECT_UNAUTHORIZED LDAP_TIMEOUT LDAP_CONNECT_TIMEOUT LDAP_IDLE_TIMEOUT LDAP_SEARCH_BY_EMAIL DEBUG_LDAP"
    
    for key in $ldap_keys; do
        comment_env_line "$key" "$file"
    done
}

# Function to comment out all LTPA settings
comment_ltpa_settings() {
    local file=$1
    local ltpa_keys="LTPA_SECRET_KEY LTPA_PUBLIC_KEY LTPA_PRIVATE_KEY LTPA_COOKIE_NAME LTPA_COOKIE_NAME_FALLBACK LTPA_REALM LTPA_TOKEN_EXPIRATION LTPA_TRUSTED_DOMAINS LTPA_DOMINO_USER_FORMAT LTPA_PREFER_AES DEBUG_LTPA"
    
    for key in $ltpa_keys; do
        comment_env_line "$key" "$file"
    done
}

# Update .env file using pipe delimiter to avoid conflicts with paths/special chars
update_env_value "DOMAIN" "$DOMAIN" ".env"
update_env_value "JWT_SECRET" "$JWT_SECRET" ".env"
update_env_value "WOPI_SECRET" "$WOPI_SECRET" ".env"
update_env_value "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD" ".env"
update_env_value "COLLABORA_ADMIN_PASSWORD" "$COLLABORA_ADMIN_PASSWORD" ".env"

echo -e "  ✓ Environment file configured"

# Create SSL directory
echo -e "${GREEN}Setting up SSL certificates...${NC}"
mkdir -p ssl

# Check for existing certificates
if [ -f ssl/fullchain.pem ] && [ -f ssl/privkey.pem ]; then
    echo -e "  ✓ SSL certificates already exist"
else
    echo ""
    echo "SSL Certificate Options:"
    echo "  1) Generate self-signed certificates (for testing)"
    echo "  2) Import existing certificates"
    echo "  3) Skip (configure later)"
    echo ""
    read -p "Select option [1-3]: " SSL_OPTION
    
    case $SSL_OPTION in
        1)
            # Generate self-signed certificate
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                -keyout ssl/privkey.pem \
                -out ssl/fullchain.pem \
                -subj "/CN=${DOMAIN}" \
                -addext "subjectAltName=DNS:${DOMAIN}"
            echo -e "  ✓ Self-signed certificates generated"
            echo -e "${YELLOW}  Note: For production, use Let's Encrypt or your own certificates${NC}"
            ;;
        2)
            echo ""
            echo -e "${BLUE}Import Existing SSL Certificates${NC}"
            echo "You can provide paths to your existing certificate files."
            echo ""
            read -p "Path to certificate file (fullchain/cert.pem): " CERT_PATH
            read -p "Path to private key file (privkey.pem): " KEY_PATH
            
            if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
                cp "$CERT_PATH" ssl/fullchain.pem
                cp "$KEY_PATH" ssl/privkey.pem
                chmod 600 ssl/privkey.pem
                echo -e "  ✓ SSL certificates imported"
            else
                echo -e "${RED}  Error: Certificate files not found${NC}"
                echo -e "${YELLOW}  Please manually copy your certificates to:${NC}"
                echo "    - ssl/fullchain.pem"
                echo "    - ssl/privkey.pem"
            fi
            ;;
        3)
            echo -e "${YELLOW}  Please add your SSL certificates to the ssl/ directory:${NC}"
            echo "    - ssl/fullchain.pem (certificate chain)"
            echo "    - ssl/privkey.pem (private key)"
            ;;
        *)
            echo -e "${YELLOW}  Skipping SSL setup. Add certificates manually.${NC}"
            ;;
    esac
fi

# LDAP/LTPA Authentication Configuration
echo ""
echo -e "${GREEN}Authentication Configuration...${NC}"
echo ""
echo "Authentication Mode Options:"
echo "  1) Local (database users only)"
echo "  2) LDAP (Active Directory / OpenLDAP)"
echo "  3) LTPA (IBM WebSphere SSO)"
echo "  4) Hybrid (LDAP + Local fallback)"
echo "  5) LDAP + LTPA Combined (SSO with LDAP user validation)"
echo ""
read -p "Select authentication mode [1-5] (default: 1): " AUTH_OPTION

case $AUTH_OPTION in
    2)
        AUTH_MODE="ldap"
        echo ""
        echo -e "${BLUE}LDAP Configuration${NC}"
        echo ""
        echo "LDAP Server Type:"
        echo "  1) OpenLDAP"
        echo "  2) Active Directory"
        echo "  3) IBM Domino LDAP"
        echo "  4) Other/Custom"
        read -p "Select LDAP server type [1-4] (default: 1): " LDAP_TYPE
        
        # Set defaults based on LDAP type
        case $LDAP_TYPE in
            2)
                LDAP_USERNAME_ATTR_DEFAULT="sAMAccountName"
                LDAP_FILTER_DEFAULT="(&(sAMAccountName={{username}})(objectclass=user))"
                LDAP_DISPLAY_NAME_DEFAULT="displayName"
                LDAP_SERVER_TYPE="ad"
                ;;
            3)
                LDAP_USERNAME_ATTR_DEFAULT="cn"
                LDAP_FILTER_DEFAULT="(&(mail={{username}})(objectclass=dominoPerson))"
                LDAP_DISPLAY_NAME_DEFAULT="cn"
                LDAP_SERVER_TYPE="domino"
                ;;
            *)
                LDAP_USERNAME_ATTR_DEFAULT="uid"
                LDAP_FILTER_DEFAULT="(uid={{username}})"
                LDAP_DISPLAY_NAME_DEFAULT="cn"
                LDAP_SERVER_TYPE="openldap"
                ;;
        esac
        
        echo ""
        read -p "LDAP Server URL (e.g., ldap://ldap.example.com:389): " LDAP_URL
        read -p "LDAP Base DN (e.g., dc=example,dc=com or o=MyOrg): " LDAP_BASE_DN
        read -p "LDAP Bind DN (service account, leave empty for anonymous): " LDAP_BIND_DN
        if [ -n "$LDAP_BIND_DN" ]; then
            read -sp "LDAP Bind Password: " LDAP_BIND_PASSWORD
            echo ""
        fi
        read -p "LDAP User Search Base (e.g., ou=users, leave empty for baseDN): " LDAP_USER_SEARCH_BASE
        read -p "LDAP User Search Filter (default: ${LDAP_FILTER_DEFAULT}): " LDAP_USER_SEARCH_FILTER
        LDAP_USER_SEARCH_FILTER=${LDAP_USER_SEARCH_FILTER:-"${LDAP_FILTER_DEFAULT}"}
        read -p "Enable LDAP debug logging? (y/N): " ENABLE_DEBUG_LDAP
        
        # Comment out ALL existing LDAP and LTPA settings from template, then add fresh values
        comment_ldap_settings ".env"
        comment_ltpa_settings ".env"
        
        # Update .env with LDAP settings
        # Calculate debug value
        if [ "$ENABLE_DEBUG_LDAP" = "y" ] || [ "$ENABLE_DEBUG_LDAP" = "Y" ]; then
            DEBUG_LDAP_VAL="true"
        else
            DEBUG_LDAP_VAL="false"
        fi
        
        {
            echo ""
            echo "# LDAP Authentication"
            echo "AUTH_MODE=ldap"
            echo "DEBUG_LDAP=${DEBUG_LDAP_VAL}"
            echo "LDAP_URL=${LDAP_URL}"
            echo "LDAP_BASE_DN=${LDAP_BASE_DN}"
            echo "LDAP_BIND_DN=${LDAP_BIND_DN}"
            echo "LDAP_BIND_PASSWORD=${LDAP_BIND_PASSWORD}"
            echo "LDAP_USER_SEARCH_BASE=${LDAP_USER_SEARCH_BASE}"
            echo "LDAP_USER_SEARCH_FILTER=\"${LDAP_USER_SEARCH_FILTER}\""
            echo "LDAP_USERNAME_ATTR=${LDAP_USERNAME_ATTR_DEFAULT}"
            echo "LDAP_EMAIL_ATTR=mail"
            echo "LDAP_DISPLAY_NAME_ATTR=${LDAP_DISPLAY_NAME_DEFAULT}"
            echo "LDAP_ADMIN_GROUP=cn=admins"
            echo "LDAP_SERVER_TYPE=${LDAP_SERVER_TYPE}"
        } >> .env
        echo -e "  ✓ LDAP configuration added to .env"
        ;;
    3)
        AUTH_MODE="ltpa"
        echo ""
        echo -e "${BLUE}LTPA2 SSO Configuration${NC}"
        echo "Supports IBM Domino, WebSphere, and Liberty LTPA2 tokens."
        echo ""
        read -p "Path to LTPA keys file (ltpa.keys), or press Enter to enter key manually: " LTPA_KEYS_PATH
        
        # Comment out ALL existing LDAP and LTPA settings from template, then add fresh values
        comment_ldap_settings ".env"
        comment_ltpa_settings ".env"
        
        if [ -n "$LTPA_KEYS_PATH" ] && [ -f "$LTPA_KEYS_PATH" ]; then
            # Extract LTPA keys from keys file
            LTPA_SECRET=$(grep -E "^com.ibm.websphere.ltpa.3DESKey=" "$LTPA_KEYS_PATH" | cut -d'=' -f2)
            LTPA_PUBLIC=$(grep -E "^com.ibm.websphere.ltpa.PublicKey=" "$LTPA_KEYS_PATH" | cut -d'=' -f2-)
            LTPA_PRIVATE=$(grep -E "^com.ibm.websphere.ltpa.PrivateKey=" "$LTPA_KEYS_PATH" | cut -d'=' -f2-)
            LTPA_REALM_FROM_FILE=$(grep -E "^com.ibm.websphere.ltpa.Realm=" "$LTPA_KEYS_PATH" | cut -d'=' -f2)
            
            if [ -n "$LTPA_SECRET" ]; then
                read -p "LTPA Cookie Name (default: LtpaToken2): " LTPA_COOKIE_NAME
                read -p "LTPA Realm (from file: ${LTPA_REALM_FROM_FILE:-defaultRealm}): " LTPA_REALM
                read -p "Domino user format - cn/uid/shortname/dn (default: cn): " LTPA_USER_FORMAT
                read -p "Enable LTPA debug logging? (y/N): " ENABLE_DEBUG_LTPA
                
                # Calculate values
                if [ "$ENABLE_DEBUG_LTPA" = "y" ] || [ "$ENABLE_DEBUG_LTPA" = "Y" ]; then
                    DEBUG_LTPA_VAL="true"
                else
                    DEBUG_LTPA_VAL="false"
                fi
                LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME:-LtpaToken2}
                LTPA_REALM=${LTPA_REALM:-${LTPA_REALM_FROM_FILE:-defaultRealm}}
                LTPA_USER_FORMAT=${LTPA_USER_FORMAT:-cn}
                
                {
                    echo ""
                    echo "# LTPA2 SSO Authentication"
                    echo "AUTH_MODE=ltpa"
                    echo "DEBUG_LTPA=${DEBUG_LTPA_VAL}"
                    echo "LTPA_SECRET_KEY=${LTPA_SECRET}"
                    echo "LTPA_PUBLIC_KEY=${LTPA_PUBLIC}"
                    echo "LTPA_PRIVATE_KEY=${LTPA_PRIVATE}"
                    echo "LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME}"
                    echo "LTPA_COOKIE_NAME_FALLBACK=LtpaToken"
                    echo "LTPA_REALM=${LTPA_REALM}"
                    echo "LTPA_TOKEN_EXPIRATION=7200"
                    echo "LTPA_DOMINO_USER_FORMAT=${LTPA_USER_FORMAT}"
                    echo "LTPA_PREFER_AES=false"
                } >> .env
                echo -e "  ✓ LTPA configuration added to .env (keys extracted from file)"
            else
                echo -e "${YELLOW}  Could not extract LTPA 3DES key from file. Please configure manually in .env${NC}"
            fi
        else
            read -p "LTPA Secret Key (base64, com.ibm.websphere.ltpa.3DESKey): " LTPA_SECRET_KEY
            read -p "LTPA Cookie Name (default: LtpaToken2): " LTPA_COOKIE_NAME
            read -p "LTPA Realm (default: defaultRealm): " LTPA_REALM
            read -p "Domino user format - cn/uid/shortname/dn (default: cn): " LTPA_USER_FORMAT
            read -p "Enable LTPA debug logging? (y/N): " ENABLE_DEBUG_LTPA
            
            # Calculate values
            if [ "$ENABLE_DEBUG_LTPA" = "y" ] || [ "$ENABLE_DEBUG_LTPA" = "Y" ]; then
                DEBUG_LTPA_VAL="true"
            else
                DEBUG_LTPA_VAL="false"
            fi
            LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME:-LtpaToken2}
            LTPA_REALM=${LTPA_REALM:-defaultRealm}
            LTPA_USER_FORMAT=${LTPA_USER_FORMAT:-cn}
            
            {
                echo ""
                echo "# LTPA2 SSO Authentication"
                echo "AUTH_MODE=ltpa"
                echo "DEBUG_LTPA=${DEBUG_LTPA_VAL}"
                echo "LTPA_SECRET_KEY=${LTPA_SECRET_KEY}"
                echo "LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME}"
                echo "LTPA_COOKIE_NAME_FALLBACK=LtpaToken"
                echo "LTPA_REALM=${LTPA_REALM}"
                echo "LTPA_TOKEN_EXPIRATION=7200"
                echo "LTPA_DOMINO_USER_FORMAT=${LTPA_USER_FORMAT}"
                echo "LTPA_PREFER_AES=false"
            } >> .env
            echo -e "  ✓ LTPA configuration added to .env"
        fi
        ;;
    4)
        AUTH_MODE="hybrid"
        echo ""
        echo -e "${BLUE}Hybrid Authentication (LDAP + Local)${NC}"
        read -p "LDAP Server URL (e.g., ldap://ldap.example.com:389): " LDAP_URL
        read -p "LDAP Base DN (e.g., dc=example,dc=com): " LDAP_BASE_DN
        read -p "LDAP Bind DN (service account): " LDAP_BIND_DN
        if [ -n "$LDAP_BIND_DN" ]; then
            read -sp "LDAP Bind Password: " LDAP_BIND_PASSWORD
            echo ""
        fi
        read -p "LDAP User Search Base (e.g., ou=users, leave empty for baseDN): " LDAP_USER_SEARCH_BASE
        read -p "LDAP User Search Filter (default: (uid={{username}})): " LDAP_USER_SEARCH_FILTER
        LDAP_USER_SEARCH_FILTER=${LDAP_USER_SEARCH_FILTER:-"(uid={{username}})"}
        read -p "Enable LDAP debug logging? (y/N): " ENABLE_DEBUG_LDAP
        
        # Comment out ALL existing LDAP and LTPA settings from template, then add fresh values
        comment_ldap_settings ".env"
        comment_ltpa_settings ".env"
        
        # Write config using echo to handle special characters properly
        # Calculate debug value
        if [ "$ENABLE_DEBUG_LDAP" = "y" ] || [ "$ENABLE_DEBUG_LDAP" = "Y" ]; then
            DEBUG_LDAP_VAL="true"
        else
            DEBUG_LDAP_VAL="false"
        fi
        
        {
            echo ""
            echo "# Hybrid Authentication (LDAP + Local)"
            echo "AUTH_MODE=hybrid"
            echo "DEBUG_LDAP=${DEBUG_LDAP_VAL}"
            echo "LDAP_URL=${LDAP_URL}"
            echo "LDAP_BASE_DN=${LDAP_BASE_DN}"
            echo "LDAP_BIND_DN=${LDAP_BIND_DN}"
            echo "LDAP_BIND_PASSWORD=${LDAP_BIND_PASSWORD}"
            echo "LDAP_USER_SEARCH_BASE=${LDAP_USER_SEARCH_BASE}"
            echo "LDAP_USER_SEARCH_FILTER=\"${LDAP_USER_SEARCH_FILTER}\""
            echo "LDAP_USERNAME_ATTR=uid"
            echo "LDAP_EMAIL_ATTR=mail"
            echo "LDAP_DISPLAY_NAME_ATTR=cn"
        } >> .env
        echo -e "  ✓ Hybrid authentication configuration added to .env"
        ;;
    5)
        AUTH_MODE="ldap_ltpa"
        echo ""
        echo -e "${BLUE}LDAP + LTPA Combined Configuration${NC}"
        echo "This mode uses LTPA tokens for SSO and validates users against LDAP."
        echo ""
        
        # LDAP Configuration
        echo -e "${BLUE}Step 1: LDAP Configuration${NC}"
        read -p "LDAP Server URL (e.g., ldap://ldap.example.com:389): " LDAP_URL
        read -p "LDAP Base DN (e.g., dc=example,dc=com): " LDAP_BASE_DN
        read -p "LDAP Bind DN (service account): " LDAP_BIND_DN
        if [ -n "$LDAP_BIND_DN" ]; then
            read -sp "LDAP Bind Password: " LDAP_BIND_PASSWORD
            echo ""
        fi
        read -p "LDAP User Search Base (e.g., ou=users): " LDAP_USER_SEARCH_BASE
        
        # LTPA Configuration
        echo ""
        echo -e "${BLUE}Step 2: LTPA Keys Configuration${NC}"
        echo "You need the LTPA keys file from your WebSphere/Liberty server."
        echo ""
        read -p "Path to LTPA keys file (ltpa.keys): " LTPA_KEYS_PATH
        
        LTPA_SECRET=""
        if [ -f "$LTPA_KEYS_PATH" ]; then
            read -sp "LTPA Keys Password: " LTPA_KEYS_PASSWORD
            echo ""
            
            # Copy keys file to config directory
            mkdir -p config/ltpa
            cp "$LTPA_KEYS_PATH" config/ltpa/ltpa.keys
            chmod 600 config/ltpa/ltpa.keys
            
            # Extract LTPA secret from keys file
            LTPA_SECRET=$(grep -E "^com.ibm.websphere.ltpa.3DESKey=" "$LTPA_KEYS_PATH" | cut -d'=' -f2)
            LTPA_REALM=$(grep -E "^com.ibm.websphere.ltpa.Realm=" "$LTPA_KEYS_PATH" | cut -d'=' -f2)
            LTPA_REALM=${LTPA_REALM:-defaultRealm}
            
            echo -e "  ✓ LTPA keys file copied to config/ltpa/"
        else
            echo -e "${YELLOW}LTPA keys file not found. You can upload it later via admin UI.${NC}"
            read -p "LTPA Secret Key (base64, or leave empty): " LTPA_SECRET
            read -p "LTPA Realm (default: defaultRealm): " LTPA_REALM
            LTPA_REALM=${LTPA_REALM:-defaultRealm}
        fi
        
        read -p "LTPA Cookie Name (default: LtpaToken2): " LTPA_COOKIE_NAME
        LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME:-LtpaToken2}
        
        read -p "LDAP User Search Filter (default: (uid={{username}})): " LDAP_USER_SEARCH_FILTER
        LDAP_USER_SEARCH_FILTER=${LDAP_USER_SEARCH_FILTER:-"(uid={{username}})"}
        
        read -p "Enable debug logging? (y/N): " ENABLE_DEBUG
        
        # Comment out ALL existing LDAP and LTPA settings from template, then add fresh values
        comment_ldap_settings ".env"
        comment_ltpa_settings ".env"
        
        # Calculate debug value
        if [ "$ENABLE_DEBUG" = "y" ] || [ "$ENABLE_DEBUG" = "Y" ]; then
            DEBUG_VAL="true"
        else
            DEBUG_VAL="false"
        fi
        
        # Write configuration using echo to handle special characters properly
        {
            echo ""
            echo "# LDAP + LTPA Combined Authentication"
            echo "AUTH_MODE=ldap_ltpa"
            echo "DEBUG_LDAP=${DEBUG_VAL}"
            echo "DEBUG_LTPA=${DEBUG_VAL}"
            echo ""
            echo "# LDAP Settings"
            echo "LDAP_URL=${LDAP_URL}"
            echo "LDAP_BASE_DN=${LDAP_BASE_DN}"
            echo "LDAP_BIND_DN=${LDAP_BIND_DN}"
            echo "LDAP_BIND_PASSWORD=${LDAP_BIND_PASSWORD}"
            echo "LDAP_USER_SEARCH_BASE=${LDAP_USER_SEARCH_BASE:-}"
            echo "LDAP_USER_SEARCH_FILTER=\"${LDAP_USER_SEARCH_FILTER}\""
            echo "LDAP_USERNAME_ATTR=uid"
            echo "LDAP_EMAIL_ATTR=mail"
            echo "LDAP_DISPLAY_NAME_ATTR=cn"
            echo ""
            echo "# LTPA Settings"
            echo "LTPA_SECRET_KEY=${LTPA_SECRET}"
            echo "LTPA_COOKIE_NAME=${LTPA_COOKIE_NAME}"
            echo "LTPA_COOKIE_NAME_FALLBACK=LtpaToken"
            echo "LTPA_REALM=${LTPA_REALM}"
            echo "LTPA_TOKEN_EXPIRATION=7200"
        } >> .env
        echo -e "  ✓ LDAP + LTPA configuration added to .env"
        
        if [ -z "$LTPA_SECRET" ]; then
            echo ""
            echo -e "${YELLOW}Note: LTPA keys not fully configured.${NC}"
            echo "After deployment, upload your ltpa.keys file via:"
            echo "  - Admin UI: Settings > Authentication > Upload LTPA Keys"
            echo "  - API: POST /api/admin/ltpa/upload"
        fi
        ;;
    *)
        AUTH_MODE="local"
        # Comment out both LDAP and LTPA settings since we're using local auth only
        comment_ldap_settings ".env"
        comment_ltpa_settings ".env"
        echo -e "  ✓ Using local authentication (default)"
        echo -e "  ✓ LDAP and LTPA settings commented out in .env"
        ;;
esac

# Create necessary directories
echo -e "${GREEN}Creating directories...${NC}"
mkdir -p nginx/logs
mkdir -p wopi-server/templates
echo -e "  ✓ Directories created"

# Create empty document templates
echo -e "${GREEN}Creating document templates...${NC}"
touch wopi-server/templates/empty.odt
touch wopi-server/templates/empty.ods
touch wopi-server/templates/empty.odp
echo -e "  ✓ Templates created"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Configuration summary:"
echo -e "  Domain: ${YELLOW}${DOMAIN}${NC}"
echo -e "  Collabora Admin Password: ${YELLOW}${COLLABORA_ADMIN_PASSWORD}${NC}"
echo ""
echo "Next steps:"
echo "  1. Review and update .env file if needed"
echo "  2. For production: Replace self-signed SSL certificates"
echo "  3. Run: ./scripts/deploy.sh"
echo ""
echo -e "${YELLOW}Important: Save the Collabora admin password shown above!${NC}"
