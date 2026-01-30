import { formatNumber, formatLine } from "../utils/numberFormat.js";
import { sendTelegramMessage } from "./telegramService.js";

function riskReward(entry, tp, sl) {
  if (entry == null || tp == null || sl == null) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return null;
  return reward / risk;
}

function movePercent(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function pnlCalc(side, entry, exit, qty) {
  if (entry == null || exit == null) {
    return { pnl: null, pnlPct: movePercent(entry, exit) };
  }
  const direction = side === "short" ? -1 : 1;
  const diff = (exit - entry) * direction;
  const pnl = qty != null ? diff * qty : null;
  const pct = movePercent(entry, exit) * direction;
  return { pnl, pnlPct: pct };
}

export async function handleNotification(payload) {
  const tsIso = new Date(payload.ts).toISOString();

  if (payload.type === "open_operation") {
    const rr = riskReward(payload.entryPrice, payload.tp, payload.sl);

    const title =
      `🚀 <b>Open</b> ${payload.side?.toUpperCase()}` +
      (payload.symbol ? ` — <b>${payload.symbol}</b>` : "");

    const body =
      formatLine("Entry", payload.entryPrice, 6) +
      formatLine("TP", payload.tp, 6) +
      formatLine("SL", payload.sl, 6) +
      (rr != null ? `• R:R: <code>${formatNumber(rr, 2)}</code>\n` : "") +
      formatLine("ATR", payload.atr) +
      formatLine("Leverage", payload.leverage, 2) +
      formatLine("Qty", payload.qty, 3) +
      `• TS: <code>${tsIso}</code>\n` +
      (payload.note
        ? `• Note: ${payload.note} | ClientId: ${payload.clientId}\n`
        : "");
    await sendTelegramMessage(`${title}\n${body}`);
    return;
  }

  if (payload.type === "trade_closed") {
    const { pnl, pnlPct } = pnlCalc(
      payload.side,
      payload.entryPrice,
      payload.exitPrice,
      payload.qty
    );

    const title =
      `✅ <b>Close</b>` + (payload.symbol ? ` — <b>${payload.symbol}</b>` : "");

    const body =
      (payload.side ? `• Side: <b>${payload.side.toUpperCase()}</b>\n` : "") +
      formatLine("Entry", payload.entryPrice, 6) +
      formatLine("Exit", payload.exitPrice, 6) +
      (pnl != null ? `• PnL: <code>${formatNumber(pnl, 4)}</code>\n` : "") +
      (pnlPct != null
        ? `• PnL%: <code>${formatNumber(pnlPct, 2)}%</code>\n`
        : "") +
      formatLine("Qty", payload.qty, 3) +
      `• TS: <code>${tsIso}</code>\n` +
      (payload.note ? `• Note: ${payload.note}\n` : "");

    await sendTelegramMessage(`${title}\n${body}`);
    return;
  }

  if (payload.type === "order_pending") {
    await sendTelegramMessage(
      `⏳ <b>Order pending</b>` +
        (payload.symbol ? ` — <b>${payload.symbol}</b>` : "") +
        `\n• TS: <code>${tsIso}</code>`
    );
    return;
  }

  if (payload.type === "order_canceled") {
    await sendTelegramMessage(
      `❌<b>Order canceled. Exceeded timeout</b>` +
        (payload.symbol ? ` — <b>${payload.symbol}</b>` : "") +
        `\n• TS: <code>${tsIso}</code>`
    );
    return;
  }

  if (payload.type === "order_confirmed") {
    await sendTelegramMessage(
      `✅ <b>Order confirmed</b>` +
        (payload.symbol ? ` — <b>${payload.symbol}</b>` : "") +
        `\n• TS: <code>${tsIso}</code>`
    );
  }
}
