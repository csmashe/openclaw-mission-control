"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StallState = "healthy" | "idle_warning" | "stalled" | "error" | "completed" | "archived" | "unknown";

interface Worker {
  agent: string;
  label: string | null;
  runId: string;
  status: string;
  stale: boolean;
  taskId: string | null;
  taskTitle: string | null;
  dispatchId: string | null;
  sessionKey: string | null;
  sessionId: string | null;
  lastActivityAt: string | null;
  activityType: string | null;
  context: string | null;
  triggerSource: string | null;
  elapsedMs: number | null;
  idleMs: number | null;
  stallState: StallState;
}

interface WhoWorkingResponse {
  ok?: boolean;
  generatedAt?: string;
  error?: string | null;
  workers?: Worker[];
}

const STALL_BADGE: Record<StallState, string> = {
  healthy: "bg-green-500/10 text-green-400 border-green-500/30",
  idle_warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  stalled: "bg-red-500/10 text-red-400 border-red-500/30",
  error: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  completed: "bg-primary/10 text-primary border-primary/30",
  archived: "bg-muted/60 text-muted-foreground border-border",
  unknown: "bg-muted text-muted-foreground border-border",
};

function formatDuration(ms: number | null): string {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatLastActivity(ts: string | null): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function workerSortBucket(status: string): number {
  const normalized = status.toLowerCase();
  if (normalized === "running") return 0;
  if (normalized === "completed" || normalized === "done" || normalized === "archived") return 2;
  return 1;
}

function compareWorkers(a: Worker, b: Worker): number {
  const bucketDiff = workerSortBucket(a.status) - workerSortBucket(b.status);
  if (bucketDiff !== 0) return bucketDiff;

  const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
  const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
  if (aTime !== bTime) return bTime - aTime;

  return (a.taskTitle || a.label || "").localeCompare(b.taskTitle || b.label || "");
}

export function WhoWorkingPanel() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkers = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/who-working", { cache: "no-store" });
      const data = (await res.json()) as WhoWorkingResponse;
      const incoming = Array.isArray(data.workers) ? [...data.workers].sort(compareWorkers) : [];
      setWorkers(incoming);
      setGeneratedAt(data.generatedAt ?? null);
      setError(data.error ?? null);
    } catch (err) {
      setError(`Unable to load Who's Working: ${String(err)}`);
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(() => fetchWorkers(), 10000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

  const summary = useMemo(() => {
    const running = workers.filter((w) => w.status === "running").length;
    const stalled = workers.filter((w) => w.stallState === "stalled").length;
    const history = workers.filter((w) => w.status !== "running").length;
    return { total: workers.length, running, stalled, history };
  }, [workers]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="rounded-lg border border-border bg-card/40 p-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Who&apos;s Working</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Live delegated worker activity inside Mission Control (open directly at
            <span className="font-mono"> /#who-working</span>).
            {generatedAt ? ` Last updated ${formatLastActivity(generatedAt)}.` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchWorkers(true)} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card/30 p-3">
          <p className="text-xs text-muted-foreground">Workers</p>
          <p className="text-xl font-semibold mt-1">{summary.total}</p>
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-3">
          <p className="text-xs text-muted-foreground">Running</p>
          <p className="text-xl font-semibold mt-1 text-green-400">{summary.running}</p>
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-3">
          <p className="text-xs text-muted-foreground">Stalled</p>
          <p className="text-xl font-semibold mt-1 text-red-400">{summary.stalled}</p>
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-3">
          <p className="text-xs text-muted-foreground">History</p>
          <p className="text-xl font-semibold mt-1 text-primary">{summary.history}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/30">
          <div className="col-span-3">Worker</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Activity</div>
          <div className="col-span-2">Elapsed</div>
          <div className="col-span-2">Idle</div>
          <div className="col-span-1">Run</div>
        </div>

        {loading ? (
          <div className="p-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading worker activity...
          </div>
        ) : workers.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">No active or recent workers found.</div>
        ) : (
          workers.map((worker) => {
            const stallState = worker.stallState || "unknown";
            const isRunning = worker.status === "running";
            return (
              <div key={worker.runId} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-border/60 last:border-b-0 text-sm">
                <div className="col-span-3 min-w-0">
                  <p className="font-medium truncate">{worker.taskTitle || worker.label || "Untitled task"}</p>
                  <p className="text-xs text-muted-foreground truncate">{worker.agent}</p>
                  <p className="text-[11px] text-muted-foreground/80 font-mono truncate" title={worker.sessionKey || undefined}>
                    {worker.sessionKey || "session:—"}
                  </p>
                </div>

                <div className="col-span-2 flex items-center gap-2">
                  {isRunning ? (
                    <Activity className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  )}
                  <Badge variant="outline" className={STALL_BADGE[stallState] || STALL_BADGE.unknown}>
                    {stallState.replace("_", " ")}
                  </Badge>
                </div>

                <div className="col-span-2">
                  <p className="font-mono text-xs">{worker.activityType || "unknown"}</p>
                  <p className="text-xs text-muted-foreground">{formatLastActivity(worker.lastActivityAt)}</p>
                </div>

                <div className="col-span-2 font-mono text-xs flex items-center">{formatDuration(worker.elapsedMs)}</div>
                <div className="col-span-2 font-mono text-xs flex items-center">{formatDuration(worker.idleMs)}</div>
                <div className="col-span-1 font-mono text-xs text-muted-foreground truncate" title={worker.runId}>
                  {worker.runId.slice(0, 8)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
