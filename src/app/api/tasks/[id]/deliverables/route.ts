import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTask, listDeliverables, addDeliverable, deleteDeliverable } from "@/lib/db";
import { broadcast } from "@/lib/events";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const deliverables = listDeliverables(taskId);
  return NextResponse.json({ deliverables });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const body = await request.json();
  const { title, deliverable_type, path, description } = body;

  if (!title || !deliverable_type) {
    return NextResponse.json(
      { error: "title and deliverable_type are required" },
      { status: 400 }
    );
  }

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const deliverable = addDeliverable({
    id: uuidv4(),
    task_id: taskId,
    deliverable_type,
    title,
    path,
    description,
  });

  broadcast({ type: "deliverable_added", payload: deliverable });

  return NextResponse.json({ deliverable }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const { searchParams } = new URL(request.url);
  const deliverableId = searchParams.get("deliverableId");

  if (!deliverableId) {
    return NextResponse.json({ error: "deliverableId is required" }, { status: 400 });
  }

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  deleteDeliverable(deliverableId);
  return NextResponse.json({ ok: true });
}
