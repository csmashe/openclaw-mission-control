import { NextRequest, NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();
    const approvals = await client.getExecApprovals();
    return NextResponse.json({ approvals });
  } catch (error) {
    return NextResponse.json(
      { error: String(error), approvals: null },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, decision } = body;

    if (!id || !decision) {
      return NextResponse.json(
        { error: "Missing id or decision" },
        { status: 400 }
      );
    }

    const client = getOpenClawClient();
    await client.connect();
    const result = await client.resolveExecApproval({ id, decision });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
