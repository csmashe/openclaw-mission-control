import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask, addComment, claimPlanningCompletion } from "@/lib/db";
import { extractJSON, getMessagesFromOpenClaw } from "@/lib/planning-utils";
import { resolveInternalApiUrl } from "@/lib/internal-api";
import { isOrchestratorEnabled, orchestrateAfterPlanning } from "@/lib/orchestrator";
import { broadcast } from "@/lib/events";
import { v4 as uuidv4 } from "uuid";

// GET - Poll for planning updates
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const sessionKey = (task as unknown as Record<string, unknown>).planning_session_key as string;
  if (!sessionKey) {
    return NextResponse.json({ error: "Planning not started" }, { status: 400 });
  }

  // Already complete
  if (task.planning_complete) {
    return NextResponse.json({ hasUpdates: false, complete: true });
  }

  // If there's a dispatch error, return it
  if ((task as unknown as Record<string, unknown>).planning_dispatch_error) {
    return NextResponse.json({
      hasUpdates: true,
      dispatchError: (task as unknown as Record<string, unknown>).planning_dispatch_error,
    });
  }

  try {
    const ocMessages = await getMessagesFromOpenClaw(sessionKey);

    let storedMessages: Array<{ role: string; content: string; timestamp?: number }> = [];
    try {
      storedMessages = JSON.parse((task as unknown as Record<string, unknown>).planning_messages as string || "[]");
    } catch { /* empty */ }

    const storedAssistantCount = storedMessages.filter((m) => m.role === "assistant").length;

    if (ocMessages.length <= storedAssistantCount) {
      return NextResponse.json({ hasUpdates: false });
    }

    // Process new messages
    const newMessages = ocMessages.slice(storedAssistantCount);
    let currentQuestion = null;
    let complete = false;
    let spec = null;

    for (const msg of newMessages) {
      storedMessages.push({ role: "assistant", content: msg.content, timestamp: Date.now() });
      const json = extractJSON(msg.content) as Record<string, unknown> | null;
      if (json) {
        if (json.complete) {
          complete = true;
          spec = json.spec || null;
        } else if (json.question) {
          currentQuestion = json;
        }
      }
    }

    // Save updated messages + set question waiting flag
    updateTask(taskId, {
      planning_messages: JSON.stringify(storedMessages),
      planning_question_waiting: currentQuestion ? 1 : 0,
    });

    if (currentQuestion && !complete) {
      const questionTask = getTask(taskId);
      if (questionTask) {
        broadcast({ type: "task_updated", payload: questionTask });
      }
    }

    if (complete && spec) {
      // Atomically claim planning completion — only one poller wins
      const claimed = claimPlanningCompletion(
        taskId,
        JSON.stringify(spec),
        JSON.stringify(storedMessages)
      );

      if (claimed) {
        // Log spec ready in activity
        const specObj = spec as Record<string, unknown>;
        const specTitle = (specObj.title as string) || "Untitled";
        const specSummary = (specObj.summary as string) || "";
        addComment({
          id: uuidv4(),
          task_id: taskId,
          author_type: "system",
          content: `📋 Spec ready for review: "${specTitle}"\n${specSummary}`,
        });

        const updatedTask = getTask(taskId);
        if (updatedTask) {
          broadcast({ type: "task_updated", payload: updatedTask });

          // Auto-approve: if flag is set, trigger dispatch automatically
          if (updatedTask.planning_auto_approve) {
            autoApproveAndDispatch(taskId, updatedTask.assigned_agent_id, request).catch((err) => {
              console.error(`[Planning Poll] Auto-approve failed for ${taskId}:`, err);
              updateTask(taskId, { planning_dispatch_error: String(err) });
            });
          }
        }
      }
    }

    return NextResponse.json({
      hasUpdates: true,
      currentQuestion,
      complete,
      spec,
      messages: storedMessages,
    });
  } catch (err) {
    console.error(`[Planning Poll] Poll failed for ${taskId}:`, err);
    return NextResponse.json(
      { error: "Poll failed" },
      { status: 500 }
    );
  }
}

async function autoApproveAndDispatch(
  taskId: string,
  assignedAgentId: string | null,
  request: NextRequest
) {
  const task = getTask(taskId);
  if (!task) return;

  // Need an agent to dispatch to
  if (!assignedAgentId) {
    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: "Auto-approve skipped: no agent assigned. Assign an agent and approve manually.",
    });
    return;
  }

  // Log auto-approval
  let specContent = "Spec auto-approved and dispatched";
  try {
    const specRaw = (task as unknown as Record<string, unknown>).planning_spec as string;
    if (specRaw) {
      const spec = JSON.parse(specRaw);
      if (spec.title) specContent = `Spec auto-approved: "${spec.title}"`;
    }
  } catch { /* ignore */ }

  addComment({
    id: uuidv4(),
    task_id: taskId,
    author_type: "system",
    content: specContent,
  });

  // Clear any previous dispatch error
  updateTask(taskId, {
    ...({ planning_dispatch_error: null } as Record<string, unknown>),
  } as Parameters<typeof updateTask>[1]);

  if (isOrchestratorEnabled()) {
    await orchestrateAfterPlanning(taskId);
    const updatedTask = getTask(taskId);
    if (updatedTask) broadcast({ type: "task_updated", payload: updatedTask });
    return;
  }

  const dispatchRes = await fetch(resolveInternalApiUrl("/api/tasks/dispatch", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, agentId: assignedAgentId }),
  });

  if (!dispatchRes.ok) {
    const err = await dispatchRes.json().catch(() => ({}));
    throw new Error(err.error || `Dispatch failed (HTTP ${dispatchRes.status})`);
  }

  const updatedTask = getTask(taskId);
  if (updatedTask) broadcast({ type: "task_updated", payload: updatedTask });
}
