import { createHttpApp } from "./http/app.js";
import { createWebSocketServer } from "./ws/wsServer.js";
import { HTTP_PORT } from "./config/env.js";

function start() {
  createWebSocketServer();

  const app = createHttpApp();
  app.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Listening on http://localhost:${HTTP_PORT}/tv`);
    console.log("[INFO] TradingView webhook URL -> /tv");
    console.log("[INFO] Raydium notifier -> /notify");
  });
}

start();
