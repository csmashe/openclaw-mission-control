/**
 * Server-Sent Events (SSE) broadcaster for real-time updates.
 * Manages client connections and broadcasts events to all listeners.
 * Uses globalThis to ensure a single shared Set across module instances.
 */

import type { SSEEvent } from "./sse-types";

const globalForSSE = globalThis as typeof globalThis & {
  __sseClients?: Set<ReadableStreamDefaultController>;
};

if (!globalForSSE.__sseClients) {
  globalForSSE.__sseClients = new Set<ReadableStreamDefaultController>();
}

const clients = globalForSSE.__sseClients;

export function registerClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

export function unregisterClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
}

export function broadcast(event: SSEEvent): void {
  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = encoder.encode(data);

  const clientsArray = Array.from(clients);
  for (const client of clientsArray) {
    try {
      client.enqueue(encoded);
    } catch {
      clients.delete(client);
    }
  }
}

export function getActiveConnectionCount(): number {
  return clients.size;
}
