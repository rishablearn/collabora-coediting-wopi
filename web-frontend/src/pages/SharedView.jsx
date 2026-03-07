import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { FileText, Download, AlertCircle } from 'lucide-react';

export default function SharedView() {
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [editUrl, setEditUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        const response = await api.get(`/shared/${shareToken}`);
        setFile({
          id: response.data.fileId,
          name: response.data.fileName,
          permission: response.data.permission
        });
        setEditUrl(response.data.editUrl);
      } catch (err) {
        if (err.response?.status === 404) {
          setError('This shared link is invalid or has expired');
        } else if (err.response?.status === 401) {
          setError('This shared link requires authentication');
        } else {
          setError(err.response?.data?.error || 'Failed to load shared document');
        }
        toast.error('Failed to load shared document');
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

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to Load Document</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/login')}
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
