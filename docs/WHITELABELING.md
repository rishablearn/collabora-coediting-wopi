# Whitelabeling Guide

This guide explains how to customize the Collabora Online application to match your organization's branding.

## Table of Contents

- [Quick Start (Environment Variables)](#quick-start-environment-variables)
- [Quick Start (Config File)](#quick-start-config-file)
- [Configuration File](#configuration-file)
- [Branding Elements](#branding-elements)
- [Color Customization](#color-customization)
- [Logo Configuration](#logo-configuration)
- [Text Customization](#text-customization)
- [Advanced Options](#advanced-options)
- [Deployment](#deployment)
- [Examples](#examples)

---

## Quick Start (Environment Variables)

**Recommended method** - No rebuild required, just edit `.env` and restart:

1. **Edit your `.env` file:**
   ```bash
   # Application branding
   APP_NAME=Your App Name
   APP_NAME_SHORT=App
   APP_TAGLINE=Your tagline here
   COMPANY_NAME=Your Company
   
   # Primary brand color (hex)
   PRIMARY_COLOR=#3b82f6
   
   # Logo URLs (place files in web-frontend/public/branding/)
   LOGO_PRIMARY=/branding/logo.svg
   LOGO_ICON=/branding/icon.svg
   
   # UI settings
   UI_BORDER_RADIUS=medium
   ENABLE_REGISTRATION=true
   ```

2. **Restart containers:**
   ```bash
   docker compose restart wopi-server
   ```

3. **Refresh browser** (Ctrl+Shift+R)

### Available Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | Collabora Docs | Application name |
| `APP_NAME_SHORT` | Docs | Short name for mobile |
| `APP_TAGLINE` | Your Documents, Anywhere | Tagline on login page |
| `COMPANY_NAME` | Your Company | Company name in footer |
| `SUPPORT_EMAIL` | | Support email address |
| `PRIMARY_COLOR` | #3b82f6 | Primary brand color (hex) |
| `LOGO_PRIMARY` | | Main logo URL/path |
| `LOGO_ICON` | | Square icon URL/path |
| `LOGO_LOGIN` | | Login page logo |
| `LOGIN_BACKGROUND` | | Login background image |
| `UI_BORDER_RADIUS` | medium | none/small/medium/large/full |
| `UI_DARK_MODE` | disabled | disabled/enabled/system |
| `ENABLE_REGISTRATION` | true | Show registration link |

---

## Quick Start (Config File)

For advanced customization, edit the config file (requires rebuild):

1. **Edit the configuration file:**
   ```bash
   nano web-frontend/src/config/whitelabel.config.js
   ```

2. **Add your logo files:**
   ```bash
   cp your-logo.svg web-frontend/public/branding/logo.svg
   ```

3. **Rebuild and deploy:**
   ```bash
   docker compose build web-frontend
   docker compose up -d web-frontend
   ```

---

## Configuration File

The main configuration file is located at:
```
web-frontend/src/config/whitelabel.config.js
```

This file contains all customizable options organized into sections:

| Section | Description |
|---------|-------------|
| `branding` | Application name, company info, support details |
| `logos` | Logo file paths for different contexts |
| `colors` | Brand colors (primary, secondary, status colors) |
| `typography` | Font family and size settings |
| `ui` | UI behavior (border radius, animations, dark mode) |
| `features` | Feature toggles (registration, social login) |
| `localization` | Language and date/time formats |
| `textOverrides` | Custom text for UI labels |

---

## Branding Elements

### Application Name

```javascript
branding: {
  appName: 'Your App Name',        // Full name
  appNameShort: 'App',             // Short name for mobile
  tagline: 'Your tagline here',    // Shown on login page
  companyName: 'Your Company',     // Footer/copyright
  copyright: '© 2024 Your Company. All rights reserved.',
}
```

### Support Information

```javascript
branding: {
  supportEmail: 'support@yourcompany.com',
  supportUrl: 'https://support.yourcompany.com',
  privacyUrl: 'https://yourcompany.com/privacy',
  termsUrl: 'https://yourcompany.com/terms',
}
```

---

## Color Customization

### Primary Brand Color

The primary color is used for buttons, links, and accents throughout the application.

```javascript
colors: {
  primary: {
    50: '#eff6ff',   // Lightest (backgrounds)
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',  // Main color
    600: '#2563eb',  // Hover state
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',  // Darkest
    950: '#172554',
  },
}
```

### Color Palette Generator

Use these tools to generate a complete color palette from a single color:

- [Tailwind CSS Color Generator](https://uicolors.app/create)
- [Palette Generator](https://coolors.co/generate)
- [Color Shades Generator](https://www.tailwindshades.com/)

### Example: Custom Blue Theme

```javascript
colors: {
  primary: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',  // Indigo
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
  },
}
```

### Example: Green Theme

```javascript
colors: {
  primary: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',  // Green
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
}
```

---

## Logo Configuration

### Logo Files Location

Place your logo files in:
```
web-frontend/public/branding/
```

### Recommended Logo Sizes

| Logo Type | Recommended Size | Format |
|-----------|------------------|--------|
| Primary (header) | 200x50px | SVG, PNG |
| Icon (square) | 64x64px | SVG, PNG |
| Login page | 300x100px | SVG, PNG |
| Favicon | 32x32px, 16x16px | ICO, SVG |

### Configuration

```javascript
logos: {
  // Main logo in header
  primary: '/branding/logo.svg',
  
  // Logo for dark backgrounds
  primaryDark: '/branding/logo-dark.svg',
  
  // Square icon for compact spaces
  icon: '/branding/icon.svg',
  
  // Large logo for login page
  login: '/branding/logo-login.svg',
  
  // Optional background image for login
  loginBackground: '/branding/login-bg.jpg',
}
```

### Favicon

To change the favicon, replace these files:
```
web-frontend/public/favicon.ico
web-frontend/public/favicon.svg
```

### Logo Tips

1. **Use SVG format** for crisp logos at any size
2. **Transparent backgrounds** work best
3. **Test on light AND dark backgrounds**
4. Keep files **under 50KB** for fast loading

---

## Text Customization

Override any UI text using the `textOverrides` section:

```javascript
textOverrides: {
  // Login page
  loginTitle: 'Welcome Back',
  loginSubtitle: 'Sign in to continue',
  loginButton: 'Log In',
  
  // Register page
  registerTitle: 'Join Us',
  registerSubtitle: 'Create your free account',
  registerButton: 'Sign Up',
  
  // Dashboard
  dashboardTitle: 'My Files',
  newDocumentButton: 'Create New',
  uploadButton: 'Upload File',
  
  // Navigation
  documentsLabel: 'Files',
  settingsLabel: 'Preferences',
  logoutLabel: 'Sign Out',
}
```

---

## Advanced Options

### Typography

```javascript
typography: {
  // Options: 'system', 'inter', 'roboto', 'custom'
  fontFamily: 'system',
  
  // For custom fonts, add the import to index.html first
  customFontFamily: "'Your Font', sans-serif",
  
  // Base font size (default: 16)
  baseFontSize: 16,
}
```

#### Using Custom Fonts

1. Add the font import to `web-frontend/index.html`:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
   ```

2. Configure in whitelabel.config.js:
   ```javascript
   typography: {
     fontFamily: 'custom',
     customFontFamily: "'Poppins', sans-serif",
   }
   ```

### UI Settings

```javascript
ui: {
  // Border radius: 'none', 'small', 'medium', 'large', 'full'
  borderRadius: 'medium',
  
  // Enable/disable animations
  enableAnimations: true,
  
  // Dark mode: 'disabled', 'enabled', 'system'
  darkMode: 'disabled',
  
  // Show "Powered by Collabora" badge
  showPoweredBy: true,
  
  // Custom CSS class for root element
  customRootClass: '',
}
```

### Feature Toggles

```javascript
features: {
  // Show registration link on login page
  enableRegistration: true,
  
  // Show "Forgot Password" link
  enableForgotPassword: false,
  
  // Enable social login buttons
  enableSocialLogin: false,
  socialProviders: ['google', 'microsoft'],
  
  // Dashboard features
  showRecentDocuments: true,
  showStorageUsage: true,
}
```

---

## Deployment

### Development Mode

For testing changes locally:

```bash
cd web-frontend
npm install
npm run dev
```

### Production Build

```bash
# Rebuild the frontend container
docker compose build web-frontend

# Restart just the frontend
docker compose up -d web-frontend

# Or restart all services
docker compose up -d
```

### Verify Changes

1. Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
2. Check browser console for errors
3. Test on mobile devices

---

## Examples

### Example 1: Corporate Blue Theme

```javascript
const whitelabelConfig = {
  branding: {
    appName: 'Acme Docs',
    appNameShort: 'Docs',
    tagline: 'Enterprise Document Management',
    companyName: 'Acme Corporation',
    copyright: '© 2024 Acme Corporation',
    supportEmail: 'support@acme.com',
  },
  logos: {
    primary: '/branding/acme-logo.svg',
    icon: '/branding/acme-icon.svg',
    login: '/branding/acme-logo-large.svg',
  },
  colors: {
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
  },
  features: {
    enableRegistration: false, // SSO only
  },
};
```

### Example 2: Green Tech Startup

```javascript
const whitelabelConfig = {
  branding: {
    appName: 'GreenDocs',
    tagline: 'Sustainable Document Collaboration',
    companyName: 'EcoTech Inc',
  },
  logos: {
    primary: '/branding/greendocs-logo.svg',
    loginBackground: '/branding/nature-bg.jpg',
  },
  colors: {
    primary: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
      900: '#14532d',
      950: '#052e16',
    },
  },
  typography: {
    fontFamily: 'inter',
  },
  ui: {
    borderRadius: 'large',
  },
};
```

### Example 3: Minimal Dark Theme

```javascript
const whitelabelConfig = {
  branding: {
    appName: 'DocHub',
    tagline: 'Simple. Secure. Documents.',
  },
  colors: {
    primary: {
      50: '#fafafa',
      100: '#f4f4f5',
      200: '#e4e4e7',
      300: '#d4d4d8',
      400: '#a1a1aa',
      500: '#71717a',
      600: '#52525b',
      700: '#3f3f46',
      800: '#27272a',
      900: '#18181b',
      950: '#09090b',
    },
  },
  ui: {
    darkMode: 'system',
    borderRadius: 'small',
    enableAnimations: false,
  },
};
```

---

## CSS Variables Reference

The following CSS variables are available for advanced customization:

```css
:root {
  /* Primary Colors */
  --color-primary-50 through --color-primary-950
  
  /* Secondary Colors */
  --color-secondary-50 through --color-secondary-950
  
  /* Status Colors */
  --color-success-50, --color-success-500, --color-success-600
  --color-warning-50, --color-warning-500, --color-warning-600
  --color-error-50, --color-error-500, --color-error-600
  
  /* UI Variables */
  --border-radius
  --font-family
  --animation-duration
}
```

You can override these in your custom CSS file if needed.

---

## Troubleshooting

### Changes Not Appearing

1. **Clear browser cache** - Hard refresh with Ctrl+Shift+R
2. **Rebuild container** - `docker compose build web-frontend`
3. **Check file paths** - Ensure logo paths are correct
4. **Check console** - Look for 404 errors on assets

### Logo Not Loading

1. Verify the file exists in `web-frontend/public/branding/`
2. Check the path starts with `/branding/`
3. Ensure the file format is supported (SVG, PNG, JPG)

### Colors Not Changing

1. Ensure all color shades (50-950) are defined
2. Use valid CSS color values (hex, rgb, hsl)
3. Rebuild after changes: `docker compose build web-frontend`

### Font Not Loading

1. Add font import to `index.html`
2. Set `fontFamily: 'custom'` in config
3. Provide full font stack in `customFontFamily`

---

## File Structure

```
web-frontend/
├── public/
│   ├── branding/           # Your custom assets
│   │   ├── logo.svg
│   │   ├── icon.svg
│   │   └── README.md
│   ├── favicon.ico
│   └── favicon.svg
├── src/
│   ├── config/
│   │   └── whitelabel.config.js  # Main configuration
│   ├── context/
│   │   └── WhitelabelContext.jsx # Theme provider
│   ├── components/
│   │   └── Logo.jsx              # Logo component
│   └── index.css                 # CSS variables
└── index.html
```

---

## Support

For questions or issues with whitelabeling:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Examples](#examples) for reference
3. Contact support at the configured `supportEmail`
