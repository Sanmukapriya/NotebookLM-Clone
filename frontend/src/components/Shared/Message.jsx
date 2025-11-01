import React from "react";
import ReactMarkdown from "react-markdown";
import "./Message.css";

function Message({ message }) {
  if (message.type === "user") {
    return (
      <div className="message user">
        <div className="user-message">
          <div className="message-bubble">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.type === "bot") {
    return (
      <div className="message bot">
        <div className="bot-message">
          <div className="message-bubble">
            <div className="message-content">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default Message;