import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTask, updateTask } from "@/lib/db";
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
    messages = JSON.parse((task as unknown as Record<string, unknown>).planning_messages as string || "[]");
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
    if ((task as unknown as Record<string, unknown>).planning_spec) {
      spec = JSON.parse((task as unknown as Record<string, unknown>).planning_spec as string);
    }
    if ((task as unknown as Record<string, unknown>).planning_agents) {
      agents = JSON.parse((task as unknown as Record<string, unknown>).planning_agents as string);
    }
  } catch { /* empty */ }

  return NextResponse.json({
    taskId,
    sessionKey: (task as unknown as Record<string, unknown>).planning_session_key,
    messages,
    currentQuestion,
    isComplete: !!(task as unknown as Record<string, unknown>).planning_complete,
    spec,
    agents,
    dispatchError: (task as unknown as Record<string, unknown>).planning_dispatch_error,
    isStarted: !!(task as unknown as Record<string, unknown>).planning_session_key,
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

  if ((task as unknown as Record<string, unknown>).planning_session_key) {
    return NextResponse.json({ error: "Planning already started" }, { status: 409 });
  }

  const sessionKey = `agent:main:planning:${taskId}`;
  const prompt = `You are a planning orchestrator. Your job is to ask clarifying questions about this task and then produce a detailed specification.

## Task
**Title:** ${task.title}
**Description:** ${task.description || "No description provided."}
**Priority:** ${task.priority}

Ask 3-5 multiple-choice questions to clarify requirements. Each response must be valid JSON:
{
  "question": "Your question?",
  "options": [
    {"id": "a", "label": "Option A"},
    {"id": "b", "label": "Option B"},
    {"id": "c", "label": "Option C"},
    {"id": "other", "label": "Other"}
  ]
}

After all questions are answered, respond with a completion JSON:
{
  "complete": true,
  "spec": {
    "title": "...",
    "summary": "...",
    "deliverables": ["..."],
    "success_criteria": ["..."]
  }
}

Start with your first question.`;

  try {
    const client = getOpenClawClient();
    await client.connect();
    await client.sendMessage(sessionKey, prompt);

    // Transition to planning
    transitionTaskStatus(taskId, "planning", {
      actor: "api",
      reason: "planning_started",
      metadata: { sessionKey },
    });

    const messages = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    updateTask(taskId, {
      openclaw_session_key: sessionKey,
      ...({ planning_session_key: sessionKey, planning_messages: JSON.stringify(messages) } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

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
    ...({
      planning_session_key: null,
      planning_messages: "[]",
      planning_complete: 0,
      planning_spec: null,
      planning_agents: null,
      planning_dispatch_error: null,
    } as Record<string, unknown>),
  } as Parameters<typeof updateTask>[1]);

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
