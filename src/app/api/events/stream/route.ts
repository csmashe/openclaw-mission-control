import { NextRequest } from "next/server";
import { registerClient, unregisterClient } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      registerClient(controller);

      // Send initial connection message
      const connectMsg = encoder.encode(`: connected\n\n`);
      controller.enqueue(connectMsg);

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          clearInterval(keepAliveInterval);
        }
      }, 30000);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAliveInterval);
        unregisterClient(controller);
        try {
          controller.close();
        } catch {
          // Controller may already be closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
