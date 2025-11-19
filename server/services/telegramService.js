import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../config/env.js";

export async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      console.error("[Telegram] sendMessage failed", res.status);
    }
  } catch (error) {
    console.error("[Telegram] Error sending message", error);
  }
}
