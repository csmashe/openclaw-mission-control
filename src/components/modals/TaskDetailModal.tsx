"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bot, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getPriorityStyle, timeAgo } from "@/lib/helpers";
import type { Task, TaskComment } from "@/lib/types";
import { DeliverablesList } from "@/components/DeliverablesList";
import { PlanningTab } from "@/components/board/PlanningTab";
import { SubAgentsList } from "@/components/SubAgentsList";

export function TaskDetailModal({ task, onClose, onMoveToDone, onRefresh }: {
  task: Task;
  onClose: () => void;
  onMoveToDone: () => void;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [showRework, setShowRework] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "deliverables" | "planning" | "subagents">(
    task.status === "planning" ? "planning" : "activity"
  );
  const [reworking, setReworking] = useState(false);
  const [prevStatus, setPrevStatus] = useState(task.status);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/comments?taskId=${task.id}`);
      const data = await res.json();
      setComments(data.comments || []);
    } catch {} // retry on next interval
  }, [task.id]);

  useEffect(() => {
    fetchComments().then(() => setLoading(false));
    const interval = setInterval(async () => {
      await fetchComments();
      onRefresh(); // Also refresh task status
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchComments, onRefresh]);

  // Auto-scroll when new comments arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  // Detect status change
  useEffect(() => {
    if (task.status !== prevStatus) {
      setPrevStatus(task.status);
    }
  }, [task.status, prevStatus]);

  const addUserComment = async () => {
    if (!newComment.trim() || sendingComment) return;
    setSendingComment(true);
    try {
      await fetch("/api/tasks/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, content: newComment.trim() }),
      });
      setNewComment("");
      await fetchComments();
    } catch {} finally {
      setSendingComment(false);
    }
  };

  const requestRework = async () => {
    if (!reworkFeedback.trim() || reworking) return;
    setReworking(true);
    try {
      await fetch("/api/tasks/rework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, feedback: reworkFeedback.trim() }),
      });
      setReworkFeedback("");
      setShowRework(false);
      await fetchComments();
      onRefresh();
    } catch {} finally {
      setReworking(false);
    }
  };

  const priority = getPriorityStyle(task.priority);
  const isAgentWorking = task.status === "in_progress" && !!task.assigned_agent_id;
  const isReview = task.status === "review";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] h-[85vh] max-h-[90vh] overflow-hidden flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task.title}
            {isAgentWorking && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-[11px] text-primary font-mono animate-pulse">
                Agent working...
              </span>
            )}
            {isReview && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-500 font-mono">
                Ready for review
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className={priority.className}>
              {priority.label}
            </Badge>
            <span className="text-xs uppercase text-muted-foreground">{task.status.replace("_", " ")}</span>
            {task.assigned_agent_id && (
              <Badge variant="secondary" className="gap-1">
                <Bot className="w-3 h-3" /> {task.assigned_agent_id}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {task.description && (
          <div className="p-3 rounded-md bg-muted border border-border text-sm text-muted-foreground leading-relaxed">
            {task.description}
          </div>
        )}

        {/* Agent Working Indicator */}
        {isAgentWorking && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-background rounded-full flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-primary">{task.assigned_agent_id} is working on this task</div>
              <div className="text-[11px] text-muted-foreground">Response will appear below when complete. Manager monitor will move task to Review.</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border">
          {task.status === "planning" && (
            <button
              onClick={() => setActiveTab("planning")}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "planning"
                  ? "border-violet-500 text-violet-500"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Planning
            </button>
          )}
          <button
            onClick={() => setActiveTab("activity")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "activity"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Activity ({comments.length})
          </button>
          <button
            onClick={() => setActiveTab("deliverables")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "deliverables"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Deliverables
          </button>
          <button
            onClick={() => setActiveTab("subagents")}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "subagents"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Sub-Agents
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 max-h-[46vh] flex flex-col gap-2 overflow-hidden">
          {activeTab === "planning" ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <PlanningTab taskId={task.id} onSpecLocked={onRefresh} />
            </div>
          ) : activeTab === "subagents" ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <SubAgentsList taskId={task.id} />
            </div>
          ) : activeTab === "deliverables" ? (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <DeliverablesList taskId={task.id} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              {loading ? (
                <div className="h-full text-sm text-muted-foreground animate-pulse py-4 text-center overflow-y-auto">Loading...</div>
              ) : comments.length === 0 ? (
                <div className="h-full text-sm text-muted-foreground py-4 text-center overflow-y-auto">
                  No activity yet. Assign an agent to start working on this task.
                </div>
              ) : (
                <div className="h-full overflow-y-scroll pr-3" ref={scrollRef}>
                  <div className="space-y-2">
                    {comments.map((c) => (
                      <div
                        key={c.id}
                        className={`p-3 rounded-md text-sm border ${
                          c.author_type === "agent"
                            ? "bg-primary/5 border-primary/20"
                            : c.author_type === "system"
                            ? "bg-blue-500/5 border-blue-500/20"
                            : "bg-amber-500/5 border-amber-500/20"
                        }`}
                      >
                        <div className={`text-[11px] font-bold uppercase mb-1 ${
                          c.author_type === "agent" ? "text-primary" : c.author_type === "system" ? "text-blue-400" : "text-amber-500"
                        }`}>
                          {c.author_type === "agent" ? `${c.agent_id || "Agent"}` : c.author_type === "system" ? "System" : "You"}
                        </div>
                        <div className="text-foreground whitespace-pre-wrap leading-relaxed text-[13px]">
                          {c.content.length > 800 ? c.content.slice(0, 800) + "..." : c.content}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {timeAgo(c.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Comment Input */}
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUserComment()}
            placeholder="Add a comment..."
          />
          <Button
            size="sm"
            disabled={!newComment.trim() || sendingComment}
            onClick={addUserComment}
          >
            <Send className="w-3 h-3" />
          </Button>
        </div>

        {/* Rework Section (visible in review status) */}
        {isReview && showRework && (
          <div className="space-y-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
            <label className="text-sm font-medium text-amber-500">Rework Instructions</label>
            <textarea
              className="w-full px-3 py-2 rounded-md border border-amber-500/30 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[80px] resize-y"
              value={reworkFeedback}
              onChange={(e) => setReworkFeedback(e.target.value)}
              placeholder="Describe what needs to be changed or improved..."
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowRework(false); setReworkFeedback(""); }}>Cancel</Button>
              <Button
                size="sm"
                disabled={!reworkFeedback.trim() || reworking}
                onClick={requestRework}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {reworking ? "Sending..." : "Send to Agent"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {isReview && !showRework && (
            <Button
              variant="outline"
              onClick={() => setShowRework(true)}
              className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
            >
              Request Rework
            </Button>
          )}
          {isReview && (
            <Button
              onClick={onMoveToDone}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Approve & Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
