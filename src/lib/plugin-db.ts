import { getDb } from "@/lib/db";
import type { PluginRecord } from "@/lib/plugin-types";

export function getPluginRecords(): PluginRecord[] {
  return getDb()
    .prepare("SELECT * FROM plugins ORDER BY slug")
    .all() as PluginRecord[];
}

export function getPluginRecord(slug: string): PluginRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM plugins WHERE slug = ?")
    .get(slug) as PluginRecord | undefined;
}

export function ensurePluginRecord(slug: string): PluginRecord {
  const db = getDb();
  db.prepare(
    `INSERT INTO plugins (slug) VALUES (?) ON CONFLICT(slug) DO NOTHING`
  ).run(slug);
  return db.prepare("SELECT * FROM plugins WHERE slug = ?").get(slug) as PluginRecord;
}

export function setPluginEnabled(slug: string, enabled: boolean): void {
  const db = getDb();
  ensurePluginRecord(slug);
  db.prepare(
    "UPDATE plugins SET enabled = ?, updated_at = datetime('now') WHERE slug = ?"
  ).run(enabled ? 1 : 0, slug);
}

export function getPluginSettings(pluginSlug: string): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM plugin_settings WHERE plugin_slug = ?")
    .all(pluginSlug) as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export function setPluginSetting(pluginSlug: string, key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO plugin_settings (plugin_slug, key, value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(plugin_slug, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(pluginSlug, key, value);
}

export function deletePluginSetting(pluginSlug: string, key: string): void {
  getDb()
    .prepare("DELETE FROM plugin_settings WHERE plugin_slug = ? AND key = ?")
    .run(pluginSlug, key);
}
