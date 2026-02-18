import { NextRequest, NextResponse } from "next/server";

function getExpectedToken(): string {
  return (
    process.env.OPENCLAW_API_TOKEN?.trim() ||
    process.env.OPENCLAW_AUTH_TOKEN?.trim() ||
    ""
  );
}

function getProvidedToken(request: NextRequest): string {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-openclaw-token")?.trim() || "";
}

export function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") {
    return NextResponse.next();
  }

  const expectedToken = getExpectedToken();
  if (!expectedToken) {
    return NextResponse.json(
      {
        error:
          "API auth token is not configured. Set OPENCLAW_API_TOKEN (or OPENCLAW_AUTH_TOKEN).",
      },
      { status: 503 }
    );
  }

  const providedToken = getProvidedToken(request);
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/openclaw/:path*", "/api/chat"],
};
