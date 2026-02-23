"use client";

import { Wifi, WifiOff, Terminal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { GatewayStatus } from "@/lib/types";

export function Header({
  gatewayStatus,
  taskCount,
  terminalOpen,
  onToggleTerminal,
}: {
  gatewayStatus: GatewayStatus;
  taskCount: number;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  return (
    <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-6 z-10 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-wider uppercase flex items-center gap-2">
          <span className="text-primary font-mono text-xl">{"//"}</span>
          Mission Control
        </h1>
        <Separator orientation="vertical" className="h-6" />
        <div className="flex items-center gap-2 text-xs font-mono text-primary">
          <span className="relative flex h-2 w-2">
            {gatewayStatus.connected && (
              <span className="ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${gatewayStatus.connected ? "bg-primary" : "bg-destructive"}`} />
          </span>
          {gatewayStatus.connected ? "SYSTEM ONLINE" : "OFFLINE"}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono">
        {/* Connection pill */}
        <div className="flex items-center gap-2 text-muted-foreground bg-muted px-3 py-1.5 rounded border border-border">
          {gatewayStatus.connected ? (
            <Wifi className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-destructive" />
          )}
          <span>ws://127.0.0.1:18789</span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end leading-none gap-1">
            <span className="text-muted-foreground text-[10px] uppercase">Agents</span>
            <span className="font-bold">{gatewayStatus.agentCount}</span>
          </div>
          <div className="flex flex-col items-end leading-none gap-1">
            <span className="text-muted-foreground text-[10px] uppercase">Tasks</span>
            <span className="text-primary font-bold">{taskCount}</span>
          </div>
        </div>

        <Separator orientation="vertical" className="h-6" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleTerminal}
              className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                terminalOpen
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-primary hover:bg-primary/5"
              }`}
            >
              <Terminal className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{terminalOpen ? "Hide terminal" : "Show terminal"}</p>
          </TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}
