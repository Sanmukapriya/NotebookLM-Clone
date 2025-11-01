import React, { useState, useRef, useCallback, useEffect } from "react";
import UploadScreen from "./components/UploadScreen/UploadScreen";
import ChatSection from "./components/Chat/ChatSection";
import PDFSection from "./components/PDFViewer/PDFSection";
import "./App.css";

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
  const [chatWidth, setChatWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [showBanner, setShowBanner] = useState(true);

  const containerRef = useRef(null);
  const pdfSectionRef = useRef(null);

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

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
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const scrollToPage = useCallback((pageNum) => {
    if (pdfSectionRef.current) {
      pdfSectionRef.current.scrollToPage(pageNum);
    }
  }, []);

  const removePdf = () => {
    setPdfFile(null);
    setPdfUrl(null);
    setDocumentId(null);
    setMessages([]);
    setTotalPages(0);
    setShowBanner(true);
    setChatWidth(50);
  };

  return (
    <div className="app-container">
      {!pdfFile && (
        <UploadScreen
          setPdfFile={setPdfFile}
          setPdfUrl={setPdfUrl}
          setDocumentId={setDocumentId}
          setTotalPages={setTotalPages}
          setMessages={setMessages}
          isUploading={isUploading}
          setIsUploading={setIsUploading}
          uploadProgress={uploadProgress}
          setUploadProgress={setUploadProgress}
        />
      )}

      {pdfFile && (
        <div className="main-layout" ref={containerRef}>
          <ChatSection
            chatWidth={chatWidth}
            messages={messages}
            setMessages={setMessages}
            inputMessage={inputMessage}
            setInputMessage={setInputMessage}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
            documentId={documentId}
            removePdf={removePdf}
            showBanner={showBanner}
            setShowBanner={setShowBanner}
            pdfFile={pdfFile}
            scrollToPage={scrollToPage}
          />
          
          <div
            className={`resizer ${isResizing ? "resizing" : ""}`}
            onMouseDown={() => setIsResizing(true)}
          />
          
          <PDFSection
            ref={pdfSectionRef}
            pdfUrl={pdfUrl}
            totalPages={totalPages}
            chatWidth={chatWidth}
          />
        </div>
      )}
    </div>
  );
}

export default App;