"use client";

import {
  LayoutDashboard,
  Bot,
  Rocket,
  Settings,
  Terminal,
  Wrench,
  DollarSign,
  Shield,
  Clock,
  FileText,
  MessageSquare,
  Users,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ViewId } from "@/lib/types";

const NAV_ITEMS = [
  { id: "board" as const, icon: LayoutDashboard, label: "Dashboard" },
  { id: "who-working" as const, icon: Users, label: "Who's Working" },
  { id: "chat" as const, icon: MessageSquare, label: "Chat" },
  { id: "agents" as const, icon: Bot, label: "Agents" },
  { id: "missions" as const, icon: Rocket, label: "Missions" },
  { id: "tools" as const, icon: Wrench, label: "Tools" },
  { id: "usage" as const, icon: DollarSign, label: "Usage" },
  { id: "approvals" as const, icon: Shield, label: "Approvals" },
  { id: "cron" as const, icon: Clock, label: "Schedules" },
  { id: "logs" as const, icon: FileText, label: "Logs" },
];

export function Sidebar({
  activeView,
  onViewChange,
  onAgentsRefresh,
}: {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  onAgentsRefresh: () => void;
}) {
  return (
    <aside className="w-16 flex flex-col items-center py-6 border-r border-border bg-card/50 z-20 shrink-0">
      {/* Logo */}
      <div className="mb-8 w-10 h-10 rounded bg-primary/20 flex items-center justify-center shadow-[0_0_5px_oklch(0.58_0.2_260/0.3)] cursor-pointer group">
        <Terminal className="w-5 h-5 text-primary group-hover:animate-pulse" />
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-3 w-full items-center">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id && activeView === item.id;
          const Icon = item.icon;
          return (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (item.id) {
                      onViewChange(item.id);
                      if (item.id === "agents") onAgentsRefresh();
                    }
                  }}
                  className={`w-10 h-10 rounded flex items-center justify-center transition-all relative group ${
                    isActive
                      ? "text-primary bg-primary/10 shadow-[0_0_10px_oklch(0.58_0.2_260/0.3)]"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 w-1 h-6 bg-primary rounded-r" />
                  )}
                  <Icon className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="flex flex-col gap-3 w-full items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onViewChange("settings")}
              className={`w-10 h-10 rounded flex items-center justify-center transition-all relative group ${
                activeView === "settings"
                  ? "text-primary bg-primary/10 shadow-[0_0_10px_oklch(0.58_0.2_260/0.3)]"
                  : "text-muted-foreground hover:text-primary hover:bg-primary/5"
              }`}
            >
              {activeView === "settings" && (
                <span className="absolute left-0 w-1 h-6 bg-primary rounded-r" />
              )}
              <Settings className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Settings</p>
          </TooltipContent>
        </Tooltip>
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary border border-primary/30">
          MC
        </div>
      </div>
    </aside>
  );
}
