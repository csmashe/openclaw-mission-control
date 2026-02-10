import { NextRequest, NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

// POST - Create a new agent in OpenClaw
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, name, identity } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId is required" },
        { status: 400 }
      );
    }

    // agents.create requires: name (string), workspace (path)
    // Gateway runs in Docker with HOME=/home/node, workspace at /home/node/.openclaw/workspace
    const agentName = name || agentId;
    const workspace = `/home/node/.openclaw/workspace/${agentId}`;

    const client = getOpenClawClient();
    await client.connect();
    const result = await client.createAgent({
      name: agentName,
      workspace,
    });

    // If identity/SOUL.md content was provided, set it
    if (identity) {
      try {
        await client.setAgentFile(agentId, "SOUL.md", identity);
      } catch {
        // Best effort - agent may already have the file
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create agent", details: String(error) },
      { status: 502 }
    );
  }
}

// GET - List all agents
export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();
    const agents = await client.listAgents();
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect to OpenClaw Gateway", details: String(error) },
      { status: 502 }
    );
  }
}
