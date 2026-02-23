import type { Task } from "@/lib/db";

export interface TaskRuntimeEvidence {
  nowIso: string;
  ackTimeoutMs: number;
  monitorAcked: boolean;
  assistantMessageCount: number;
  latestAssistantTimestamp?: string;
}

export type ActiveTaskStatus = "assigned" | "in_progress";

function countIsFresh(task: Task, evidence: TaskRuntimeEvidence): boolean {
  const baseline = task.dispatch_message_count_start ?? 0;
  if (evidence.assistantMessageCount <= baseline) return false;

  if (!task.dispatch_started_at || !evidence.latestAssistantTimestamp) return true;

  const dispatchMs = Date.parse(task.dispatch_started_at);
  const assistantMs = Date.parse(evidence.latestAssistantTimestamp);
  if (!Number.isFinite(dispatchMs) || !Number.isFinite(assistantMs)) return true;

  return assistantMs >= dispatchMs;
}

export function deriveExpectedActiveStatus(
  task: Task,
  evidence: TaskRuntimeEvidence
): ActiveTaskStatus {
  // monitorAcked alone is not sufficient — stray gateway events can set it.
  // Always require actual message evidence before promoting to in_progress.
  if (countIsFresh(task, evidence)) return "in_progress";
  return "assigned";
}

export interface DispatchDedupeInput {
  task: Task;
  requestedAgentId: string;
  sessionKey: string;
  monitorActive: boolean;
  nowIso: string;
  ackTimeoutMs: number;
}

export interface DispatchDedupeDecision {
  dedupe: boolean;
  reason:
    | "none"
    | "active_monitor"
    | "already_in_progress"
    | "awaiting_first_activity_ack";
}

export function shouldDedupeDispatch(
  input: DispatchDedupeInput
): DispatchDedupeDecision {
  const { task, requestedAgentId, monitorActive, nowIso, ackTimeoutMs } = input;

  if (task.assigned_agent_id !== requestedAgentId) {
    return { dedupe: false, reason: "none" };
  }

  if (monitorActive) {
    return { dedupe: true, reason: "active_monitor" };
  }

  if (task.status === "in_progress") {
    return { dedupe: true, reason: "already_in_progress" };
  }

  if (task.status !== "assigned") {
    return { dedupe: false, reason: "none" };
  }

  if (!task.dispatch_started_at) {
    return { dedupe: false, reason: "none" };
  }

  const nowMs = Date.parse(nowIso);
  const dispatchMs = Date.parse(task.dispatch_started_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(dispatchMs)) {
    return { dedupe: true, reason: "awaiting_first_activity_ack" };
  }

  if (nowMs - dispatchMs < ackTimeoutMs) {
    return { dedupe: true, reason: "awaiting_first_activity_ack" };
  }

  return { dedupe: false, reason: "none" };
}
