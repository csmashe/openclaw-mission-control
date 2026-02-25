import { NextRequest, NextResponse } from "next/server";

const BROWSER_SESSION_COOKIE = "mc_browser_session";
const SESSION_CONTEXT = "mission-control-browser-session:v1";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getExpectedToken(): string {
  return process.env.OPENCLAW_API_TOKEN?.trim() || "";
}

function getProvidedToken(request: NextRequest): string {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-openclaw-token")?.trim() || "";
}

function isProtectedApi(pathname: string): boolean {
  return pathname === "/api/chat" || pathname.startsWith("/api/openclaw/");
}

function shouldIssueBrowserSessionCookie(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  if (request.nextUrl.pathname.startsWith("/api")) return false;

  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isSecureCookieRequest(request: NextRequest): boolean {
  const forced = (process.env.MC_COOKIE_SECURE || "").trim().toLowerCase();
  if (forced === "1" || forced === "true") return true;
  if (forced === "0" || forced === "false") return false;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto === "https";

  return request.nextUrl.protocol === "https:";
}

function secureCompare(a: string, b: string): boolean {
  const sa = a || "";
  const sb = b || "";
  const len = Math.max(sa.length, sb.length);

  let mismatch = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }

  return len > 0 && mismatch === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const digestBytes = new Uint8Array(digest);

  return Array.from(digestBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSessionPayload(
  expectedToken: string,
  userAgent: string,
  issuedAtMs: string
): string {
  return `${SESSION_CONTEXT}:${expectedToken}:${userAgent}:${issuedAtMs}`;
}

async function createBrowserSessionProof(
  expectedToken: string,
  userAgent: string
): Promise<string> {
  const issuedAtMs = Date.now().toString();
  const signature = await sha256Hex(
    buildSessionPayload(expectedToken, userAgent, issuedAtMs)
  );

  return `${issuedAtMs}.${signature}`;
}

async function isValidBrowserSessionProof(
  proof: string,
  expectedToken: string,
  userAgent: string
): Promise<boolean> {
  if (!proof) return false;

  const [issuedAtMs, signature] = proof.split(".");
  if (!issuedAtMs || !signature) return false;

  const issuedAt = Number.parseInt(issuedAtMs, 10);
  if (!Number.isFinite(issuedAt)) return false;

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > SESSION_TTL_MS) return false;

  const expectedSignature = await sha256Hex(
    buildSessionPayload(expectedToken, userAgent, issuedAtMs)
  );

  return secureCompare(signature, expectedSignature);
}

export async function proxy(request: NextRequest) {
  const expectedToken = getExpectedToken();
  const pathname = request.nextUrl.pathname;

  if (isProtectedApi(pathname)) {
    if (request.method === "OPTIONS") {
      return NextResponse.next();
    }

    if (!expectedToken) {
      return NextResponse.json(
        {
          error:
            "API auth token is not configured. Set OPENCLAW_API_TOKEN.",
        },
        { status: 503 }
      );
    }

    const providedToken = getProvidedToken(request);
    if (providedToken && secureCompare(providedToken, expectedToken)) {
      return NextResponse.next();
    }

    const userAgent = request.headers.get("user-agent") || "";
    const browserSessionProof =
      request.cookies.get(BROWSER_SESSION_COOKIE)?.value || "";

    if (
      await isValidBrowserSessionProof(
        browserSessionProof,
        expectedToken,
        userAgent
      )
    ) {
      // Inject token server-side for protected route handlers.
      const headers = new Headers(request.headers);
      headers.set("x-openclaw-token", expectedToken);
      return NextResponse.next({ request: { headers } });
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!expectedToken || !shouldIssueBrowserSessionCookie(request)) {
    return NextResponse.next();
  }

  const userAgent = request.headers.get("user-agent") || "";
  const existingProof = request.cookies.get(BROWSER_SESSION_COOKIE)?.value || "";

  if (await isValidBrowserSessionProof(existingProof, expectedToken, userAgent)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set({
    name: BROWSER_SESSION_COOKIE,
    value: await createBrowserSessionProof(expectedToken, userAgent),
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieRequest(request),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
