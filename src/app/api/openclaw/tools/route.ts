import { NextRequest, NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

type ToolHandler = (
  client: ReturnType<typeof getOpenClawClient>,
  args: Record<string, unknown>
) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  "sessions.list": (client, args) => {
    if (
      args.agentId !== undefined &&
      (typeof args.agentId !== "string" || args.agentId.trim().length === 0)
    ) {
      throw new ValidationError("sessions.list args.agentId must be a non-empty string");
    }

    const agentId = typeof args.agentId === "string" ? args.agentId.trim() : undefined;
    return client.listSessions(agentId ? { agentId } : undefined);
  },
  "sessions.preview": (client, args) => {
    const keys = Array.isArray(args.keys)
      ? args.keys
          .map((k) => (typeof k === "string" ? k.trim() : ""))
          .filter((k): k is string => k.length > 0)
      : [];

    if (keys.length === 0) {
      throw new ValidationError("sessions.preview requires a non-empty string[] in args.keys");
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
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError || (error as { name?: string })?.name === "SyntaxError") {
        return NextResponse.json(
          { ok: false, error: "Invalid JSON body" },
          { status: 400 }
        );
      }
      throw error;
    }

    const parsedBody = body as { tool?: unknown; args?: unknown };
    const tool = typeof parsedBody.tool === "string" ? parsedBody.tool : "";
    const args =
      parsedBody.args && typeof parsedBody.args === "object" && !Array.isArray(parsedBody.args)
        ? (parsedBody.args as Record<string, unknown>)
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
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
