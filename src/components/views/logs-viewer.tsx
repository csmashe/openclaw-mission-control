"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  Loader2,
  Pause,
  Play,
  Search,
  Trash2,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";

interface LogLine {
  id: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

const LEVEL_STYLES: Record<string, { color: string; bg: string }> = {
  INFO: { color: "text-foreground", bg: "bg-primary/10 text-primary" },
  WARN: { color: "text-yellow-400", bg: "bg-yellow-500/10 text-yellow-500" },
  ERROR: { color: "text-red-400", bg: "bg-red-500/10 text-red-400" },
  DEBUG: { color: "text-muted-foreground", bg: "bg-muted text-muted-foreground" },
};

function parseLogLines(raw: unknown): LogLine[] {
  if (!raw) return [];

  // If it's already an array of objects
  if (Array.isArray(raw)) {
    return raw.map((item, i) => {
      if (typeof item === "string") return parseStringLine(item, i);
      return {
        id: i,
        timestamp: item.timestamp || item.ts || new Date().toISOString(),
        level: (item.level || item.severity || "INFO").toUpperCase() as LogLine["level"],
        message: item.message || item.msg || item.text || JSON.stringify(item),
      };
    });
  }

  // If it's a string (newline-separated)
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((line, i) => parseStringLine(line, i));
  }

  // If it's an object with a lines/entries key
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.lines) return parseLogLines(obj.lines);
    if (obj.entries) return parseLogLines(obj.entries);
    if (obj.logs) return parseLogLines(obj.logs);
    // Single log object
    return [
      {
        id: 0,
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: JSON.stringify(raw, null, 2),
      },
    ];
  }

  return [];
}

function parseStringLine(line: string, id: number): LogLine {
  // Try to parse structured log: "2026-01-16 14:30:00 [INFO] message"
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?)\s*\[?(INFO|WARN|WARNING|ERROR|DEBUG|ERR)\]?\s*(.*)$/i
  );
  if (match) {
    return {
      id,
      timestamp: match[1],
      level: (match[2] === "WARNING" ? "WARN" : match[2] === "ERR" ? "ERROR" : match[2]).toUpperCase() as LogLine["level"],
      message: match[3],
    };
  }
  // Fallback: detect level from content
  let level: LogLine["level"] = "INFO";
  if (/\b(error|err|fatal|panic)\b/i.test(line)) level = "ERROR";
  else if (/\b(warn|warning)\b/i.test(line)) level = "WARN";
  else if (/\b(debug|trace)\b/i.test(line)) level = "DEBUG";

  return {
    id,
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    level,
    message: line,
  };
}

export function LogsViewer() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Set<string>>(
    new Set(["INFO", "WARN", "ERROR"])
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);

  const fetchLogs = useCallback(async () => {
    if (paused) return;

    try {
      const res = await fetch("/api/openclaw/logs");
      if (!res.ok) throw new Error(`Failed to fetch logs (${res.status})`);

      const data = await res.json();
      const parsed = parseLogLines(data.logs);

      // Assign unique IDs and append
      const newLines = parsed.map((l) => ({
        ...l,
        id: logIdCounter.current++,
      }));

      setLogs((prev) => {
        const combined = [...prev, ...newLines];
        // Keep last 500 lines
        return combined.slice(-500);
      });
    } finally {
      setLoading(false);
    }
  }, [paused]);

  useAdaptivePolling({
    poll: fetchLogs,
    intervalMs: 5_000,
    hiddenIntervalMs: 20_000,
    maxBackoffMs: 60_000,
    enabled: !paused,
  });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const toggleFilter = (level: string) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const filteredLogs = logs.filter((log) => {
    if (!filters.has(log.level)) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts.slice(11, 19) || ts;
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border bg-card/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Live Logs</h2>
          </div>
          {!paused && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Streaming
            </span>
          )}
          {paused && (
            <Badge variant="secondary" className="text-xs">Paused</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="pl-8 pr-3 py-1.5 bg-background border border-border rounded text-xs w-48 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-1">
            {(["INFO", "WARN", "ERROR", "DEBUG"] as const).map((level) => {
              const active = filters.has(level);
              const style = LEVEL_STYLES[level];
              return (
                <button
                  key={level}
                  onClick={() => toggleFilter(level)}
                  className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                    active ? style.bg : "bg-muted/50 text-muted-foreground/50"
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused(!paused)}
            className="h-7 w-7 p-0"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? (
              <Play className="w-3.5 h-3.5" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
            }}
            className="h-7 w-7 p-0"
            title="Scroll to bottom"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLogs([])}
            className="h-7 w-7 p-0"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-muted/50 font-mono text-xs leading-relaxed"
        onScroll={(e) => {
          const el = e.currentTarget;
          const isAtBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(isAtBottom);
        }}
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Connecting to log stream...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            {logs.length > 0
              ? "No logs match your filters"
              : "Waiting for log entries..."}
          </div>
        ) : (
          <div className="p-2">
            {filteredLogs.map((log) => {
              const style = LEVEL_STYLES[log.level] || LEVEL_STYLES.INFO;
              const highlighted =
                search && log.message.toLowerCase().includes(search.toLowerCase());
              return (
                <div
                  key={log.id}
                  className={`flex gap-3 px-2 py-0.5 hover:bg-primary/5 rounded ${
                    highlighted ? "bg-yellow-500/10" : ""
                  }`}
                >
                  <span className="text-muted-foreground shrink-0 w-16 text-right">
                    {formatTime(log.timestamp)}
                  </span>
                  <span
                    className={`shrink-0 w-11 font-bold ${style.color}`}
                  >
                    {log.level}
                  </span>
                  <span className={`${style.color} break-all`}>
                    {log.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer status */}
      <div className="px-4 py-1.5 border-t border-border bg-card/30 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
        <span>{filteredLogs.length} lines shown</span>
        <span>{autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}</span>
      </div>
    </div>
  );
}
