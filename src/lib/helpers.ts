import type { ColumnId } from "./types";

function parseTimestamp(dateStr: string): Date {
  const raw = String(dateStr || "").trim();
  const base = raw.includes("T") ? raw : raw.replace(" ", "T");

  // If timezone is already present, keep it as-is. If not, treat as UTC.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(base);
  const normalized = hasTimezone ? base : `${base}Z`;
  return new Date(normalized);
}

export function timeAgo(dateStr: string): string {
  const date = parseTimestamp(dateStr);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return "just now";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTime(dateStr: string): string {
  const date = parseTimestamp(dateStr);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function getColumnDotColor(id: ColumnId): string {
  switch (id) {
    case "inbox": return "bg-slate-400";
    case "planning": return "bg-violet-500";
    case "assigned": return "bg-primary/50";
    case "in_progress": return "bg-primary shadow-[0_0_8px_oklch(0.58_0.2_260)]";
    case "testing": return "bg-cyan-500";
    case "review": return "bg-purple-500";
    case "done": return "bg-green-500";
  }
}

export function getPriorityStyle(priority: string) {
  switch (priority) {
    case "urgent": return { className: "text-red-400 bg-red-400/10 border-red-400/20", label: "URGENT" };
    case "high": return { className: "text-red-400 bg-red-400/10 border-red-400/20", label: "HIGH" };
    case "medium": return { className: "text-orange-400 bg-orange-400/10 border-orange-400/20", label: "MED" };
    case "low": return { className: "text-primary bg-primary/10 border-primary/20", label: "LOW" };
    default: return { className: "text-slate-400 bg-slate-400/10 border-slate-400/20", label: priority.toUpperCase() };
  }
}

export function getActivityColor(type: string): string {
  if (type.includes("created")) return "text-primary font-bold";
  if (type.includes("assigned")) return "text-blue-400 font-bold";
  if (type.includes("progress")) return "text-green-500 font-bold";
  if (type.includes("review")) return "text-purple-400 font-bold";
  if (type.includes("deleted")) return "text-red-400 font-bold";
  if (type.includes("agent")) return "text-green-500 font-bold";
  return "text-primary font-bold";
}

export function getActivityLabel(type: string): string {
  if (type.includes("created")) return "Info:";
  if (type.includes("assigned")) return "Agent:";
  if (type.includes("progress")) return "Agent:";
  if (type.includes("review")) return "System:";
  if (type.includes("agent")) return "Agent:";
  return "System:";
}
