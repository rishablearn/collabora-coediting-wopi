const express = require('express');
const router = express.Router();

/**
 * GET /api/config/whitelabel
 * Returns whitelabel configuration from environment variables
 * This allows runtime customization without rebuilding the frontend
 */
router.get('/whitelabel', (req, res) => {
  const config = {
    branding: {
      appName: process.env.APP_NAME || 'Collabora Docs',
      appNameShort: process.env.APP_NAME_SHORT || 'Docs',
      tagline: process.env.APP_TAGLINE || 'Your Documents, Anywhere',
      companyName: process.env.COMPANY_NAME || 'Your Company',
      copyright: process.env.COPYRIGHT || `© ${new Date().getFullYear()} ${process.env.COMPANY_NAME || 'Your Company'}. All rights reserved.`,
      supportEmail: process.env.SUPPORT_EMAIL || '',
      supportUrl: process.env.SUPPORT_URL || '',
      privacyUrl: process.env.PRIVACY_URL || '',
      termsUrl: process.env.TERMS_URL || '',
    },
    logos: {
      primary: process.env.LOGO_PRIMARY || null,
      primaryDark: process.env.LOGO_PRIMARY_DARK || null,
      icon: process.env.LOGO_ICON || null,
      login: process.env.LOGO_LOGIN || null,
      loginBackground: process.env.LOGIN_BACKGROUND || null,
    },
    colors: parseColors(),
    ui: {
      borderRadius: process.env.UI_BORDER_RADIUS || 'medium',
      enableAnimations: process.env.UI_ANIMATIONS !== 'false',
      darkMode: process.env.UI_DARK_MODE || 'disabled',
      showPoweredBy: process.env.UI_SHOW_POWERED_BY !== 'false',
    },
    features: {
      enableRegistration: process.env.ENABLE_REGISTRATION !== 'false',
      enableForgotPassword: process.env.ENABLE_FORGOT_PASSWORD === 'true',
      showRecentDocuments: process.env.SHOW_RECENT_DOCUMENTS !== 'false',
      showStorageUsage: process.env.SHOW_STORAGE_USAGE !== 'false',
    },
    textOverrides: {
      loginTitle: process.env.TEXT_LOGIN_TITLE || null,
      loginSubtitle: process.env.TEXT_LOGIN_SUBTITLE || 'Sign in to your account',
      loginButton: process.env.TEXT_LOGIN_BUTTON || 'Sign in',
      dashboardTitle: process.env.TEXT_DASHBOARD_TITLE || 'My Documents',
    },
  };

  res.json(config);
});

/**
 * Parse color configuration from environment variables
 */
function parseColors() {
  const defaultColors = {
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
  };

  // Allow overriding primary color via single env var (generates shades)
  const primaryColor = process.env.PRIMARY_COLOR;
  if (primaryColor) {
    // If a primary color is set, use it for 500 and generate approximate shades
    defaultColors.primary[500] = primaryColor;
    defaultColors.primary[600] = adjustColor(primaryColor, -15);
    defaultColors.primary[700] = adjustColor(primaryColor, -30);
    defaultColors.primary[400] = adjustColor(primaryColor, 15);
    defaultColors.primary[300] = adjustColor(primaryColor, 30);
  }

  return defaultColors;
}

/**
 * Simple color adjustment (darken/lighten)
 */
function adjustColor(hex, percent) {
  if (!hex || !hex.startsWith('#')) return hex;
  
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);

  r = Math.min(255, Math.max(0, r + (percent * 2.55)));
  g = Math.min(255, Math.max(0, g + (percent * 2.55)));
  b = Math.min(255, Math.max(0, b + (percent * 2.55)));

  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

module.exports = router;
