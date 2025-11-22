function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeTvPayload(req) {
  let data = req.is("text/*") ? req.body : req.body;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // ignore, keep as text
    }
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid or non-JSON payload");
  }

  const side = String(data.side || "").toLowerCase();
  if (!["long", "short"].includes(side)) {
    throw new Error("Field 'side' must be 'long' or 'short'");
  }

  const atrRaw = data.atr ?? data.atrBin;
  const atr = toNumber(atrRaw);
  if (atr == null) {
    throw new Error("Missing numeric 'atr' or 'atrBin'");
  }

  const price = toNumber(data.price);
  const ts = Number(data.ts) || Date.now();
  const clientId = data.clientId;

  return {
    type: "tv_signal",
    side,
    ts,
    atr,
    price,
    clientId,
  };
}

export function normalizeNotifyPayload(req) {
  let data = req.is("text/*") ? req.body : req.body;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // ignore
    }
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid payload");
  }

  const type = String(data.type || "").toLowerCase();

  const allowedTypes = [
    "open_operation",
    "trade_closed",
    "order_pending",
    "order_confirmed",
  ];

  if (!allowedTypes.includes(type)) {
    throw new Error(
      "Field 'type' should be one of: " + allowedTypes.join(" / ")
    );
  }

  const side = data.side ? String(data.side).toLowerCase() : undefined;

  if (type === "open_operation" && !["long", "short"].includes(side || "")) {
    throw new Error(
      "For 'open_operation' the field 'side' must be 'long' or 'short'"
    );
  }

  return {
    type,
    side,
    symbol: data.symbol ? String(data.symbol) : undefined,
    ts: Number(data.ts) || Date.now(),

    entryPrice: toNumber(data.entryPrice ?? data.price),
    tp: toNumber(data.tp),
    sl: toNumber(data.sl),
    exitPrice: toNumber(data.exitPrice),

    qty: toNumber(data.qty),
    leverage: toNumber(data.leverage),
    note: data.note ? String(data.note) : undefined,
    atr: toNumber(data.atr),
    clientId: toNumber(data.clientId),
  };
}
