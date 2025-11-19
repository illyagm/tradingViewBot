export function formatNumber(n, decimals = 4) {
  return n == null ? "" : Number(n).toFixed(decimals);
}

export function formatLine(label, value, decimals = 4) {
  return value == null
    ? ""
    : `• ${label}: <code>${formatNumber(value, decimals)}</code>\n`;
}

export function riskReward(entry, tp, sl) {
  if (entry == null || tp == null || sl == null) return null;
  const r = Math.abs(entry - sl);
  const w = Math.abs(tp - entry);
  if (r === 0) return null;
  return w / r;
}

export function pnlCalc(side, entry, exit, qty) {
  if (entry == null || exit == null) return { pnl: null, pnlPct: null };
  const dir = side === "short" ? -1 : 1;
  const diff = (exit - entry) * dir;
  return {
    pnl: qty != null ? diff * qty : null,
    pnlPct: entry ? (diff / entry) * 100 : null,
  };
}

export function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
