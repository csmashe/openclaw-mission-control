import { NextRequest, NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

// Tools Playground API: invokes gateway WebSocket methods directly
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tool, args } = body;

    if (!tool) {
      return NextResponse.json(
        { ok: false, error: "Missing tool name" },
        { status: 400 }
      );
    }

    const client = getOpenClawClient();
    await client.connect();

    // The tool name from the playground uses dot notation matching gateway WS methods
    // e.g. "health", "agents.list", "sessions.list", "cron.list"
    const result = await client.call(tool, args || {});

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
