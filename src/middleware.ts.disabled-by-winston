import { NextRequest, NextResponse } from "next/server";

const MC_API_TOKEN = process.env.MC_API_TOKEN;
if (!MC_API_TOKEN) {
  console.warn(
    "[SECURITY WARNING] MC_API_TOKEN not set — write operations restricted to same-origin requests only"
  );
}

/**
 * Check if a request originates from the same host (browser UI).
 * Same-origin browser requests include a Referer or Origin header
 * pointing to the MC server itself.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // If neither origin nor referer is set, this is likely a server-side
  // fetch or a direct curl. Require auth for these (external API calls).
  if (!origin && !referer) return false;

  if (origin) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {
      // Invalid origin header
    }
  }

  if (referer) {
    try {
      if (new URL(referer).host === host) return true;
    } catch {
      // Invalid referer header
    }
  }

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // If MC_API_TOKEN is not set, restrict write operations to same-origin requests.
  // This provides baseline protection against external mutation in dev/local mode.
  if (!MC_API_TOKEN) {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (!isSameOriginRequest(request)) {
        console.warn(
          `[AUTH] Blocked non-same-origin write (${method} ${pathname}) — set MC_API_TOKEN to enable full auth`
        );
        return NextResponse.json(
          {
            error:
              "Unauthorized: MC_API_TOKEN not configured and request is not same-origin",
          },
          { status: 401 }
        );
      }
    }
    return NextResponse.next();
  }

  // Allow same-origin browser requests (UI fetching its own API)
  if (isSameOriginRequest(request)) {
    return NextResponse.next();
  }

  // Check Authorization header for bearer token
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.substring(7);

  if (token !== MC_API_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
