"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { Agent } from "@/lib/types";

export function CreateTaskModal({ open, onOpenChange, onCreate, agents }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { title: string; description: string; priority: string; assigned_agent_id?: string; startPlanning?: boolean; autoApprovePlan?: boolean }) => void;
  agents: Agent[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [agentId, setAgentId] = useState("none");
  const [startPlanning, setStartPlanning] = useState(false);
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAgentId("none");
    setStartPlanning(false);
    setAutoApprovePlan(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description.trim(),
      priority,
      ...(agentId !== "none" ? { assigned_agent_id: agentId } : {}),
      ...(startPlanning ? { startPlanning: true } : {}),
      ...(startPlanning && autoApprovePlan ? { autoApprovePlan: true } : {}),
    });
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>Add a new task to the inbox.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="task-title" className="text-sm font-medium">Title</label>
              <input
                id="task-title"
                type="text"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="task-description" className="text-sm font-medium">Description</label>
              <textarea
                id="task-description"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-y"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details..."
              />
            </div>
            <div className="flex gap-3">
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Assign to Agent</label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Unassigned</span>
                    </SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-1.5">
                          <Bot className="w-3 h-3" />
                          {a.name || a.id}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="startPlanning"
                  checked={startPlanning}
                  onChange={(e) => {
                    setStartPlanning(e.target.checked);
                    if (!e.target.checked) setAutoApprovePlan(false);
                  }}
                  className="rounded border-input"
                />
                <label htmlFor="startPlanning" className="text-sm text-muted-foreground cursor-pointer">
                  Start with planning phase (AI will ask clarifying questions before dispatch)
                </label>
              </div>
              {startPlanning && (
                <div className="flex items-center gap-2 ml-5">
                  <input
                    type="checkbox"
                    id="autoApprovePlan"
                    checked={autoApprovePlan}
                    onChange={(e) => setAutoApprovePlan(e.target.checked)}
                    className="rounded border-input"
                  />
                  <label htmlFor="autoApprovePlan" className="text-sm text-muted-foreground cursor-pointer">
                    Auto-approve plan and dispatch when ready
                  </label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit">Create Task</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
