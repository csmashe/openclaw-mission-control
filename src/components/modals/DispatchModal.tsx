"use client";

import { useState } from "react";
import { Send, Bot, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getPriorityStyle } from "@/lib/helpers";
import type { Task, Agent } from "@/lib/types";

export function DispatchModal({ task, agents, onClose, onDispatch }: {
  task: Task;
  agents: Agent[];
  onClose: () => void;
  onDispatch: (taskId: string, agentId: string) => Promise<unknown>;
}) {
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || "");
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleDispatch = async () => {
    if (!selectedAgent) return;
    setDispatching(true);
    try {
      const res = await onDispatch(task.id, selectedAgent);
      setResult((res as { ok: boolean }).ok ? "success" : "error");
    } catch {
      setResult("error");
    }
    setDispatching(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" /> Dispatch Task to Agent
          </DialogTitle>
        </DialogHeader>

        {/* Task summary */}
        <div className="p-3 rounded-md bg-muted border border-border">
          <div className="font-medium text-sm">{task.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{task.description || "No description"}</div>
          <div className="mt-2">
            <Badge variant="outline" className={getPriorityStyle(task.priority).className}>
              {task.priority}
            </Badge>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-yellow-500 p-3 bg-yellow-500/10 rounded-md border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4" />
            No agents available. Go to Agents page to create one first.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Agent</label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4" />
                        {agent.name || agent.id}
                        {agent.model && <span className="text-muted-foreground">({agent.model})</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {result && (
              <div className={`p-3 rounded-md text-sm ${
                result === "success"
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              }`}>
                {result === "success" ? "Task dispatched! Agent is processing..." : "Dispatch failed"}
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {agents.length > 0 && !result && (
            <Button onClick={handleDispatch} disabled={dispatching}>
              {dispatching ? "Dispatching..." : "Send to Agent"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
