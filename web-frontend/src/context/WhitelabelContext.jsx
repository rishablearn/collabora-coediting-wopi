import { createContext, useContext, useEffect, useState } from 'react';
import whitelabelConfig, { generateCSSVariables, getFontFamily } from '../config/whitelabel.config';
import api from '../services/api';

const WhitelabelContext = createContext(null);

export function WhitelabelProvider({ children, customConfig = {} }) {
  // Merge custom config with default config
  const [config, setConfig] = useState(() => deepMerge(whitelabelConfig, customConfig));
  const [loading, setLoading] = useState(true);

  // Fetch runtime config from backend on mount
  useEffect(() => {
    async function fetchRuntimeConfig() {
      try {
        const response = await api.get('/config/whitelabel');
        if (response.data) {
          setConfig((prev) => deepMerge(prev, response.data));
        }
      } catch (error) {
        // If backend config fails, continue with static config
        console.warn('Failed to fetch runtime whitelabel config, using defaults:', error.message);
      } finally {
        setLoading(false);
      }
    }
    fetchRuntimeConfig();
  }, []);

  // Apply CSS variables on mount and when config changes
  useEffect(() => {
    applyTheme(config);
  }, [config]);

  // Update config dynamically (useful for admin panel or runtime changes)
  const updateConfig = (newConfig) => {
    setConfig((prev) => deepMerge(prev, newConfig));
  };

  // Reset to default config
  const resetConfig = () => {
    setConfig(whitelabelConfig);
  };

  const value = {
    config,
    updateConfig,
    resetConfig,
    loading,
    // Convenience getters
    branding: config.branding,
    logos: config.logos,
    colors: config.colors,
    typography: config.typography,
    ui: config.ui,
    features: config.features,
    localization: config.localization,
    text: config.textOverrides,
  };

  return (
    <WhitelabelContext.Provider value={value}>
      {children}
    </WhitelabelContext.Provider>
  );
}

export function useWhitelabel() {
  const context = useContext(WhitelabelContext);
  if (!context) {
    throw new Error('useWhitelabel must be used within a WhitelabelProvider');
  }
  return context;
}

/**
 * Apply theme CSS variables to the document
 */
function applyTheme(config) {
  const root = document.documentElement;
  const cssVars = generateCSSVariables(config);

  // Apply CSS variables
  Object.entries(cssVars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Apply font family
  root.style.setProperty('--font-family', getFontFamily(config));
  document.body.style.fontFamily = getFontFamily(config);

  // Apply base font size
  if (config.typography?.baseFontSize) {
    root.style.fontSize = `${config.typography.baseFontSize}px`;
  }

  // Apply custom root class
  if (config.ui?.customRootClass) {
    root.classList.add(config.ui.customRootClass);
  }

  // Update document title
  if (config.branding?.appName) {
    document.title = `${config.branding.appName} - Document Editor`;
  }

  // Handle dark mode
  if (config.ui?.darkMode === 'enabled') {
    root.classList.add('dark');
  } else if (config.ui?.darkMode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    }
  } else {
    root.classList.remove('dark');
  }

  // Disable animations if configured
  if (config.ui?.enableAnimations === false) {
    root.style.setProperty('--animation-duration', '0s');
    root.classList.add('reduce-motion');
  } else {
    root.style.removeProperty('--animation-duration');
    root.classList.remove('reduce-motion');
  }
}

/**
 * Deep merge utility for config objects
 */
function deepMerge(target, source) {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else if (source[key] !== undefined) {
        output[key] = source[key];
      }
    });
  }
  
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

export default WhitelabelContext;
