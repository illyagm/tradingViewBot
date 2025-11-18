function symbolFromURL() {
  try {
    const u = new URL(location.href);
    const p = u.pathname.split("/").filter(Boolean);
    return p[p.length - 1] || "";
  } catch {
    return "";
  }
}

function getSide() {
  const { buyBtn, sellBtn } = findSideButtons();
  const buyActive = buyBtn?.getAttribute("data-active") !== null;
  const sellActive = sellBtn?.getAttribute("data-active") !== null;

  if (buyActive && !sellActive) return "buy";
  if (sellActive && !buyActive) return "sell";
  return "buy";
}

function sideUiToSignal(uiSide) {
  return uiSide === "sell" ? "short" : "long"; // default buy→long
}

const toNum = (t) =>
  Number(
    String(t ?? "")
      .trim()
      .replace(",", ".")
      .replace(/[^\d.\-eE+]/g, "")
  );

// Estimate of price liquidation
// Long:  liq = entry * (1 - 1/L + mmr) => mmr = maintenance margin requirement
// Short: liq = entry * (1 + 1/L - mmr)
function estLiqPrice(entry, side, L, mmr) {
  if (!Number.isFinite(entry) || !Number.isFinite(L) || L <= 1) return NaN;
  if (side === "buy") return entry * (1 - 1 / L + mmr);
  if (side === "sell") return entry * (1 + 1 / L - mmr);
  return NaN;
}

// Buy/Sell buttons selectors
function findSideButtons() {
  const buyBtn = document.querySelector(".chakra-button.css-1viccdw");
  const sellBtn = document.querySelector(".chakra-button.css-195sdwt");
  return { buyBtn, sellBtn };
}

function toast(msg, kind = "ok") {
  const pfx = "[ATR]";
  if (kind === "warn") console.warn(pfx, msg);
  else if (kind === "err" || kind === "error") console.error(pfx, msg);
  else console.log(pfx, msg);
}

function findContextWith(selector) {
  if (document.querySelector(selector)) return document;
  for (const f of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const ctx = f.contentDocument || f.contentWindow?.document;
      if (ctx && ctx.querySelector(selector)) return ctx;
    } catch (e) {}
  }
  return null;
}

function readPriceFromCtx(ctx) {
  const titles = Array.from(ctx.querySelectorAll(PRICE_TITLE));

  for (const t of titles) {
    const label = (t.textContent || "").trim().toLowerCase();
    const isClose =
      label === "c" ||
      label.startsWith("close") ||
      label.startsWith("cierre") ||
      label.startsWith("cerrar");
    if (isClose && t.nextSibling) {
      const v = toNum(t.nextSibling.textContent);
      if (isFinite(v)) return v;
    }
  }

  if (titles.length) {
    const last = titles[titles.length - 1];
    if (last?.nextSibling) {
      const v = toNum(last.nextSibling.textContent);
      if (isFinite(v)) return v;
    }
  }

  for (const vEl of Array.from(ctx.querySelectorAll(PRICE_VALUE))) {
    const v = toNum(vEl.textContent);
    if (isFinite(v) && v > 0) return v;
  }
  return NaN;
}

// Inputs .css-7gbhpa (UI)
function getBlocks() {
  const nodes = Array.from(document.querySelectorAll(".css-7gbhpa"));

  return nodes.map((div, i) => ({
    i,
    div,
    text: (div.textContent || "").trim().toLowerCase(),
  }));
}

function findNearbyInput(container) {
  const candidates = [
    container.nextElementSibling,
    container.previousElementSibling,
    container.parentElement?.nextElementSibling,
    container.parentElement?.previousElementSibling,
  ];

  for (const node of candidates) {
    if (!node) continue;
    const input =
      node.querySelector?.("input") || (node.tagName === "INPUT" ? node : null);
    if (input) return input;
  }

  return null;
}

function roundNumber(value, input) {
  if (!input) return Number(value.toFixed(3));
  const stepAttr = input.getAttribute("step");
  if (stepAttr && !isNaN(+stepAttr) && +stepAttr > 0) {
    const step = +stepAttr;
    return Math.round(value / step) * step;
  }
  const cur = parseFloat(input.value || "0");
  const dec = (cur.toString().split(".")[1] || "").length || 3;
  return Number(value.toFixed(dec));
}

function mapIndexes(blocks) {
  let priceIndex = null;
  let tpIndex = null;
  let slIndex = null;
  let qtyIndex = null;

  for (const block of blocks) {
    const label = block.text;

    // Price field
    if (priceIndex === null && /\bprice\b/.test(label)) {
      priceIndex = block.i;
    }

    // Take Profit field
    if (tpIndex === null && /\btp\b/.test(label)) {
      tpIndex = block.i;
    }

    // Stop Loss field
    if (slIndex === null && /(sl|stop\s*loss)/.test(label)) {
      slIndex = block.i;
    }

    // Quantity / Size / Volume field
    if (
      qtyIndex === null &&
      /\b(qty|quantity|size|amount|volume)\b/.test(label)
    ) {
      qtyIndex = block.i;
    }
  }

  return {
    PRICE: priceIndex,
    TP: tpIndex,
    SL: slIndex,
    QTY: qtyIndex,
  };
}
