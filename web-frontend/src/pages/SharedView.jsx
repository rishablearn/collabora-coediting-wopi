import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { FileText, Download, AlertCircle, LogIn, Lock } from 'lucide-react';

export default function SharedView() {
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [editUrl, setEditUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [shareInfo, setShareInfo] = useState(null);

  // Handle PostMessage from Collabora
  const handleCollaboraMessage = useCallback((event) => {
    let data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }

    if (data.MessageId === 'UI_Close' || data.Values?.Clicked === 'Close') {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    window.addEventListener('message', handleCollaboraMessage);
    return () => window.removeEventListener('message', handleCollaboraMessage);
  }, [handleCollaboraMessage]);

  useEffect(() => {
    const fetchSharedFile = async () => {
      try {
        // First, check if auth is required
        const infoResponse = await api.get(`/shared/${shareToken}/info`);
        setShareInfo(infoResponse.data);
        
        // If auth required and user not logged in, show auth prompt
        if (infoResponse.data.requiresAuth) {
          const token = localStorage.getItem('token');
          if (!token) {
            setRequiresAuth(true);
            setLoading(false);
            return;
          }
        }

        // Fetch the actual share with editor URL
        const response = await api.get(`/shared/${shareToken}`);
        setFile({
          id: response.data.fileId,
          name: response.data.fileName,
          permission: response.data.permission,
          user: response.data.user
        });
        setEditUrl(response.data.editUrl);
      } catch (err) {
        if (err.response?.status === 404) {
          setError('This shared link is invalid or has expired');
        } else if (err.response?.status === 401) {
          // Auth required - redirect to login with return URL
          if (err.response?.data?.requiresAuth) {
            setRequiresAuth(true);
          } else {
            setError('Your session has expired. Please sign in again.');
          }
        } else {
          setError(err.response?.data?.error || 'Failed to load shared document');
          toast.error('Failed to load shared document');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSharedFile();
  }, [shareToken]);

  const handleDownload = async () => {
    try {
      const response = await api.get(`/shared/${shareToken}/download`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = file?.name || 'document';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Failed to download file');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading shared document...</p>
        </div>
      </div>
    );
  }

  // Handle sign in - redirect to login with return URL
  const handleSignIn = () => {
    // Store the current share URL to return after login
    sessionStorage.setItem('returnUrl', `/shared/${shareToken}`);
    navigate('/login');
  };

  // Authentication required screen
  if (requiresAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="h-8 w-8 text-primary-600" />
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign In Required</h2>
          <p className="text-gray-600 mb-6">
            To edit this document, you need to sign in with your account. This ensures your changes are tracked and you can collaborate with others.
          </p>

          {shareInfo && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
              <div className="flex items-center gap-3">
                <FileText className="h-10 w-10 text-primary-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{shareInfo.fileName}</p>
                  <p className="text-sm text-gray-500">Shared by {shareInfo.ownerName}</p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors"
          >
            <LogIn className="h-5 w-5" />
            Sign In to Edit
          </button>

          <p className="mt-4 text-sm text-gray-500">
            After signing in, you'll be redirected back to this document.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load Document</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleSignIn}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 h-14 flex items-center px-4">
        <FileText className="h-6 w-6 text-primary-600 mr-3" />
        
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-medium text-gray-900 truncate">
            {file?.name || 'Shared Document'}
          </h1>
          <p className="text-xs text-gray-500">
            {file?.permission === 'edit' ? 'You can edit this document' : 'View only'}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            title="Download"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </header>

      {/* Collabora iframe */}
      <div className="flex-1">
        {editUrl && (
          <iframe
            src={editUrl}
            className="collabora-frame"
            title="Shared Document"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>
    </div>
  );
}
