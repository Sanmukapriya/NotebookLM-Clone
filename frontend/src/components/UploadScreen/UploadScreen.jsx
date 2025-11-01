// UploadScreen.jsx
import React, { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import "./UploadScreen.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function UploadScreen({
  setPdfFile,
  setPdfUrl,
  setDocumentId,
  setTotalPages,
  setMessages,
  isUploading,
  setIsUploading,
  uploadProgress,
  setUploadProgress,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      handleFileUpload(file);
    } else {
      setError("Please upload a PDF file");
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("File size exceeds 100MB limit");
      setTimeout(() => setError(null), 5000);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setPdfFile(file);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, { method: "POST", body: formData });
      const data = await response.json();
      if (data.success) {
        setDocumentId(data.documentId);
        setTotalPages(data.totalPages || 0);
        setPdfUrl(`${API_URL}${data.pdfUrl}`);
        setMessages([
          {
            type: "system",
            content: `Document uploaded: ${data.totalPages} pages, ${data.totalChunks} chunks`,
          },
        ]);
        setUploadProgress(100);
      }
    } catch {
      setError("Upload failed. Make sure backend is running.");
      setPdfFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="upload-screen">
      <div
        className={`upload-area ${isDragging ? "dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <div className="upload-icon">
          {isUploading ? <Loader2 size={48} className="spinner" /> : <Upload size={32} />}
        </div>
        <h2>{isUploading ? "Processing PDF..." : "Upload PDF to start chatting"}</h2>
        <p>{isUploading ? "This may take a moment for large files..." : "Click or drag and drop your file here"}</p>

        {isUploading && uploadProgress > 0 && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0])}
          style={{ display: "none" }}
        />
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}

export default UploadScreen;