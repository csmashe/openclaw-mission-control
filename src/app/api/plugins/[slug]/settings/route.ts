import { NextRequest, NextResponse } from "next/server";
import { getPluginSettings, setPluginSetting, deletePluginSetting } from "@/lib/plugin-db";
import { scanPlugins } from "@/lib/plugins";

// GET /api/plugins/[slug]/settings
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const plugins = scanPlugins();
  if (!plugins.find((p) => p.manifest.slug === slug)) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  const settings = getPluginSettings(slug);
  return NextResponse.json({ settings });
}

// PATCH /api/plugins/[slug]/settings - update plugin settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const plugins = scanPlugins();
  if (!plugins.find((p) => p.manifest.slug === slug)) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        { error: "settings object is required" },
        { status: 400 }
      );
    }

    for (const [key, value] of Object.entries(settings)) {
      if (value === null) {
        deletePluginSetting(slug, key);
      } else {
        setPluginSetting(slug, key, String(value));
      }
    }

    const updated = getPluginSettings(slug);
    return NextResponse.json({ settings: updated });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update settings", details: String(error) },
      { status: 500 }
    );
  }
}
