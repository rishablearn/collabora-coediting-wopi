import { FileText } from 'lucide-react';
import { useWhitelabel } from '../context/WhitelabelContext';

/**
 * Logo component that displays the configured logo or falls back to default
 * 
 * @param {Object} props
 * @param {string} props.variant - 'primary' | 'icon' | 'login' | 'dark'
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.showText - Whether to show app name next to logo (for icon variant)
 * @param {string} props.size - 'sm' | 'md' | 'lg' | 'xl'
 */
export default function Logo({ 
  variant = 'primary', 
  className = '', 
  showText = true,
  size = 'md' 
}) {
  const { logos, branding, colors } = useWhitelabel();

  // Size configurations
  const sizes = {
    sm: { icon: 'h-6 w-6', text: 'text-lg', image: 'h-6' },
    md: { icon: 'h-8 w-8', text: 'text-xl', image: 'h-8' },
    lg: { icon: 'h-12 w-12', text: 'text-2xl', image: 'h-12' },
    xl: { icon: 'h-16 w-16', text: 'text-3xl', image: 'h-16' },
  };

  const sizeConfig = sizes[size] || sizes.md;

  // Determine which logo to use
  const getLogoSrc = () => {
    switch (variant) {
      case 'dark':
        return logos.primaryDark || logos.primary;
      case 'icon':
        return logos.icon || logos.primary;
      case 'login':
        return logos.login || logos.primary;
      default:
        return logos.primary;
    }
  };

  const logoSrc = getLogoSrc();

  // If a custom logo is provided, render it
  if (logoSrc) {
    return (
      <div className={`flex items-center ${className}`}>
        <img 
          src={logoSrc} 
          alt={branding.appName}
          className={`${sizeConfig.image} w-auto object-contain`}
        />
        {showText && variant === 'icon' && (
          <span className={`ml-2 font-bold text-gray-900 ${sizeConfig.text}`}>
            {branding.appName}
          </span>
        )}
      </div>
    );
  }

  // Default logo with icon + text
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <FileText 
        className={`${sizeConfig.icon} text-primary-600`}
        style={{ color: colors.primary[600] }}
      />
      {showText && (
        <span className={`font-bold text-gray-900 ${sizeConfig.text}`}>
          {branding.appName}
        </span>
      )}
    </div>
  );
}

/**
 * Standalone icon component for use in headers, favicons, etc.
 */
export function LogoIcon({ className = '', size = 'md' }) {
  const { logos, colors } = useWhitelabel();

  const sizes = {
    sm: 'h-5 w-5',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
    xl: 'h-12 w-12',
  };

  const sizeClass = sizes[size] || sizes.md;

  if (logos.icon) {
    return (
      <img 
        src={logos.icon} 
        alt="Logo"
        className={`${sizeClass} object-contain ${className}`}
      />
    );
  }

  return (
    <FileText 
      className={`${sizeClass} ${className}`}
      style={{ color: colors.primary[600] }}
    />
  );
}
