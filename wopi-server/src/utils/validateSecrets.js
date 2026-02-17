/**
 * Secrets Validation Utility
 * 
 * Validates that all required secrets are properly configured
 * and meet minimum security requirements.
 */

const logger = require('./logger');

const INSECURE_PATTERNS = [
  'CHANGE_ME',
  'change_me',
  'changeme',
  'password',
  'secret',
  'admin123',
  'default',
  '123456',
  'example',
  'test',
  'dev-',
  'development'
];

const REQUIRED_SECRETS = [
  {
    name: 'JWT_SECRET',
    envVar: 'JWT_SECRET',
    minLength: 32,
    description: 'JWT signing secret for authentication tokens'
  },
  {
    name: 'WOPI_SECRET',
    envVar: 'WOPI_SECRET',
    minLength: 32,
    description: 'WOPI token encryption secret'
  },
  {
    name: 'POSTGRES_PASSWORD',
    envVar: 'POSTGRES_PASSWORD',
    minLength: 12,
    description: 'PostgreSQL database password'
  }
];

const OPTIONAL_SECRETS = [
  {
    name: 'COLLABORA_ADMIN_PASSWORD',
    envVar: 'COLLABORA_ADMIN_PASSWORD',
    minLength: 12,
    description: 'Collabora admin console password'
  },
  {
    name: 'LDAP_BIND_PASSWORD',
    envVar: 'LDAP_BIND_PASSWORD',
    minLength: 8,
    description: 'LDAP bind password (required if using LDAP auth)',
    conditionalOn: () => ['ldap', 'hybrid', 'ldap_ltpa'].includes(process.env.AUTH_MODE)
  },
  {
    name: 'LTPA_SECRET_KEY',
    envVar: 'LTPA_SECRET_KEY',
    minLength: 16,
    description: 'LTPA secret key (required if using LTPA auth)',
    conditionalOn: () => ['ltpa', 'ldap_ltpa'].includes(process.env.AUTH_MODE)
  }
];

/**
 * Check if a secret value appears to be insecure
 */
function isInsecureValue(value) {
  if (!value) return true;
  
  const lowerValue = value.toLowerCase();
  return INSECURE_PATTERNS.some(pattern => lowerValue.includes(pattern.toLowerCase()));
}

/**
 * Validate a single secret
 */
function validateSecret(secret, value) {
  const errors = [];
  
  if (!value) {
    errors.push(`${secret.name} is not set`);
    return errors;
  }
  
  if (value.length < secret.minLength) {
    errors.push(`${secret.name} is too short (minimum ${secret.minLength} characters)`);
  }
  
  if (isInsecureValue(value)) {
    errors.push(`${secret.name} appears to contain an insecure or default value`);
  }
  
  return errors;
}

/**
 * Validate all secrets and return validation results
 */
function validateSecrets(options = { strict: false }) {
  const results = {
    valid: true,
    errors: [],
    warnings: []
  };
  
  // Check required secrets
  for (const secret of REQUIRED_SECRETS) {
    const value = process.env[secret.envVar];
    const errors = validateSecret(secret, value);
    
    if (errors.length > 0) {
      results.valid = false;
      results.errors.push(...errors.map(e => `[REQUIRED] ${e}`));
    }
  }
  
  // Check optional secrets (only if their condition is met)
  for (const secret of OPTIONAL_SECRETS) {
    if (secret.conditionalOn && !secret.conditionalOn()) {
      continue; // Skip if condition not met
    }
    
    const value = process.env[secret.envVar];
    const errors = validateSecret(secret, value);
    
    if (errors.length > 0) {
      if (options.strict) {
        results.valid = false;
        results.errors.push(...errors.map(e => `[CONDITIONAL] ${e}`));
      } else {
        results.warnings.push(...errors);
      }
    }
  }
  
  return results;
}

/**
 * Validate secrets on startup and log results
 * In production, this will throw an error if secrets are invalid
 */
function validateSecretsOnStartup() {
  const isProduction = process.env.NODE_ENV === 'production';
  const results = validateSecrets({ strict: isProduction });
  
  if (results.warnings.length > 0) {
    results.warnings.forEach(warning => {
      logger.warn(`Secret validation warning: ${warning}`);
    });
  }
  
  if (!results.valid) {
    const errorMessage = [
      '========================================',
      'SECURITY CONFIGURATION ERROR',
      '========================================',
      'The following secrets are missing or insecure:',
      '',
      ...results.errors.map(e => `  • ${e}`),
      '',
      'To fix this:',
      '  1. Run: ./scripts/generate-secrets.sh',
      '  2. Or manually generate secrets with: openssl rand -hex 32',
      '  3. Update your .env file with the generated values',
      '',
      'For more information, see docs/SECURITY.md',
      '========================================'
    ].join('\n');
    
    logger.error(errorMessage);
    
    if (isProduction) {
      throw new Error('Invalid security configuration. See logs for details.');
    } else {
      logger.warn('⚠️  Running in development mode with insecure secrets. DO NOT use in production!');
    }
  } else {
    logger.info('✓ All secrets validated successfully');
  }
  
  return results;
}

/**
 * Generate a secure random secret
 */
function generateSecureSecret(length = 32) {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

module.exports = {
  validateSecrets,
  validateSecretsOnStartup,
  validateSecret,
  isInsecureValue,
  generateSecureSecret,
  REQUIRED_SECRETS,
  OPTIONAL_SECRETS
};
