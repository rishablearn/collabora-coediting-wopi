# Branding Assets

Place your custom branding assets in this directory.

## Recommended Files

| File | Purpose | Recommended Size |
|------|---------|------------------|
| `logo.svg` | Main logo for header | 200x50px (or similar ratio) |
| `logo-dark.svg` | Logo for dark backgrounds | 200x50px |
| `icon.svg` | Square icon/favicon | 64x64px |
| `login-logo.svg` | Large logo for login page | 300x100px |
| `login-bg.jpg` | Login page background | 1920x1080px |

## Supported Formats

- **SVG** (recommended for logos)
- **PNG** (with transparency support)
- **JPG/JPEG** (for backgrounds)
- **WebP** (modern format, smaller sizes)

## Configuration

After adding your assets, update the paths in:
`src/config/whitelabel.config.js`

```javascript
logos: {
  primary: '/branding/logo.svg',
  primaryDark: '/branding/logo-dark.svg',
  icon: '/branding/icon.svg',
  login: '/branding/login-logo.svg',
  loginBackground: '/branding/login-bg.jpg',
}
```

## Tips

1. **SVG logos** scale perfectly at any size
2. Use **transparent backgrounds** for logos
3. **Test on both light and dark backgrounds**
4. Keep file sizes small for fast loading
5. Use **descriptive alt text** in the config
