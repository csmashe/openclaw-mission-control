"use client";

import { useState, useCallback, useEffect } from "react";
import { RefreshCw, Puzzle, Check, X, AlertTriangle } from "lucide-react";
import type { PluginInfo } from "@/lib/plugin-types";

export function PluginManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);

  const fetchPlugins = useCallback(async (rescan = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = rescan ? "/api/plugins?rescan=1" : "/api/plugins";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const togglePlugin = async (slug: string, enabled: boolean) => {
    setTogglingSlug(slug);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to toggle plugin");
        return;
      }
      // Refresh to get updated state
      await fetchPlugins();
    } catch (err) {
      setError(String(err));
    } finally {
      setTogglingSlug(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-purple-400" />
              Plugins
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Manage installed plugins. Plugins live in{" "}
              <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded">~/.openclaw/mission-control/plugins/</code>
            </p>
          </div>
          <button
            onClick={() => fetchPlugins(true)}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-primary"
            title="Rescan plugins directory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {loading && plugins.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-3" />
            Scanning plugins...
          </div>
        ) : plugins.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Puzzle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No plugins found</p>
            <p className="text-xs mt-1">
              Create a directory in <code>~/.openclaw/mission-control/plugins/</code> with a{" "}
              <code>plugin.json</code> manifest.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => (
              <div
                key={plugin.manifest.slug}
                className="flex items-center justify-between p-4 border border-border rounded-lg bg-background/50 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Puzzle className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{plugin.manifest.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        v{plugin.manifest.version}
                      </span>
                    </div>
                    {plugin.manifest.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {plugin.manifest.description}
                      </p>
                    )}
                    {plugin.manifest.author && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        by {plugin.manifest.author}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => togglePlugin(plugin.manifest.slug, !plugin.enabled)}
                  disabled={togglingSlug === plugin.manifest.slug}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    plugin.enabled
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30"
                      : "bg-muted/50 text-muted-foreground border border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                  }`}
                >
                  {togglingSlug === plugin.manifest.slug ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : plugin.enabled ? (
                    <>
                      <Check className="w-4 h-4" />
                      Enabled
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      Disabled
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card/50 border border-border/50 rounded-xl p-5 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How plugins work</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Plugins are directories containing a <code>plugin.json</code> manifest and a bundled JS entry file</li>
          <li>Enabled plugins appear as icons in the sidebar and render their React component in the content area</li>
          <li>Plugins receive a context object with API helpers, navigation, and settings access</li>
          <li>Click &quot;Rescan&quot; after adding new plugins to the directory</li>
        </ul>
      </div>
    </div>
  );
}
