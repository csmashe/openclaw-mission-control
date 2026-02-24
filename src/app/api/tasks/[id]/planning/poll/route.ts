import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { extractJSON, getMessagesFromOpenClaw } from "@/lib/planning-utils";
import { transitionTaskStatus } from "@/lib/task-state";
import { broadcast } from "@/lib/events";
import { resolveInternalApiUrl } from "@/lib/internal-api";
import { isOrchestratorEnabled, orchestrateAfterPlanning } from "@/lib/orchestrator";

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
  if ((task as unknown as Record<string, unknown>).planning_complete) {
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
      ...({
        planning_messages: JSON.stringify(storedMessages),
        planning_question_waiting: currentQuestion ? 1 : 0,
      } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

    if (currentQuestion && !complete) {
      const questionTask = getTask(taskId);
      if (questionTask) {
        broadcast({ type: "task_updated", payload: questionTask });
      }
    }

    if (complete && spec) {
      // Mark planning as complete
      updateTask(taskId, {
        ...({
          planning_complete: 1,
          planning_spec: JSON.stringify(spec),
          planning_question_waiting: 0,
        } as Record<string, unknown>),
      } as Parameters<typeof updateTask>[1]);

      // Auto-dispatch: route through orchestrator if enabled, else direct dispatch
      const freshTask = getTask(taskId);
      if (freshTask?.assigned_agent_id) {
        if (isOrchestratorEnabled()) {
          // Fire-and-forget: orchestrator will evaluate spec and dispatch
          orchestrateAfterPlanning(taskId).catch((err) => {
            console.error(`[Planning Poll] Orchestrator post-planning failed for ${taskId}:`, err);
            // Fallback: direct dispatch
            fetch(resolveInternalApiUrl("/api/tasks/dispatch", request.url), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId, agentId: freshTask.assigned_agent_id }),
            }).catch(() => {});
          });
        } else {
          try {
            const dispatchRes = await fetch(resolveInternalApiUrl("/api/tasks/dispatch", request.url), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                taskId,
                agentId: freshTask.assigned_agent_id,
              }),
            });
            if (!dispatchRes.ok) {
              const err = await dispatchRes.json().catch(() => ({}));
              updateTask(taskId, {
                ...({ planning_dispatch_error: err.error || "Dispatch failed" } as Record<string, unknown>),
              } as Parameters<typeof updateTask>[1]);
            }
          } catch (dispatchErr) {
            updateTask(taskId, {
              ...({ planning_dispatch_error: String(dispatchErr) } as Record<string, unknown>),
            } as Parameters<typeof updateTask>[1]);
          }
        }
      } else {
        // Move to inbox for manual dispatch
        transitionTaskStatus(taskId, "inbox", {
          actor: "system",
          reason: "planning_complete_awaiting_dispatch",
          bypassGuards: true,
        });
      }

      const updatedTask = getTask(taskId);
      if (updatedTask) {
        broadcast({ type: "task_updated", payload: updatedTask });
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
    return NextResponse.json(
      { error: "Poll failed", details: String(err) },
      { status: 500 }
    );
  }
}
