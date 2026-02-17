import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWhitelabel } from '../context/WhitelabelContext';
import Logo from '../components/Logo';
import { Eye, EyeOff, Mail, Lock, User, AtSign, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Register() {
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const { register } = useAuth();
  const { branding, text, logos } = useWhitelabel();
  const navigate = useNavigate();

  // Password strength indicator
  const getPasswordStrength = (password) => {
    if (!password) return { strength: 0, label: '', color: '' };
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;
    
    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];
    return { strength, label: labels[strength - 1] || '', color: colors[strength - 1] || '' };
  };

  const passwordStrength = getPasswordStrength(formData.password);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await register(
        formData.email,
        formData.username,
        formData.password,
        formData.displayName || formData.username
      );
      toast.success('Account created successfully!');
      navigate('/');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Background style for register page
  const backgroundStyle = logos.loginBackground 
    ? { backgroundImage: `url(${logos.loginBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  const InputField = ({ icon: Icon, label, id, type = 'text', placeholder, required = true, autoComplete }) => (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-2">
        {label}
      </label>
      <div className={`relative rounded-xl transition-all duration-200 ${
        focusedField === id ? 'ring-2 ring-primary-500 ring-offset-2' : ''
      }`}>
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Icon className={`h-5 w-5 transition-colors duration-200 ${
            focusedField === id ? 'text-primary-500' : 'text-gray-400'
          }`} />
        </div>
        <input
          id={id}
          name={id}
          type={type}
          autoComplete={autoComplete}
          required={required}
          value={formData[id]}
          onChange={handleChange}
          onFocus={() => setFocusedField(id)}
          onBlur={() => setFocusedField(null)}
          className="block w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl bg-gray-50/50 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-primary-500 text-gray-900 text-sm transition-all duration-200"
          placeholder={placeholder}
        />
      </div>
    </div>
  );

  return (
    <div 
      className="min-h-screen login-gradient flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden"
      style={backgroundStyle}
    >
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary-600/10 rounded-full blur-3xl"></div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center transform hover:scale-105 transition-transform duration-300">
          <Logo variant="login" size="xl" showText={false} />
        </div>
        <h2 className="mt-8 text-center text-3xl font-extrabold tracking-tight text-gray-900">
          {text.registerTitle || 'Create your account'}
        </h2>
        <p className="mt-3 text-center text-base text-gray-600">
          {text.registerSubtitle || 'Start collaborating on documents'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-white/80 backdrop-blur-xl py-10 px-6 shadow-2xl rounded-2xl sm:px-12 border border-white/20">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <InputField icon={Mail} label="Email address" id="email" type="email" placeholder="you@example.com" autoComplete="email" />
            <InputField icon={AtSign} label="Username" id="username" placeholder="johndoe" autoComplete="username" />
            <InputField icon={User} label="Display Name (optional)" id="displayName" placeholder="John Doe" required={false} />

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <div className={`relative rounded-xl transition-all duration-200 ${
                focusedField === 'password' ? 'ring-2 ring-primary-500 ring-offset-2' : ''
              }`}>
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className={`h-5 w-5 transition-colors duration-200 ${
                    focusedField === 'password' ? 'text-primary-500' : 'text-gray-400'
                  }`} />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  className="block w-full pl-12 pr-12 py-3 border border-gray-200 rounded-xl bg-gray-50/50 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-primary-500 text-gray-900 text-sm transition-all duration-200"
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-4 flex items-center hover:opacity-70 transition-opacity"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-5 w-5 text-gray-400" /> : <Eye className="h-5 w-5 text-gray-400" />}
                </button>
              </div>
              {/* Password strength indicator */}
              {formData.password && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          level <= passwordStrength.strength ? passwordStrength.color : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs mt-1 ${
                    passwordStrength.strength <= 1 ? 'text-red-500' : 
                    passwordStrength.strength === 2 ? 'text-yellow-600' : 
                    passwordStrength.strength === 3 ? 'text-blue-600' : 'text-green-600'
                  }`}>
                    {passwordStrength.label && `Password strength: ${passwordStrength.label}`}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                Confirm Password
              </label>
              <div className={`relative rounded-xl transition-all duration-200 ${
                focusedField === 'confirmPassword' ? 'ring-2 ring-primary-500 ring-offset-2' : ''
              }`}>
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  {formData.confirmPassword && formData.password === formData.confirmPassword ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Lock className={`h-5 w-5 transition-colors duration-200 ${
                      focusedField === 'confirmPassword' ? 'text-primary-500' : 'text-gray-400'
                    }`} />
                  )}
                </div>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  onFocus={() => setFocusedField('confirmPassword')}
                  onBlur={() => setFocusedField(null)}
                  className="block w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl bg-gray-50/50 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-primary-500 text-gray-900 text-sm transition-all duration-200"
                  placeholder="Confirm your password"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 transition-all duration-200 transform hover:-translate-y-0.5"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Creating account...
                  </>
                ) : (
                  <>
                    {text.registerButton || 'Create account'}
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform duration-200" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-8">
            <p className="text-center text-sm text-gray-600">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-500 transition-colors">
                {text.loginButton || 'Sign in'}
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-500">
          {branding.copyright || `© ${new Date().getFullYear()} ${branding.companyName || branding.appName}`}
        </p>
      </div>
    </div>
  );
}
