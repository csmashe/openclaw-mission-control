import { NextRequest, NextResponse } from "next/server";
import { getPluginBundle } from "@/lib/plugins";

// GET /api/plugins/[slug]/bundle - serve plugin JS bundle
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const bundle = getPluginBundle(slug);
  if (!bundle) {
    return NextResponse.json({ error: "Plugin bundle not found" }, { status: 404 });
  }

  return new NextResponse(bundle, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
