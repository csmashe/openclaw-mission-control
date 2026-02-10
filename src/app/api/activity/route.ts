import { NextResponse } from "next/server";
import { listActivity } from "@/lib/db";

export async function GET() {
  const activity = listActivity({ limit: 50 });
  return NextResponse.json({ activity });
}
