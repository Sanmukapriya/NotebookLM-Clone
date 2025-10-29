import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload,
  Send,
  FileText,
  Loader2,
  X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Document, Page, pdfjs } from "react-pdf";
import "./App.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);
  const [showBanner, setShowBanner] = useState(true);
  const [chatWidth, setChatWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [renderedPages, setRenderedPages] = useState(new Set([1, 2, 3]));

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const pdfContainerRef = useRef(null);
  const pageRefs = useRef([]);
  const containerRef = useRef(null);
  const observerRef = useRef(null);

  // Initialize page refs
  useEffect(() => {
    if (totalPages > 0) {
      pageRefs.current = pageRefs.current.slice(0, totalPages);
    }
  }, [totalPages]);

  // Auto scroll to latest message
  useEffect(() => {
    if (messages.length > 1) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth =
        ((e.clientX - containerRect.left) / containerRect.width) * 100;

      if (newWidth > 20 && newWidth < 80) {
        setChatWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Intersection Observer for lazy loading pages
  useEffect(() => {
    if (!pdfContainerRef.current || totalPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.pageNumber);
            if (pageNum) {
              setRenderedPages((prev) => new Set([...prev, pageNum]));
            }
          }
        });
      },
      {
        root: pdfContainerRef.current,
        rootMargin: "500px", 
        threshold: 0.01,
      }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [totalPages]);

  // Observe page elements
  useEffect(() => {
    const observer = observerRef.current;
    if (!observer) return;

    pageRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      pageRefs.current.forEach((ref) => {
        if (ref) observer.unobserve(ref);
      });
    };
  }, [totalPages, pageRefs.current]);

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
    setError(null);
    setUploadProgress(0);
    setPdfFile(file);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

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
    } catch (err) {
      setError(
        "Upload failed. Make sure the backend is running on port 5000."
      );
      setPdfFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !documentId || isLoading) return;

    const userMessage = { type: "user", content: inputMessage };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = inputMessage;
    setInputMessage("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentInput, documentId }),
      });

      const data = await res.json();

      if (data.success) {
        const botMessage = {
          type: "bot",
          content: data.response,
          citations: data.citations || [],
          metadata: data.metadata,
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: "bot", content: `Error: ${data.error}` },
        ]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          type: "bot",
          content:
            "Connection error. Please check if the backend is running.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatBotMessage = (content, citations = []) => {
    if (!content) return null;

    const paragraphs = content.split(/\n\n+/);

    return (
      <div>
        {paragraphs.map((para, idx) => {
          const trimmed = para.trim();
          if (!trimmed) return null;

          const lines = trimmed.split("\n");
          let messageContent = null;

          if (lines.length > 1 && lines[0].match(/^\d+\./)) {
            messageContent = (
              <ol key={idx} className="formatted-list">
                {lines.map((line, i) => {
                  const cleaned = line.replace(/^\d+\.\s*/, "");
                  return cleaned ? <li key={i}>{cleaned}</li> : null;
                })}
              </ol>
            );
          } else if (lines.length > 1 && lines[0].match(/^[•\-*]/)) {
            messageContent = (
              <ul key={idx} className="formatted-list">
                {lines.map((line, i) => {
                  const cleaned = line.replace(/^[•\-*]\s*/, "");
                  return cleaned ? <li key={i}>{cleaned}</li> : null;
                })}
              </ul>
            );
          } else {
            messageContent = (
              <div key={idx} className="message-paragraph">
                <ReactMarkdown>{trimmed}</ReactMarkdown>
              </div>
            );
          }

          return messageContent;
        })}

        {citations.length > 0 && (
          <div className="citation-buttons">
            {citations.map((c, i) => (
              <button
                key={i}
                onClick={() => scrollToPage(c)}
                className="citation-btn"
              >
                Page {c}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const scrollToPage = useCallback((pageNum) => {
    const pageEl = pageRefs.current[pageNum - 1];
    if (pageEl) {
      // Ensure the page is rendered before scrolling
      setRenderedPages((prev) => new Set([...prev, pageNum]));
      setTimeout(() => {
        pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
        setCurrentPage(pageNum);
      }, 100);
    }
  }, []);

  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      scrollToPage(pageNum);
    }
  };

  const removePdf = () => {
    setPdfFile(null);
    setPdfUrl(null);
    setDocumentId(null);
    setMessages([]);
    setTotalPages(0);
    setError(null);
    setShowBanner(true);
    setChatWidth(50);
    setRenderedPages(new Set([1, 2, 3]));
    setCurrentPage(1);
    setScale(1.0);
  };

  const handleDocumentLoadSuccess = useCallback(({ numPages }) => {
    setTotalPages(numPages);
    // For large PDFs, only render first few pages initially
    if (numPages > 50) {
      setRenderedPages(new Set([1, 2, 3, 4, 5]));
    } else {
      // For smaller PDFs, render all pages
      setRenderedPages(new Set(Array.from({ length: numPages }, (_, i) => i + 1)));
    }
  }, []);

  // Custom page renderer with canvas optimization
  const renderPage = useCallback(
    (pageNumber) => {
      const shouldRender = renderedPages.has(pageNumber) || totalPages <= 50;

      return (
        <div
          key={`page_${pageNumber}`}
          className="pdf-page-wrapper"
          ref={(el) => (pageRefs.current[pageNumber - 1] = el)}
          data-page-number={pageNumber}
        >
          <div className="page-number-badge">Page {pageNumber}</div>
          {shouldRender ? (
            <Page
              pageNumber={pageNumber}
              className="pdf-page"
              renderTextLayer={false}
              renderAnnotationLayer={false}
              scale={scale}
              loading={
                <div className="page-loading">
                  <Loader2 size={20} className="spinner" />
                </div>
              }
              // Fix canvas warning by setting willReadFrequently
              canvasBackground="white"
            />
          ) : (
            <div className="page-placeholder">
              <Loader2 size={24} className="spinner" />
              <p>Loading page {pageNumber}...</p>
            </div>
          )}
        </div>
      );
    },
    [renderedPages, scale, totalPages]
  );

  const suggestedQuestions = [
    "What is this document about?",
    "Summarize the main points",
    "What are the key findings?",
    "List the main topics covered",
  ];

  return (
    <div className="app-container">
      {!pdfFile && (
        <div className="upload-screen">
          <div
            className={`upload-area ${isDragging ? "dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div
              className="upload-content"
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              <div className="upload-icon">
                {isUploading ? (
                  <Loader2 size={48} className="spinner" />
                ) : (
                  <Upload size={32} />
                )}
              </div>
              <h2>
                {isUploading
                  ? "Processing PDF..."
                  : "Upload PDF to start chatting"}
              </h2>
              <p>
                {isUploading
                  ? "This may take a moment for large files..."
                  : "Click or drag and drop your file here"}
              </p>

              {isUploading && uploadProgress > 0 && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) =>
                  e.target.files[0] && handleFileUpload(e.target.files[0])
                }
                style={{ display: "none" }}
              />
            </div>
          </div>
        </div>
      )}

      {pdfFile && (
        <div className="main-layout" ref={containerRef}>
          <div className="chat-section" style={{ width: `${chatWidth}%` }}>
            <div className="chat-header">
              <div className="doc-info">
                <FileText size={25} />
                <div className="doc-details">
                  <h3>{pdfFile.name}</h3>
                </div>
              </div>
              <button
                onClick={removePdf}
                className="remove-btn"
                title="Remove document"
              >
                <X size={20} />
              </button>
            </div>

            {showBanner && messages.length <= 2 && (
              <div className="welcome-banner">
                <div className="banner-header">
                  <div className="banner-text">
                    <h4>Your document is ready!</h4>
                    <h5>Ask questions about your document:</h5>
                  </div>
                  <button
                    onClick={() => setShowBanner(false)}
                    className="remove-btn"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="suggested-questions">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInputMessage(q);
                      }}
                      className="suggestion-btn"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="chat-messages">
              {messages
                .filter((m) => m.type !== "system")
                .map((m, i) => (
                  <div key={i} className={`message ${m.type}`}>
                    {m.type === "user" && (
                      <div className="user-message">
                        <div className="message-bubble">{m.content}</div>
                      </div>
                    )}

                    {m.type === "bot" && (
                      <div className="bot-message">
                        <div className="message-bubble">
                          <div className="message-content">
                            {formatBotMessage(m.content, m.citations)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

              {isLoading && (
                <div className="bot-message">
                  <div className="loading-indicator">
                    <Loader2 size={18} className="spinner" />
                    <span>Analyzing document...</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-area">
              <div className="input-wrapper">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && !e.shiftKey && handleSendMessage()
                  }
                  placeholder="Ask about the document..."
                  disabled={isLoading}
                  className="chat-input"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoading}
                  className="send-button"
                  title="Send message"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>

          <div
            className={`resizer ${isResizing ? "resizing" : ""}`}
            onMouseDown={() => setIsResizing(true)}
          />

          <div
            className="pdf-section"
            style={{ width: `${100 - chatWidth}%` }}
          >
            <div className="pdf-container" ref={pdfContainerRef}>
              {pdfUrl ? (
                <Document
                  file={pdfUrl}
                  onLoadSuccess={handleDocumentLoadSuccess}
                  loading={
                    <div className="pdf-loading">
                      <Loader2 size={32} className="spinner" />
                      <p>Loading PDF...</p>
                    </div>
                  }
                  options={{
                    cMapUrl: "https://unpkg.com/pdfjs-dist@3.11.174/cmaps/",
                    cMapPacked: true,
                    standardFontDataUrl:
                      "https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/",
                  }}
                >
                  <div className="pdf-pages-container">
                    {Array.from({ length: totalPages }, (_, index) =>
                      renderPage(index + 1)
                    )}
                  </div>
                </Document>
              ) : (
                <div className="pdf-loading">
                  <Loader2 size={32} className="spinner" />
                  <p>Loading PDF...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;