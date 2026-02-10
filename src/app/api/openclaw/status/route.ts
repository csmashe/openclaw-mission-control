import { NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const [health, agents, cronJobs] = await Promise.allSettled([
      client.health(),
      client.listAgents(),
      client.listCronJobs(),
    ]);

    return NextResponse.json({
      connected: true,
      health: health.status === "fulfilled" ? health.value : null,
      agentCount:
        agents.status === "fulfilled"
          ? (agents.value as unknown[]).length
          : 0,
      cronJobCount:
        cronJobs.status === "fulfilled"
          ? (cronJobs.value as unknown[]).length
          : 0,
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: String(error),
      agentCount: 0,
      cronJobCount: 0,
    });
  }
}
