import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  buildDeviceAuthPayload,
  loadOrCreateGatewayDeviceAuth,
  persistGatewayDeviceToken,
  publicKeyRawBase64Url,
  signDevicePayload,
  type GatewayDeviceAuth,
} from "@/lib/openclaw-device-auth";

// --- Types ---

export interface OpenClawAgent {
  id: string;
  name?: string;
  model?: string;
  status?: string;
  sessionKey?: string;
}

export interface OpenClawSession {
  key: string;
  agentId?: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  lastActivity?: string;
}

export interface OpenClawCronJob {
  id: string;
  agentId?: string;
  schedule: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  prompt?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

type EventCallback = (data: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Gateway protocol frame types
interface EventFrame {
  type: "event";
  event: string;
  seq?: number;
  payload?: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string; code?: number };
}

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface HelloOkPayload {
  type?: string;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
}

// --- Client ---

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private url: string;
  private gatewayToken: string;
  private deviceAuth: GatewayDeviceAuth | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private authenticated = false;
  private connectResolve?: () => void;
  private connectReject?: (err: Error) => void;

  constructor(
    url = "ws://127.0.0.1:18789",
    opts?: { gatewayToken?: string; authToken?: string }
  ) {
    this.url = url;
    this.gatewayToken = opts?.gatewayToken ?? opts?.authToken ?? "";

    try {
      this.deviceAuth = loadOrCreateGatewayDeviceAuth();
    } catch (err) {
      console.warn("[openclaw-client] Failed to load/create gateway device auth; continuing without device auth", err);
      this.deviceAuth = null;
    }
  }

  // --- Connection with proper Gateway protocol ---

  async connect(): Promise<void> {
    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      try {
        this.ws = new WebSocket(this.url, {
          maxPayload: 25 * 1024 * 1024,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const connectTimeout = setTimeout(() => {
        reject(new Error("Gateway connection timeout (10s)"));
        this.ws?.close();
      }, 10000);

      this.ws.on("open", () => {
        this.connected = true;
        // Wait for connect.challenge event from server
        // The server will send it, and handleMessage will process it
      });

      this.ws.on("message", (raw: WebSocket.Data) => {
        try {
          const parsed = JSON.parse(raw.toString());
          this.handleMessage(parsed, connectTimeout);
        } catch {
          // Ignore non-JSON
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.authenticated = false;
        clearTimeout(connectTimeout);
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        if (!this.authenticated) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  isConnected(): boolean {
    return (
      this.authenticated && this.ws?.readyState === WebSocket.OPEN
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 3000);
  }

  // --- Protocol handling ---

  private handleMessage(
    msg: Record<string, unknown>,
    connectTimeout?: ReturnType<typeof setTimeout>
  ): void {
    // Event frame
    if (msg.type === "event") {
      const evt = msg as unknown as EventFrame;

      // Handle connect.challenge - send connect request
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: string } | undefined;
        const nonce = payload?.nonce;
        this.sendConnectRequest(nonce, connectTimeout);
        return;
      }

      // Broadcast to event listeners
      const listeners = this.eventListeners.get(evt.event);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(evt.payload ?? evt); } catch { /* ignore */ }
        }
      }
      const wildcardListeners = this.eventListeners.get("*");
      if (wildcardListeners) {
        for (const cb of wildcardListeners) {
          try { cb({ event: evt.event, payload: evt.payload, seq: evt.seq }); } catch { /* ignore */ }
        }
      }
      return;
    }

    // Response frame
    if (msg.type === "res") {
      const res = msg as unknown as ResponseFrame;
      const pending = this.pendingRequests.get(res.id);
      if (!pending) return;

      // Skip only "accepted" ack (connect handshake).
      // "started" from chat.send should resolve — agent processes asynchronously via events.
      if (
        res.ok &&
        typeof res.payload === "object" &&
        res.payload !== null &&
        (res.payload as Record<string, unknown>).status === "accepted"
      ) {
        return;
      }

      this.pendingRequests.delete(res.id);
      clearTimeout(pending.timeout);

      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(
          new Error(res.error?.message ?? "Unknown gateway error")
        );
      }
    }
  }

  private sendConnectRequest(
    nonce?: string,
    connectTimeout?: ReturnType<typeof setTimeout>
  ): void {
    const id = randomUUID();
    const role = "operator";
    const scopes = ["operator.read", "operator.admin"];
    const clientId = "cli";
    const clientMode = "ui";

    const authToken = this.deviceAuth?.deviceToken || this.gatewayToken;

    const signedAtMs = Date.now();
    const device = this.deviceAuth
      ? (() => {
          const payload = buildDeviceAuthPayload({
            deviceId: this.deviceAuth!.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: authToken || null,
            nonce,
          });

          return {
            id: this.deviceAuth!.deviceId,
            publicKey: publicKeyRawBase64Url(this.deviceAuth!.publicKeyPem),
            signature: signDevicePayload(this.deviceAuth!.privateKeyPem, payload),
            signedAt: signedAtMs,
            nonce,
          };
        })()
      : undefined;

    const frame: RequestFrame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          displayName: "Mission Control Dashboard",
          version: "1.0.0",
          platform: "node",
          mode: clientMode,
        },
        caps: [],
        auth: authToken ? { token: authToken } : undefined,
        role,
        scopes,
        locale: "en-US",
        userAgent: "openclaw-mission-control/0.1.0",
        device,
      },
    };

    // Register pending for the connect response
    const pending: PendingRequest = {
      resolve: (payload: unknown) => {
        const hello = payload as HelloOkPayload;
        const issuedDeviceToken = hello?.auth?.deviceToken;

        if (issuedDeviceToken && issuedDeviceToken !== this.deviceAuth?.deviceToken) {
          try {
            persistGatewayDeviceToken(issuedDeviceToken);
            this.deviceAuth = {
              ...(this.deviceAuth ?? loadOrCreateGatewayDeviceAuth()),
              deviceToken: issuedDeviceToken,
            };
          } catch {
            // ignore persistence failures; continue with current in-memory state
          }
        }

        if (connectTimeout) clearTimeout(connectTimeout);
        this.authenticated = true;
        this.connectResolve?.();
      },
      reject: (err: unknown) => {
        if (connectTimeout) clearTimeout(connectTimeout);
        this.connectReject?.(
          err instanceof Error ? err : new Error(String(err))
        );
      },
      timeout: setTimeout(() => {
        this.pendingRequests.delete(id);
        this.connectReject?.(new Error("Connect handshake timeout"));
      }, 10000),
    };

    this.pendingRequests.set(id, pending);
    this.ws?.send(JSON.stringify(frame));
  }

  // --- JSON-RPC calls ---

  async call(
    method: string,
    params?: unknown,
    timeoutMs = 30000
  ): Promise<unknown> {
    if (!this.isConnected()) {
      await this.connect();
    }

    const id = randomUUID();
    const frame: RequestFrame = {
      type: "req",
      id,
      method,
      params: params ?? {},
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  // --- Events ---

  onEvent(type: string, callback: EventCallback): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(callback);
    return () => {
      this.eventListeners.get(type)?.delete(callback);
    };
  }

  // --- Agents ---

  async listAgents(): Promise<OpenClawAgent[]> {
    const result = (await this.call("agents.list", {})) as {
      agents?: OpenClawAgent[];
    };
    return result?.agents ?? [];
  }

  async createAgent(params: {
    name: string;
    workspace: string;
    emoji?: string;
    avatar?: string;
  }): Promise<unknown> {
    return this.call("agents.create", params);
  }

  async updateAgent(params: {
    agentId: string;
    patch: Record<string, unknown>;
  }): Promise<unknown> {
    return this.call("agents.update", params);
  }

  async deleteAgent(agentId: string): Promise<unknown> {
    return this.call("agents.delete", { agentId });
  }

  async getAgentFile(agentId: string, name: string): Promise<string> {
    const result = (await this.call("agents.files.get", {
      agentId,
      name,
    })) as { file?: { content?: string } };
    return result?.file?.content ?? "";
  }

  async setAgentFile(
    agentId: string,
    name: string,
    content: string
  ): Promise<unknown> {
    return this.call("agents.files.set", { agentId, name, content });
  }

  // --- Chat ---

  async sendMessage(
    sessionKey: string,
    message: string,
    opts?: { idempotencyKey?: string }
  ): Promise<unknown> {
    return this.call("chat.send", {
      sessionKey,
      message,
      idempotencyKey: opts?.idempotencyKey ?? randomUUID(),
    });
  }

  async getChatHistory(
    sessionKey: string,
    opts?: { limit?: number }
  ): Promise<ChatMessage[]> {
    const result = (await this.call("chat.history", {
      sessionKey,
      ...opts,
    })) as { messages?: ChatMessage[] };
    return result?.messages ?? [];
  }

  async abortChat(sessionKey: string, runId?: string): Promise<unknown> {
    return this.call("chat.abort", { sessionKey, runId });
  }

  // --- Sessions ---

  async listSessions(opts?: {
    agentId?: string;
  }): Promise<OpenClawSession[]> {
    const result = (await this.call("sessions.list", opts ?? {})) as {
      sessions?: OpenClawSession[];
    };
    return result?.sessions ?? [];
  }

  async previewSessions(keys: string[]): Promise<unknown> {
    return this.call("sessions.preview", { keys });
  }

  async resetSession(key: string): Promise<unknown> {
    return this.call("sessions.reset", { key });
  }

  async deleteSession(key: string): Promise<unknown> {
    return this.call("sessions.delete", { key });
  }

  async patchSession(
    key: string,
    patch: { model?: string | null; [k: string]: unknown }
  ): Promise<unknown> {
    return this.call("sessions.patch", { key, ...patch });
  }

  // --- Cron ---

  async listCronJobs(): Promise<OpenClawCronJob[]> {
    const result = (await this.call("cron.list", {
      includeDisabled: true,
    })) as { jobs?: OpenClawCronJob[] };
    return result?.jobs ?? [];
  }

  async addCronJob(params: {
    prompt: string;
    schedule: string;
    agentId?: string;
    sessionKey?: string;
    enabled?: boolean;
  }): Promise<OpenClawCronJob> {
    return (await this.call("cron.add", params)) as OpenClawCronJob;
  }

  async updateCronJob(
    id: string,
    patch: Partial<{
      prompt: string;
      schedule: string;
      enabled: boolean;
    }>
  ): Promise<OpenClawCronJob> {
    return (await this.call("cron.update", {
      id,
      patch,
    })) as OpenClawCronJob;
  }

  async removeCronJob(id: string): Promise<unknown> {
    return this.call("cron.remove", { id });
  }

  async runCronJob(id: string, mode?: "due" | "force"): Promise<unknown> {
    return this.call("cron.run", { id, mode: mode ?? "force" });
  }

  // --- System ---

  async health(): Promise<unknown> {
    return this.call("health", {});
  }

  async status(): Promise<unknown> {
    return this.call("status", {});
  }

  async getUsage(): Promise<unknown> {
    return this.call("usage.status", {});
  }

  async listModels(): Promise<unknown> {
    return this.call("models.list", {});
  }

  // --- Send to agent session (the `send` method) ---

  async sendToAgent(params: {
    message: string;
    session?: string;
    agentId?: string;
  }): Promise<unknown> {
    return this.call("send", params);
  }

  // --- Usage & Costs ---

  async getUsageCost(): Promise<unknown> {
    return this.call("usage.cost", {});
  }

  // --- TTS ---

  async ttsStatus(): Promise<unknown> {
    return this.call("tts.status", {});
  }

  async ttsProviders(): Promise<unknown> {
    return this.call("tts.providers", {});
  }

  async ttsConvert(params: {
    text: string;
    provider?: string;
  }): Promise<unknown> {
    return this.call("tts.convert", params);
  }

  // --- Config ---

  async configGet(): Promise<unknown> {
    return this.call("config.get", {});
  }

  async configSchema(): Promise<unknown> {
    return this.call("config.schema", {});
  }

  async configPatch(patch: Record<string, unknown>): Promise<unknown> {
    return this.call("config.patch", { patch });
  }

  // --- Exec Approvals ---

  async getExecApprovals(): Promise<unknown> {
    return this.call("exec.approvals.get", {});
  }

  async setExecApprovals(params: Record<string, unknown>): Promise<unknown> {
    return this.call("exec.approvals.set", params);
  }

  async resolveExecApproval(params: {
    id: string;
    decision: "approve" | "reject";
  }): Promise<unknown> {
    return this.call("exec.approval.resolve", params);
  }

  // --- Nodes ---

  async listNodes(): Promise<unknown> {
    return this.call("node.list", {});
  }

  async describeNode(nodeId: string): Promise<unknown> {
    return this.call("node.describe", { nodeId });
  }

  // --- Logs ---

  async tailLogs(): Promise<unknown> {
    return this.call("logs.tail", {});
  }

  // --- Channels ---

  async channelsStatus(): Promise<unknown> {
    return this.call("channels.status", {});
  }

  // --- Skills ---

  async skillsStatus(): Promise<unknown> {
    return this.call("skills.status", {});
  }

  // --- Cron Runs ---

  async cronRuns(id: string): Promise<unknown> {
    return this.call("cron.runs", { id });
  }

  async cronStatus(): Promise<unknown> {
    return this.call("cron.status", {});
  }
}

// Singleton for server-side usage
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    const url =
      process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";

    let gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!gatewayToken && process.env.OPENCLAW_AUTH_TOKEN) {
      gatewayToken = process.env.OPENCLAW_AUTH_TOKEN;
      console.warn(
        "[openclaw-client] OPENCLAW_AUTH_TOKEN is deprecated for gateway auth; please use OPENCLAW_GATEWAY_TOKEN"
      );
    }

    clientInstance = new OpenClawClient(url, { gatewayToken: gatewayToken || "" });
  }
  return clientInstance;
}
