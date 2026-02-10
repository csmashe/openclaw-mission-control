import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  logActivity,
} from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const mission_id = searchParams.get("mission_id") ?? undefined;
  const assigned_agent_id = searchParams.get("agent_id") ?? undefined;

  const tasks = listTasks({ status, mission_id, assigned_agent_id });
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, status, priority, mission_id, assigned_agent_id } = body;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const task = createTask({
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    mission_id,
    assigned_agent_id,
  });

  logActivity({
    id: uuidv4(),
    type: "task_created",
    task_id: task.id,
    mission_id: task.mission_id ?? undefined,
    message: `Task "${task.title}" created`,
  });

  return NextResponse.json({ task }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...patch } = body;

  if (!id) {
    return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
  }

  const existing = getTask(id);
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const task = updateTask(id, patch);

  if (patch.status && patch.status !== existing.status) {
    logActivity({
      id: uuidv4(),
      type: "task_status_changed",
      task_id: id,
      agent_id: patch.assigned_agent_id ?? existing.assigned_agent_id ?? undefined,
      message: `Task "${existing.title}" moved from ${existing.status} to ${patch.status}`,
      metadata: { from: existing.status, to: patch.status },
    });
  }

  return NextResponse.json({ task });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
  }

  const existing = getTask(id);
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  deleteTask(id);

  logActivity({
    id: uuidv4(),
    type: "task_deleted",
    task_id: id,
    message: `Task "${existing.title}" deleted`,
  });

  return NextResponse.json({ ok: true });
}
