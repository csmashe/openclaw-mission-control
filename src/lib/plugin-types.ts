export interface PluginManifest {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  entry: string;
}

export interface PluginRecord {
  slug: string;
  enabled: number; // 0 or 1
  installed_at: string;
  updated_at: string;
}

export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
}

export interface PluginContext {
  pluginSlug: string;
  api: {
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
  navigate(viewId: string): void;
  settings: Record<string, string>;
}
