"use client";

import { Plus, CheckCircle2, MoreHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getColumnDotColor } from "@/lib/helpers";
import type { Task } from "@/lib/types";
import { COLUMNS } from "./ColumnConstants";
import { TaskCard } from "./TaskCard";

export function KanbanBoard({
  getColumnTasks,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverColumn,
  onDeleteTask,
  onDispatchTask,
  onViewTask,
  onMoveToDown,
  onCreateTask,
}: {
  getColumnTasks: (status: string) => Task[];
  onDragStart: (task: Task) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumn: string | null;
  onDeleteTask: (id: string) => void;
  onDispatchTask: (task: Task) => void;
  onViewTask: (task: Task) => void;
  onMoveToDown?: (id: string) => void;
  onCreateTask?: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain p-6">
      <div className="flex h-full min-h-0 min-w-full w-max gap-4">
        {COLUMNS.map((col) => {
          const colTasks = getColumnTasks(col.id);
          const isActive = col.id === "in_progress";
          const isDragOver = dragOverColumn === col.id;

          return (
            <div
              key={col.id}
              className={`flex-1 basis-[20rem] min-w-[18rem] max-w-[24rem] flex min-h-0 flex-col overflow-hidden rounded-lg border backdrop-blur-sm ${
                isActive
                  ? "border-t-2 border-t-primary border-x-border border-b-border column-glow"
                  : "border-border"
              } ${isDragOver ? "ring-2 ring-primary/30" : ""} bg-muted/30`}
            >
              {/* Column Header */}
              <div className="shrink-0 p-3 border-b border-border/50 flex justify-between items-center relative z-10">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${getColumnDotColor(col.id)}`} />
                  <h3 className={`font-bold text-sm tracking-wide ${isActive ? "text-primary" : ""}`}>
                    {col.label}
                  </h3>
                  <span className={`text-[10px] px-1.5 rounded font-mono border ${
                    isActive
                      ? "bg-primary/20 text-primary border-primary/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}>
                    {colTasks.length}
                  </span>
                </div>
                {col.id === "inbox" ? (
                  <button
                    onClick={onCreateTask}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                ) : col.id === "done" ? (
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              {/* Column Body */}
              <ScrollArea className="flex-1 min-h-0">
                <div
                  className="p-3 flex flex-col gap-3 min-h-full min-w-0 overflow-x-hidden relative z-10"
                  onDragOver={(e) => onDragOver(e, col.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, col.id)}
                >
                  {colTasks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground/40 text-xs">
                      Drop tasks here
                    </div>
                  ) : (
                    colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isInProgress={isActive}
                        onDragStart={() => onDragStart(task)}
                        onDelete={() => onDeleteTask(task.id)}
                        onDispatch={() => onDispatchTask(task)}
                        onClick={() => onViewTask(task)}
                        onMoveToDown={onMoveToDown ? () => onMoveToDown(task.id) : undefined}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
