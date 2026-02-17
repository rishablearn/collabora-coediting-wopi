#!/bin/bash

# =============================================================================
# Secrets Generator Script
# =============================================================================
# This script generates secure random secrets for the Collabora deployment.
# Run this before first deployment or when rotating secrets.
#
# Usage: ./scripts/generate-secrets.sh [options]
#   -o, --output FILE   Write to specified file (default: .env)
#   -f, --force         Overwrite existing .env file
#   -p, --print         Print secrets to stdout only (don't write file)
#   -h, --help          Show this help message

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
OUTPUT_FILE=".env"
FORCE=false
PRINT_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -p|--print)
            PRINT_ONLY=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  -o, --output FILE   Write to specified file (default: .env)"
            echo "  -f, --force         Overwrite existing .env file"
            echo "  -p, --print         Print secrets to stdout only"
            echo "  -h, --help          Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Function to generate a random hex string
generate_hex() {
    local length=${1:-32}
    openssl rand -hex "$length" 2>/dev/null || head -c "$length" /dev/urandom | xxd -p | tr -d '\n'
}

# Function to generate a random base64 string (for passwords)
generate_password() {
    local length=${1:-24}
    openssl rand -base64 "$length" 2>/dev/null | tr -d '\n' | head -c "$length" || \
    head -c "$length" /dev/urandom | base64 | tr -d '\n' | head -c "$length"
}

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}   Collabora Secrets Generator${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# Generate secrets
echo -e "${YELLOW}Generating secure secrets...${NC}"

JWT_SECRET=$(generate_hex 32)
WOPI_SECRET=$(generate_hex 32)
POSTGRES_PASSWORD=$(generate_password 24)
COLLABORA_ADMIN_PASSWORD=$(generate_password 16)
REDIS_PASSWORD=$(generate_password 20)

echo -e "${GREEN}✓ JWT_SECRET generated (64 characters)${NC}"
echo -e "${GREEN}✓ WOPI_SECRET generated (64 characters)${NC}"
echo -e "${GREEN}✓ POSTGRES_PASSWORD generated${NC}"
echo -e "${GREEN}✓ COLLABORA_ADMIN_PASSWORD generated${NC}"
echo -e "${GREEN}✓ REDIS_PASSWORD generated${NC}"
echo ""

# Print secrets if requested
if [ "$PRINT_ONLY" = true ]; then
    echo -e "${YELLOW}Generated Secrets:${NC}"
    echo "----------------------------------------"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "WOPI_SECRET=$WOPI_SECRET"
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    echo "COLLABORA_ADMIN_PASSWORD=$COLLABORA_ADMIN_PASSWORD"
    echo "REDIS_PASSWORD=$REDIS_PASSWORD"
    echo "----------------------------------------"
    echo ""
    echo -e "${YELLOW}Copy these values to your .env file${NC}"
    exit 0
fi

# Check if .env exists
if [ -f "$OUTPUT_FILE" ] && [ "$FORCE" = false ]; then
    echo -e "${YELLOW}Found existing $OUTPUT_FILE${NC}"
    echo ""
    
    # Check if secrets are already configured
    if grep -q "CHANGE_ME" "$OUTPUT_FILE" 2>/dev/null; then
        echo -e "${YELLOW}Detected placeholder secrets. Updating...${NC}"
    else
        echo -e "${RED}Warning: $OUTPUT_FILE already exists with configured secrets.${NC}"
        echo -e "Use ${YELLOW}--force${NC} to overwrite, or manually update the file."
        echo ""
        echo "Generated secrets (copy manually if needed):"
        echo "  JWT_SECRET=$JWT_SECRET"
        echo "  WOPI_SECRET=$WOPI_SECRET"
        echo "  POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
        echo "  COLLABORA_ADMIN_PASSWORD=$COLLABORA_ADMIN_PASSWORD"
        exit 1
    fi
fi

# Create or update .env file
if [ -f ".env.example" ] && [ ! -f "$OUTPUT_FILE" ]; then
    echo -e "${YELLOW}Creating $OUTPUT_FILE from .env.example...${NC}"
    cp .env.example "$OUTPUT_FILE"
fi

if [ ! -f "$OUTPUT_FILE" ]; then
    echo -e "${RED}Error: $OUTPUT_FILE not found and no .env.example available${NC}"
    exit 1
fi

# Update secrets in .env file
echo -e "${YELLOW}Updating secrets in $OUTPUT_FILE...${NC}"

# Use sed to replace placeholder values
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS sed syntax
    sed -i '' "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$OUTPUT_FILE"
    sed -i '' "s|WOPI_SECRET=.*|WOPI_SECRET=$WOPI_SECRET|" "$OUTPUT_FILE"
    sed -i '' "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" "$OUTPUT_FILE"
    sed -i '' "s|COLLABORA_ADMIN_PASSWORD=.*|COLLABORA_ADMIN_PASSWORD=$COLLABORA_ADMIN_PASSWORD|" "$OUTPUT_FILE"
else
    # Linux sed syntax
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$OUTPUT_FILE"
    sed -i "s|WOPI_SECRET=.*|WOPI_SECRET=$WOPI_SECRET|" "$OUTPUT_FILE"
    sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|" "$OUTPUT_FILE"
    sed -i "s|COLLABORA_ADMIN_PASSWORD=.*|COLLABORA_ADMIN_PASSWORD=$COLLABORA_ADMIN_PASSWORD|" "$OUTPUT_FILE"
fi

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}   Secrets generated successfully!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "Secrets have been written to: ${BLUE}$OUTPUT_FILE${NC}"
echo ""
echo -e "${YELLOW}Important:${NC}"
echo "  • Keep your .env file secure and never commit it to version control"
echo "  • The .env file is already in .gitignore"
echo "  • Save a backup of these secrets in a secure location"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Review the generated secrets in $OUTPUT_FILE"
echo "  2. Configure any additional settings (domain, etc.)"
echo "  3. Run: docker compose up -d"
echo ""
