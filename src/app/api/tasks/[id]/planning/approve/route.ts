import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/db";
import { resolveInternalApiUrl } from "@/lib/internal-api";

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

  if (!(task as unknown as Record<string, unknown>).planning_complete) {
    return NextResponse.json({ error: "Planning not complete" }, { status: 400 });
  }

  if (!task.assigned_agent_id) {
    return NextResponse.json(
      { error: "No agent assigned. Assign an agent first." },
      { status: 400 }
    );
  }

  try {
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

    return NextResponse.json({ ok: true, message: "Task dispatched after planning" });
  } catch (err) {
    return NextResponse.json(
      { error: "Dispatch failed", details: String(err) },
      { status: 500 }
    );
  }
}
