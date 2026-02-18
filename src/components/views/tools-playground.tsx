"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Play,
  Star,
  StarOff,
  Copy,
  Check,
  ChevronRight,
  Loader2,
  Wrench,
  Clock,
  Bot,
  Calendar,
  BarChart3,
  MessageSquare,
  Globe,
  Shield,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// Tool definitions with human-friendly names and categories
const TOOL_CATALOG = [
  // Sessions
  { tool: "sessions_list", label: "List Sessions", desc: "Show all active AI sessions", category: "Sessions", icon: MessageSquare, params: [{ name: "agentId", label: "Agent", type: "text", placeholder: "All agents", optional: true }] },
  { tool: "sessions_preview", label: "Preview Session", desc: "See recent messages in a session", category: "Sessions", icon: MessageSquare, params: [{ name: "sessionKey", label: "Session Key", type: "text", placeholder: "agent:main:main" }] },
  // Agents
  { tool: "agents_list", label: "List Agents", desc: "Show all configured AI agents", category: "Agents", icon: Bot, params: [] },
  // Cron
  { tool: "cron_list", label: "List Scheduled Tasks", desc: "Show all recurring AI tasks", category: "Automation", icon: Calendar, params: [] },
  { tool: "cron_status", label: "Scheduler Status", desc: "Check if the scheduler is running", category: "Automation", icon: Calendar, params: [] },
  // Usage
  { tool: "usage_status", label: "Usage Status", desc: "Current token usage and quotas", category: "Usage", icon: BarChart3, params: [] },
  { tool: "usage_cost", label: "Usage Cost", desc: "Total spending so far", category: "Usage", icon: BarChart3, params: [] },
  // System
  { tool: "health", label: "Health Check", desc: "Verify the gateway is healthy", category: "System", icon: Shield, params: [] },
  { tool: "status", label: "System Status", desc: "Full gateway status information", category: "System", icon: Shield, params: [] },
  { tool: "models_list", label: "List Models", desc: "Show all available AI models", category: "System", icon: Database, params: [] },
  { tool: "channels_status", label: "Channel Status", desc: "Status of messaging channels", category: "Channels", icon: Globe, params: [] },
  { tool: "skills_status", label: "Skills Status", desc: "List installed agent skills", category: "System", icon: Wrench, params: [] },
  { tool: "logs_tail", label: "Recent Logs", desc: "Fetch the latest log entries", category: "System", icon: Clock, params: [] },
];

const CATEGORIES = ["All", ...Array.from(new Set(TOOL_CATALOG.map((t) => t.category)))];

interface ToolResult {
  ok: boolean;
  data: unknown;
  duration: number;
  error?: string;
}

export function ToolsPlayground() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedTool, setSelectedTool] = useState(TOOL_CATALOG[0]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mc-tool-favorites");
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    }
    return new Set<string>();
  });

  const filteredTools = TOOL_CATALOG.filter((t) => {
    const matchSearch =
      !search ||
      t.label.toLowerCase().includes(search.toLowerCase()) ||
      t.desc.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All" || t.category === category;
    return matchSearch && matchCategory;
  });

  // Sort favorites to top
  const sortedTools = [...filteredTools].sort((a, b) => {
    const af = favorites.has(a.tool) ? 0 : 1;
    const bf = favorites.has(b.tool) ? 0 : 1;
    return af - bf;
  });

  const toggleFavorite = useCallback(
    (tool: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(tool)) next.delete(tool);
        else next.add(tool);
        localStorage.setItem("mc-tool-favorites", JSON.stringify([...next]));
        return next;
      });
    },
    []
  );

  const runTool = async () => {
    setLoading(true);
    setResult(null);
    const start = Date.now();
    try {
      // Map underscored tool name to the gateway method name (dot-separated)
      const gatewayTool = selectedTool.tool.replace(/_/g, ".");
      const args: Record<string, unknown> = {};
      selectedTool.params.forEach((p) => {
        const val = paramValues[p.name];
        if (!val || !val.trim()) return;

        // Preview Session expects args.keys: string[] in gateway route.
        if (p.name === "sessionKey") {
          args.keys = val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return;
        }

        // Generic array input support (legacy keys param)
        if (p.name === "keys") {
          args[p.name] = val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return;
        }

        args[p.name] = val;
      });

      if (gatewayTool === "sessions.preview" && (!Array.isArray(args.keys) || (args.keys as string[]).length === 0)) {
        setResult({
          ok: false,
          data: null,
          duration: Date.now() - start,
          error: "Please enter at least one session key (e.g., agent:main:main)",
        });
        setLoading(false);
        return;
      }

      const res = await fetch("/api/openclaw/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: gatewayTool, args }),
      });
      const data = await res.json();
      // The WS-based route returns { ok: true, result: ... } or { ok: false, error: "..." }
      setResult({
        ok: data.ok === true,
        data: data.ok ? data.result : data,
        duration: Date.now() - start,
        error: data.ok ? undefined : (data.error || "Unknown error"),
      });
    } catch (err) {
      setResult({
        ok: false,
        data: null,
        duration: Date.now() - start,
        error: String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    setParamValues({});
    setResult(null);
  }, [selectedTool]);

  const Icon = selectedTool.icon;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel — Tool list */}
      <div className="w-72 border-r border-border bg-card/30 flex flex-col shrink-0">
        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools..."
              className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-border">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Tool list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {sortedTools.map((tool) => {
              const TIcon = tool.icon;
              const isActive = selectedTool.tool === tool.tool;
              const isFav = favorites.has(tool.tool);
              return (
                <button
                  key={tool.tool}
                  onClick={() => setSelectedTool(tool)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-left text-sm transition-all group ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "hover:bg-accent text-foreground"
                  }`}
                >
                  <TIcon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      {isFav && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />}
                      {tool.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{tool.desc}</div>
                  </div>
                  {isActive && <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Right panel — Tool details */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tool header */}
        <div className="p-5 border-b border-border bg-card/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{selectedTool.label}</h2>
                <p className="text-sm text-muted-foreground">{selectedTool.desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleFavorite(selectedTool.tool)}
                className="p-2 rounded hover:bg-accent transition-colors"
                title={favorites.has(selectedTool.tool) ? "Remove from favorites" : "Add to favorites"}
              >
                {favorites.has(selectedTool.tool) ? (
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ) : (
                  <StarOff className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <Badge variant="secondary" className="font-mono text-[11px]">
                {selectedTool.category}
              </Badge>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 p-5">
          {/* Parameters */}
          {selectedTool.params.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 tracking-wider">
                Parameters
              </h3>
              <div className="space-y-3">
                {selectedTool.params.map((param) => (
                  <div key={param.name}>
                    <label className="block text-sm font-medium mb-1.5">
                      {param.label}
                      {"optional" in param && param.optional && (
                        <span className="text-muted-foreground text-xs ml-1">(optional)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={paramValues[param.name] || ""}
                      onChange={(e) =>
                        setParamValues((prev) => ({
                          ...prev,
                          [param.name]: e.target.value,
                        }))
                      }
                      placeholder={param.placeholder || ""}
                      className="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Run button */}
          <Button
            onClick={runTool}
            disabled={loading}
            className="mb-6 gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {loading ? "Running..." : "Run Tool"}
          </Button>

          {/* Result */}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase text-muted-foreground tracking-wider">
                  Result
                </h3>
                <div className="flex items-center gap-3 text-xs">
                  <Badge
                    variant={result.ok ? "default" : "destructive"}
                    className="text-[10px]"
                  >
                    {result.ok ? "✅ Success" : "❌ Error"}
                  </Badge>
                  <span className="text-muted-foreground font-mono">
                    {result.duration}ms
                  </span>
                  <button
                    onClick={copyResult}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
              <pre className="bg-muted/50 rounded border border-border p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {result.error
                  ? result.error
                  : JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                Select a tool and press <strong>Run</strong> to see results
              </p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
