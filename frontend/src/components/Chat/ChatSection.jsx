import React, { useRef, useEffect } from "react";
import { Send, FileText, X } from "lucide-react";
import { Loader2 } from "lucide-react";
import "./ChatSection.css";

function ChatSection({
  chatWidth,
  messages,
  setMessages,
  inputMessage,
  setInputMessage,
  isLoading,
  setIsLoading,
  documentId,
  removePdf,
  showBanner,
  setShowBanner,
  pdfFile,
  scrollToPage,
}) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !documentId || isLoading) return;

    const userMessage = { type: "user", content: inputMessage };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = inputMessage;
    setInputMessage("");
    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentInput, documentId }),
      });
      const data = await res.json();

      if (data.success) {
        setMessages((prev) => [
          ...prev,
          {
            type: "bot",
            content: data.response,
            citations: data.citations || [],
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: "bot", content: `Error: ${data.error}` },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          type: "bot",
          content: "Connection error. Check if backend is running.",
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
                {trimmed}
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

  return (
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
            <button onClick={() => setShowBanner(false)} className="remove-btn">
              <X size={16} />
            </button>
          </div>
          <div className="suggested-questions">
            {[
              "What is the main topic of this document?",
              "Can you summarize the key points?",
              "What are the conclusions or recommendations?",
            ].map((q, i) => (
              <button
                key={i}
                onClick={() => setInputMessage(q)}
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
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatSection;