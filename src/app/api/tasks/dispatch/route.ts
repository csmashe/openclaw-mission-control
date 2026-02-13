import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { getAgentTaskMonitor } from "@/lib/agent-task-monitor";
import {
  getTask,
  updateTask,
  addComment,
  logActivity,
  listComments,
} from "@/lib/db";

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

    // Update task to assigned → in_progress
    updateTask(taskId, {
      status: "in_progress",
      assigned_agent_id: agentId,
      openclaw_session_key: sessionKey,
    });

    logActivity({
      id: uuidv4(),
      type: isRework ? "task_rework_started" : "task_in_progress",
      task_id: taskId,
      agent_id: agentId,
      message: isRework
        ? `Agent "${agentId}" re-processing "${task.title}" with feedback`
        : `Agent "${agentId}" started working on "${task.title}"`,
      metadata: { sessionKey },
    });

    // Build the prompt
    const prompt = isRework
      ? buildReworkPrompt(task, feedback, taskId)
      : buildTaskPrompt(task);

    // Connect and send to agent
    const client = getOpenClawClient();
    await client.connect();

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
          ? `🔄 Rework request sent to agent ${agentId}. Monitoring for completion...`
          : `🚀 Task dispatched to agent ${agentId}. Monitoring for completion...`,
      });

      // Register with the AgentTaskMonitor for event-driven completion
      const monitor = getAgentTaskMonitor();
      await monitor.startMonitoring(taskId, sessionKey, agentId);

      return NextResponse.json({
        ok: true,
        status: "dispatched",
        sessionKey,
        monitoring: true,
        isRework,
        message: "Task sent to agent. Will auto-move to review when complete.",
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
      updateTask(taskId, { status: isRework ? "review" : "inbox" });

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
}): string {
  return `## Task Assignment

**Title:** ${task.title}
**Priority:** ${task.priority.toUpperCase()}

**Description:**
${task.description || "No additional details provided."}

---

Please complete this task. Provide a clear, actionable response with your findings or deliverables. Be concise but thorough.`;
}

function buildReworkPrompt(
  task: { title: string; description: string; priority: string },
  feedback: string,
  taskId: string
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

Please address the feedback above and provide an updated response. Consider all previous discussion context.`;
}
