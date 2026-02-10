import { NextRequest, NextResponse } from "next/server";
import { listComments } from "@/lib/db";

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
