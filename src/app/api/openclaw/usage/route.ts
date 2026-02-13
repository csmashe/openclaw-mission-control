import { NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const [usage, cost] = await Promise.allSettled([
      client.getUsage(),
      client.getUsageCost(),
    ]);

    return NextResponse.json({
      usage: usage.status === "fulfilled" ? usage.value : null,
      cost: cost.status === "fulfilled" ? cost.value : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error), usage: null, cost: null },
      { status: 500 }
    );
  }
}
