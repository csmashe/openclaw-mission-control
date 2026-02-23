"use client";

import { useState } from "react";
import { Bot, Plus, Wifi, WifiOff, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Agent, GatewayStatus } from "@/lib/types";

export function AgentsView({ status, agents, onRefresh }: { status: GatewayStatus; agents: Agent[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [createResult, setCreateResult] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newId.trim()) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: newId.trim(),
          name: newId.trim(),
          identity: newIdentity.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreateResult("success");
        setNewId("");
        setNewIdentity("");
        onRefresh();
        setTimeout(() => { setShowCreate(false); setCreateResult(null); }, 1500);
      } else {
        setCreateResult(`error:${data.error || "Failed to create agent"}`);
      }
    } catch (err) {
      setCreateResult(`error:${String(err)}`);
    }
    setCreating(false);
  };

  if (!status.connected) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <WifiOff className="w-12 h-12 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground">OpenClaw Gateway not connected</p>
          <p className="text-xs text-muted-foreground/70">Make sure the gateway is running at ws://127.0.0.1:18789</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Agents</div>
          <div className="text-2xl font-bold text-primary">{agents.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Cron Jobs</div>
          <div className="text-2xl font-bold text-primary">{status.cronJobCount}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Gateway</div>
          <div className="text-lg font-bold text-green-500 flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Online
          </div>
        </div>
      </div>

      {/* Create button */}
      <Button onClick={() => setShowCreate(!showCreate)} variant={showCreate ? "outline" : "default"}>
        {showCreate ? "Cancel" : <><Plus className="w-4 h-4 mr-1" /> Create Agent</>}
      </Button>

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-primary/20 rounded-lg p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Agent ID</label>
            <input
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="e.g., researcher, writer, reviewer"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Identity / Persona (SOUL.md)</label>
            <textarea
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
              value={newIdentity}
              onChange={(e) => setNewIdentity(e.target.value)}
              placeholder="You are a skilled researcher who finds and summarizes information..."
            />
          </div>
          {createResult && (
            <div className={`p-3 rounded-md text-sm ${
              createResult === "success"
                ? "bg-green-500/10 text-green-500"
                : "bg-destructive/10 text-destructive"
            }`}>
              {createResult === "success" ? "Agent created successfully!" : `${createResult.replace("error:", "")}`}
            </div>
          )}
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Agent in OpenClaw"}
          </Button>
        </div>
      )}

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 hover:shadow-[0_0_15px_oklch(0.58_0.2_260/0.1)] transition-all cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center mb-3">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="font-semibold">{agent.name || agent.id}</div>
            <div className="text-xs text-muted-foreground font-mono">{agent.id}</div>
            {agent.model && (
              <div className="mt-2 text-xs text-primary flex items-center gap-1">
                <Monitor className="w-3 h-3" /> {agent.model}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
