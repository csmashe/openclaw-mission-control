import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask, getWorkflowSettings } from "@/lib/db";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { transitionTaskStatus } from "@/lib/task-state";
import { broadcast } from "@/lib/events";
import { extractJSON } from "@/lib/planning-utils";

// GET - Retrieve planning state
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let messages: Array<{ role: string; content: string; timestamp?: number }> = [];
  try {
    messages = JSON.parse(task.planning_messages || "[]");
  } catch { /* empty */ }

  let currentQuestion = null;
  if (messages.length > 0) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      const json = extractJSON(lastAssistant.content);
      if (json && "question" in (json as Record<string, unknown>)) {
        currentQuestion = json;
      }
    }
  }

  let spec = null;
  let agents = null;
  try {
    if (task.planning_spec) {
      spec = JSON.parse(task.planning_spec);
    }
    if (task.planning_agents) {
      agents = JSON.parse(task.planning_agents);
    }
  } catch { /* empty */ }

  return NextResponse.json({
    taskId,
    sessionKey: task.planning_session_key,
    messages,
    currentQuestion,
    isComplete: !!task.planning_complete,
    spec,
    agents,
    dispatchError: task.planning_dispatch_error,
    isStarted: !!task.planning_session_key,
  });
}

// POST - Start planning session
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.planning_session_key) {
    return NextResponse.json({ error: "Planning already started" }, { status: 409 });
  }

  const settings = getWorkflowSettings();
  const plannerAgent = settings.planner_agent_id || "main";
  const sessionKey = `agent:${plannerAgent}:planning:${taskId}`;
  const prompt = `You are a planning agent. Review the task below and produce a detailed specification.

## Task
**Title:** ${task.title}
**Description:** ${task.description || "No description provided."}
**Priority:** ${task.priority}

## Instructions
- If the task description is clear enough, produce the spec immediately — no questions needed.
- If requirements are genuinely ambiguous or critical details are missing, ask ONE clarifying question at a time.
- Question format (JSON): { "question": "...", "options": [{"id": "a", "label": "..."}, ...] }
- Spec format (JSON): { "complete": true, "spec": { "title": "...", "summary": "...", "deliverables": ["..."], "success_criteria": ["..."] } }

Begin — either produce the spec directly, or ask your first question.`;

  try {
    const client = getOpenClawClient();
    await client.connect();
    await client.sendMessage(sessionKey, prompt);

    // Transition to planning
    const transition = transitionTaskStatus(taskId, "planning", {
      actor: "api",
      reason: "planning_started",
      metadata: { sessionKey },
    });

    if (!transition.ok) {
      return NextResponse.json(
        { error: "Cannot transition to planning", reason: transition.blockedReason },
        { status: 409 }
      );
    }

    const messages = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    updateTask(taskId, {
      planning_session_key: sessionKey,
      planning_messages: JSON.stringify(messages),
    });

    const updatedTask = getTask(taskId);
    if (updatedTask) {
      broadcast({ type: "task_updated", payload: updatedTask });
    }

    return NextResponse.json({
      ok: true,
      sessionKey,
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to start planning", details: String(err) },
      { status: 500 }
    );
  }
}

// DELETE - Cancel planning
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  updateTask(taskId, {
    planning_session_key: null,
    planning_messages: "[]",
    planning_complete: 0,
    planning_spec: null,
    planning_agents: null,
    planning_dispatch_error: null,
    planning_question_waiting: 0,
  });

  transitionTaskStatus(taskId, "inbox", {
    actor: "api",
    reason: "planning_cancelled",
    bypassGuards: true,
  });

  const updatedTask = getTask(taskId);
  if (updatedTask) {
    broadcast({ type: "task_updated", payload: updatedTask });
  }

  return NextResponse.json({ ok: true });
}
