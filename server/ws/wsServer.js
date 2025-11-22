import { WebSocketServer } from "ws";
import { WS_PORT } from "../config/env.js";
import crypto from "crypto";

let wss = null;
const clients = new Map();

export function createWebSocketServer() {
  wss = new WebSocketServer({ port: WS_PORT });

  wss.on("listening", () => {
    console.log(`[WS] Listening on ws://localhost:${WS_PORT}`);
  });

  wss.on("connection", (socket, req) => {
    // ws://localhost:PORT?clientId=1
    let clientId;
    try {
      const url = new URL(req.url, `ws://localhost:${WS_PORT}`);
      clientId = url.searchParams.get("clientId") || crypto.randomUUID();
    } catch {
      clientId = crypto.randomUUID();
    }

    console.log("[WS] Client connected:", clientId);

    clients.set(clientId, socket);
    socket.clientId = clientId;

    socket.on("close", () => {
      console.log("[WS] Client disconnected:", clientId);
      clients.delete(clientId);
    });
  });

  return wss;
}

// Send action to client ONLY if clientId is present
export function sendToClient(messageObject) {
  if (!wss) return false;

  const { clientId } = messageObject || {};
  if (!clientId) {
    console.warn("[WS] Missing clientId in messageObject:", messageObject);
    return false;
  }

  const socket = clients.get(clientId);
  if (!socket) {
    console.warn("[WS] No WS client for clientId:", clientId);
    return false;
  }

  if (socket.readyState !== 1) {
    console.warn("[WS] Client not open for clientId:", clientId);
    return false;
  }

  const payload = JSON.stringify(messageObject);
  socket.send(payload);
  return true;
}
