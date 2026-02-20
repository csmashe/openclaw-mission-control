import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function gatewayToken(): string {
  return (
    process.env.OPENCLAW_GATEWAY_TOKEN ||
    process.env.OPENCLAW_AUTH_TOKEN ||
    process.env.OPENCLAW_API_TOKEN ||
    ""
  );
}

async function runOpenclawJson(args: string[]) {
  const token = gatewayToken();
  if (!token) throw new Error("Missing gateway token in environment");

  const gatewayUrl =
    process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";

  const { stdout } = await execFileAsync(
    "openclaw",
    [
      ...args,
      "--url",
      gatewayUrl,
      "--token",
      token,
      "--json",
    ],
    { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
  );

  return JSON.parse(stdout?.trim() || "{}");
}

export async function GET() {
  try {
    const data = await runOpenclawJson(["devices", "list"]);
    const pending = Array.isArray(data?.pending) ? data.pending : [];
    return NextResponse.json({
      ok: true,
      pendingCount: pending.length,
      latestPending: pending.length > 0 ? pending[pending.length - 1] : null,
      pending,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, pendingCount: 0, pending: [], error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await runOpenclawJson(["devices", "approve", "--latest"]);
    const list = await runOpenclawJson(["devices", "list"]);
    const pending = Array.isArray(list?.pending) ? list.pending : [];

    return NextResponse.json({
      ok: true,
      result,
      pendingCount: pending.length,
      latestPending: pending.length > 0 ? pending[pending.length - 1] : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
