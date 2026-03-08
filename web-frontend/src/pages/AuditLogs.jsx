import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Activity, FileText, User, Clock, Filter, RefreshCw,
  ChevronLeft, ChevronRight, Search, Users, Edit3,
  Upload, Download, Trash2, Share2, LogIn, LogOut,
  Save, Eye, AlertCircle
} from 'lucide-react';

const ACTION_ICONS = {
  'LOGIN': LogIn,
  'LOGOUT': LogOut,
  'REGISTER': User,
  'FILE_UPLOAD': Upload,
  'FILE_UPDATE': Save,
  'FILE_DELETE': Trash2,
  'FILE_DOWNLOAD': Download,
  'FILE_EXPORT': Download,
  'FILE_SAVE_AS': Save,
  'FILE_RENAME': Edit3,
  'FILE_SHARE': Share2,
  'USER_CREATE': User,
  'USER_UPDATE': Edit3,
  'USER_DELETE': Trash2,
  'PASSWORD_CHANGE': AlertCircle,
  'CONFIG_UPDATE': Edit3
};

const ACTION_COLORS = {
  'LOGIN': 'bg-green-100 text-green-800',
  'LOGOUT': 'bg-gray-100 text-gray-800',
  'REGISTER': 'bg-blue-100 text-blue-800',
  'FILE_UPLOAD': 'bg-blue-100 text-blue-800',
  'FILE_UPDATE': 'bg-yellow-100 text-yellow-800',
  'FILE_DELETE': 'bg-red-100 text-red-800',
  'FILE_DOWNLOAD': 'bg-purple-100 text-purple-800',
  'FILE_EXPORT': 'bg-purple-100 text-purple-800',
  'FILE_SAVE_AS': 'bg-yellow-100 text-yellow-800',
  'FILE_RENAME': 'bg-orange-100 text-orange-800',
  'FILE_SHARE': 'bg-indigo-100 text-indigo-800',
  'USER_CREATE': 'bg-green-100 text-green-800',
  'USER_UPDATE': 'bg-yellow-100 text-yellow-800',
  'USER_DELETE': 'bg-red-100 text-red-800',
  'PASSWORD_CHANGE': 'bg-orange-100 text-orange-800',
  'CONFIG_UPDATE': 'bg-gray-100 text-gray-800'
};

function ActionBadge({ action }) {
  const Icon = ACTION_ICONS[action] || Activity;
  const colorClass = ACTION_COLORS[action] || 'bg-gray-100 text-gray-800';
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {action.replace(/_/g, ' ')}
    </span>
  );
}

function ActiveSessionCard({ session }) {
  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
      <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center text-white font-medium">
        {session.userName?.charAt(0)?.toUpperCase() || 'U'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{session.userName}</p>
        <p className="text-sm text-gray-500 truncate">{session.fileName || 'Unknown file'}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-green-600 font-medium">Active</p>
        <p className="text-xs text-gray-500">{timeAgo(session.lastActivity)}</p>
      </div>
    </div>
  );
}

function CoEditingFileCard({ file }) {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-5 w-5 text-blue-500" />
        <span className="font-medium text-gray-900 truncate">{file.fileName || 'Unknown file'}</span>
        <span className="ml-auto px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
          {file.editors.length} editor{file.editors.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {file.editors.map((editor, idx) => (
          <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded-full text-sm">
            <div className="h-5 w-5 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs">
              {editor.userName?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <span className="text-gray-700">{editor.userName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AuditLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [activeSessions, setActiveSessions] = useState({ sessions: [], byFile: [] });
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(25);
  
  // Filters
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('logs');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        action: actionFilter,
        resourceType: resourceFilter
      });
      
      const response = await api.get(`/api/system/audit-logs?${params}`);
      setLogs(response.data.logs);
      setTotal(response.data.total);
      setStats(response.data.stats || []);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [offset, limit, actionFilter, resourceFilter]);

  const fetchActiveSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      const response = await api.get('/api/system/active-sessions');
      setActiveSessions(response.data);
    } catch (error) {
      console.error('Failed to fetch active sessions:', error);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchActiveSessions();
    const interval = setInterval(fetchActiveSessions, 30000);
    return () => clearInterval(interval);
  }, [fetchActiveSessions]);

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  const filteredLogs = logs.filter(log => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      log.userName?.toLowerCase().includes(search) ||
      log.action?.toLowerCase().includes(search) ||
      log.fileName?.toLowerCase().includes(search) ||
      log.ipAddress?.includes(search)
    );
  });

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                <Activity className="h-6 w-6 text-primary-600" />
                <h1 className="text-xl font-semibold text-gray-900">Co-Editing Activity</h1>
              </div>
            </div>
            <button
              onClick={() => { fetchLogs(); fetchActiveSessions(); }}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeSessions.totalSessions}</p>
                <p className="text-sm text-gray-500">Active Editors</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeSessions.totalFiles}</p>
                <p className="text-sm text-gray-500">Files Being Edited</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Activity className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{total}</p>
                <p className="text-sm text-gray-500">Total Events</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Save className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.find(s => s.action === 'FILE_UPDATE')?.count || 0}
                </p>
                <p className="text-sm text-gray-500">Saves Today</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'logs'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Activity className="h-4 w-4 inline mr-2" />
            Audit Logs
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
              activeTab === 'sessions'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="h-4 w-4 inline mr-2" />
            Active Sessions
            {activeSessions.totalSessions > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full">
                {activeSessions.totalSessions}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'logs' && (
          <>
            {/* Filters */}
            <div className="bg-white p-4 rounded-lg border border-gray-200 mb-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Filters:</span>
                </div>
                
                <select
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Actions</option>
                  <option value="FILE_UPDATE">File Updates</option>
                  <option value="FILE_UPLOAD">File Uploads</option>
                  <option value="FILE_DELETE">File Deletes</option>
                  <option value="FILE_SAVE_AS">Save As</option>
                  <option value="FILE_EXPORT">Exports</option>
                  <option value="LOGIN">Logins</option>
                  <option value="LOGOUT">Logouts</option>
                </select>

                <select
                  value={resourceFilter}
                  onChange={(e) => { setResourceFilter(e.target.value); setOffset(0); }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Resources</option>
                  <option value="file">Files</option>
                  <option value="user">Users</option>
                  <option value="system">System</option>
                </select>

                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search logs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Logs Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 text-primary-500 animate-spin" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center py-12">
                  <Activity className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No audit logs found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <Clock className="h-4 w-4" />
                              {formatDate(log.createdAt)}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-medium text-sm">
                                {log.userName?.charAt(0)?.toUpperCase() || 'U'}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{log.userName}</p>
                                <p className="text-xs text-gray-500">{log.userEmail}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <ActionBadge action={log.action} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm">
                              <span className="text-gray-500">{log.resourceType}: </span>
                              <span className="font-medium text-gray-900">
                                {log.fileName || log.resourceId?.substring(0, 8) || 'N/A'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-gray-500 max-w-xs truncate">
                              {log.details ? (
                                typeof log.details === 'object' 
                                  ? JSON.stringify(log.details) 
                                  : log.details
                              ) : '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {log.ipAddress || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {total > limit && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Showing {offset + 1} to {Math.min(offset + limit, total)} of {total} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOffset(Math.max(0, offset - limit))}
                      disabled={offset === 0}
                      className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span className="text-sm text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setOffset(offset + limit)}
                      disabled={offset + limit >= total}
                      className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'sessions' && (
          <div className="space-y-6">
            {/* Active Sessions */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Editing Sessions</h3>
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 text-primary-500 animate-spin" />
                </div>
              ) : activeSessions.sessions.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No active editing sessions</p>
                  <p className="text-sm text-gray-400 mt-1">Sessions appear here when users are editing documents</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeSessions.sessions.map((session, idx) => (
                    <ActiveSessionCard key={idx} session={session} />
                  ))}
                </div>
              )}
            </div>

            {/* Co-Editing Files */}
            {activeSessions.byFile.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  <Eye className="h-5 w-5 inline mr-2 text-blue-500" />
                  Collaborative Editing
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeSessions.byFile
                    .filter(file => file.editors.length > 1)
                    .map((file, idx) => (
                      <CoEditingFileCard key={idx} file={file} />
                    ))}
                </div>
                {activeSessions.byFile.filter(f => f.editors.length > 1).length === 0 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                    <p className="text-gray-500">No files currently being edited by multiple users</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
