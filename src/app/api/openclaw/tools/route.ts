import { NextRequest, NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

type ToolHandler = (
  client: ReturnType<typeof getOpenClawClient>,
  args: Record<string, unknown>
) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  "sessions.list": (client, args) => {
    const agentId = typeof args.agentId === "string" ? args.agentId : undefined;
    return client.listSessions(agentId ? { agentId } : undefined);
  },
  "sessions.preview": (client, args) => {
    const keys = Array.isArray(args.keys)
      ? args.keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      : [];

    if (keys.length === 0) {
      throw new Error("sessions.preview requires a non-empty string[] in args.keys");
    }

    return client.previewSessions(keys);
  },
  "agents.list": (client) => client.listAgents(),
  "cron.list": (client) => client.listCronJobs(),
  "cron.status": (client) => client.cronStatus(),
  "usage.status": (client) => client.getUsage(),
  "usage.cost": (client) => client.getUsageCost(),
  health: (client) => client.health(),
  status: (client) => client.status(),
  "models.list": (client) => client.listModels(),
  "channels.status": (client) => client.channelsStatus(),
  "skills.status": (client) => client.skillsStatus(),
  "logs.tail": (client) => client.tailLogs(),
};

// Tools Playground API: explicitly allowlisted safe gateway calls only.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tool = typeof body?.tool === "string" ? body.tool : "";
    const args =
      body?.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    if (!tool) {
      return NextResponse.json(
        { ok: false, error: "Missing tool name" },
        { status: 400 }
      );
    }

    const handler = TOOL_HANDLERS[tool];
    if (!handler) {
      return NextResponse.json(
        { ok: false, error: `Tool is not allowed: ${tool}` },
        { status: 403 }
      );
    }

    const client = getOpenClawClient();
    await client.connect();

    const result = await handler(client, args);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
