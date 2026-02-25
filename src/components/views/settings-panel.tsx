"use client";

import { useEffect, useState, useCallback } from "react";
import { Cpu, Check, RefreshCw, Sparkles, AlertTriangle, Workflow, Puzzle } from "lucide-react";
import { PluginManager } from "@/components/views/plugin-manager";

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

interface WorkflowSettings {
  orchestrator_agent_id: string | null;
  planner_agent_id: string | null;
  tester_agent_id: string | null;
  max_rework_cycles: number;
}

interface AgentInfo {
  id: string;
  name?: string;
}

type SettingsTab = "model" | "workflow" | "plugins";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "model", label: "AI Model & Provider", icon: <Sparkles className="w-4 h-4" /> },
  { id: "workflow", label: "Workflow Roles", icon: <Workflow className="w-4 h-4" /> },
  { id: "plugins", label: "Plugins", icon: <Puzzle className="w-4 h-4" /> },
];

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [saved, setSaved] = useState(false);

  // Workflow settings state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>({
    orchestrator_agent_id: null,
    planner_agent_id: null,
    tester_agent_id: null,
    max_rework_cycles: 3,
  });
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowSaved, setWorkflowSaved] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

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

  const fetchWorkflowSettings = useCallback(async () => {
    setWorkflowLoading(true);
    setWorkflowError(null);
    try {
      const [settingsRes, agentsRes] = await Promise.all([
        fetch("/api/settings/workflow"),
        fetch("/api/agents"),
      ]);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setWorkflowSettings(s);
      }
      if (agentsRes.ok) {
        const a = await agentsRes.json();
        setAgents(a.agents ?? a ?? []);
      }
    } catch (err) {
      setWorkflowError(String(err));
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    fetchWorkflowSettings();
  }, [fetchModels, fetchWorkflowSettings]);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSaved(false);
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

  const handleWorkflowSave = async () => {
    setWorkflowSaved(false);
    try {
      const res = await fetch("/api/settings/workflow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflowSettings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setWorkflowError(err.error || "Save failed");
        return;
      }
      const updated = await res.json();
      setWorkflowSettings(updated);
      setWorkflowSaved(true);
      setTimeout(() => setWorkflowSaved(false), 2000);
    } catch (err) {
      setWorkflowError(String(err));
    }
  };

  const currentPreference = getStoredModelPreference();
  const availableModels = data?.byProvider[selectedProvider] ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header + Tabs */}
      <div className="shrink-0 p-6 pb-0 space-y-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            Settings
          </h2>
          <p className="text-muted-foreground mt-2">
            Configure AI models, providers, and multi-agent workflow roles.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — scrollable */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "model" && (
          <div className="space-y-6">
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
        )}

        {activeTab === "plugins" && <PluginManager />}

        {activeTab === "workflow" && (
          <div className="space-y-6">
            {/* Workflow Roles Card */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Workflow className="w-5 h-5 text-blue-400" />
                    Workflow Roles
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Configure multi-agent orchestration for planning, testing, and
                    coordination. Leave disabled for default behavior.
                  </p>
                </div>
                <button
                  onClick={fetchWorkflowSettings}
                  className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-primary"
                  title="Refresh workflow settings"
                >
                  <RefreshCw className={`w-4 h-4 ${workflowLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {workflowError && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{workflowError}</p>
                </div>
              )}

              {workflowLoading && agents.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin mr-3" />
                  Loading workflow settings...
                </div>
              ) : (
                <>
                  {/* Orchestrator Agent */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Orchestrator Agent
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Coordinates handoffs between planning, coding, and testing phases.
                    </p>
                    <select
                      value={workflowSettings.orchestrator_agent_id || ""}
                      onChange={(e) => {
                        setWorkflowSettings((s) => ({
                          ...s,
                          orchestrator_agent_id: e.target.value || null,
                        }));
                        setWorkflowSaved(false);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Disabled (direct routing)</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Planner Agent */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Planner Agent
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Handles spec clarification during the planning phase.
                    </p>
                    <select
                      value={workflowSettings.planner_agent_id || ""}
                      onChange={(e) => {
                        setWorkflowSettings((s) => ({
                          ...s,
                          planner_agent_id: e.target.value || null,
                        }));
                        setWorkflowSaved(false);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Default (main)</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Tester Agent */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Tester Agent
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Validates completed work via code review, lint, types, and browser testing.
                    </p>
                    <select
                      value={workflowSettings.tester_agent_id || ""}
                      onChange={(e) => {
                        setWorkflowSettings((s) => ({
                          ...s,
                          tester_agent_id: e.target.value || null,
                        }));
                        setWorkflowSaved(false);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Disabled (no testing agent)</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Max Rework Cycles */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Max Rework Cycles
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Maximum test-fix loops before escalating to review (0-10).
                    </p>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={workflowSettings.max_rework_cycles}
                      onChange={(e) => {
                        const val = Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0));
                        setWorkflowSettings((s) => ({ ...s, max_rework_cycles: val }));
                        setWorkflowSaved(false);
                      }}
                      className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  {/* Save Button */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleWorkflowSave}
                      className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        workflowSaved
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_15px_oklch(0.58_0.2_260/0.3)]"
                      }`}
                    >
                      {workflowSaved ? (
                        <span className="flex items-center gap-2">
                          <Check className="w-4 h-4" /> Saved
                        </span>
                      ) : (
                        "Save Workflow Settings"
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Info Card */}
            <div className="bg-card/50 border border-border/50 rounded-xl p-5 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">How workflow orchestration works</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>
                  The <strong>Orchestrator</strong> evaluates each phase transition and decides next steps
                </li>
                <li>
                  The <strong>Planner</strong> handles spec clarification (defaults to &quot;main&quot; agent)
                </li>
                <li>
                  The <strong>Tester</strong> validates completed work: lint, types, build, and browser checks
                </li>
                <li>
                  Failed tests loop back to the programmer up to the max rework cycle limit
                </li>
                <li>
                  With no roles configured, behavior is identical to default (direct routing)
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
