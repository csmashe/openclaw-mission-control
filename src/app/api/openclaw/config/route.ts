import { NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const [config, schema] = await Promise.allSettled([
      client.configGet(),
      client.configSchema(),
    ]);

    return NextResponse.json({
      config: config.status === "fulfilled" ? config.value : null,
      schema: schema.status === "fulfilled" ? schema.value : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error), config: null, schema: null },
      { status: 500 }
    );
  }
}
