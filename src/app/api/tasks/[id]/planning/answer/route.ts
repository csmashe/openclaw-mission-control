import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { getOpenClawClient } from "@/lib/openclaw-client";

// POST - Submit answer to planning question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const body = await request.json();
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

  const answerText = answer.toLowerCase() === "other" && otherText
    ? `Other: ${otherText}`
    : answer;

  const prompt = `User selected: "${answerText}"

Continue with the next question in JSON format, or if all questions have been asked, respond with the completion JSON containing the spec.`;

  try {
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
      ...({ planning_messages: JSON.stringify(messages) } as Record<string, unknown>),
    } as Parameters<typeof updateTask>[1]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to submit answer", details: String(err) },
      { status: 500 }
    );
  }
}
