"use client";

import { useEffect, useState, useCallback } from "react";
import { Cpu, Check, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";

interface GatewayModel {
  id: string;
  name?: string;
  provider?: string;
  description?: string;
}

interface ModelsResponse {
  models: GatewayModel[];
  byProvider: Record<string, GatewayModel[]>;
  providers: string[];
  defaultModel?: string;
  defaultProvider?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  "google-antigravity": "Google Antigravity",
  google: "Google (Gemini)",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  "google-gemini-cli": "Google Gemini CLI",
  "google-vertex": "Google Vertex AI",
  xai: "xAI (Grok)",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral AI",
  "amazon-bedrock": "Amazon Bedrock",
  "azure-openai-responses": "Azure OpenAI",
  cerebras: "Cerebras",
  "github-copilot": "GitHub Copilot",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi Coding",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax (CN)",
  opencode: "OpenCode",
  "vercel-ai-gateway": "Vercel AI Gateway",
  zai: "Z.AI",
};

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  "google-antigravity": "🚀",
  google: "🔵",
  openai: "🟢",
  "openai-codex": "💻",
  xai: "⚡",
  openrouter: "🔀",
  groq: "⚡",
  mistral: "🌬️",
  "amazon-bedrock": "☁️",
  "google-vertex": "🔷",
  "github-copilot": "🐙",
};

const STORAGE_KEY = "mc:preferred-model";

export interface ModelPreference {
  provider: string;
  model: string;
}

export function getStoredModelPreference(): ModelPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function SettingsPanel() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ModelsResponse = await res.json();
      setData(json);

      // Load saved preference or use defaults
      const stored = getStoredModelPreference();
      if (stored) {
        setSelectedProvider(stored.provider);
        setSelectedModel(stored.model);
      } else if (json.defaultProvider && json.defaultModel) {
        setSelectedProvider(json.defaultProvider);
        setSelectedModel(json.defaultModel);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSaved(false);
    // Auto-select first model for this provider
    if (data?.byProvider[provider]?.length) {
      setSelectedModel(data.byProvider[provider][0].id);
    } else {
      setSelectedModel("");
    }
  };

  const handleSave = () => {
    if (!selectedProvider || !selectedModel) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ provider: selectedProvider, model: selectedModel })
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearOverride = () => {
    localStorage.removeItem(STORAGE_KEY);
    if (data?.defaultProvider) setSelectedProvider(data.defaultProvider);
    if (data?.defaultModel) setSelectedModel(data.defaultModel);
    setSaved(false);
  };

  const currentPreference = getStoredModelPreference();
  const availableModels =
    data?.byProvider[selectedProvider] ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          Settings
        </h2>
        <p className="text-muted-foreground mt-2">
          Configure your default AI model and provider for task processing.
        </p>
      </div>

      {/* Model Selection Card */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              AI Model &amp; Provider
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Choose which AI model processes your tasks. This affects all newly
              dispatched tasks.
            </p>
          </div>
          <button
            onClick={fetchModels}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-primary"
            title="Refresh models"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Failed to load models
              </p>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-3" />
            Loading models from gateway...
          </div>
        )}

        {data && (
          <>
            {/* Current Active */}
            {currentPreference && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                <p className="text-xs font-medium text-primary/80 uppercase tracking-wider mb-1">
                  Active Override
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {PROVIDER_ICONS[currentPreference.provider] || "🔧"}
                    </span>
                    <div>
                      <span className="font-semibold">
                        {PROVIDER_LABELS[currentPreference.provider] ||
                          currentPreference.provider}
                      </span>
                      <span className="text-muted-foreground mx-2">/</span>
                      <span className="text-sm font-mono">
                        {currentPreference.model}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleClearOverride}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Clear Override
                  </button>
                </div>
              </div>
            )}

            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium mb-3">Provider</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {data.providers.map((provider) => {
                  const count = data.byProvider[provider]?.length ?? 0;
                  const isActive = provider === selectedProvider;
                  return (
                    <button
                      key={provider}
                      onClick={() => handleProviderChange(provider)}
                      className={`relative p-3 rounded-lg border text-left transition-all group ${
                        isActive
                          ? "border-primary bg-primary/10 shadow-[0_0_10px_oklch(0.58_0.2_260/0.2)]"
                          : "border-border hover:border-primary/50 hover:bg-muted/30"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute top-2 right-2">
                          <Check className="w-3.5 h-3.5 text-primary" />
                        </span>
                      )}
                      <span className="text-lg block mb-1">
                        {PROVIDER_ICONS[provider] || "🔧"}
                      </span>
                      <span
                        className={`text-sm font-medium block truncate ${
                          isActive ? "text-primary" : ""
                        }`}
                      >
                        {PROVIDER_LABELS[provider] || provider}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {count} model{count !== 1 ? "s" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model Selection */}
            {selectedProvider && availableModels.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-3">
                  Model
                  <span className="text-muted-foreground font-normal ml-2">
                    ({availableModels.length} available)
                  </span>
                </label>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                  {availableModels.map((model) => {
                    const isActive = model.id === selectedModel;
                    return (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setSaved(false);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 transition-all ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <div className="text-left">
                          <span className="text-sm font-medium block">
                            {model.name || model.id}
                          </span>
                          {model.name && model.name !== model.id && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {model.id}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <Check className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={!selectedProvider || !selectedModel}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  saved
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : !selectedProvider || !selectedModel
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_15px_oklch(0.58_0.2_260/0.3)]"
                }`}
              >
                {saved ? (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" /> Saved
                  </span>
                ) : (
                  "Save as Default"
                )}
              </button>
              {!saved && selectedProvider && selectedModel && (
                <span className="text-xs text-muted-foreground">
                  New tasks will use{" "}
                  <span className="font-mono text-primary">
                    {selectedProvider}/{selectedModel}
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Info Card */}
      <div className="bg-card/50 border border-border/50 rounded-xl p-5 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How model selection works</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            Your selection is saved locally and applied when dispatching new tasks
          </li>
          <li>
            The session is patched with the model override before the agent starts
            processing
          </li>
          <li>Existing in-progress tasks keep their original model assignment</li>
          <li>
            Clear the override to use the gateway&apos;s default model for new tasks
          </li>
        </ul>
      </div>
    </div>
  );
}
