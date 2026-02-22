import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { listTasks, updateTask, addComment, logActivity, listComments } from "@/lib/db";
import { evaluateCompletion, extractDispatchCompletion } from "@/lib/completion-gate";

/**
 * Extract text content from chat message content.
 * The gateway may return content as a string OR as an array of content blocks
 * (e.g. [{type: "text", text: "..."}, ...] from Anthropic API format).
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text" && block.text)
      .map((block: Record<string, unknown>) => block.text as string)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  return "";
}

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
  const inProgressTasks = listTasks({ status: "in_progress" });
  const tasksToCheck = inProgressTasks.filter(
    (t) => t.assigned_agent_id && t.openclaw_session_key
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
            evidenceTimestamp,
            assistantMessageCount: assistantMsgs.length,
          });

          if (!decision.accepted) {
            // Optional secondary filter for non-marker chatter: skip noisy logs.
            if (!isSubstantiveCompletion(responseText) && !extracted.dispatchId) {
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
            continue;
          }

          updateTask(task.id, { status: "review" });

          const createdAt = new Date(task.updated_at).getTime();
          const duration = Math.round((Date.now() - createdAt) / 1000);

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

          completed.push(task.id);
          console.log(
            `[check-completion] Task "${task.title}" moved to REVIEW (completion gate accepted)`
          );
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
