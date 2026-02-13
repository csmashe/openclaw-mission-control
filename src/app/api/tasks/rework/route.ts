import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/db";

// POST /api/tasks/rework - Request rework on a task in review
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, feedback } = body;

    if (!taskId || !feedback?.trim()) {
      return NextResponse.json(
        { error: "taskId and feedback are required" },
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

    if (task.status !== "review") {
      return NextResponse.json(
        { error: "Task must be in review status to request rework" },
        { status: 400 }
      );
    }

    if (!task.assigned_agent_id) {
      return NextResponse.json(
        { error: "Task has no assigned agent for rework" },
        { status: 400 }
      );
    }

    // The actual rework dispatch is handled by /api/tasks/dispatch
    // with the feedback parameter. This endpoint triggers that.
    const dispatchRes = await fetch(
      new URL("/api/tasks/dispatch", request.url).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          agentId: task.assigned_agent_id,
          feedback: feedback.trim(),
        }),
      }
    );

    const dispatchData = await dispatchRes.json();

    if (!dispatchData.ok) {
      return NextResponse.json(
        { error: "Rework dispatch failed", details: dispatchData },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: "rework_dispatched",
      message: `Rework request sent to agent "${task.assigned_agent_id}". Task moved back to in_progress.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Rework failed", details: String(error) },
      { status: 500 }
    );
  }
}
