import fs from "fs";
import path from "path";
import type { PluginManifest, PluginInfo } from "@/lib/plugin-types";
import { getPluginRecords, ensurePluginRecord } from "@/lib/plugin-db";

const PLUGINS_DIR = path.join(
  process.env.HOME || "/home/csmashe",
  ".openclaw/mission-control/plugins"
);

let cachedPlugins: PluginInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

function parseManifest(dirPath: string): PluginManifest | null {
  const manifestPath = path.join(dirPath, "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Validate required fields
    if (!parsed.name || !parsed.slug || !parsed.version || !parsed.entry) {
      console.warn(`[plugins] Invalid manifest in ${dirPath}: missing required fields`);
      return null;
    }

    return {
      name: parsed.name,
      slug: parsed.slug,
      version: parsed.version,
      description: parsed.description || "",
      author: parsed.author || "",
      icon: parsed.icon || "puzzle",
      entry: parsed.entry,
    };
  } catch (err) {
    console.warn(`[plugins] Failed to parse manifest in ${dirPath}:`, err);
    return null;
  }
}

export function scanPlugins(force = false): PluginInfo[] {
  const now = Date.now();
  if (!force && cachedPlugins && now - cacheTimestamp < CACHE_TTL) {
    return cachedPlugins;
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    cachedPlugins = [];
    cacheTimestamp = now;
    return [];
  }

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const manifests: PluginManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = parseManifest(path.join(PLUGINS_DIR, entry.name));
    if (manifest && manifest.slug === entry.name) {
      manifests.push(manifest);
    }
  }

  // Ensure DB records exist for all discovered plugins
  for (const m of manifests) {
    ensurePluginRecord(m.slug);
  }

  // Build combined info
  const records = getPluginRecords();
  const recordMap = new Map(records.map((r) => [r.slug, r]));

  const plugins: PluginInfo[] = manifests.map((manifest) => ({
    manifest,
    enabled: recordMap.get(manifest.slug)?.enabled === 1,
  }));

  cachedPlugins = plugins;
  cacheTimestamp = now;
  return plugins;
}

export function invalidatePluginCache(): void {
  cachedPlugins = null;
  cacheTimestamp = 0;
}

export function getPluginBundle(slug: string): string | null {
  const plugins = scanPlugins();
  const plugin = plugins.find((p) => p.manifest.slug === slug);
  if (!plugin) return null;

  const bundlePath = path.join(PLUGINS_DIR, slug, plugin.manifest.entry);
  if (!fs.existsSync(bundlePath)) return null;

  return fs.readFileSync(bundlePath, "utf-8");
}
