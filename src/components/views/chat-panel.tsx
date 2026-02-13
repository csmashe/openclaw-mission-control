"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Plus, Bot, User, Loader2, RefreshCw } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

/** Strip <think>...</think> blocks and <final>...</final> wrapper tags from model output */
function cleanText(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<\/?final>/gi, "");
  return cleaned.trim();
}

function extractText(content: unknown): string {
  if (typeof content === "string") return cleanText(content);
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        // Handle { type: "text", text: "..." }
        if (block.text) parts.push(block.text);
        // Handle { type: "thinking", thinking: "..." } — skip thinking blocks
        // Handle { content: "..." } or { content: [...] }
        else if (block.content) {
          const inner = extractText(block.content);
          if (inner) parts.push(inner);
        }
      }
    }
    const joined = parts.join("\n");
    return cleanText(joined);
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (obj.text) return cleanText(String(obj.text));
    if (obj.content) return extractText(obj.content);
  }
  return cleanText(String(content ?? ""));
}

const SESSION_KEY = "mission-control:general-chat";

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [sessionKey, setSessionKey] = useState(SESSION_KEY);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/chat?sessionKey=${encodeURIComponent(sessionKey)}&limit=50`);
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
      setError(null);
    } catch (err) {
      setError("Failed to load chat history");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionKey }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.reply) {
        setMessages((prev) => [...prev, data.reply]);
      } else if (data.timeout) {
        setError("Agent is still processing. Refresh to check for updates.");
      }

      await fetchHistory();
    } catch (err) {
      setError("Failed to send message");
      console.error(err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewSession = async () => {
    const newKey = `mission-control:chat-${Date.now()}`;
    setSessionKey(newKey);
    setMessages([]);
    setError(null);
  };

  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{ flexShrink: 0 }}
        className="flex items-center justify-between px-6 py-4 border-b border-border"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Agent Chat</h2>
            <p className="text-xs text-muted-foreground">
              Direct conversation with your AI agent
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchHistory}
            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={startNewSession}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 border border-border transition-all"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
      </div>

      {/* Messages — scrollable middle */}
      <div
        ref={scrollContainerRef}
        style={{ flex: "1 1 0%", overflowY: "auto", minHeight: 0 }}
        className="px-6 py-4 space-y-4"
      >
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading conversation…
          </div>
        )}

        {!loading && visibleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-primary/60" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">
              Start a conversation
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Chat directly with your agent. Ask questions, give instructions, or
              just say hello.
            </p>
          </div>
        )}

        {visibleMessages.map((msg, i) => {
          const isUser = msg.role === "user";
          const text = extractText(msg.content);
          const time = msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null;

          return (
            <div
              key={i}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isUser
                    ? "bg-primary/20 text-primary"
                    : "bg-emerald-500/10 text-emerald-400"
                }`}
              >
                {isUser ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>
              {/* Bubble */}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                  isUser
                    ? "bg-primary text-primary-foreground rounded-tr-md"
                    : "bg-card border border-border rounded-tl-md"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                  {text || (
                    <span className="text-muted-foreground italic">
                      (empty response)
                    </span>
                  )}
                </div>
                {time && (
                  <div
                    className={`text-[10px] mt-1 ${
                      isUser
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground"
                    }`}
                  >
                    {time}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Sending indicator */}
        {sending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Agent is thinking…
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-md text-center text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Input — pinned bottom */}
      <div
        style={{ flexShrink: 0 }}
        className="px-6 py-4 border-t border-border"
      >
        <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 focus-within:border-primary/50 focus-within:shadow-[0_0_10px_oklch(0.58_0.2_260/0.15)] transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={sending}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none max-h-32 py-1.5 disabled:opacity-50"
            style={{ minHeight: "24px" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-30 hover:bg-primary/90 transition-all shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
