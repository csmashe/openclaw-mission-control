import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/db";
import {
  isOrchestratorEnabled,
  orchestrateAfterPlanning,
  orchestrateAfterCompletion,
  orchestrateAfterTesting,
} from "@/lib/orchestrator";

// POST /api/tasks/[id]/orchestrate — manual/internal orchestration trigger
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!isOrchestratorEnabled()) {
    return NextResponse.json(
      { error: "Orchestrator is not enabled. Configure an orchestrator agent in Settings." },
      { status: 400 }
    );
  }

  let body: { phase?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected: { phase: 'after_planning' | 'after_completion' | 'after_testing' }" },
      { status: 400 }
    );
  }

  const { phase } = body;

  if (!phase || !["after_planning", "after_completion", "after_testing"].includes(phase)) {
    return NextResponse.json(
      { error: "Invalid phase. Must be: after_planning, after_completion, or after_testing" },
      { status: 400 }
    );
  }

  try {
    switch (phase) {
      case "after_planning":
        await orchestrateAfterPlanning(taskId);
        break;
      case "after_completion":
        await orchestrateAfterCompletion(taskId);
        break;
      case "after_testing":
        await orchestrateAfterTesting(taskId);
        break;
    }

    // Re-fetch task to get updated state
    const updatedTask = getTask(taskId);

    return NextResponse.json({
      ok: true,
      phase,
      taskId,
      resultStatus: updatedTask?.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Orchestration failed", details: String(err) },
      { status: 500 }
    );
  }
}
