import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Shield, Activity, Settings, FileText, Server, Database,
  CheckCircle, XCircle, AlertCircle, RefreshCw, Search,
  Save, Eye, EyeOff, ChevronDown, ChevronRight, Loader2,
  Palette, Globe, Lock, HardDrive, Users, BarChart3
} from 'lucide-react';

// Status badge component
function StatusBadge({ status }) {
  const styles = {
    healthy: 'bg-green-100 text-green-800',
    running: 'bg-green-100 text-green-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    unhealthy: 'bg-red-100 text-red-800',
    unreachable: 'bg-red-100 text-red-800',
    not_configured: 'bg-gray-100 text-gray-800',
    unknown: 'bg-gray-100 text-gray-800'
  };

  const icons = {
    healthy: <CheckCircle className="h-4 w-4" />,
    running: <CheckCircle className="h-4 w-4" />,
    degraded: <AlertCircle className="h-4 w-4" />,
    unhealthy: <XCircle className="h-4 w-4" />,
    unreachable: <XCircle className="h-4 w-4" />,
    not_configured: <AlertCircle className="h-4 w-4" />,
    unknown: <AlertCircle className="h-4 w-4" />
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.unknown}`}>
      {icons[status] || icons.unknown}
      {status.replace('_', ' ')}
    </span>
  );
}

// Health Check Tab
function HealthTab({ health, versions, docker, loading, onRefresh }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">System Health</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Overall Status */}
      {health && (
        <div className={`p-4 rounded-lg border-2 ${
          health.overall === 'healthy' ? 'bg-green-50 border-green-200' :
          health.overall === 'degraded' ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-3">
            {health.overall === 'healthy' ? (
              <CheckCircle className="h-8 w-8 text-green-600" />
            ) : health.overall === 'degraded' ? (
              <AlertCircle className="h-8 w-8 text-yellow-600" />
            ) : (
              <XCircle className="h-8 w-8 text-red-600" />
            )}
            <div>
              <h4 className="font-semibold text-gray-900">
                System Status: {health.overall.charAt(0).toUpperCase() + health.overall.slice(1)}
              </h4>
              <p className="text-sm text-gray-600">Last checked: {new Date(health.timestamp).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {health?.services && Object.entries(health.services).map(([name, service]) => (
          <div key={name} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-900 capitalize">{name}</h4>
              <StatusBadge status={service.status} />
            </div>
            {service.latency && (
              <p className="text-sm text-gray-600">Latency: {service.latency}</p>
            )}
            {service.error && (
              <p className="text-sm text-red-600 mt-1">{service.error}</p>
            )}
            {service.stats && (
              <div className="mt-2 text-xs text-gray-500">
                {Object.entries(service.stats).map(([key, val]) => (
                  <div key={key}>{key.replace('_', ' ')}: {val}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Docker Containers */}
      {docker?.containers && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Docker Containers</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Container</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Status</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {docker.containers.map((container) => (
                  <tr key={container.name}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{container.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={container.status} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {container.error || container.statusCode || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Versions */}
      {versions?.components && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Component Versions</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Component</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {Object.entries(versions.components).map(([name, info]) => (
                  <tr key={name}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 capitalize">{name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {info.version || info.productVersion || info.error || 'Unknown'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Configuration Tab
function ConfigTab({ config, onSave, loading }) {
  const [editMode, setEditMode] = useState({});
  const [editedValues, setEditedValues] = useState({});
  const [expandedSections, setExpandedSections] = useState(['whitelabel', 'general']);

  const toggleSection = (section) => {
    setExpandedSections(prev => 
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  };

  const handleEdit = (category, key, value) => {
    setEditedValues(prev => ({
      ...prev,
      [category]: { ...prev[category], [key]: value }
    }));
  };

  const handleSave = async (category) => {
    if (editedValues[category]) {
      await onSave(category, editedValues[category]);
      setEditMode(prev => ({ ...prev, [category]: false }));
      setEditedValues(prev => ({ ...prev, [category]: {} }));
    }
  };

  const sectionIcons = {
    general: <Globe className="h-5 w-5" />,
    authentication: <Lock className="h-5 w-5" />,
    ldap: <Users className="h-5 w-5" />,
    collabora: <Server className="h-5 w-5" />,
    storage: <HardDrive className="h-5 w-5" />,
    whitelabel: <Palette className="h-5 w-5" />,
    security: <Shield className="h-5 w-5" />
  };

  const editableCategories = ['whitelabel', 'general', 'security'];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Configuration Settings</h3>
      
      {config && Object.entries(config).map(([category, settings]) => (
        <div key={category} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection(category)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100"
          >
            <div className="flex items-center gap-2">
              {sectionIcons[category] || <Settings className="h-5 w-5" />}
              <span className="font-medium text-gray-900 capitalize">{category}</span>
            </div>
            <div className="flex items-center gap-2">
              {editableCategories.includes(category) && (
                <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">Editable</span>
              )}
              {expandedSections.includes(category) ? (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronRight className="h-5 w-5 text-gray-500" />
              )}
            </div>
          </button>
          
          {expandedSections.includes(category) && (
            <div className="p-4">
              {editableCategories.includes(category) && (
                <div className="flex justify-end mb-3">
                  {editMode[category] ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditMode(prev => ({ ...prev, [category]: false }));
                          setEditedValues(prev => ({ ...prev, [category]: {} }));
                        }}
                        className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(category)}
                        disabled={loading}
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditMode(prev => ({ ...prev, [category]: true }))}
                      className="px-3 py-1 text-sm text-primary-600 hover:text-primary-800"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
              
              <div className="space-y-3">
                {Object.entries(settings).map(([key, value]) => (
                  <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <label className="text-sm font-medium text-gray-700 sm:w-1/3">{key}</label>
                    {editMode[category] && editableCategories.includes(category) ? (
                      <input
                        type="text"
                        value={editedValues[category]?.[key] ?? value}
                        onChange={(e) => handleEdit(category, key, e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
                      />
                    ) : (
                      <span className="flex-1 text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded">
                        {value || <span className="text-gray-400 italic">Not set</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Logs Tab
function LogsTab({ logs, loading, onRefresh, onSearch }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [expandedLog, setExpandedLog] = useState(null);

  const handleSearch = () => {
    onSearch({ search: searchTerm, level: levelFilter });
  };

  const levelColors = {
    error: 'text-red-600 bg-red-50',
    warn: 'text-yellow-600 bg-yellow-50',
    info: 'text-blue-600 bg-blue-50',
    debug: 'text-gray-600 bg-gray-50'
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">System Logs</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="all">All Levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
        >
          Filter
        </button>
      </div>

      {/* Logs List */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : logs?.logs?.length > 0 ? (
          <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {logs.logs.map((log, index) => (
              <div
                key={index}
                className="p-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpandedLog(expandedLog === index ? null : index)}
              >
                <div className="flex items-start gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelColors[log.level] || levelColors.info}`}>
                    {log.level || 'info'}
                  </span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  <span className="flex-1 text-sm text-gray-800 truncate">
                    {log.message || log.action || JSON.stringify(log).substring(0, 100)}
                  </span>
                </div>
                {expandedLog === index && (
                  <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-x-auto">
                    {JSON.stringify(log, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>No logs found</p>
          </div>
        )}
      </div>

      {logs && (
        <p className="text-sm text-gray-500">
          Showing {logs.logs?.length || 0} of {logs.total || 0} logs
        </p>
      )}
    </div>
  );
}

// Stats Tab
function StatsTab({ stats, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">System Statistics</h3>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.users?.total_users || 0}</p>
              <p className="text-sm text-gray-600">Total Users</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            <span className="text-green-600">{stats.users?.users_24h || 0}</span> active today
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <FileText className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.files?.total_files || 0}</p>
              <p className="text-sm text-gray-600">Total Files</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {stats.files?.total_size_formatted || '0 Bytes'} total
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Activity className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.sessions?.active_sessions || 0}</p>
              <p className="text-sm text-gray-600">Active Sessions</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {stats.sessions?.unique_users || 0} unique users
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <HardDrive className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.storage?.percentage || 0}%</p>
              <p className="text-sm text-gray-600">Storage Used</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {stats.storage?.used_formatted} / {stats.storage?.quota_formatted}
          </div>
        </div>
      </div>

      {/* User Stats Details */}
      {stats.users && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-4">User Statistics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Active Users</p>
              <p className="text-xl font-semibold">{stats.users.active_users}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Admin Users</p>
              <p className="text-xl font-semibold">{stats.users.admin_users}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">LDAP Users</p>
              <p className="text-xl font-semibold">{stats.users.ldap_users}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Active (7 days)</p>
              <p className="text-xl font-semibold">{stats.users.users_7d}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main Component
export default function SystemAdmin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('health');
  const [hasAccess, setHasAccess] = useState(null);
  const [accessInfo, setAccessInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [versions, setVersions] = useState(null);
  const [docker, setDocker] = useState(null);
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState(null);
  const [stats, setStats] = useState(null);

  // Check access on mount
  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      const response = await api.get('/system/access-check');
      setAccessInfo(response.data);
      setHasAccess(response.data.hasAccess);
      if (response.data.hasAccess) {
        loadAllData();
      }
    } catch (error) {
      if (error.response?.status === 401) {
        navigate('/login');
      } else {
        setHasAccess(false);
        setAccessInfo(error.response?.data || { error: error.message });
      }
    } finally {
      setLoading(false);
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [healthRes, versionsRes, dockerRes, configRes, logsRes, statsRes] = await Promise.allSettled([
        api.get('/system/health'),
        api.get('/system/versions'),
        api.get('/system/docker'),
        api.get('/system/config'),
        api.get('/system/logs'),
        api.get('/system/stats')
      ]);

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value.data);
      if (versionsRes.status === 'fulfilled') setVersions(versionsRes.value.data);
      if (dockerRes.status === 'fulfilled') setDocker(dockerRes.value.data);
      if (configRes.status === 'fulfilled') setConfig(configRes.value.data);
      if (logsRes.status === 'fulfilled') setLogs(logsRes.value.data);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
    } catch (error) {
      toast.error('Failed to load system data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (category, settings) => {
    try {
      await api.put('/system/config', { category, settings });
      toast.success('Configuration saved successfully');
      // Reload config
      const configRes = await api.get('/system/config');
      setConfig(configRes.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save configuration');
    }
  };

  const handleSearchLogs = async (filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams(filters);
      const response = await api.get(`/system/logs?${params}`);
      setLogs(response.data);
    } catch (error) {
      toast.error('Failed to search logs');
    } finally {
      setLoading(false);
    }
  };

  // Access denied screen
  if (hasAccess === false) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg text-center">
          <Shield className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-4">
            You must be a member of the <strong>LocalDomainAdmins</strong> group to access System Administration.
          </p>
          
          {/* Debug info */}
          {accessInfo && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg text-left text-sm">
              <h4 className="font-medium text-gray-900 mb-2">Debug Information:</h4>
              <div className="space-y-1 text-gray-600">
                <p><strong>User:</strong> {accessInfo.user || 'Unknown'}</p>
                <p><strong>Role:</strong> {accessInfo.role || 'Unknown'}</p>
                <p><strong>Auth Source:</strong> {accessInfo.authSource || 'Unknown'}</p>
                <p><strong>Required Group:</strong> {accessInfo.requiredGroup || 'LocalDomainAdmins'}</p>
                {accessInfo.userGroups && accessInfo.userGroups.length > 0 && (
                  <div>
                    <strong>Your Groups:</strong>
                    <ul className="ml-4 mt-1 list-disc">
                      {accessInfo.userGroups.map((g, i) => (
                        <li key={i} className="text-xs">{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {accessInfo.userGroups && accessInfo.userGroups.length === 0 && (
                  <p className="text-yellow-600">No groups found for your account</p>
                )}
              </div>
            </div>
          )}
          
          <button
            onClick={() => navigate('/')}
            className="mt-6 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Loading screen
  if (loading && hasAccess === null) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary-600" />
      </div>
    );
  }

  const tabs = [
    { id: 'health', label: 'Health Check', icon: Activity },
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'stats', label: 'Statistics', icon: BarChart3 }
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">System Administration</h1>
                <p className="text-sm text-gray-600">Health checks, configuration, and diagnostics</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'health' && (
          <HealthTab
            health={health}
            versions={versions}
            docker={docker}
            loading={loading}
            onRefresh={loadAllData}
          />
        )}
        {activeTab === 'config' && (
          <ConfigTab
            config={config}
            onSave={handleSaveConfig}
            loading={loading}
          />
        )}
        {activeTab === 'logs' && (
          <LogsTab
            logs={logs}
            loading={loading}
            onRefresh={() => handleSearchLogs({})}
            onSearch={handleSearchLogs}
          />
        )}
        {activeTab === 'stats' && (
          <StatsTab stats={stats} loading={loading} />
        )}
      </main>
    </div>
  );
}
