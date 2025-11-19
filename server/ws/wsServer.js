import { WebSocketServer } from "ws";
import { WS_PORT } from "../config/env.js";

let wss = null;

export function createWebSocketServer() {
  wss = new WebSocketServer({ port: WS_PORT });

  wss.on("listening", () => {
    console.log(`[WS] Listening on ws://localhost:${WS_PORT}`);
  });

  wss.on("connection", (socket) => {
    console.log("[WS] Client connected");
    socket.on("close", () => console.log("[WS] Client disconnected"));
  });

  return wss;
}

export function broadcastToClients(messageObject) {
  if (!wss) return;

  const payload = JSON.stringify(messageObject);

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}
