// ==UserScript==
// @name          TradingView → Local Bridge (CSP-safe)
// @match         https://www.tradingview.com/*
// @match         https://es.tradingview.com/*
// @grant         GM_xmlhttpRequest
// @connect       localhost
// @connect       127.0.0.1
// ==/UserScript==

(function () {
  // Endpoint used to forward TradingView signals to the local backend wich connects at the same time with Raydium platform
  const BRIDGE_ENDPOINT = "http://localhost:8787/tv";

  // Extracts a numeric value from a TradingView panel field
  function readFloatFromPanel(label) {
    const element = document.querySelector(
      `[data-test-id-value-title="${label}"]`
    );
    if (!element) return NaN;

    const raw = (element.textContent || "")
      .replace(",", ".") // European decimal formats
      .replace(/[^\d.+-eE]/g, ""); // Keep only numeric / scientific notation

    const value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
  }

  // Extracts an integer (0 or 1 for triggers)
  function readIntFromPanel(label) {
    const value = readFloatFromPanel(label);
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  // Prevents duplicate consecutive signals
  let lastSignalSide = "none";
  let lastSignalTimestamp = 0;

  // Sends JSON to the local bridge using GM_xmlhttpRequest
  function sendJsonToBridge(url, payload) {
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onerror: (error) =>
        console.warn("[TV → Bridge] POST error", error, payload),
    });
  }

  // Main polling loop: reads indicator values and emits signals
  function pollTradingView() {
    const atrBinance = readFloatFromPanel("ATR_BINANCE");
    const triggerLong = readIntFromPanel("TRIG_LONG");
    const triggerShort = readIntFromPanel("TRIG_SHORT");
    const triggerClose = readIntFromPanel("TRIG_FLAT");
    const currentPrice = readFloatFromPanel("CURRENT_PRICE");

    let detectedSide = "none";
    if (triggerLong === 1) detectedSide = "long";
    if (triggerShort === 1) detectedSide = "short";

    const now = Date.now();

    // If TRIG_FLAT fires, mark position as closed
    if (triggerClose === 1) {
      lastSignalSide = "none";
      console.log("[TV → Bridge] trade_closed (local reset)");
    }

    // Debounce repeated identical signals and enforce minimum interval
    const oneSecondPassed = now - lastSignalTimestamp > 1000;
    const isNewSide =
      detectedSide !== "none" && detectedSide !== lastSignalSide;

    if (isNewSide && oneSecondPassed) {
      lastSignalSide = detectedSide;
      lastSignalTimestamp = now;

      const payload = {
        type: "tv_signal",
        side: detectedSide,
        price: currentPrice,
        atrBin: Number.isFinite(atrBinance)
          ? Number(atrBinance.toFixed(6))
          : null,
        ts: now,
      };

      sendJsonToBridge(BRIDGE_ENDPOINT, payload);
      console.log("[TV → Bridge] Signal sent:", payload);
    }
  }

  // Poll TradingView every 700ms
  setInterval(pollTradingView, 700);
})();
