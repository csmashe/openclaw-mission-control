"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, Loader2 } from "lucide-react";
import type { OpenClawSession } from "@/lib/db";
import { timeAgo } from "@/lib/helpers";

export function SubAgentsList({ taskId }: { taskId: string }) {
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/subagent`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {
      // retry on next interval
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading sub-agents...</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No sub-agents spawned for this task.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`p-3 rounded-md border text-sm ${
            session.status === "active"
              ? "bg-primary/5 border-primary/20"
              : "bg-muted border-border"
          }`}
        >
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="font-medium">{session.agent_id || "Sub-Agent"}</span>
            <span
              className={`ml-auto px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                session.status === "active"
                  ? "bg-green-500/10 text-green-500"
                  : "bg-muted-foreground/10 text-muted-foreground"
              }`}
            >
              {session.status}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono truncate">
            {session.openclaw_session_id}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Started {timeAgo(session.created_at)}
            {session.ended_at && ` · Ended ${timeAgo(session.ended_at)}`}
          </div>
        </div>
      ))}
    </div>
  );
}
