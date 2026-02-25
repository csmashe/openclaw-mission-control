"use client";

import { useEffect, useRef } from "react";
import React from "react";
import { useMissionControl } from "@/lib/store";
import type { PluginInfo } from "@/lib/plugin-types";

// Expose React globally so plugins can use it
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__MC_REACT = React;
}

interface MCPluginRegistry {
  register(slug: string, component: React.ComponentType<{ context: unknown }>): void;
}

export function usePlugins() {
  const { setPlugins, registerPluginComponent } = useMissionControl();
  const loadedSlugs = useRef(new Set<string>());

  // Set up global plugin registry
  useEffect(() => {
    const registry: MCPluginRegistry = {
      register(slug, component) {
        registerPluginComponent(slug, component);
      },
    };
    (window as unknown as Record<string, unknown>).__MC_PLUGINS = registry;

    return () => {
      delete (window as unknown as Record<string, unknown>).__MC_PLUGINS;
    };
  }, [registerPluginComponent]);

  // Fetch plugin list and load enabled bundles
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/plugins");
        if (!res.ok) return;
        const data = await res.json();
        const plugins: PluginInfo[] = data.plugins || [];

        if (cancelled) return;
        setPlugins(plugins);

        // Load enabled plugin bundles
        for (const plugin of plugins) {
          if (!plugin.enabled) continue;
          if (loadedSlugs.current.has(plugin.manifest.slug)) continue;

          try {
            const bundleRes = await fetch(
              `/api/plugins/${plugin.manifest.slug}/bundle`
            );
            if (!bundleRes.ok) continue;
            const code = await bundleRes.text();

            // Evaluate the bundle - it should call window.__MC_PLUGINS.register()
            const fn = new Function(code);
            fn();
            loadedSlugs.current.add(plugin.manifest.slug);
          } catch (err) {
            console.error(
              `[plugins] Failed to load bundle for ${plugin.manifest.slug}:`,
              err
            );
          }
        }
      } catch (err) {
        console.error("[plugins] Failed to fetch plugin list:", err);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [setPlugins, registerPluginComponent]);
}
