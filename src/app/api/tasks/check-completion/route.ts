import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { listTasks, addComment, logActivity, listComments, listDeliverables } from "@/lib/db";
import { evaluateCompletion, extractDispatchCompletion, extractTextContent } from "@/lib/completion-gate";
import { transitionTaskStatus } from "@/lib/task-state";
import { reconcileTaskRuntimeTruth } from "@/lib/task-reconciler";
import { resolveInternalApiUrl } from "@/lib/internal-api";
import { getAgentTaskMonitor } from "@/lib/agent-task-monitor";

function isSubstantiveCompletion(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;

  // Fast reject for acknowledgement-only replies.
  const ackOnly = [
    /^on it[.!]?$/i,
    /^working on it[.!]?$/i,
    /^i'?ll handle it[.!]?$/i,
    /^starting now[.!]?$/i,
    /^got it[.!]?$/i,
  ];
  if (ackOnly.some((rx) => rx.test(t))) return false;

  // Require concrete completion language + implementation evidence signal.
  const lower = t.toLowerCase();
  const hasCompletionSignal =
    lower.includes("done") ||
    lower.includes("completed") ||
    lower.includes("implemented") ||
    lower.includes("finished");

  const hasEvidenceSignal =
    lower.includes("changed files") ||
    lower.includes("diff") ||
    lower.includes("verification") ||
    lower.includes("build") ||
    lower.includes("test") ||
    lower.includes("output");

  // Length floor avoids tiny one-liners auto-completing tasks.
  return hasCompletionSignal && hasEvidenceSignal && t.length >= 120;
}

/**
 * GET /api/tasks/check-completion
 * 
 * Checks all in_progress tasks with assigned agents for completion.
 * Polls chat history and if a new assistant message is found, moves the task to review.
 * 
 * This is called by the frontend on every polling cycle (~5s) to reliably
 * detect agent completion.
 */
export async function GET() {
  // Deterministic self-heal before completion checks.
  await reconcileTaskRuntimeTruth();

  const inProgressTasks = listTasks({ status: "in_progress" });
  const activeMonitors = getAgentTaskMonitor().getActiveMonitors();
  const monitoredSessions = new Set(activeMonitors.map((m) => m.sessionKey));
  const tasksToCheck = inProgressTasks.filter(
    (t) => t.assigned_agent_id && t.openclaw_session_key && !monitoredSessions.has(t.openclaw_session_key)
  );

  if (tasksToCheck.length === 0) {
    return NextResponse.json({ checked: 0, completed: [] });
  }

  const completed: string[] = [];

  try {
    const client = getOpenClawClient();
    await client.connect();

    for (const task of tasksToCheck) {
      try {
        const history = await client.getChatHistory(task.openclaw_session_key!);
        const assistantMsgs = history.filter((m) => m.role === "assistant");

        // If there are assistant messages, check whether latest one is substantive completion.
        if (assistantMsgs.length > 0) {
          const latestResponse = assistantMsgs[assistantMsgs.length - 1];
          const responseText = extractTextContent(latestResponse.content);
          const existingComments = listComments(task.id);

          const sameAgentCommentExists = responseText
            ? existingComments.some(
                (c) => c.author_type === "agent" && c.content.trim() === responseText.trim()
              )
            : false;

          // Persist latest agent response once for review context, even if not completion.
          if (responseText && !sameAgentCommentExists) {
            addComment({
              id: uuidv4(),
              task_id: task.id,
              agent_id: task.assigned_agent_id!,
              author_type: "agent",
              content: responseText,
            });
          }

          const extracted = extractDispatchCompletion(responseText || "");
          const evidenceTimestamp = latestResponse.timestamp ?? new Date().toISOString();
          const decision = evaluateCompletion(task, {
            payloadDispatchId: extracted.dispatchId,
            hasCompletionMarker: extracted.hasCompletionMarker,
            evidenceTimestamp,
            assistantMessageCount: assistantMsgs.length,
          });

          if (!decision.accepted) {
            const maybeCompletionSignal =
              isSubstantiveCompletion(responseText) || extracted.hasCompletionMarker;
            if (!maybeCompletionSignal) {
              continue;
            }

            // Allow re-evaluation for transient guard outcomes.
            const retryableRejection =
              decision.completionReason === "rejected_suspicious_instant_no_new_evidence";

            // Avoid repeated spam logs for unchanged assistant output when rejection is final.
            if (sameAgentCommentExists && !retryableRejection) {
              continue;
            }

            logActivity({
              id: uuidv4(),
              type: "task_completion_gate_rejected",
              task_id: task.id,
              agent_id: task.assigned_agent_id ?? undefined,
              message: `Completion rejected for "${task.title}" (${decision.completionReason})`,
              metadata: {
                dispatchId: decision.dispatchId,
                payloadDispatchId: decision.payloadDispatchId,
                evidenceTimestamp: decision.evidenceTimestamp,
                completionReason: decision.completionReason,
                accepted: false,
              },
            });

            addComment({
              id: uuidv4(),
              task_id: task.id,
              author_type: "system",
              content: `⚠️ Completion signal rejected (${decision.completionReason}). Task remains ${task.status}. Please re-dispatch or send a valid TASK_COMPLETE marker for the active dispatch.`,
            });
            continue;
          }

          const createdAt = new Date(task.updated_at).getTime();
          const duration = Math.round((Date.now() - createdAt) / 1000);

          // Check for testable deliverables
          const deliverables = listDeliverables(task.id);
          const hasTestableDeliverables = deliverables.some(
            (d) => d.deliverable_type === "file" || d.deliverable_type === "url"
          );

          if (hasTestableDeliverables) {
            // Route through automated testing
            transitionTaskStatus(task.id, "testing", {
              actor: "monitor",
              reason: "completion_gate_accepted_testing",
              agentId: task.assigned_agent_id ?? undefined,
              metadata: {
                dispatchId: decision.dispatchId,
                payloadDispatchId: decision.payloadDispatchId,
              },
            });

            addComment({
              id: uuidv4(),
              task_id: task.id,
              author_type: "system",
              content: `Agent completed in ~${duration}s. Running automated tests on deliverables...`,
            });

            logActivity({
              id: uuidv4(),
              type: "task_testing",
              task_id: task.id,
              agent_id: task.assigned_agent_id ?? undefined,
              message: `Agent "${task.assigned_agent_id}" completed "${task.title}" — running automated tests`,
              metadata: {
                duration,
                dispatchId: decision.dispatchId,
                payloadDispatchId: decision.payloadDispatchId,
                evidenceTimestamp: decision.evidenceTimestamp,
                completionReason: decision.completionReason,
                accepted: true,
              },
            });

            // Trigger test endpoint (fire-and-forget)
            try {
              fetch(resolveInternalApiUrl(`/api/tasks/${task.id}/test`), { method: "POST" }).catch(() => {});
            } catch { /* ignore */ }

            console.log(
              `[check-completion] Task "${task.title}" moved to TESTING (completion gate accepted, deliverables found)`
            );
          } else {
            // No deliverables — go straight to review (backward compatible)
            transitionTaskStatus(task.id, "review", {
              actor: "monitor",
              reason: "completion_gate_accepted",
              agentId: task.assigned_agent_id ?? undefined,
              metadata: {
                dispatchId: decision.dispatchId,
                payloadDispatchId: decision.payloadDispatchId,
              },
            });

            addComment({
              id: uuidv4(),
              task_id: task.id,
              author_type: "system",
              content: `✅ Agent completed in ~${duration}s. Task moved to review.`,
            });

            logActivity({
              id: uuidv4(),
              type: "task_review",
              task_id: task.id,
              agent_id: task.assigned_agent_id ?? undefined,
              message: `Agent "${task.assigned_agent_id}" completed "${task.title}" — moved to review`,
              metadata: {
                duration,
                dispatchId: decision.dispatchId,
                payloadDispatchId: decision.payloadDispatchId,
                evidenceTimestamp: decision.evidenceTimestamp,
                completionReason: decision.completionReason,
                accepted: true,
              },
            });

            console.log(
              `[check-completion] Task "${task.title}" moved to REVIEW (completion gate accepted)`
            );
          }

          completed.push(task.id);
        }
      } catch (err) {
        console.error(
          `[check-completion] Error checking task "${task.title}":`,
          String(err)
        );
      }
    }
  } catch (err) {
    console.error("[check-completion] Client error:", String(err));
  }

  return NextResponse.json({
    checked: tasksToCheck.length,
    completed,
  });
}
