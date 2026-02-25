import { NextRequest, NextResponse } from "next/server";
import { scanPlugins, invalidatePluginCache } from "@/lib/plugins";
import { setPluginEnabled } from "@/lib/plugin-db";
import { broadcast } from "@/lib/events";

// GET /api/plugins - list all discovered plugins
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("rescan") === "1";
  if (force) invalidatePluginCache();
  const plugins = scanPlugins(force);
  return NextResponse.json({ plugins });
}

// POST /api/plugins - enable/disable a plugin
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, enabled } = body;

    if (!slug || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "slug (string) and enabled (boolean) are required" },
        { status: 400 }
      );
    }

    // Verify the plugin exists on disk
    const plugins = scanPlugins();
    const found = plugins.find((p) => p.manifest.slug === slug);
    if (!found) {
      return NextResponse.json(
        { error: `Plugin "${slug}" not found` },
        { status: 404 }
      );
    }

    setPluginEnabled(slug, enabled);
    invalidatePluginCache();

    broadcast({
      type: "plugin_toggled",
      payload: { slug, enabled },
    });

    return NextResponse.json({ ok: true, slug, enabled });
  } catch (error) {
    console.error("[Plugins] Failed to update plugin:", error);
    return NextResponse.json(
      { error: "Failed to update plugin" },
      { status: 500 }
    );
  }
}
