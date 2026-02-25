"use client";

import React from "react";
import { useMissionControl } from "@/lib/store";
import type { PluginContext } from "@/lib/plugin-types";
import type { ViewId } from "@/lib/types";
import { AlertTriangle, RefreshCw } from "lucide-react";

function makePluginContext(slug: string, navigate: (viewId: ViewId) => void): PluginContext {
  const apiCall = async (path: string, method: string, body?: unknown) => {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `API error: ${res.status} ${res.statusText}`);
    }
    return data;
  };

  return {
    pluginSlug: slug,
    api: {
      get: (path) => apiCall(path, "GET"),
      post: (path, body) => apiCall(path, "POST", body),
      patch: (path, body) => apiCall(path, "PATCH", body),
      delete: (path) => apiCall(path, "DELETE"),
    },
    navigate: (viewId) => navigate(viewId as ViewId),
    settings: {},
  };
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PluginErrorBoundary extends React.Component<
  { children: React.ReactNode; slug: string },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; slug: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-8 max-w-lg text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
            <h3 className="text-lg font-semibold">Plugin Error</h3>
            <p className="text-sm text-muted-foreground">
              The plugin <span className="font-mono text-foreground">{this.props.slug}</span> encountered an error.
            </p>
            <pre className="text-xs text-left bg-background/50 rounded-lg p-4 overflow-auto max-h-32">
              {this.state.error?.message || "Unknown error"}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function PluginViewWrapper() {
  const { activeView, pluginComponents, plugins, setActiveView } = useMissionControl();

  if (!activeView.startsWith("plugin:")) return null;

  const slug = activeView.replace("plugin:", "");
  const Component = pluginComponents[slug];
  const plugin = plugins.find((p) => p.manifest.slug === slug);

  if (!Component) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-lg font-semibold">Plugin Not Loaded</h3>
          <p className="text-sm text-muted-foreground">
            {plugin
              ? `The plugin "${plugin.manifest.name}" has not loaded its component yet.`
              : `No plugin found for slug "${slug}".`}
          </p>
        </div>
      </div>
    );
  }

  const context = makePluginContext(slug, setActiveView);

  return (
    <PluginErrorBoundary slug={slug}>
      <Component context={context} />
    </PluginErrorBoundary>
  );
}
