import { NextResponse } from "next/server";
import { getWhoWorkingSnapshot } from "@/lib/who-working";

export async function GET() {
  try {
    const snapshot = await getWhoWorkingSnapshot();
    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        generatedAt: new Date().toISOString(),
        workers: [],
        error: `Who's Working internal snapshot failed: ${String(error)}`,
      },
      { status: 500 }
    );
  }
}
