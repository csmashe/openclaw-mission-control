import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { listComments, addComment, logActivity } from "@/lib/db";

// GET /api/tasks/comments?taskId=xxx - Get comments for a task
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId is required" },
      { status: 400 }
    );
  }

  const comments = listComments(taskId);
  return NextResponse.json({ comments });
}

// POST /api/tasks/comments - Add a user comment to a task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, content } = body;

    if (!taskId || !content?.trim()) {
      return NextResponse.json(
        { error: "taskId and content are required" },
        { status: 400 }
      );
    }

    const comment = addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "user",
      content: content.trim(),
    });

    logActivity({
      id: uuidv4(),
      type: "comment_added",
      task_id: taskId,
      message: `User added a comment on task`,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to add comment", details: String(error) },
      { status: 500 }
    );
  }
}
