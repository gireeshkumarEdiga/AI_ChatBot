import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000/api/chats";

async function readJson(response) {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sendingRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadChats = useCallback(async () => {
    try {
      setLoadingChats(true);

      const response = await fetch(API_URL);
      const data = await readJson(response);

      setChats(data.Data || []);
    } catch (error) {
      setError(error.message || "Unable to load chats.");
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    loadChats();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadChats]);

  const openChat = async (chatId) => {
    if (sendingRef.current) return;

    try {
      setError("");
      setActiveChatId(chatId);
      setMessages([]);
      setLoadingMessages(true);

      const response = await fetch(`${API_URL}/${chatId}`);
      const data = await readJson(response);

      setMessages(data.Data.messages || []);
    } catch (error) {
      setError(error.message || "Unable to open this chat.");
    } finally {
      setLoadingMessages(false);
    }
  };

  const createChat = async () => {
    if (sendingRef.current) return;

    try {
      setError("");

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const data = await readJson(response);
      const chat = data.Data;

      setChats((previous) => [
        {
          _id: chat._id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          messageCount: 0,
          lastMessage: "",
        },
        ...previous,
      ]);

      setActiveChatId(chat._id);
      setMessages([]);
      setInput("");
    } catch (error) {
      setError(error.message || "Unable to create a new chat.");
    }
  };

  const deleteChat = async (chatId) => {
    if (sendingRef.current) return;

    if (!window.confirm("Delete this conversation permanently?")) {
      return;
    }

    try {
      setError("");

      const response = await fetch(`${API_URL}/${chatId}`, {
        method: "DELETE",
      });

      await readJson(response);

      setChats((previous) =>
        previous.filter((chat) => chat._id !== chatId)
      );

      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
        setInput("");
      }
    } catch (error) {
      setError(error.message || "Unable to delete this chat.");
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    const text = input.trim();

    if (!text || sendingRef.current) return;

    setError("");

    let chatId = activeChatId;

    // Automatically create a chat when the user starts from the welcome screen.
    if (!chatId) {
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        const data = await readJson(response);
        chatId = data.Data._id;

        setActiveChatId(chatId);
        setChats((previous) => [
          {
            _id: chatId,
            title: "New Chat",
            createdAt: data.Data.createdAt,
            updatedAt: data.Data.updatedAt,
            messageCount: 0,
            lastMessage: "",
          },
          ...previous,
        ]);
      } catch (error) {
        setError(error.message || "Unable to create a conversation.");
        return;
      }
    }

    sendingRef.current = true;
    setSending(true);
    setInput("");

    const userMessage = {
      _id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    const assistantMessageId = `assistant-${Date.now()}`;

    const assistantPlaceholder = {
      _id: assistantMessageId,
      role: "assistant",
      content: "",
    };

    setMessages((previous) => [
      ...previous,
      userMessage,
      assistantPlaceholder,
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let completed = false;
    let streamError = "";

    try {
      const response = await fetch(
        `${API_URL}/${chatId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ message: text }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Unable to send message.");
      }

      if (!response.body) {
        throw new Error("Your browser does not support response streaming.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      const processEvent = (eventText) => {
        const dataLines = eventText
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) return;

        let event;

        try {
          event = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }

        if (event.type === "token") {
          setMessages((previous) =>
            previous.map((item) =>
              item._id === assistantMessageId
                ? {
                    ...item,
                    content: item.content + event.content,
                  }
                : item
            )
          );
        }

        if (event.type === "done") {
          completed = true;
        }

        if (event.type === "error") {
          streamError = event.message || "The AI response failed.";
        }
      };

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventText of events) {
          processEvent(eventText);
        }
      }

      if (buffer.trim()) {
        processEvent(buffer);
      }

      if (!completed && !streamError) {
        throw new Error("The stream ended before the response completed.");
      }

      if (streamError) {
        setError(streamError);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setError(error.message || "Something went wrong.");
      }
    } finally {
      abortControllerRef.current = null;
      sendingRef.current = false;
      setSending(false);

      // Reload persisted conversation history and titles.
      try {
        const [chatResponse, messageResponse] = await Promise.all([
          fetch(API_URL),
          fetch(`${API_URL}/${chatId}`),
        ]);

        const [chatData, messageData] = await Promise.all([
          readJson(chatResponse),
          readJson(messageResponse),
        ]);

        setChats(chatData.Data || []);

        // Use the database copy once the stream has completed.
        if (completed) {
          setMessages(messageData.Data.messages || []);
        }
      } catch {
        // Keep the visible messages if refreshing history fails.
      }
    }
  };

  const cancelResponse = () => {
    abortControllerRef.current?.abort();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">AI</div>
          <div>
            <h1>AI Chatbot</h1>
            <p>Your AI assistant</p>
          </div>
        </div>

        <button
          className="new-chat-button"
          onClick={createChat}
          disabled={sending}
        >
          <span>＋</span> New chat
        </button>

        <div className="history-heading">Recent conversations</div>

        <div className="chat-list">
          {loadingChats && (
            <p className="muted sidebar-message">Loading chats...</p>
          )}

          {!loadingChats && chats.length === 0 && (
            <p className="muted sidebar-message">
              Your conversations will appear here.
            </p>
          )}

          {chats.map((chat) => (
            <div
              key={chat._id}
              className={`chat-list-item ${
                activeChatId === chat._id ? "active" : ""
              }`}
            >
              <button
                className="chat-select"
                onClick={() => openChat(chat._id)}
                disabled={sending}
                title={chat.title}
              >
                <span className="chat-title">{chat.title}</span>
                {chat.lastMessage && (
                  <span className="chat-preview">{chat.lastMessage}</span>
                )}
              </button>

              <button
                className="delete-chat-button"
                onClick={() => deleteChat(chat._id)}
                disabled={sending}
                title="Delete conversation"
                aria-label={`Delete ${chat.title}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          MERN + OpenAI
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <strong>
              {chats.find((chat) => chat._id === activeChatId)?.title ||
                "New conversation"}
            </strong>
            <p>Ask questions, explore ideas, and learn.</p>
          </div>

          <button
            className="topbar-button"
            onClick={createChat}
            disabled={sending}
          >
            + New chat
          </button>
        </header>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        <section className="messages-area">
          {!activeChatId && messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon">✦</div>
              <h2>How can I help you today?</h2>
              <p>
                Ask a question, learn something new, or brainstorm an idea.
              </p>

              <div className="suggestions">
                <button
                  onClick={() =>
                    setInput("Explain the MERN stack with a simple example.")
                  }
                >
                  <strong>Learn MERN</strong>
                  <span>Explain a technical concept</span>
                </button>

                <button
                  onClick={() =>
                    setInput("Give me 5 project ideas using AI and React.")
                  }
                >
                  <strong>Explore ideas</strong>
                  <span>Discover useful AI projects</span>
                </button>

                <button
                  onClick={() =>
                    setInput("Create a 7-day plan to learn Node.js.")
                  }
                >
                  <strong>Make a plan</strong>
                  <span>Break a goal into steps</span>
                </button>
              </div>
            </div>
          )}

          {loadingMessages && (
            <p className="muted loading-message">Loading conversation...</p>
          )}

          <div className="message-list">
            {messages.map((message) => (
              <article
                key={message._id}
                className={`message-row ${message.role}`}
              >
                <div className="avatar">
                  {message.role === "user" ? "You" : "AI"}
                </div>

                <div className="message-body">
                  <div className="message-author">
                    {message.role === "user" ? "You" : "Assistant"}
                  </div>

                  <div className="message-content">
                    {message.content ||
                      (sending && message.role === "assistant" ? (
                        <span className="typing">Thinking...</span>
                      ) : null)}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div ref={messagesEndRef} />
        </section>

        <footer className="composer-footer">
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();

                  if (!sending) {
                    event.currentTarget.form?.requestSubmit();
                  }
                }
              }}
              placeholder="Message AI Chatbot..."
              rows={2}
              maxLength={10000}
              disabled={sending}
              aria-label="Message"
            />

            {sending ? (
              <button
                type="button"
                className="send-button stop-button"
                onClick={cancelResponse}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!input.trim()}
              >
                ↑
              </button>
            )}
          </form>

          <p className="composer-note">
            AI can make mistakes. Check important information.
            {" "}Press Enter to send; Shift + Enter for a new line.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;