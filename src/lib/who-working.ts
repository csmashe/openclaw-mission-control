import { listTasks, type Task } from "@/lib/db";
import { getOpenClawClient, type OpenClawSession } from "@/lib/openclaw-client";

export type StallState = "healthy" | "idle_warning" | "stalled" | "completed" | "unknown";

export interface WhoWorkingWorker {
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
  elapsedMs: number | null;
  idleMs: number | null;
  stallState: StallState;
}

export interface WhoWorkingSnapshot {
  ok: boolean;
  generatedAt: string;
  workers: WhoWorkingWorker[];
  error?: string;
}

type ExtendedSession = OpenClawSession & {
  id?: string;
  status?: string;
  state?: string;
  runId?: string;
  activeRunId?: string;
  updatedAt?: string;
  updated_at?: string;
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;

  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;

  // SQLite datetime format: YYYY-MM-DD HH:mm:ss
  const sqlite = Date.parse(value.replace(" ", "T") + "Z");
  if (Number.isFinite(sqlite)) return sqlite;

  return null;
}

function deriveAgentName(session: ExtendedSession, task?: Task): string {
  if (session.agentId) return session.agentId;
  if (task?.assigned_agent_id) return task.assigned_agent_id;

  const key = session.key || task?.openclaw_session_key || "";
  const parts = key.split(":");
  if (parts.length >= 2 && parts[0] === "agent") return parts[1];

  return "unknown";
}

function deriveStatus(session: ExtendedSession, task?: Task): string {
  const raw = (session.status || session.state || "").toLowerCase().trim();
  if (raw) return raw;

  if (task?.status === "done") return "completed";
  if (task?.status === "review" || task?.status === "testing") return "running";
  if (task?.status === "in_progress" || task?.status === "assigned") return "running";

  return "unknown";
}

function deriveActivityType(task?: Task): string {
  if (!task) return "session";
  if (task.status === "testing") return "testing";
  if (task.status === "review") return "review";
  if (task.status === "done") return "completed";
  return "task_execution";
}

function deriveStallState(status: string, idleMs: number | null): StallState {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "done") return "completed";
  if (!idleMs || idleMs < 0) return "unknown";
  if (idleMs >= 20 * 60_000) return "stalled";
  if (idleMs >= 10 * 60_000) return "idle_warning";
  return "healthy";
}

function taskUpdatedAtIso(task?: Task): string | null {
  if (!task?.updated_at) return null;
  const ms = parseTimestamp(task.updated_at);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

export async function getWhoWorkingSnapshot(): Promise<WhoWorkingSnapshot> {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();

  const tasks = listTasks();
  const taskBySessionKey = new Map<string, Task>();
  for (const task of tasks) {
    if (task.openclaw_session_key) {
      taskBySessionKey.set(task.openclaw_session_key, task);
    }
  }

  let sessions: ExtendedSession[] = [];
  let sessionError: string | null = null;

  try {
    const client = getOpenClawClient();
    await client.connect();
    sessions = (await client.listSessions()) as ExtendedSession[];
  } catch (error) {
    sessionError = `Unable to load runtime sessions: ${String(error)}`;
  }

  // Prefer explicit runtime sessions. If unavailable, still provide a best-effort
  // task-centric snapshot to keep the page useful after clean startup.
  const runtimeSessions = sessions.length > 0
    ? sessions
    : tasks
        .filter((task) => ["assigned", "in_progress", "testing", "review"].includes(task.status))
        .map((task) => ({
          key: task.openclaw_session_key || `task:${task.id}`,
          agentId: task.assigned_agent_id || undefined,
          lastActivity: taskUpdatedAtIso(task) || undefined,
          status: task.status === "done" ? "completed" : "running",
        })) as ExtendedSession[];

  const runtimeWorkers = runtimeSessions
    .filter((session) => {
      if (!session.key) return false;
      const linkedTask = taskBySessionKey.get(session.key);
      const status = deriveStatus(session, linkedTask);
      // Keep subagent sessions only when they are linked to a task OR actively running.
      if (session.key.includes(":subagent:")) {
        return !!linkedTask || status === "running";
      }
      return !!linkedTask;
    })
    .map((session): WhoWorkingWorker => {
      const task = taskBySessionKey.get(session.key);
      const lastActivityAt = session.lastActivity || taskUpdatedAtIso(task);
      const lastActivityMs = parseTimestamp(lastActivityAt);
      const dispatchStartMs = parseTimestamp(task?.dispatch_started_at || null);
      const idleMs = lastActivityMs ? Math.max(0, now - lastActivityMs) : null;
      const elapsedMs = dispatchStartMs ? Math.max(0, now - dispatchStartMs) : null;
      const status = deriveStatus(session, task);
      const stallState = deriveStallState(status, idleMs);
      const runId = session.runId || session.activeRunId || session.key;

      return {
        agent: deriveAgentName(session, task),
        label: task?.title || null,
        runId,
        status,
        stale: stallState === "stalled",
        taskId: task?.id || null,
        taskTitle: task?.title || null,
        dispatchId: task?.dispatch_id || null,
        sessionKey: session.key || null,
        sessionId: session.id || session.key || null,
        lastActivityAt: lastActivityAt || null,
        activityType: deriveActivityType(task),
        elapsedMs,
        idleMs,
        stallState,
      };
    });

  // Add recent completed tasks from Mission Control itself so completed work still shows
  // even if runtime session pointers were cleaned up.
  const doneTaskWorkers: WhoWorkingWorker[] = tasks
    .filter((task) => task.status === "done" && !!task.assigned_agent_id)
    .map((task): WhoWorkingWorker => {
      const lastActivityAt = taskUpdatedAtIso(task);
      const lastActivityMs = parseTimestamp(lastActivityAt);
      const dispatchStartMs = parseTimestamp(task.dispatch_started_at || null);
      const idleMs = lastActivityMs ? Math.max(0, now - lastActivityMs) : null;
      const elapsedMs = dispatchStartMs ? Math.max(0, now - dispatchStartMs) : null;
      return {
        agent: task.assigned_agent_id || "unknown",
        label: task.title,
        runId: task.id,
        status: "completed",
        stale: false,
        taskId: task.id,
        taskTitle: task.title,
        dispatchId: task.dispatch_id || null,
        sessionKey: task.openclaw_session_key || null,
        sessionId: task.openclaw_session_key || task.id,
        lastActivityAt: lastActivityAt || null,
        activityType: "completed",
        elapsedMs,
        idleMs,
        stallState: "completed",
      };
    })
    .sort((a, b) => (parseTimestamp(b.lastActivityAt) || 0) - (parseTimestamp(a.lastActivityAt) || 0))
    .slice(0, 25);

  const seenTaskIds = new Set(runtimeWorkers.map((w) => w.taskId).filter(Boolean));
  const workers = [
    ...runtimeWorkers,
    ...doneTaskWorkers.filter((w) => !seenTaskIds.has(w.taskId)),
  ]
    .sort((a, b) => {
      const aTime = parseTimestamp(a.lastActivityAt) || 0;
      const bTime = parseTimestamp(b.lastActivityAt) || 0;
      return bTime - aTime;
    })
    .slice(0, 100);

  return {
    ok: true,
    generatedAt,
    workers,
    ...(sessionError ? { error: sessionError } : {}),
  };
}
