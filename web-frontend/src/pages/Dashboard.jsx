import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { useWhitelabel } from '../context/WhitelabelContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Folder,
  Upload,
  Plus,
  Trash2,
  Download,
  Share2,
  MoreVertical,
  ChevronRight,
  Home,
  Search,
  Grid,
  List,
  FolderPlus,
  Clock,
  X
} from 'lucide-react';

const fileIcons = {
  'application/vnd.oasis.opendocument.text': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'application/msword': FileText,
  'application/vnd.oasis.opendocument.spreadsheet': FileSpreadsheet,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet,
  'application/vnd.ms-excel': FileSpreadsheet,
  'application/vnd.oasis.opendocument.presentation': Presentation,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': Presentation,
  'application/vnd.ms-powerpoint': Presentation,
};

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function Dashboard() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const { text } = useWhitelabel();
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: 'My Documents' }]);
  const [searchFocused, setSearchFocused] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (folderId) params.append('folderId', folderId);
      if (searchQuery) params.append('search', searchQuery);

      const response = await api.get(`/files?${params}`);
      setFiles(response.data.files);
      setFolders(response.data.folders);
    } catch (error) {
      toast.error('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [folderId, searchQuery]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const onDrop = useCallback(async (acceptedFiles) => {
    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);
      if (folderId) formData.append('folderId', folderId);

      try {
        await api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success(`Uploaded ${file.name}`);
      } catch (error) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    fetchFiles();
  }, [folderId, fetchFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    accept: {
      'application/vnd.oasis.opendocument.text': ['.odt'],
      'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
      'application/vnd.oasis.opendocument.presentation': ['.odp'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/msword': ['.doc'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.ms-powerpoint': ['.ppt'],
    }
  });

  const handleFileClick = (file) => {
    navigate(`/edit/${file.id}`);
  };

  const handleFolderClick = (folder) => {
    navigate(`/folder/${folder.id}`);
  };

  const handleDelete = async (e, file) => {
    e.stopPropagation();
    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      await api.delete(`/files/${file.id}`);
      toast.success('File deleted');
      fetchFiles();
    } catch (error) {
      toast.error('Failed to delete file');
    }
  };

  const handleDownload = async (e, file) => {
    e.stopPropagation();
    try {
      const response = await api.get(`/files/${file.id}/download`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Failed to download file');
    }
  };

  const handleCreateDocument = async (type) => {
    setShowNewMenu(false);
    const name = prompt(`Enter ${type} name:`);
    if (!name) return;

    try {
      const response = await api.post('/files/create', {
        name,
        type,
        folderId: folderId || null
      });
      toast.success('Document created');
      navigate(`/edit/${response.data.id}`);
    } catch (error) {
      toast.error('Failed to create document');
    }
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      await api.post('/files/folder', {
        name: newFolderName,
        parentId: folderId || null
      });
      toast.success('Folder created');
      setShowNewFolderModal(false);
      setNewFolderName('');
      fetchFiles();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create folder');
    }
  };

  const FileIcon = ({ mimeType, size = 'md' }) => {
    const Icon = fileIcons[mimeType] || FileText;
    const sizes = { sm: 'h-8 w-8', md: 'h-12 w-12', lg: 'h-16 w-16' };
    const colors = {
      'application/vnd.oasis.opendocument.text': 'text-blue-500',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'text-blue-500',
      'application/msword': 'text-blue-500',
      'application/vnd.oasis.opendocument.spreadsheet': 'text-green-500',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'text-green-500',
      'application/vnd.ms-excel': 'text-green-500',
      'application/vnd.oasis.opendocument.presentation': 'text-orange-500',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'text-orange-500',
      'application/vnd.ms-powerpoint': 'text-orange-500',
    };
    return <Icon className={`${sizes[size]} ${colors[mimeType] || 'text-primary-500'}`} />;
  };

  return (
    <div {...getRootProps()} className="min-h-[calc(100vh-180px)]">
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="fixed inset-0 bg-primary-500/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-xl p-10 rounded-2xl shadow-2xl text-center border border-white/50 transform scale-105 transition-transform">
            <div className="h-20 w-20 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Upload className="h-10 w-10 text-primary-600" />
            </div>
            <p className="text-xl font-semibold text-gray-900">Drop files to upload</p>
            <p className="text-sm text-gray-500 mt-2">Release to start uploading</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{text.dashboardTitle || 'My Documents'}</h1>
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-1 text-sm text-gray-500 mt-2">
            <button onClick={() => navigate('/')} className="hover:text-primary-600 p-1 rounded-md hover:bg-primary-50 transition-colors">
              <Home className="h-4 w-4" />
            </button>
            {breadcrumbs.slice(1).map((crumb, index) => (
              <span key={crumb.id} className="flex items-center">
                <ChevronRight className="h-4 w-4 mx-1 text-gray-300" />
                <button 
                  onClick={() => navigate(crumb.id ? `/folder/${crumb.id}` : '/')} 
                  className="hover:text-primary-600 px-2 py-1 rounded-md hover:bg-primary-50 transition-colors"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search */}
          <div className={`relative flex-1 sm:flex-none transition-all duration-200 ${searchFocused ? 'sm:w-80' : 'sm:w-64'}`}>
            <Search className={`absolute left-3.5 top-1/2 transform -translate-y-1/2 h-5 w-5 transition-colors ${searchFocused ? 'text-primary-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white/80 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder-gray-400"
            />
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Grid className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <List className="h-5 w-5" />
            </button>
          </div>

          {/* New button */}
          <div className="relative">
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 transform hover:-translate-y-0.5"
            >
              <Plus className="h-5 w-5" />
              <span className="font-medium">{text.newDocumentButton || 'New'}</span>
            </button>

            {showNewMenu && (
              <div className="absolute right-0 mt-3 w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="p-2">
                  <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Create New</p>
                  <button
                    onClick={() => handleCreateDocument('document')}
                    className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-blue-50 rounded-xl flex items-center gap-3 transition-colors group"
                  >
                    <div className="h-9 w-9 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">Document</p>
                      <p className="text-xs text-gray-400">Text document</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleCreateDocument('spreadsheet')}
                    className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-green-50 rounded-xl flex items-center gap-3 transition-colors group"
                  >
                    <div className="h-9 w-9 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition-colors">
                      <FileSpreadsheet className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium">Spreadsheet</p>
                      <p className="text-xs text-gray-400">Data & calculations</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleCreateDocument('presentation')}
                    className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-orange-50 rounded-xl flex items-center gap-3 transition-colors group"
                  >
                    <div className="h-9 w-9 bg-orange-100 rounded-lg flex items-center justify-center group-hover:bg-orange-200 transition-colors">
                      <Presentation className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium">Presentation</p>
                      <p className="text-xs text-gray-400">Slides & visuals</p>
                    </div>
                  </button>
                </div>
                <hr className="border-gray-100" />
                <div className="p-2">
                  <button
                    onClick={() => { setShowNewMenu(false); setShowNewFolderModal(true); }}
                    className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-yellow-50 rounded-xl flex items-center gap-3 transition-colors group"
                  >
                    <div className="h-9 w-9 bg-yellow-100 rounded-lg flex items-center justify-center group-hover:bg-yellow-200 transition-colors">
                      <FolderPlus className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="font-medium">New Folder</p>
                      <p className="text-xs text-gray-400">Organize files</p>
                    </div>
                  </button>
                  <label className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 rounded-xl flex items-center gap-3 cursor-pointer transition-colors group">
                    <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                      <Upload className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium">{text.uploadButton || 'Upload File'}</p>
                      <p className="text-xs text-gray-400">From your device</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          onDrop(Array.from(e.target.files));
                        }
                        setShowNewMenu(false);
                      }}
                      multiple
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="relative">
            <div className="h-14 w-14 rounded-full border-4 border-primary-100"></div>
            <div className="absolute top-0 h-14 w-14 rounded-full border-4 border-primary-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="mt-4 text-sm text-gray-500">Loading your files...</p>
        </div>
      ) : (
        <>
          {/* Empty state */}
          {files.length === 0 && folders.length === 0 ? (
            <div className="text-center py-20 bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 hover:border-primary-300 transition-colors">
              <div className="h-20 w-20 bg-gradient-to-br from-primary-50 to-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <FileText className="h-10 w-10 text-primary-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No documents yet</h3>
              <p className="text-gray-500 mb-8 max-w-sm mx-auto">Get started by creating a new document or uploading a file from your computer</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => setShowNewMenu(true)}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg shadow-primary-500/25 font-medium"
                >
                  <Plus className="h-5 w-5" />
                  Create document
                </button>
                <label className="inline-flex items-center gap-2 px-5 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-all cursor-pointer font-medium">
                  <Upload className="h-5 w-5" />
                  Upload files
                  <input type="file" className="hidden" onChange={(e) => e.target.files && onDrop(Array.from(e.target.files))} multiple />
                </label>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {/* Folders */}
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  onClick={() => handleFolderClick(folder)}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-100 hover:border-yellow-300 hover:shadow-xl hover:shadow-yellow-500/10 cursor-pointer transition-all duration-200 group transform hover:-translate-y-1"
                >
                  <div className="flex justify-center mb-4">
                    <div className="h-14 w-14 bg-gradient-to-br from-yellow-100 to-yellow-50 rounded-xl flex items-center justify-center group-hover:from-yellow-200 group-hover:to-yellow-100 transition-colors">
                      <Folder className="h-8 w-8 text-yellow-600" />
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 text-center truncate">{folder.name}</p>
                  <p className="text-xs text-gray-400 text-center mt-1">Folder</p>
                </div>
              ))}

              {/* Files */}
              {files.map((file) => (
                <div
                  key={file.id}
                  onClick={() => handleFileClick(file)}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-gray-100 hover:border-primary-200 hover:shadow-xl hover:shadow-primary-500/10 cursor-pointer transition-all duration-200 group relative transform hover:-translate-y-1"
                >
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-200">
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => handleDownload(e, file)}
                        className="p-1.5 bg-gray-100/80 backdrop-blur rounded-lg hover:bg-gray-200 transition-colors"
                        title="Download"
                      >
                        <Download className="h-4 w-4 text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, file)}
                        className="p-1.5 bg-gray-100/80 backdrop-blur rounded-lg hover:bg-red-100 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-gray-600 hover:text-red-600" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-center mb-4">
                    <div className="h-14 w-14 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl flex items-center justify-center">
                      <FileIcon mimeType={file.mimeType} size="sm" />
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 text-center truncate" title={file.name}>
                    {file.name}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2 text-xs text-gray-400">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <Clock className="h-3 w-3" />
                    <span>{format(new Date(file.updatedAt), 'MMM d')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Modified</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {folders.map((folder) => (
                    <tr
                      key={folder.id}
                      onClick={() => handleFolderClick(folder)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Folder className="h-8 w-8 text-yellow-500 mr-3" />
                          <span className="text-sm font-medium text-gray-900">{folder.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(folder.updatedAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right"></td>
                    </tr>
                  ))}
                  {files.map((file) => (
                    <tr
                      key={file.id}
                      onClick={() => handleFileClick(file)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileIcon mimeType={file.mimeType} />
                          <span className="text-sm font-medium text-gray-900 ml-3">{file.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatFileSize(file.size)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(file.updatedAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={(e) => handleDownload(e, file)}
                          className="text-gray-400 hover:text-gray-600 mr-2"
                        >
                          <Download className="h-5 w-5" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, file)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <FolderPlus className="h-5 w-5 text-yellow-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Create New Folder</h3>
              </div>
              <button
                onClick={() => { setShowNewFolderModal(false); setNewFolderName(''); }}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder}>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Enter folder name"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-6 bg-gray-50 focus:bg-white transition-colors"
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowNewFolderModal(false); setNewFolderName(''); }}
                  className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl hover:from-primary-700 hover:to-primary-800 font-medium shadow-lg shadow-primary-500/25 transition-all"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {showNewMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowNewMenu(false)}
        />
      )}
    </div>
  );
}
