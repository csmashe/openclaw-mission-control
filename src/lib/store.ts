"use client";

import { create } from "zustand";
import type { Task, ActivityEntry, Agent, GatewayStatus, DevicePairStatus, ViewId } from "./types";

interface MissionControlState {
  // Data
  tasks: Task[];
  activity: ActivityEntry[];
  agents: Agent[];
  gatewayStatus: GatewayStatus;
  devicePairStatus: DevicePairStatus;

  // UI State
  selectedTask: Task | null;
  activeView: ViewId;
  isOnline: boolean;
  showCreateModal: boolean;
  showDispatchModal: Task | null;
  showTaskDetail: Task | null;
  terminalOpen: boolean;

  // Setters
  setTasks: (tasks: Task[]) => void;
  setActivity: (activity: ActivityEntry[]) => void;
  addActivity: (entry: ActivityEntry) => void;
  setAgents: (agents: Agent[]) => void;
  setGatewayStatus: (status: GatewayStatus) => void;
  setDevicePairStatus: (status: DevicePairStatus) => void;
  setIsOnline: (online: boolean) => void;
  setActiveView: (view: ViewId) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowDispatchModal: (task: Task | null) => void;
  setShowTaskDetail: (task: Task | null) => void;
  setTerminalOpen: (open: boolean) => void;

  // Task mutations
  updateTask: (task: Task) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
}

export const useMissionControl = create<MissionControlState>((set) => ({
  // Initial state
  tasks: [],
  activity: [],
  agents: [],
  gatewayStatus: { connected: false, agentCount: 0, cronJobCount: 0 },
  devicePairStatus: { pendingCount: 0 },
  selectedTask: null,
  activeView: "board",
  isOnline: false,
  showCreateModal: false,
  showDispatchModal: null,
  showTaskDetail: null,
  terminalOpen: false,

  // Setters
  setTasks: (tasks) => set({ tasks }),
  setActivity: (activity) => set({ activity }),
  addActivity: (entry) =>
    set((state) => ({ activity: [entry, ...state.activity].slice(0, 100) })),
  setAgents: (agents) => set({ agents }),
  setGatewayStatus: (gatewayStatus) => set({ gatewayStatus }),
  setDevicePairStatus: (devicePairStatus) => set({ devicePairStatus }),
  setIsOnline: (isOnline) => set({ isOnline }),
  setActiveView: (activeView) => {
    if (typeof window !== "undefined") {
      window.location.hash = activeView === "board" ? "" : activeView;
    }
    set({ activeView });
  },
  setShowCreateModal: (showCreateModal) => set({ showCreateModal }),
  setShowDispatchModal: (showDispatchModal) => set({ showDispatchModal }),
  setShowTaskDetail: (showTaskDetail) => set({ showTaskDetail }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),

  // Task mutations
  updateTask: (updatedTask) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === updatedTask.id ? updatedTask : task
      ),
      // Also update showTaskDetail if viewing this task
      showTaskDetail:
        state.showTaskDetail?.id === updatedTask.id
          ? updatedTask
          : state.showTaskDetail,
    })),
  addTask: (task) =>
    set((state) => {
      if (state.tasks.some((t) => t.id === task.id)) return state;
      return { tasks: [task, ...state.tasks] };
    }),
  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),
}));
