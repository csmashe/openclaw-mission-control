import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { getAgentTaskMonitor } from "@/lib/agent-task-monitor";
import {
  getTask,
  addComment,
  logActivity,
  listComments,
} from "@/lib/db";
import type { ChatMessage } from "@/lib/openclaw-client";
import { transitionTaskStatus, type TaskStatus } from "@/lib/task-state";
import { shouldDedupeDispatch } from "@/lib/task-runtime-truth";

// POST /api/tasks/dispatch - Send a task to an agent for processing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, agentId, feedback, model, provider } = body;

    if (!taskId || !agentId) {
      return NextResponse.json(
        { error: "taskId and agentId are required" },
        { status: 400 }
      );
    }

    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // Generate or reuse session key
    // Gateway canonicalizes keys as agent:<agentId>:<sessionKey>
    const sessionKey =
      task.openclaw_session_key ||
      `agent:${agentId}:mission-control:${agentId}:task-${taskId.slice(0, 8)}`;

    // If this is a rework re-dispatch, add the user's feedback as a comment first
    const isRework = !!feedback;
    if (isRework) {
      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "user",
        content: feedback,
      });

      logActivity({
        id: uuidv4(),
        type: "task_rework",
        task_id: taskId,
        agent_id: agentId,
        message: `User requested rework on "${task.title}"`,
      });
    }

    const dispatchId = uuidv4();
    const dispatchStartedAt = new Date().toISOString();

    // Connect early so we can capture baseline evidence before sending this run.
    const client = getOpenClawClient();
    await client.connect();

    const monitor = getAgentTaskMonitor();
    const activeForTask = monitor
      .getActiveMonitors()
      .some((m) => m.taskId === taskId && m.agentId === agentId);

    const dedupe = shouldDedupeDispatch({
      task,
      requestedAgentId: agentId,
      sessionKey,
      monitorActive: activeForTask,
      nowIso: dispatchStartedAt,
      ackTimeoutMs: monitor.getAckTimeoutMs(),
    });

    if (dedupe.dedupe) {
      logActivity({
        id: uuidv4(),
        type: "task_dispatch_deduped",
        task_id: taskId,
        agent_id: agentId,
        message: `Dispatch deduped for \"${task.title}\" (${dedupe.reason})`,
        metadata: {
          reason: dedupe.reason,
          existingDispatchId: task.dispatch_id,
          sessionKey,
        },
      });

      return NextResponse.json({
        ok: true,
        deduped: true,
        reason: dedupe.reason,
        status: task.status,
        dispatchId: task.dispatch_id,
        sessionKey,
        monitoring: activeForTask,
      });
    }

    let baselineAssistantCount = 0;
    try {
      const baselineHistory = (await client.getChatHistory(sessionKey)) as ChatMessage[];
      baselineAssistantCount = baselineHistory.filter((m) => m.role === "assistant").length;
    } catch {
      baselineAssistantCount = 0;
    }

    // Dispatch enters ASSIGNED. It becomes IN_PROGRESS only after first real runtime activity/ack.
    transitionTaskStatus(taskId, "assigned", {
      actor: "dispatch",
      reason: isRework ? "dispatch_rework_sent" : "dispatch_sent",
      agentId,
      patch: {
        assigned_agent_id: agentId,
        openclaw_session_key: sessionKey,
        dispatch_id: dispatchId,
        dispatch_started_at: dispatchStartedAt,
        dispatch_message_count_start: baselineAssistantCount,
      },
      metadata: {
        sessionKey,
        dispatchId,
        dispatchStartedAt,
        baselineAssistantCount,
      },
    });

    logActivity({
      id: uuidv4(),
      type: isRework ? "task_rework_dispatched" : "task_dispatched",
      task_id: taskId,
      agent_id: agentId,
      message: isRework
        ? `Agent "${agentId}" received rework dispatch for "${task.title}" (awaiting first activity ack)`
        : `Task "${task.title}" dispatched to "${agentId}" (awaiting first activity ack)`,
      metadata: { sessionKey, dispatchId, dispatchStartedAt, baselineAssistantCount },
    });

    // Build the prompt
    const prompt = isRework
      ? buildReworkPrompt(task, feedback, taskId, dispatchId)
      : buildTaskPrompt(task, dispatchId);

    // Send to agent
    try {
      // If a model override is specified, patch the session before sending
      if (model) {
        const modelRef = provider ? `${provider}/${model}` : model;
        try {
          await client.patchSession(sessionKey, { model: modelRef });
          console.log(`[dispatch] Set model override: ${modelRef} for session: ${sessionKey}`);
        } catch (patchErr) {
          console.warn(`[dispatch] Failed to set model override: ${patchErr}`);
          // Continue anyway — fall back to default model
        }
      }

      await client.sendMessage(sessionKey, prompt);

      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "system",
        content: isRework
          ? `🔄 Rework request sent to agent ${agentId}. Waiting for first activity ack, then monitoring completion...`
          : `🚀 Task dispatched to agent ${agentId}. Waiting for first activity ack, then monitoring completion...`,
      });

      // Register with the AgentTaskMonitor for event-driven completion
      await monitor.startMonitoring(taskId, sessionKey, agentId, {
        dispatchId,
        dispatchStartedAt,
        baselineAssistantCount,
      });

      return NextResponse.json({
        ok: true,
        status: "dispatched",
        sessionKey,
        dispatchId,
        monitoring: true,
        isRework,
        message: "Task sent to agent. Manager monitor will move to review after valid completion.",
      });
    } catch (sendError) {
      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "system",
        content: `❌ Failed to send to agent: ${String(sendError)}`,
      });

      // Revert to previous status on send failure
      transitionTaskStatus(taskId, task.status as TaskStatus, {
        actor: "dispatch",
        reason: "dispatch_send_failed_revert",
        agentId,
        bypassGuards: true,
        metadata: {
          previousStatus: task.status,
          error: String(sendError),
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Failed to send task to agent",
          details: String(sendError),
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Dispatch failed", details: String(error) },
      { status: 500 }
    );
  }
}

function buildTaskPrompt(task: {
  title: string;
  description: string;
  priority: string;
}, dispatchId: string): string {
  return `## Task Assignment

**Title:** ${task.title}
**Priority:** ${task.priority.toUpperCase()}

**Description:**
${task.description || "No additional details provided."}

---

**Environment constraints:**
- Use Claude CLI only for implementation work in this environment.
- Do not assume Codex CLI is installed.

**Dispatch ID:** ${dispatchId}

When complete, respond exactly with:
TASK_COMPLETE dispatch_id=${dispatchId}: <brief summary>

Please complete this task. Provide a clear, actionable response with your findings or deliverables. Be concise but thorough.`;
}

function buildReworkPrompt(
  task: { title: string; description: string; priority: string },
  feedback: string,
  taskId: string,
  dispatchId: string
): string {
  // Get previous comments for context
  const comments = listComments(taskId);
  const commentHistory = comments
    .filter((c) => c.author_type !== "system")
    .map((c) => {
      const prefix =
        c.author_type === "agent" ? "🤖 Agent" : "👤 User";
      return `${prefix}: ${c.content}`;
    })
    .join("\n\n");

  return `## Task Rework Request

**Title:** ${task.title}
**Priority:** ${task.priority.toUpperCase()}

**Original Description:**
${task.description || "No additional details provided."}

---

### Previous Discussion:
${commentHistory || "No previous comments."}

---

### Rework Feedback:
${feedback}

---

**Environment constraints:**
- Use Claude CLI only for implementation work in this environment.
- Do not assume Codex CLI is installed.

**Dispatch ID:** ${dispatchId}

When complete, respond exactly with:
TASK_COMPLETE dispatch_id=${dispatchId}: <brief summary>

Please address the feedback above and provide an updated response. Consider all previous discussion context.`;
}
