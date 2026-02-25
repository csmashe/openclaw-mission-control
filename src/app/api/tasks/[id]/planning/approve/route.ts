import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask, addComment } from "@/lib/db";
import { resolveInternalApiUrl } from "@/lib/internal-api";
import { isOrchestratorEnabled, orchestrateAfterPlanning } from "@/lib/orchestrator";
import { broadcast } from "@/lib/events";
import { v4 as uuidv4 } from "uuid";

// POST - Approve spec and trigger dispatch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.planning_complete) {
    return NextResponse.json({ error: "Planning not complete" }, { status: 400 });
  }

  if (!task.assigned_agent_id) {
    return NextResponse.json(
      { error: "No agent assigned. Assign an agent first." },
      { status: 400 }
    );
  }

  // Build spec summary for the activity log
  let specContent = "";
  try {
    const specRaw = (task as unknown as Record<string, unknown>).planning_spec as string;
    if (specRaw) {
      const spec = JSON.parse(specRaw);
      const parts = [`Spec approved and dispatched to ${task.assigned_agent_id}`];
      if (spec.title) parts.push(`\nTitle: ${spec.title}`);
      if (spec.summary) parts.push(`Summary: ${spec.summary}`);
      if (spec.deliverables?.length) parts.push(`Deliverables:\n${spec.deliverables.map((d: string) => `  - ${d}`).join("\n")}`);
      if (spec.success_criteria?.length) parts.push(`Success Criteria:\n${spec.success_criteria.map((c: string) => `  - ${c}`).join("\n")}`);
      specContent = parts.join("\n");
    }
  } catch { /* ignore parse errors */ }

  try {
    // Log approval in activity
    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: specContent || `Spec approved and dispatched to ${task.assigned_agent_id}`,
    });

    // Clear any previous dispatch error
    updateTask(taskId, {
      ...({ planning_dispatch_error: null } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

    if (isOrchestratorEnabled()) {
      // Route through orchestrator for spec evaluation + dispatch
      orchestrateAfterPlanning(taskId).catch((err) => {
        console.error(`[Planning Approve] Orchestrator post-planning failed for ${taskId}:`, err);
        const errorDetail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
        updateTask(taskId, {
          ...({ planning_dispatch_error: errorDetail } as Record<string, unknown>),
        } as Parameters<typeof updateTask>[1]);
        const errTask = getTask(taskId);
        if (errTask) broadcast({ type: "task_updated", payload: errTask });
      });

      const updatedTask = getTask(taskId);
      if (updatedTask) broadcast({ type: "task_updated", payload: updatedTask });

      return NextResponse.json({ ok: true, message: "Task sent to orchestrator for evaluation" });
    }

    const dispatchRes = await fetch(resolveInternalApiUrl("/api/tasks/dispatch", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        agentId: task.assigned_agent_id,
      }),
    });

    if (!dispatchRes.ok) {
      const err = await dispatchRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error || "Dispatch failed" },
        { status: 502 }
      );
    }

    const updatedTask = getTask(taskId);
    if (updatedTask) broadcast({ type: "task_updated", payload: updatedTask });

    return NextResponse.json({ ok: true, message: "Task dispatched after planning" });
  } catch (err) {
    return NextResponse.json(
      { error: "Dispatch failed", details: String(err) },
      { status: 500 }
    );
  }
}
