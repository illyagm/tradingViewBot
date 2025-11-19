export function formatNumber(value, decimals = 4) {
  return value == null ? "" : Number(value).toFixed(decimals);
}

export function formatLine(label, value, decimals = 4) {
  if (value == null) return "";
  return `• ${label}: <code>${formatNumber(value, decimals)}</code>\n`;
}
