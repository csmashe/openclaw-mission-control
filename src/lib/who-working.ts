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
  context: string | null;
  triggerSource: string | null;
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
  label?: string;
  runLabel?: string;
  run_label?: string;
  metadata?: unknown;
  context?: unknown;
  taskText?: string;
  prompt?: string;
  owner?: unknown;
  caller?: unknown;
  source?: unknown;
  trigger?: unknown;
  startedAt?: string | number | Date;
  started_at?: string | number | Date;
  createdAt?: string | number | Date;
  created_at?: string | number | Date;
  runStartedAt?: string | number | Date;
  run_started_at?: string | number | Date;
  updatedAt?: string;
  updated_at?: string;
  [key: string]: unknown;
};

const RECENT_COMPLETED_WINDOW_MS = 12 * 60 * 60_000;
const MAX_WORKERS = 100;

const ACTIVE_SESSION_STATUSES = new Set([
  "running",
  "active",
  "in_progress",
  "assigned",
  "busy",
  "processing",
  "started",
  "streaming",
  "queued",
]);

const COMPLETED_SESSION_STATUSES = new Set([
  "completed",
  "done",
  "finished",
  "succeeded",
  "success",
]);

function parseTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Heuristic: small numbers are probably seconds; large numbers are ms.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;

  // SQLite datetime format: YYYY-MM-DD HH:mm:ss
  const sqlite = Date.parse(value.replace(" ", "T") + "Z");
  if (Number.isFinite(sqlite)) return sqlite;

  return null;
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_SESSION_STATUSES.has(status.toLowerCase());
}

function isRecent(ms: number | null, now: number, windowMs: number): boolean {
  if (ms === null) return false;
  return now - ms <= windowMs;
}

function deriveLastActivityAt(session: ExtendedSession, task?: Task): string | null {
  const candidate = session.lastActivity ?? session.updatedAt ?? session.updated_at ?? taskUpdatedAtIso(task);
  const ms = parseTimestamp(candidate as string | number | Date | null | undefined);
  if (ms === null) return null;
  return new Date(ms).toISOString();
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
  if (raw) {
    if (isActiveStatus(raw)) return "running";
    if (COMPLETED_SESSION_STATUSES.has(raw)) return "completed";
    return raw;
  }

  if (task?.status === "done") return "completed";
  if (task?.status === "review" || task?.status === "testing") return "running";
  if (task?.status === "in_progress" || task?.status === "assigned") return "running";

  return "unknown";
}

function fallbackTaskActivityType(task?: Task): string {
  if (!task) return "session";
  if (task.status === "testing") return "testing";
  if (task.status === "review") return "review";
  if (task.status === "done") return "completed";
  return "task_execution";
}

function deriveStallState(status: string, idleMs: number | null): StallState {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "done") return "completed";
  if (idleMs === null || idleMs < 0) return "unknown";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateSnippet(value: string | null, maxLength = 96): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function actorFromUnknown(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return normalizeText(value);
  const record = asRecord(value);
  if (!record) return null;

  const preferredKeys = ["displayName", "name", "label", "id", "key", "agentId", "user", "owner"];
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

function getPathValue(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return current;
}

function getPathString(root: unknown, path: string[]): string | null {
  const value = getPathValue(root, path);
  if (typeof value === "string") return normalizeText(value);
  return null;
}

function firstPathString(root: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = getPathString(root, path);
    if (value) return value;
  }
  return null;
}

function firstPathActor(root: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = actorFromUnknown(getPathValue(root, path));
    if (value) return value;
  }
  return null;
}

function deriveSessionKeyTitle(sessionKey: string | null): { title: string | null; context: string | null } {
  if (!sessionKey) return { title: null, context: null };

  const parts = sessionKey.split(":").filter(Boolean);
  if (parts.length >= 3 && parts[0] === "agent") {
    const agent = parts[1];
    const mode = parts[2];

    if (mode === "cron") {
      return { title: `Cron run (${agent})`, context: sessionKey };
    }

    if (mode === "planning") {
      return { title: `Planning run (${agent})`, context: sessionKey };
    }

    if (mode === "subagent") {
      return { title: `Subagent run (${agent})`, context: sessionKey };
    }

    if (mode === "telegram") {
      return { title: `Telegram trigger (${agent})`, context: sessionKey };
    }

    if (mode === "mission-control") {
      const taskSegment = parts.find((part) => part.startsWith("task-"));
      if (taskSegment) {
        return { title: `Mission Control ${taskSegment}`, context: sessionKey };
      }
      return { title: `Mission Control run (${agent})`, context: sessionKey };
    }
  }

  return { title: `Session ${sessionKey}`, context: null };
}

function deriveNonTaskTitleAndContext(session: ExtendedSession): { title: string; context: string | null } {
  const sessionLabel = firstPathString(session, [
    ["label"],
    ["sessionLabel"],
    ["session", "label"],
    ["metadata", "sessionLabel"],
    ["metadata", "session", "label"],
    ["context", "sessionLabel"],
  ]);

  const taskText = firstPathString(session, [
    ["taskText"],
    ["task_text"],
    ["task"],
    ["prompt"],
    ["instruction"],
    ["message"],
    ["request"],
    ["input"],
    ["metadata", "taskText"],
    ["metadata", "task", "text"],
    ["metadata", "prompt"],
    ["context", "taskText"],
  ]);

  const runLabel = firstPathString(session, [
    ["runLabel"],
    ["run_label"],
    ["run", "label"],
    ["activeRun", "label"],
    ["metadata", "runLabel"],
    ["metadata", "run", "label"],
  ]);

  const callerOrOwner = firstPathActor(session, [
    ["caller"],
    ["callerId"],
    ["callerName"],
    ["owner"],
    ["ownerId"],
    ["ownerName"],
    ["requester"],
    ["requestedBy"],
    ["initiator"],
    ["triggeredBy"],
    ["metadata", "caller"],
    ["metadata", "owner"],
    ["context", "caller"],
    ["context", "owner"],
  ]);

  const taskSnippet = truncateSnippet(taskText);
  const callerTitle = callerOrOwner ? `Run by ${callerOrOwner}` : null;
  const keyPresentation = deriveSessionKeyTitle(getPathString(session, ["key"]));

  const title = sessionLabel || taskSnippet || runLabel || callerTitle || keyPresentation.title || "(non-task run)";
  const context = [
    taskSnippet,
    runLabel,
    callerTitle,
    keyPresentation.context,
  ].find((candidate) => candidate && candidate !== title) || null;

  return { title, context };
}

function normalizeActivityToken(value: string): string {
  return value.toLowerCase().replace(/[\s.-]+/g, "_").trim();
}

function mapActivityHint(text: string): string | null {
  const normalized = normalizeActivityToken(text);

  if (normalized.includes("tool_result") || normalized.includes("toolresult")) return "tool_result";
  if (normalized.includes("tool_call") || normalized.includes("toolcall") || normalized.includes("tool_invocation")) return "tool_call";
  if (normalized.includes("completion") || normalized.includes("completed") || normalized.includes("done") || normalized.includes("finish")) return "completion";
  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("exception") || normalized.includes("reject")) return "error";
  if (normalized.includes("review") || normalized.includes("qa")) return "review";
  if (normalized.includes("message") || normalized.includes("chat") || normalized.includes("assistant") || normalized.includes("user_prompt")) return "message";
  if (normalized.includes("heartbeat") || normalized.includes("keepalive") || normalized.includes("keep_alive")) return "heartbeat";

  return null;
}

function deriveRuntimeActivityType(session: ExtendedSession, task?: Task, triggerSource?: string | null): string {
  const directCandidates: string[] = [];

  const paths: string[][] = [
    ["activityType"],
    ["activity_type"],
    ["lastEventType"],
    ["last_event_type"],
    ["eventType"],
    ["event_type"],
    ["lastMessageType"],
    ["last_message_type"],
    ["latestEvent", "type"],
    ["latestEvent", "kind"],
    ["latestMessage", "type"],
    ["latestMessage", "kind"],
    ["run", "lastEventType"],
    ["run", "activityType"],
    ["activeRun", "lastEventType"],
    ["activeRun", "activityType"],
    ["metadata", "activityType"],
    ["metadata", "activity_type"],
    ["metadata", "lastEventType"],
    ["metadata", "last_event_type"],
    ["metadata", "eventType"],
    ["metadata", "event_type"],
    ["metadata", "event"],
    ["metadata", "kind"],
    ["metadata", "lastMessageType"],
    ["metadata", "messageType"],
    ["context", "activityType"],
    ["context", "eventType"],
    ["context", "event"],
    ["context", "kind"],
  ];

  for (const path of paths) {
    const value = getPathString(session, path);
    if (value) directCandidates.push(value);
  }

  for (const candidate of directCandidates) {
    const mapped = mapActivityHint(candidate);
    if (mapped) return mapped;
  }

  const haystack = normalizeText([
    ...directCandidates,
    getPathString(session, ["label"]),
    getPathString(session, ["runLabel"]),
    getPathString(session, ["run_label"]),
    getPathString(session, ["taskText"]),
    getPathString(session, ["prompt"]),
    getPathString(session, ["key"]),
    triggerSource,
  ].filter(Boolean).join(" "));

  if (haystack) {
    const mapped = mapActivityHint(haystack);
    if (mapped) return mapped;
  }

  if (triggerSource) {
    if (triggerSource === "review") return "review";
    if (triggerSource === "heartbeat") return "heartbeat";
  }

  return fallbackTaskActivityType(task);
}

function inferNonTaskTriggerSource(session: ExtendedSession): string | null {
  const explicitSource = firstPathString(session, [
    ["source"],
    ["trigger"],
    ["reason"],
    ["origin"],
    ["eventType"],
    ["metadata", "source"],
    ["metadata", "trigger"],
    ["metadata", "reason"],
    ["metadata", "origin"],
    ["context", "source"],
    ["context", "trigger"],
  ]);

  const haystack = normalizeText(
    [
      explicitSource,
      getPathString(session, ["key"]),
      getPathString(session, ["label"]),
      getPathString(session, ["runLabel"]),
      getPathString(session, ["run_label"]),
      getPathString(session, ["activityType"]),
      getPathString(session, ["metadata", "event"]),
      getPathString(session, ["metadata", "kind"]),
      getPathString(session, ["context", "event"]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  );

  if (!haystack) return null;
  if (haystack.includes("heartbeat") || haystack.includes("keepalive") || haystack.includes("keep-alive")) return "heartbeat";
  if (haystack.includes("cron") || haystack.includes("schedule") || haystack.includes("timer")) return "cron";
  if (haystack.includes("dispatch") || haystack.includes("delegat") || haystack.includes("planning")) return "dispatch";
  if (haystack.includes("review") || haystack.includes("qa")) return "review";
  if (haystack.includes("manual") || haystack.includes("operator") || haystack.includes("human") || haystack.includes("user")) return "manual";
  return null;
}

function deriveElapsedStartMs(session: ExtendedSession, task?: Task): number | null {
  const candidates: Array<string | number | Date | null | undefined> = [
    getPathValue(session, ["startedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["started_at"]) as string | number | Date | null | undefined,
    getPathValue(session, ["runStartedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["run_started_at"]) as string | number | Date | null | undefined,
    getPathValue(session, ["activeRun", "startedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["activeRun", "createdAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["run", "startedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["run", "createdAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["metadata", "startedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["metadata", "createdAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["metadata", "run", "startedAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["metadata", "run", "createdAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["createdAt"]) as string | number | Date | null | undefined,
    getPathValue(session, ["created_at"]) as string | number | Date | null | undefined,
    task?.dispatch_started_at,
    task?.created_at,
    session.updatedAt,
    session.updated_at,
    session.lastActivity,
  ];

  for (const candidate of candidates) {
    const ms = parseTimestamp(candidate);
    if (ms !== null) return ms;
  }

  return null;
}

function workerSortBucket(status: string): number {
  const normalized = status.toLowerCase();
  if (normalized === "running") return 0;
  if (normalized === "completed" || normalized === "done") return 2;
  return 1;
}

function compareWorkers(a: WhoWorkingWorker, b: WhoWorkingWorker): number {
  const bucketDiff = workerSortBucket(a.status) - workerSortBucket(b.status);
  if (bucketDiff !== 0) return bucketDiff;

  const aTime = parseTimestamp(a.lastActivityAt) || 0;
  const bTime = parseTimestamp(b.lastActivityAt) || 0;
  if (aTime !== bTime) return bTime - aTime;

  return (a.taskTitle || a.label || "").localeCompare(b.taskTitle || b.label || "");
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
          startedAt: task.dispatch_started_at || task.created_at,
          createdAt: task.created_at,
          status: "running",
        })) as ExtendedSession[];

  const runtimeWorkers = runtimeSessions
    .filter((session) => {
      const sessionKey = session.key || session.id || "";
      if (!sessionKey) return false;

      const linkedTask = taskBySessionKey.get(session.key || "");
      if (linkedTask) return true; // Keep existing board-task-linked rows.

      const status = deriveStatus(session, linkedTask);
      const lastActivityMs = parseTimestamp(deriveLastActivityAt(session, linkedTask));

      // Include non-task runs that are active OR recently completed/recently active.
      return isActiveStatus(status) || isRecent(lastActivityMs, now, RECENT_COMPLETED_WINDOW_MS);
    })
    .map((session): WhoWorkingWorker => {
      const task = taskBySessionKey.get(session.key || "");
      const lastActivityAt = deriveLastActivityAt(session, task);
      const lastActivityMs = parseTimestamp(lastActivityAt);
      const elapsedStartMs = deriveElapsedStartMs(session, task);
      const idleMs = lastActivityMs ? Math.max(0, now - lastActivityMs) : null;
      const elapsedMs = elapsedStartMs !== null ? Math.max(0, now - elapsedStartMs) : null;
      const status = deriveStatus(session, task);
      const stallState = deriveStallState(status, idleMs);
      const runId = session.runId || session.activeRunId || session.id || session.key || "unknown-run";

      if (task) {
        return {
          agent: deriveAgentName(session, task),
          label: task.title,
          runId,
          status,
          stale: stallState === "stalled",
          taskId: task.id,
          taskTitle: task.title,
          dispatchId: task.dispatch_id || null,
          sessionKey: session.key || session.id || null,
          sessionId: session.id || session.key || runId,
          lastActivityAt: lastActivityAt || null,
          activityType: deriveRuntimeActivityType(session, task),
          context: null,
          triggerSource: null,
          elapsedMs,
          idleMs,
          stallState,
        };
      }

      const nonTaskPresentation = deriveNonTaskTitleAndContext(session);
      const triggerSource = inferNonTaskTriggerSource(session);

      return {
        agent: deriveAgentName(session, task),
        label: nonTaskPresentation.title,
        runId,
        status,
        stale: stallState === "stalled",
        taskId: null,
        taskTitle: nonTaskPresentation.title,
        dispatchId: null,
        sessionKey: session.key || session.id || null,
        sessionId: session.id || session.key || runId,
        lastActivityAt: lastActivityAt || null,
        activityType: deriveRuntimeActivityType(session, undefined, triggerSource),
        context: nonTaskPresentation.context,
        triggerSource,
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
      const idleMs = lastActivityMs ? Math.max(0, now - lastActivityMs) : null;
      const elapsedStartMs = parseTimestamp(task.dispatch_started_at || null) ?? parseTimestamp(task.created_at);
      const elapsedMs = elapsedStartMs !== null ? Math.max(0, now - elapsedStartMs) : null;
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
        context: null,
        triggerSource: null,
        elapsedMs,
        idleMs,
        stallState: "completed",
      };
    })
    .filter((worker) => isRecent(parseTimestamp(worker.lastActivityAt), now, RECENT_COMPLETED_WINDOW_MS))
    .sort((a, b) => (parseTimestamp(b.lastActivityAt) || 0) - (parseTimestamp(a.lastActivityAt) || 0))
    .slice(0, 25);

  const seenTaskIds = new Set(runtimeWorkers.map((w) => w.taskId).filter(Boolean));
  const workers = [
    ...runtimeWorkers,
    ...doneTaskWorkers.filter((w) => !seenTaskIds.has(w.taskId)),
  ]
    .sort(compareWorkers)
    .slice(0, MAX_WORKERS);

  return {
    ok: true,
    generatedAt,
    workers,
    ...(sessionError ? { error: sessionError } : {}),
  };
}
