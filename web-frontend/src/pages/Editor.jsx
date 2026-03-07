import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Share2, X, Copy, Link, Mail, Users } from 'lucide-react';

export default function Editor() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [editUrl, setEditUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const iframeRef = useRef(null);

  // Handle PostMessage from Collabora
  const handleCollaboraMessage = useCallback((event) => {
    // Validate origin if needed
    let data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return; // Not a JSON message
    }

    // Handle different Collabora PostMessage actions
    if (data.MessageId === 'UI_Share' || data.Values?.Clicked === 'Share') {
      handleShare();
    } else if (data.MessageId === 'UI_Close' || data.Values?.Clicked === 'Close') {
      navigate('/');
    } else if (data.MessageId === 'App_LoadingStatus' && data.Values?.Status === 'Document_Loaded') {
      console.log('Document loaded in Collabora');
    }
  }, [navigate]);

  useEffect(() => {
    // Add message listener for Collabora PostMessage
    window.addEventListener('message', handleCollaboraMessage);
    return () => window.removeEventListener('message', handleCollaboraMessage);
  }, [handleCollaboraMessage]);

  useEffect(() => {
    const fetchEditUrl = async () => {
      try {
        const response = await api.get(`/files/${fileId}/edit`);
        setFile({
          id: fileId,
          name: response.data.fileName,
          permission: response.data.permission
        });
        setEditUrl(response.data.editUrl);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load document');
        toast.error('Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchEditUrl();
  }, [fileId]);

  // Handle share button click
  const handleShare = async () => {
    setShowShareModal(true);
    setShareLoading(true);
    try {
      // Get or create share link
      const response = await api.post(`/files/${fileId}/share`, {
        permission: 'view',
        isPublic: true
      });
      setShareData(response.data);
    } catch (err) {
      toast.error('Failed to create share link');
      console.error('Share error:', err);
    } finally {
      setShareLoading(false);
    }
  };

  // Copy share link to clipboard
  const copyShareLink = () => {
    if (shareData?.shareUrl) {
      navigator.clipboard.writeText(shareData.shareUrl);
      toast.success('Link copied to clipboard!');
    }
  };

  // Create edit share link
  const createEditLink = async () => {
    setShareLoading(true);
    try {
      const response = await api.post(`/files/${fileId}/share`, {
        permission: 'edit',
        isPublic: true
      });
      setShareData(response.data);
      toast.success('Edit link created!');
    } catch (err) {
      toast.error('Failed to create edit link');
    } finally {
      setShareLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await api.get(`/files/${fileId}/download`, {
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
          <p className="text-gray-600">Loading document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Document</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 h-16 flex items-center px-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center text-gray-600 hover:text-gray-900 mr-4"
        >
          <ArrowLeft className="h-5 w-5 mr-1" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-medium text-gray-900 truncate">
            {file?.name || 'Document'}
          </h1>
          <p className="text-xs text-gray-500">
            {file?.permission === 'edit' ? 'Editing' : 'View only'}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleDownload}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            title="Download"
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            onClick={handleShare}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            title="Share"
          >
            <Share2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Share Document</h2>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {shareLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : shareData ? (
                <div className="space-y-4">
                  {/* Share Link */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Link className="h-4 w-4 inline mr-1" />
                      Share Link ({shareData.permission === 'edit' ? 'Can Edit' : 'View Only'})
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareData.shareUrl}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                      />
                      <button
                        onClick={copyShareLink}
                        className="p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        title="Copy link"
                      >
                        <Copy className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Permission Options */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleShare()}
                      disabled={shareData.permission === 'view'}
                      className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors
                        ${shareData.permission === 'view' 
                          ? 'bg-primary-100 text-primary-700 border-2 border-primary-500' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      View Only
                    </button>
                    <button
                      onClick={createEditLink}
                      disabled={shareData.permission === 'edit'}
                      className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors
                        ${shareData.permission === 'edit' 
                          ? 'bg-primary-100 text-primary-700 border-2 border-primary-500' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      Can Edit
                    </button>
                  </div>

                  {/* Quick Share Options */}
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-3">Quick Share</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          window.open(`mailto:?subject=Shared Document: ${file?.name}&body=View this document: ${shareData.shareUrl}`, '_blank');
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm"
                      >
                        <Mail className="h-4 w-4" />
                        Email
                      </button>
                      <button
                        onClick={copyShareLink}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm"
                      >
                        <Copy className="h-4 w-4" />
                        Copy Link
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Unable to create share link</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Collabora iframe */}
      <div className="flex-1">
        {editUrl && (
          <iframe
            ref={iframeRef}
            src={editUrl}
            className="collabora-frame"
            title="Collabora Online Editor"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>
    </div>
  );
}
