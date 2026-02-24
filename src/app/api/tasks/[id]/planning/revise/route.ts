import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask, addComment } from "@/lib/db";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { broadcast } from "@/lib/events";
import { v4 as uuidv4 } from "uuid";

// POST - Send revision feedback to planner and reset spec state
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const body = await request.json();
  const { feedback } = body;

  if (!feedback || !feedback.trim()) {
    return NextResponse.json({ error: "feedback is required" }, { status: 400 });
  }

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const sessionKey = (task as unknown as Record<string, unknown>).planning_session_key as string;
  if (!sessionKey) {
    return NextResponse.json({ error: "Planning not started" }, { status: 400 });
  }

  if (!(task as unknown as Record<string, unknown>).planning_complete) {
    return NextResponse.json({ error: "Planning not complete — nothing to revise" }, { status: 400 });
  }

  const prompt = `The user reviewed your spec and requested changes:\n\n${feedback}\n\nPlease revise the spec and produce an updated completion JSON.`;

  try {
    const client = getOpenClawClient();
    await client.connect();
    await client.sendMessage(sessionKey, prompt);

    // Append feedback to planning messages
    let messages: Array<{ role: string; content: string; timestamp: number }> = [];
    try {
      messages = JSON.parse((task as unknown as Record<string, unknown>).planning_messages as string || "[]");
    } catch { /* empty */ }

    messages.push({ role: "user", content: `[Revision requested] ${feedback}`, timestamp: Date.now() });

    // Reset spec state so polling resumes
    updateTask(taskId, {
      ...({
        planning_messages: JSON.stringify(messages),
        planning_complete: 0,
        planning_spec: null,
        planning_question_waiting: 0,
      } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

    // Log in activity
    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Spec revision requested: ${feedback}`,
    });

    const updatedTask = getTask(taskId);
    if (updatedTask) {
      broadcast({ type: "task_updated", payload: updatedTask });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to send revision feedback", details: String(err) },
      { status: 500 }
    );
  }
}
