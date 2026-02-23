import type { Task } from "@/lib/db";

export type CompletionReason =
  | "accepted"
  | "rejected_missing_dispatch_context"
  | "rejected_stale_dispatch_id"
  | "rejected_stale_evidence_timestamp"
  | "rejected_suspicious_instant_no_new_evidence"
  | "rejected_missing_completion_marker";

export interface CompletionDecision {
  accepted: boolean;
  completionReason: CompletionReason;
  dispatchId: string | null;
  payloadDispatchId: string | null;
  evidenceTimestamp: string | null;
}

const INSTANT_WINDOW_MS = 5_000;

export function extractDispatchCompletion(text: string): { dispatchId: string | null } {
  const m = text.match(/TASK_COMPLETE(?:\s+dispatch_id=([a-zA-Z0-9-]+))?:/i);
  return { dispatchId: m?.[1] ?? null };
}

export function evaluateCompletion(
  task: Task,
  params: {
    payloadDispatchId: string | null;
    evidenceTimestamp: string | null;
    assistantMessageCount: number;
    nowIso?: string;
  }
): CompletionDecision {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const dispatchId = task.dispatch_id ?? null;
  const dispatchStartedAt = task.dispatch_started_at ?? null;
  const baseline = task.dispatch_message_count_start ?? 0;

  if (!dispatchId || !dispatchStartedAt) {
    return {
      accepted: false,
      completionReason: "rejected_missing_dispatch_context",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  if (!params.payloadDispatchId) {
    return {
      accepted: false,
      completionReason: "rejected_missing_completion_marker",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  if (params.payloadDispatchId !== dispatchId) {
    return {
      accepted: false,
      completionReason: "rejected_stale_dispatch_id",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  const dispatchMs = Date.parse(dispatchStartedAt);
  const evidenceMs = params.evidenceTimestamp ? Date.parse(params.evidenceTimestamp) : NaN;
  if (Number.isFinite(dispatchMs) && Number.isFinite(evidenceMs) && evidenceMs < dispatchMs) {
    return {
      accepted: false,
      completionReason: "rejected_stale_evidence_timestamp",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  const newEvidenceCount = Math.max(0, params.assistantMessageCount - baseline);
  const elapsed = Date.parse(nowIso) - dispatchMs;
  if (newEvidenceCount <= 0 && Number.isFinite(elapsed) && elapsed < INSTANT_WINDOW_MS) {
    return {
      accepted: false,
      completionReason: "rejected_suspicious_instant_no_new_evidence",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  return {
    accepted: true,
    completionReason: "accepted",
    dispatchId,
    payloadDispatchId: params.payloadDispatchId,
    evidenceTimestamp: params.evidenceTimestamp,
  };
}
