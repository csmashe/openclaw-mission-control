import { NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();
    const logs = await client.tailLogs();
    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      { error: String(error), logs: null },
      { status: 500 }
    );
  }
}
