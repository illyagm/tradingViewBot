import "dotenv/config";

export const HTTP_PORT = process.env.PORT_HTTP
  ? Number(process.env.PORT_HTTP)
  : 8787;

export const WS_PORT = process.env.PORT_WS ? Number(process.env.PORT_WS) : 8788;

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
