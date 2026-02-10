import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  listMissions,
  getMission,
  createMission,
  updateMission,
  deleteMission,
  logActivity,
} from "@/lib/db";

export async function GET() {
  const missions = listMissions();
  return NextResponse.json({ missions });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const mission = createMission({
    id: uuidv4(),
    name,
    description,
  });

  logActivity({
    id: uuidv4(),
    type: "mission_created",
    mission_id: mission.id,
    message: `Mission "${mission.name}" created`,
  });

  return NextResponse.json({ mission }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...patch } = body;

  if (!id) {
    return NextResponse.json({ error: "Mission ID is required" }, { status: 400 });
  }

  const existing = getMission(id);
  if (!existing) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const mission = updateMission(id, patch);
  return NextResponse.json({ mission });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Mission ID is required" }, { status: 400 });
  }

  deleteMission(id);
  return NextResponse.json({ ok: true });
}
