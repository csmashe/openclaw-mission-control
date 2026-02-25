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

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        const obj = block as Record<string, unknown>;
        // Extract text from any block that has a text field
        // (covers Claude {type:"text",text:...}, OpenAI {type:"output_text",text:...}, etc.)
        if (typeof obj.text === "string") {
          parts.push(obj.text);
        } else if (typeof obj.content === "string") {
          parts.push(obj.content);
        }
      }
    }
    if (parts.length > 0) return parts.join("\n");
    // Fallback: stringify the array if no text could be extracted
    return JSON.stringify(content);
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    return JSON.stringify(content);
  }
  return "";
}

export function extractDispatchCompletion(text: unknown): {
  hasCompletionMarker: boolean;
  dispatchId: string | null;
} {
  const s = extractTextContent(text);
  const m = s.match(/TASK_COMPLETE(?:\s+dispatch_id=([a-zA-Z0-9-]+))?(?:\s*[:\-]|\s|$)/i);
  return { hasCompletionMarker: Boolean(m), dispatchId: m?.[1] ?? null };
}

export function evaluateCompletion(
  task: Task,
  params: {
    payloadDispatchId: string | null;
    hasCompletionMarker?: boolean;
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

  const effectivePayloadDispatchId =
    params.payloadDispatchId ?? (params.hasCompletionMarker ? dispatchId : null);

  if (!effectivePayloadDispatchId) {
    return {
      accepted: false,
      completionReason: "rejected_missing_completion_marker",
      dispatchId,
      payloadDispatchId: params.payloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  if (effectivePayloadDispatchId !== dispatchId) {
    return {
      accepted: false,
      completionReason: "rejected_stale_dispatch_id",
      dispatchId,
      payloadDispatchId: effectivePayloadDispatchId,
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
      payloadDispatchId: effectivePayloadDispatchId,
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
      payloadDispatchId: effectivePayloadDispatchId,
      evidenceTimestamp: params.evidenceTimestamp,
    };
  }

  return {
    accepted: true,
    completionReason: "accepted",
    dispatchId,
    payloadDispatchId: effectivePayloadDispatchId,
    evidenceTimestamp: params.evidenceTimestamp,
  };
}
