"use client";

import { Bot, Send, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPriorityStyle, timeAgo } from "@/lib/helpers";
import type { Task } from "@/lib/types";

export function TaskCard({
  task,
  isInProgress,
  onDragStart,
  onDelete,
  onDispatch,
  onClick,
  onMoveToDown,
}: {
  task: Task;
  isInProgress?: boolean;
  onDragStart: () => void;
  onDelete: () => void;
  onDispatch: () => void;
  onClick: () => void;
  onMoveToDown?: () => void;
}) {
  const showDispatch = task.status === "inbox" && !task.assigned_agent_id;
  const showDone = task.status === "review";
  const isReview = task.status === "review";
  const isAgentWorking = isInProgress && !!task.assigned_agent_id;
  const isDone = task.status === "done";
  const isPlanning = task.status === "planning";
  const hasQuestionWaiting = isPlanning && task.planning_question_waiting === 1;
  const priority = getPriorityStyle(task.priority);

  return (
    <div
      className={`group min-w-0 bg-card p-4 rounded border shadow-sm hover:shadow-[0_0_15px_oklch(0.58_0.2_260/0.1)] transition-all cursor-pointer relative overflow-hidden ${
        isAgentWorking
          ? "border-primary/50 animate-[pulse_3s_ease-in-out_infinite]"
          : isReview
          ? "border-amber-500/50 shadow-[0_0_10px_oklch(0.75_0.15_85/0.1)]"
          : isDone
          ? "border-border opacity-60 hover:opacity-100"
          : "border-border hover:border-primary/50"
      }`}
      draggable={!isAgentWorking}
      onDragStart={isAgentWorking ? undefined : onDragStart}
      onClick={onClick}
    >
      {/* Active task left accent */}
      {isInProgress && task.assigned_agent_id && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
      )}

      {/* Header: priority + ID */}
      <div className={`flex justify-between items-start mb-2 ${isInProgress && task.assigned_agent_id ? "pl-2" : ""}`}>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${priority.className} ${isDone ? "line-through" : ""}`}>
          {priority.label}
        </span>
        <span className={`text-[10px] font-mono text-muted-foreground ${isDone ? "line-through" : ""}`}>
          #{task.sort_order}
        </span>
      </div>

      {/* Title */}
      <h4 className={`min-w-0 break-words text-sm font-medium mb-3 leading-snug ${
        isInProgress && task.assigned_agent_id ? "pl-2" : ""
      } ${isDone ? "line-through text-muted-foreground" : ""}`}>
        {task.title}
      </h4>

      {/* Progress bar for active tasks */}
      {isInProgress && task.assigned_agent_id && (
        <div className="w-full h-1 bg-muted rounded-full mb-3 ml-2 overflow-hidden" style={{ width: "calc(100% - 8px)" }}>
          <div className="h-full bg-primary w-2/3 animate-pulse" />
        </div>
      )}

      {/* Footer */}
      <div className={`flex justify-between items-center pt-2 border-t border-border/50 ${
        isInProgress && task.assigned_agent_id ? "pl-2" : ""
      }`}>
        <div className="flex items-center gap-2">
          {task.assigned_agent_id ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary flex items-center justify-center">
                  <Bot className="w-3 h-3 text-primary" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-background rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_lime]" />
                </div>
              </div>
              <span className="max-w-28 truncate text-[10px] text-primary font-mono" title={task.assigned_agent_id}>{task.assigned_agent_id}</span>
            </div>
          ) : isDone ? (
            <div className="w-6 h-6 rounded-full bg-green-900/30 border border-green-800 flex items-center justify-center text-[10px] text-green-500">
              ✓
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] text-muted-foreground">
              ?
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isAgentWorking && (
            <span className="text-[10px] font-mono text-primary animate-pulse">Working...</span>
          )}
          {hasQuestionWaiting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-500">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Question waiting
            </span>
          )}
          {isPlanning && !hasQuestionWaiting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-violet-500">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
              Planning...
            </span>
          )}
          {isReview && (
            <span className="text-[10px] font-mono text-amber-500">Needs Review</span>
          )}
          {showDispatch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDispatch(); }}
              className="h-6 px-2 text-[10px] text-primary hover:text-primary"
            >
              <Send className="w-3 h-3 mr-1" /> Dispatch
            </Button>
          )}
          {showDone && onMoveToDown && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onMoveToDown(); }}
              className="h-6 px-2 text-[10px] text-green-500 hover:text-green-400"
            >
              <CheckCircle2 className="w-3 h-3 mr-1" /> Done
            </Button>
          )}
          {!isDone && (
            <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(task.created_at)}</span>
          )}
          {isDone && (
            <span className="text-[10px] font-mono text-green-600/70">{timeAgo(task.updated_at)}</span>
          )}
          <button
            type="button"
            draggable={false}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-70 group-hover:opacity-100 ml-1 text-muted-foreground hover:text-destructive transition-all"
            aria-label="Delete task"
            title="Delete task"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
