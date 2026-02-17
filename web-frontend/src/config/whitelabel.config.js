/**
 * Whitelabel Configuration
 * 
 * This file contains all customizable branding options for the application.
 * Modify these values to match your organization's branding.
 * 
 * After making changes, rebuild the frontend:
 *   docker compose build web-frontend
 *   docker compose up -d web-frontend
 */

const whitelabelConfig = {
  // ==========================================================================
  // BRANDING
  // ==========================================================================
  branding: {
    // Application name displayed in headers, titles, and throughout the UI
    appName: 'Collabora Docs',
    
    // Short name for compact displays (mobile, etc.)
    appNameShort: 'Docs',
    
    // Tagline or description shown on login page
    tagline: 'Your Documents, Anywhere',
    
    // Company/Organization name (shown in footer, copyright, etc.)
    companyName: 'Your Company',
    
    // Copyright text
    copyright: `© ${new Date().getFullYear()} Your Company. All rights reserved.`,
    
    // Support email
    supportEmail: 'support@example.com',
    
    // Support URL (optional)
    supportUrl: '',
    
    // Privacy policy URL (optional)
    privacyUrl: '',
    
    // Terms of service URL (optional)
    termsUrl: '',
  },

  // ==========================================================================
  // LOGOS & IMAGES
  // ==========================================================================
  // Place your logo files in: web-frontend/public/branding/
  // Supported formats: SVG (recommended), PNG, JPG, WebP
  logos: {
    // Main logo displayed in the header (recommended: 200x50 or similar ratio)
    // Set to null to use default icon + text
    primary: null, // e.g., '/branding/logo.svg'
    
    // Logo for dark backgrounds (optional)
    primaryDark: null, // e.g., '/branding/logo-dark.svg'
    
    // Small logo/icon for compact spaces (recommended: square, 32x32 or 64x64)
    icon: null, // e.g., '/branding/icon.svg'
    
    // Favicon (place in public folder as favicon.ico and favicon.svg)
    // To change: Replace web-frontend/public/favicon.ico and favicon.svg
    
    // Login page logo (optional, uses primary if not set)
    login: null, // e.g., '/branding/logo-login.svg'
    
    // Login page background image (optional)
    loginBackground: null, // e.g., '/branding/login-bg.jpg'
  },

  // ==========================================================================
  // COLORS
  // ==========================================================================
  // Define your brand colors. All colors support full Tailwind color palette.
  // Use CSS color values: hex (#3b82f6), rgb(59, 130, 246), hsl(217, 91%, 60%)
  colors: {
    // Primary brand color (used for buttons, links, accents)
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',  // Main primary color
      600: '#2563eb',  // Primary hover
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
    
    // Secondary/accent color (optional, for secondary actions)
    secondary: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617',
    },
    
    // Success color (for success states, confirmations)
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
    },
    
    // Warning color (for warnings, cautions)
    warning: {
      50: '#fffbeb',
      100: '#fef3c7',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
    },
    
    // Error/Danger color (for errors, destructive actions)
    error: {
      50: '#fef2f2',
      100: '#fee2e2',
      500: '#ef4444',
      600: '#dc2626',
      700: '#b91c1c',
    },
  },

  // ==========================================================================
  // TYPOGRAPHY
  // ==========================================================================
  typography: {
    // Font family for the application
    // Options: 'system' (system fonts), 'inter', 'roboto', 'custom'
    fontFamily: 'system',
    
    // Custom font family (used when fontFamily is 'custom')
    // Include the font via CSS @import or link in index.html
    customFontFamily: '',
    
    // Base font size (default: 16)
    baseFontSize: 16,
  },

  // ==========================================================================
  // UI CUSTOMIZATION
  // ==========================================================================
  ui: {
    // Border radius style: 'none', 'small', 'medium', 'large', 'full'
    borderRadius: 'medium',
    
    // Enable/disable animations
    enableAnimations: true,
    
    // Dark mode: 'disabled', 'enabled', 'system' (follows system preference)
    darkMode: 'disabled',
    
    // Show powered by Collabora badge (set to false to hide)
    showPoweredBy: true,
    
    // Custom CSS class to add to the root element
    customRootClass: '',
  },

  // ==========================================================================
  // FEATURES
  // ==========================================================================
  features: {
    // Show registration link on login page
    enableRegistration: true,
    
    // Show "Forgot Password" link (requires backend support)
    enableForgotPassword: false,
    
    // Enable social login buttons (requires backend configuration)
    enableSocialLogin: false,
    
    // Social login providers (if enableSocialLogin is true)
    socialProviders: [], // e.g., ['google', 'microsoft', 'github']
    
    // Show recent documents on dashboard
    showRecentDocuments: true,
    
    // Show storage usage indicator
    showStorageUsage: true,
  },

  // ==========================================================================
  // LOCALIZATION
  // ==========================================================================
  localization: {
    // Default language
    defaultLanguage: 'en',
    
    // Date format: 'US' (MM/DD/YYYY), 'EU' (DD/MM/YYYY), 'ISO' (YYYY-MM-DD)
    dateFormat: 'US',
    
    // Time format: '12h' or '24h'
    timeFormat: '12h',
  },

  // ==========================================================================
  // CUSTOM TEXT OVERRIDES
  // ==========================================================================
  // Override specific UI text strings
  textOverrides: {
    // Login page
    loginTitle: null, // Defaults to appName
    loginSubtitle: 'Sign in to your account',
    loginButton: 'Sign in',
    
    // Register page
    registerTitle: 'Create Account',
    registerSubtitle: 'Get started with your documents',
    registerButton: 'Create Account',
    
    // Dashboard
    dashboardTitle: 'My Documents',
    newDocumentButton: 'New Document',
    uploadButton: 'Upload',
    
    // Common
    documentsLabel: 'Documents',
    settingsLabel: 'Settings',
    logoutLabel: 'Logout',
  },
};

export default whitelabelConfig;

/**
 * Helper function to generate CSS variables from config
 */
export function generateCSSVariables(config = whitelabelConfig) {
  const vars = {};
  
  // Primary colors
  Object.entries(config.colors.primary).forEach(([key, value]) => {
    vars[`--color-primary-${key}`] = value;
  });
  
  // Secondary colors
  Object.entries(config.colors.secondary).forEach(([key, value]) => {
    vars[`--color-secondary-${key}`] = value;
  });
  
  // Status colors
  Object.entries(config.colors.success).forEach(([key, value]) => {
    vars[`--color-success-${key}`] = value;
  });
  Object.entries(config.colors.warning).forEach(([key, value]) => {
    vars[`--color-warning-${key}`] = value;
  });
  Object.entries(config.colors.error).forEach(([key, value]) => {
    vars[`--color-error-${key}`] = value;
  });
  
  // Border radius
  const radiusMap = {
    none: '0',
    small: '0.25rem',
    medium: '0.375rem',
    large: '0.5rem',
    full: '9999px',
  };
  vars['--border-radius'] = radiusMap[config.ui.borderRadius] || '0.375rem';
  
  return vars;
}

/**
 * Helper function to get font family CSS value
 */
export function getFontFamily(config = whitelabelConfig) {
  const fontMap = {
    system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
    inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    roboto: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    custom: config.typography.customFontFamily,
  };
  
  return fontMap[config.typography.fontFamily] || fontMap.system;
}
