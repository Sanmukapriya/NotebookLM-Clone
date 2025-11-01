import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";
import "./PDFSection.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PDFSection = forwardRef(({ pdfUrl, totalPages, chatWidth }, ref) => {
  const pdfContainerRef = useRef(null);
  const pageRefs = useRef([]);
  const [renderedPages, setRenderedPages] = useState(new Set([1, 2, 3]));
  const [scale] = useState(1.0);

  // Expose scrollToPage function to parent component
  useImperativeHandle(ref, () => ({
    scrollToPage: (pageNum) => {
      if (pageNum >= 1 && pageNum <= totalPages) {
        // Ensure the page is rendered before scrolling
        setRenderedPages((prev) => new Set([...prev, pageNum]));
        setTimeout(() => {
          const pageEl = pageRefs.current[pageNum - 1];
          if (pageEl) {
            pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }));

  // Lazy-load with IntersectionObserver
  const observerRef = useRef(null);
  useEffect(() => {
    if (!pdfContainerRef.current || totalPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.pageNumber);
            if (pageNum) setRenderedPages((prev) => new Set([...prev, pageNum]));
          }
        });
      },
      { root: pdfContainerRef.current, rootMargin: "500px", threshold: 0.01 }
    );

    pageRefs.current.forEach((ref) => ref && observerRef.current.observe(ref));

    return () => observerRef.current?.disconnect();
  }, [totalPages]);

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

  const handleDocumentLoadSuccess = ({ numPages }) => {
    if (numPages > 50) setRenderedPages(new Set([1, 2, 3, 4, 5]));
    else setRenderedPages(new Set(Array.from({ length: numPages }, (_, i) => i + 1)));
  };

  return (
    <div className="pdf-section" style={{ width: `${100 - chatWidth}%` }}>
      <div className="pdf-container" ref={pdfContainerRef}>
        {pdfUrl ? (
          <Document
            file={pdfUrl}
            onLoadSuccess={handleDocumentLoadSuccess}
            loading={
              <div className="pdf-loading">
                <p>Loading PDF...</p>
              </div>
            }
            options={{
              cMapUrl: "https://unpkg.com/pdfjs-dist@3.11.174/cmaps/",
              cMapPacked: true,
              standardFontDataUrl: "https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/",
            }}
          >
            <div className="pdf-pages-container">
              {Array.from({ length: totalPages }, (_, index) => renderPage(index + 1))}
            </div>
          </Document>
        ) : (
          <div className="pdf-loading">
            <p>Loading PDF...</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default PDFSection;