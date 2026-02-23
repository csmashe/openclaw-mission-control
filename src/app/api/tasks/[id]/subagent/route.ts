/**
 * Sub-agent Registration API
 * Register and list OpenClaw sub-agent sessions for tasks.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTask, createSession, listSessions, logActivity } from "@/lib/db";
import { broadcast } from "@/lib/events";

/**
 * POST /api/tasks/[id]/subagent
 * Register a sub-agent session for a task
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const body = await request.json();
    const { openclaw_session_id, agent_name } = body;

    if (!openclaw_session_id) {
      return NextResponse.json(
        { error: "openclaw_session_id is required" },
        { status: 400 }
      );
    }

    const session = createSession({
      id: uuidv4(),
      agent_id: agent_name || undefined,
      openclaw_session_id,
      session_type: "subagent",
      task_id: taskId,
    });

    logActivity({
      id: uuidv4(),
      type: "agent_spawned",
      task_id: taskId,
      agent_id: agent_name || undefined,
      message: `Sub-agent spawned${agent_name ? `: ${agent_name}` : ""} for task "${task.title}"`,
      metadata: {
        sessionId: openclaw_session_id,
        agentName: agent_name,
      },
    });

    broadcast({
      type: "agent_spawned",
      payload: {
        taskId,
        sessionId: openclaw_session_id,
        agentName: agent_name,
      },
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("Error registering sub-agent:", error);
    return NextResponse.json(
      { error: "Failed to register sub-agent" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tasks/[id]/subagent
 * Get all sub-agent sessions for a task
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const sessions = listSessions(taskId);
    const subagentSessions = sessions.filter((s) => s.session_type === "subagent");
    return NextResponse.json(subagentSessions);
  } catch (error) {
    console.error("Error fetching sub-agents:", error);
    return NextResponse.json(
      { error: "Failed to fetch sub-agents" },
      { status: 500 }
    );
  }
}
