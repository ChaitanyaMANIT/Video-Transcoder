import { useState, useEffect } from 'react';
import axios from 'axios';
import './index.css';

const API_URL = 'http://localhost:3000';

function App() {
  const [file, setFile] = useState(null);
  const [videos, setVideos] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Load videos when the page opens
  useEffect(() => {
    fetchVideos();

    // Check for updates every 3 seconds (Polling)
    // This makes the UI feel "real-time" without needing complex WebSockets
    const interval = setInterval(fetchVideos, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchVideos = async () => {
    try {
      const response = await axios.get(`${API_URL}/videos`);
      setVideos(response.data);
    } catch (error) {
      console.error("Error fetching videos:", error);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please select a video file!");

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // 1. Get the VIP Pass (Presigned URL) from our backend
      const { data } = await axios.get(`${API_URL}/get-upload-url`);
      const { videoId, uploadUrl, originalKey } = data;

      // 2. Upload the file DIRECTLY to AWS S3 using the VIP Pass
      // We use axios so we can track the exact upload progress (0 to 100%)
      await axios.put(uploadUrl, file, {
        headers: {
          'Content-Type': file.type,
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      // 3. Tell our backend that the upload is finished so it saves it to the database
      await axios.post(`${API_URL}/videos`, {
        videoId: videoId,
        title: file.name,
        originalKey: originalKey
      });

      // Reset the form
      setFile(null);
      fetchVideos();
      alert("Video uploaded successfully!");

    } catch (error) {
      console.error("Upload failed:", error);
      alert("Upload failed. Make sure your AWS keys and CORS are set up!");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Video Transcoder</h1>
        <p>Upload a high-quality video and we will automatically convert it!</p>
      </header>

      {/* The Upload Form */}
      <div className="card upload-card">
        <h2>Upload New Video</h2>
        <form onSubmit={handleUpload}>
          <input
            type="file"
            accept="video/mp4,video/x-m4v,video/*"
            onChange={(e) => setFile(e.target.files[0])}
            disabled={isUploading}
          />
          <button type="submit" disabled={isUploading || !file}>
            {isUploading ? `Uploading... ${uploadProgress}%` : 'Upload to AWS S3'}
          </button>
        </form>

        {isUploading && (
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
          </div>
        )}
      </div>

      {/* The List of Videos */}
      <div className="video-list">
        <h2>Your Videos</h2>
        {videos.length === 0 && <p className="empty-state">No videos uploaded yet.</p>}

        <div className="grid">
          {videos.map(video => (
            <div key={video.id} className="card video-card">
              {/* Thumbnail Container */}
              <div className="video-thumbnail-container">
                {video.thumbnailUrl ? (
                  <img src={video.thumbnailUrl} className="video-thumbnail" alt={video.title} />
                ) : (
                  <div className="thumbnail-placeholder">
                    {video.status === 'Pending' && (
                      <>
                        <div className="spinner"></div>
                        <span>Waiting...</span>
                      </>
                    )}
                    {video.status === 'Transcoding' && (
                      <>
                        <div className="spinner"></div>
                        <span>Generating preview...</span>
                      </>
                    )}
                    {video.status === 'Failed' && (
                      <span>❌ Error generating preview</span>
                    )}
                  </div>
                )}
              </div>

              <h3>{video.title}</h3>
              
              {/* Status Badge */}
              <div className={`status-badge status-${video.status.toLowerCase()}`}>
                {video.status}
              </div>

              {/* Transcoding Progress Bar */}
              {video.status === 'Transcoding' && (
                <div className="transcode-progress-section">
                  <div className="transcode-progress-label">
                    <span className="pulse">Processing video...</span>
                    <span>{video.transcodeProgress}%</span>
                  </div>
                  <div className="progress-bar-container">
                    <div className="progress-bar" style={{ width: `${video.transcodeProgress}%` }}></div>
                  </div>
                </div>
              )}

              <p className="date">Uploaded: {new Date(video.createdAt).toLocaleString()}</p>

              {/* Download Buttons */}
              {video.status === 'Completed' && video.downloadUrls && (
                <div className="download-section">
                  <h4>Download Resolutions</h4>
                  <div className="download-buttons">
                    {video.downloadUrls['360p'] && (
                      <a href={video.downloadUrls['360p']} target="_blank" rel="noopener noreferrer" className="download-btn">
                        360p
                      </a>
                    )}
                    {video.downloadUrls['480p'] && (
                      <a href={video.downloadUrls['480p']} target="_blank" rel="noopener noreferrer" className="download-btn">
                        480p
                      </a>
                    )}
                    {video.downloadUrls['720p'] && (
                      <a href={video.downloadUrls['720p']} target="_blank" rel="noopener noreferrer" className="download-btn">
                        720p
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
