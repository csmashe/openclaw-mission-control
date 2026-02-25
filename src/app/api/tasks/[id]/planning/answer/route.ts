import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { broadcast } from "@/lib/events";

// POST - Submit answer to planning question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch (err) {
      return NextResponse.json(
        { error: "Invalid JSON body", details: err instanceof SyntaxError ? err.message : String(err) },
        { status: 400 }
      );
    }

    const { answer, otherText } = body;

    if (!answer) {
      return NextResponse.json({ error: "answer is required" }, { status: 400 });
    }

    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const sessionKey = (task as unknown as Record<string, unknown>).planning_session_key as string;
    if (!sessionKey) {
      return NextResponse.json({ error: "Planning not started" }, { status: 400 });
    }

    const answerText = String(answer).toLowerCase() === "other" && otherText
      ? `Other: ${otherText}`
      : String(answer);

    const prompt = `User selected: "${answerText}"

If you now have enough clarity, produce the spec immediately. Only ask another question if something critical is still genuinely ambiguous.`;
    const client = getOpenClawClient();
    await client.connect();
    await client.sendMessage(sessionKey, prompt);

    // Update messages
    let messages: Array<{ role: string; content: string; timestamp: number }> = [];
    try {
      messages = JSON.parse((task as unknown as Record<string, unknown>).planning_messages as string || "[]");
    } catch { /* empty */ }

    messages.push({ role: "user", content: answerText, timestamp: Date.now() });

    updateTask(taskId, {
      ...({
        planning_messages: JSON.stringify(messages),
        planning_question_waiting: 0,
      } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

    const updatedTask = getTask(taskId);
    if (updatedTask) {
      broadcast({ type: "task_updated", payload: updatedTask });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to submit answer", details: String(err) },
      { status: 500 }
    );
  }
}
