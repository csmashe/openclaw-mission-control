import { NextRequest, NextResponse } from "next/server";
import { OpenClawClient } from "@/lib/openclaw-client";

const DEFAULT_SESSION_KEY = "mission-control:general-chat";

function getClient() {
  return new OpenClawClient(
    process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789",
    { authToken: process.env.OPENCLAW_AUTH_TOKEN || "" }
  );
}

/**
 * GET /api/chat — fetch chat history for a session
 */
export async function GET(req: NextRequest) {
  const sessionKey =
    req.nextUrl.searchParams.get("sessionKey") || DEFAULT_SESSION_KEY;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);

  try {
    const client = getClient();
    const messages = await client.getChatHistory(sessionKey, { limit });
    return NextResponse.json({ messages, sessionKey });
  } catch (err: unknown) {
    console.error("[chat] Error fetching history:", err);
    return NextResponse.json(
      { error: "Failed to fetch chat history", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chat — send a message and poll for the assistant reply
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, sessionKey: customSessionKey } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const sessionKey = customSessionKey || DEFAULT_SESSION_KEY;
    const client = getClient();

    // Send the message
    await client.sendMessage(sessionKey, message.trim());

    // Poll for assistant reply (up to 60s)
    const maxAttempts = 30;
    const pollInterval = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const history = await client.getChatHistory(sessionKey, { limit: 5 });

      // Check if we have a new assistant message
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        return NextResponse.json({
          reply: lastMsg,
          sessionKey,
          history: history.slice(-10),
        });
      }
    }

    // Timeout — return what we have
    const finalHistory = await client.getChatHistory(sessionKey, { limit: 10 });
    return NextResponse.json({
      reply: null,
      timeout: true,
      sessionKey,
      history: finalHistory.slice(-10),
    });
  } catch (err: unknown) {
    console.error("[chat] Error sending message:", err);
    return NextResponse.json(
      { error: "Failed to send message", detail: String(err) },
      { status: 500 }
    );
  }
}
