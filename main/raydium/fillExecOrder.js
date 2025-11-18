// ==UserScript==
// @name         Order filler / executor (no UI)
// @namespace    illya-utils
// @require      utils.js
// @version      3.1
// @description  Script in charge of risk management and order fill in the Raydium platform (headless)
// @match        https://perps.raydium.io/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  "use strict";

  // Base parameters
  const SL_MULT = 1.5;
  const TP_MULT = 2.0;
  const DEFAULT_ATR = 1.0;
  const MARGIN_MULT_DEFAULT = 0.0004;
  const CLASS_ITEM = '[class^="item-"]';
  const PRICE_VALUE = '[class*="valueValue-"]';
  const PRICE_TITLE = '[class*="valueTitle-"]';

  // Storage - getters and setters
  const STORE = {
    get atr() {
      const v = parseFloat(localStorage.getItem("atr.value") || "");
      return Number.isFinite(v) ? v : DEFAULT_ATR;
    },
    set atr(v) {
      localStorage.setItem("atr.value", String(v));
    },
    get autoATR() {
      return localStorage.getItem("atr.auto") === "1";
    },
    set autoATR(f) {
      localStorage.setItem("atr.auto", f ? "1" : "0");
    },
    get atrIdx() {
      const n = parseInt(
        localStorage.getItem("atr.valuesWrapperIdx") || "15",
        10
      );
      return Number.isInteger(n) ? n : 15;
    },
    set atrIdx(v) {
      localStorage.setItem("atr.valuesWrapperIdx", String(v));
    },
    get idx() {
      try {
        return JSON.parse(localStorage.getItem("atr.idx") || "{}");
      } catch {
        return {};
      }
    },
    set idx(v) {
      localStorage.setItem("atr.idx", JSON.stringify(v || {}));
    },

    // — apalancamiento y seguridad —
    get lev() {
      const v = parseFloat(localStorage.getItem("atr.lev") || "5");
      return Number.isFinite(v) ? v : 5;
    },
    set lev(v) {
      localStorage.setItem("atr.lev", String(v));
    },
    get mmr() {
      const v = parseFloat(localStorage.getItem("atr.mmr") || "0.005");
      return Number.isFinite(v) ? v : 0.005;
    }, // 0.5%
    set mmr(v) {
      localStorage.setItem("atr.mmr", String(v));
    },
    get liqBufATR() {
      const v = parseFloat(localStorage.getItem("atr.liqBufATR") || "0.5");
      return Number.isFinite(v) ? v : 0.5;
    }, // 0.5×ATR
    set liqBufATR(v) {
      localStorage.setItem("atr.liqBufATR", String(v));
    },
    get maxNotional() {
      const v = parseFloat(localStorage.getItem("atr.maxNotional") || "0");
      return Number.isFinite(v) ? v : 0;
    }, // 0 = sin tope extra
    set maxNotional(v) {
      localStorage.setItem("atr.maxNotional", String(v));
    },
    get allowUnsafe() {
      return localStorage.getItem("atr.allowUnsafe") === "1";
    },
    set allowUnsafe(f) {
      localStorage.setItem("atr.allowUnsafe", f ? "1" : "0");
    },

    // Riesgo y auto qty
    get riskPct() {
      const v = parseFloat(localStorage.getItem("atr.riskPct") || "2");
      return Number.isFinite(v) ? v : 2;
    },
    set riskPct(v) {
      localStorage.setItem("atr.riskPct", String(v));
    },
    get autoQty() {
      return localStorage.getItem("atr.autoQty") === "1";
    },
    set autoQty(f) {
      localStorage.setItem("atr.autoQty", f ? "1" : "0");
    },

    // Journal
    get journal() {
      try {
        return JSON.parse(localStorage.getItem("atr.journal") || "[]");
      } catch {
        return [];
      }
    },
    set journal(a) {
      localStorage.setItem("atr.journal", JSON.stringify(a || []));
    },

    get marginMult() {
      const v = parseFloat(localStorage.getItem("atr.marginMult") || "");
      return Number.isFinite(v) ? v : MARGIN_MULT_DEFAULT;
    },
    set marginMult(v) {
      localStorage.setItem("atr.marginMult", String(v));
    },
  };
  // End storage getters and setters

  let webSocket = null;
  let webSocketIndex = 0;

  // Bridge (Raydium page)
  const BRIDGE_WS_ENDPOINTS = [
    "ws://localhost:8788",
    "ws://127.0.0.1:8788",
    "ws://localhost:8787",
    "ws://127.0.0.1:8787",
  ];
  const WEBHOOK = "http://localhost:8787/notify";

  function postJSON(url, obj) {
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(obj),
      onload: () => console.log("[notify] ok", obj),
      onerror: (e) => console.warn("[notify] error", e),
    });
  }

  // Limit the leverage per order
  function capQtyByLeverage({ entry, qtyRisk, side, sl, balance, atr }) {
    const L = STORE.lev;
    const mmr = STORE.mmr;
    const bufA = STORE.liqBufATR * atr;

    const maxNotionalByLev = balance * L; // USDC
    let maxQtyByLev =
      Number.isFinite(entry) && entry > 0 ? maxNotionalByLev / entry : Infinity;

    if (STORE.maxNotional > 0) {
      const qByManual = STORE.maxNotional / entry;
      maxQtyByLev = Math.min(maxQtyByLev, qByManual);
    }

    let qty = Math.min(qtyRisk, maxQtyByLev);

    const liq = estLiqPrice(entry, side, L, mmr);

    let tooClose = false,
      distLiq = NaN,
      distSL = NaN;

    if (Number.isFinite(liq)) {
      distLiq = Math.abs(entry - liq);
      distSL = Math.abs(entry - sl);
      const safeWindow = distLiq - bufA;
      tooClose = !(safeWindow > 0 && distSL <= safeWindow);
    }

    return { qty, maxQtyByLev, tooClose, liq, distLiq, distSL, bufA, L, mmr };
  }

  function setSideInUI(targetSide) {
    const { buyBtn, sellBtn } = findSideButtons();
    const target = targetSide === "sell" ? sellBtn : buyBtn;
    const fireEvent = () => target.click();

    if (!target) {
      console.warn("[Side] botón no encontrado");
      return;
    }

    if (getSide() === targetSide) return;

    setTimeout(() => {
      const sideAfterChange = getSide();
      console.log("[Side verify]", {
        desiredSide: targetSide,
        sideAfterChange,
      });
      if (sideAfterChange !== targetSide) {
        fireEvent();
      }
    }, 100);
  }

  function readPrice() {
    const ctx =
      findContextWith(PRICE_TITLE) ||
      findContextWith(PRICE_VALUE) ||
      findContextWith(CLASS_ITEM);
    if (!ctx) return NaN;
    return readPriceFromCtx(ctx);
  }

  function resolveIndexes() {
    const blocks = getBlocks();
    const auto = mapIndexes(blocks);

    const idx = {
      PRICE: Number.isInteger(auto.PRICE) ? auto.PRICE : 0,
      TP: Number.isInteger(auto.TP) ? auto.TP : 3,
      SL: Number.isInteger(auto.SL) ? auto.SL : 5,
      QTY: Number.isInteger(auto.QTY) ? auto.QTY : undefined,
      _len: blocks.length,
    };
    return { idx, blocks };
  }

  function getOrderInputs() {
    const { indexes, labeledBlocks } = resolveIndexes();

    // Given a block index, return the closest <input> element
    const findInputForBlock = (blockIndex) => {
      const block = labeledBlocks[blockIndex];
      if (!block) return null;
      return findClosestInput(block.element);
    };

    const inputs = {
      meta: indexes,
      price: findInputForBlock(indexes.PRICE),
      tp: findInputForBlock(indexes.TP),
      sl: findInputForBlock(indexes.SL),
    };

    // Quantity may not always have a block — depends on Raydium UI layout
    inputs.qty = Number.isInteger(indexes.QTY)
      ? findInputForBlock(indexes.QTY)
      : null;

    return inputs;
  }

  // React/Chakra input setters
  // We need a usage of native setters since chakra ui/react do not allow changing input value directly
  // Basically this is a hack in order to bypass these libraries and talk to browser directly
  function setInputValue(input, val) {
    if (!input) return;
    input.focus();

    const newInputValue = String(val);
    const inputPrototype = Object.getPrototypeOf(input);

    // Get input getters/setters
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(
      inputPrototype,
      "value"
    );

    const nativeSetter = prototypeDescriptor && prototypeDescriptor.set;

    // Call the setter
    if (nativeSetter) nativeSetter.call(input, newInputValue);
    else input.value = newInputValue;

    // Dispatch artificial events in order to let react know that a change has been performed
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }

  function adjustEntryBySide(entry, atr, side, mult = STORE.marginMult) {
    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(atr) ||
      !Number.isFinite(mult)
    )
      return entry;
    const d = entry * MARGIN_MULT_DEFAULT;
    if (side === "buy") return entry + d;
    if (side === "sell") return entry - d;
    return entry;
  }

  // MAIN LOGIC
  async function applyATRToTPSL(sideOverride = null) {
    const {
      meta,
      price: priceInput,
      tp: tpInput,
      sl: slInput,
      qty: qtyInput,
    } = getOrderInputs();
    if (!priceInput || !tpInput || !slInput) {
      toast(
        `Price/TP/SL not found. .css-7gbhpa=${meta._len} idx=(${meta.PRICE}/${meta.TP}/${meta.SL})`,
        "warn"
      );
      return;
    }

    let entry = parseFloat(priceInput.value);

    if (!Number.isFinite(entry)) {
      entry = readPrice();
      if (!Number.isFinite(entry)) {
        toast("There is no price(input or panel).", "warn");
        return;
      }
      setInputValue(priceInput, entry);
    }

    const atr = STORE.atr;
    const side = sideOverride ?? getSide(); // 'buy' | 'sell'

    // Add margin when opening an order in order to maximize the openning order rate
    const entryAdj = adjustEntryBySide(entry, atr, side);
    if (Number.isFinite(entryAdj) && Math.abs(entryAdj - entry) > 1e-9) {
      entry = roundNumber(entryAdj, priceInput);
      setInputValue(priceInput, entry);
    }

    // CALCULATE TS/SL DEPENDING ON THE ORDER DIRECTION (LONG/SHORT)
    let tpVal, slVal;
    if (side === "buy") {
      tpVal = entry + TP_MULT * atr;
      slVal = entry - SL_MULT * atr;
    } else {
      tpVal = entry - TP_MULT * atr;
      slVal = entry + SL_MULT * atr;
    }

    tpVal = roundNumber(tpVal, tpInput);
    slVal = roundNumber(slVal, slInput);

    // Avoid crossed values
    let tpField = tpInput,
      slField = slInput;
    const badLong = side === "buy" && (tpVal <= entry || slVal >= entry);
    const badShort = side === "sell" && (tpVal >= entry || slVal <= entry);
    if (badLong || badShort) {
      console.warn("[ATR] TP/SL inverted. Swap de fields TP/SL");
      [tpField, slField] = [slField, tpField];
    }

    setInputValue(tpField, tpVal);
    setInputValue(slField, slVal);

    // 8) Qty per risk % + leverage
    if (qtyInput && (STORE.autoQty || true)) {
      const balanceElement = document.querySelector(".chakra-text.css-157wn8n");
      const balance = balanceElement
        ? parseFloat((balanceElement.textContent || "").replace(/[^\d.]/g, ""))
        : NaN;
      if (!Number.isFinite(balance)) {
        toast("Balance not found (.chakra-text.css-157wn8n)", "warn");
        return;
      }

      const diff = Math.abs(entry - slVal);
      if (!(diff > 0)) {
        toast("TP/SL READY, but diff does not seem right!!!", "warn");
        return;
      }

      const riskAmount = balance * (STORE.riskPct / 100);
      const qtyRisk = riskAmount / diff;

      const safe = capQtyByLeverage({
        entry,
        qtyRisk,
        side,
        sl: slVal,
        balance,
        atr,
      });
      let qty = roundNumber(safe.qty, qtyInput);
      setInputValue(qtyInput, qty);

      const RR = Math.abs(tpVal - entry) / Math.abs(entry - slVal);
      let notes = [];
      if (qty < qtyRisk - 1e-9) notes.push("cap L/notional");
      if (safe.tooClose) {
        const msg = `SL close of liquidation (L=${safe.L.toFixed(
          2
        )}×): distSL=${safe.distSL?.toFixed(4)} vs (distLiq−buf)=${(
          safe.distLiq - safe.bufA
        ).toFixed(4)} @ liq≈${safe.liq?.toFixed(4)}.`;

        if (!STORE.allowUnsafe) {
          toast(msg + " | Blocked for security reasons.", "warn");
          return;
        }

        notes.push("unsafe");
        toast(msg + " | Allowed by toggle", "warn");
      }
      toast(
        `TP=${tpVal} | SL=${slVal} | Qty=${qty} | RR≈${RR.toFixed(
          2
        )} (ATR=${atr} • Risk ${STORE.riskPct}% • L=${STORE.lev}×${
          notes.length ? " • " + notes.join(" / ") : ""
        })`
      );
    } else {
      toast(
        `TP=${tpVal} | SL=${slVal}  (ATR=${atr} • ${
          STORE.autoATR ? "auto" : "manual"
        } • ${side})`
      );
    }
  }

  function getInputsSnapshot() {
    const { price, tp, sl, qty } = getOrderInputs();
    const entry = price ? parseFloat(price.value || "") : NaN;
    const tpParsed = tp ? parseFloat(tp.value || "") : NaN;
    const slParsed = sl ? parseFloat(sl.value || "") : NaN;
    const qtyParsed = qty ? parseFloat(qty.value || "") : NaN;
    return {
      entry: finiteNumber(entry),
      tp: finiteNumber(tpParsed),
      sl: finiteNumber(slParsed),
      qty: finiteNumber(qtyParsed),
    };

    function finiteNumber(val) {
      return Number.isFinite(val) ? val : NaN;
    }
  }

  // Construct and send notification to the telegram bot
  async function sendOpenNotify() {
    const uiSide = getSide(); // buy | sell
    const side = sideUiToSignal(uiSide); // long | short
    const sym = symbolFromURL() || "SOL/USDC";

    const { entry, tp, sl, qty } = getInputsSnapshot();
    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(tp) ||
      !Number.isFinite(sl)
    ) {
      toast(
        "There is no valid entry/TP/SL in order to send a notification.",
        "warn"
      );
      return;
    }
    const atr = STORE.atr;
    const leverage = STORE.lev;

    postJSON(WEBHOOK, {
      type: "open_operation",
      side,
      symbol: sym,
      entryPrice: entry,
      tp,
      sl,
      qty: Number.isFinite(qty) ? qty : undefined,
      leverage,
      atr,
      note: "auto from Raydium",
      ts: Date.now(),
    });
  }

  async function handleTVSignal(msg) {
    const side = String(msg?.side || "").toLowerCase(); // "long" | "short"
    const atrBin = Number(msg?.atr ?? msg?.atrBin);
    if (side !== "long" && side !== "short") return;
    if (!Number.isFinite(atrBin) || atrBin <= 0) {
      toast("Señal sin ATR_BIN válido.", "warn");
      return;
    }

    const uiSide = side === "long" ? "buy" : "sell";
    setSideInUI(uiSide);

    // Use the price coming from the TW signal, else read it from the panel
    const { price: priceInput } = getOrderInputs();
    let entry = Number(msg?.price);
    if (!Number.isFinite(entry)) entry = readPrice();
    if (Number.isFinite(entry) && priceInput) {
      setInputValue(priceInput, roundNumber(entry, priceInput));
    }

    // Use ATR from binance
    STORE.atr = atrBin;
    STORE.autoATR = false;

    toast(`ATR (bridge) = ${atrBin}`, "ok");
    await applyATRToTPSL(uiSide);

    setTimeout(() => {
      console.log("[auto-trade] Order prepared");
      document.querySelector('button[type="submit"]:not([disabled])')?.click();
      // Notify telegram bot
      sendOpenNotify();
    }, 500);

    toast(`Trade ${side.toUpperCase()} • ATR=${atrBin.toFixed(3)}`, "ok");
    console.log("[Executed on Raydium]", {
      side,
      uiSide,
      atrBin,
    });
  }

  function connectNextWS() {
    if (webSocket)
      try {
        webSocket.close();
      } catch {}
    const url =
      BRIDGE_WS_ENDPOINTS[webSocketIndex % BRIDGE_WS_ENDPOINTS.length];
    webSocketIndex++;
    console.log("[Bridge] intentando WS", url);
    try {
      webSocket = new WebSocket(url);
      webSocket.onopen = () => console.log("[Bridge] WS conectado", url);
      webSocket.onerror = (e) => console.warn("[Bridge] WS error", url, e);
      webSocket.onclose = () => {
        console.log("[Bridge] WS cerrado", url, "— reintento en 1.2s");
        setTimeout(connectNextWS, 1200);
      };
      webSocket.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg?.type === "tv_signal") {
          console.log("[Bridge] señal recibida", msg);
          handleTVSignal(msg);
        }
      };
    } catch (e) {
      console.warn("[Bridge] fallo creando WS", url, e);
      setTimeout(connectNextWS, 1200);
    }
  }

  function startBridgeWS() {
    connectNextWS();
  }

  function init() {
    startBridgeWS();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
