// ==UserScript==
// @name         Order filler / executor (no UI)
// @namespace    illya-utils
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
    const MARGIN_MULT_DEFAULT = 0;
    const CLASS_ITEM = '[class^="oui-w-"]';
    const PRICE_VALUE = '[class*="valueValue-"]';
    const PRICE_TITLE = '[class*="valueTitle-"]';
    const RISK_PCT = 2.5;

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
            const v = RISK_PCT;
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
        "ws://localhost:8788?clientId=2",
        "ws://127.0.0.1:8788?clientId=2",
        "ws://localhost:8787?clientId=2",
        "ws://127.0.0.1:8787?clientId=2",
    ];
    const WEBHOOK = "http://localhost:8787/notify";

    // POLLING

    // ====== Bridge HTTP polling (CSP-safe) ======
    const BRIDGE_HTTP_ENDPOINTS = [
        "http://localhost:8788/pull",
        "http://127.0.0.1:8788/pull",
        "http://localhost:8787/pull",
        "http://127.0.0.1:8787/pull",
    ];

    const CLIENT_ID = "2";

    // polling tunables
    const POLL_MIN_MS = 250;     // rápido sin ser ridículo
    const POLL_MAX_MS = 1500;    // backoff si falla
    const JITTER_MS   = 180;     // para que no peguen todos a la vez

    let _pollIdx = 0;
    let _pollDelay = POLL_MIN_MS;
    let _polling = false;

    function gmGetJSON(url, cbOk, cbErr) {
        GM_xmlhttpRequest({
            method: "GET",
            url,
            headers: { "Accept": "application/json" },
            onload: (r) => {
                try {
                    const data = JSON.parse(r.responseText || "{}");
                    cbOk(data);
                } catch (e) {
                    cbErr(e);
                }
            },
            onerror: (e) => cbErr(e),
        });
    }

    function nextPollURL() {
        const base = BRIDGE_HTTP_ENDPOINTS[_pollIdx % BRIDGE_HTTP_ENDPOINTS.length];
        _pollIdx++;
        // cache buster + client id
        return `${base}?clientId=${encodeURIComponent(CLIENT_ID)}&t=${Date.now()}`;
    }

    function scheduleNextPoll() {
        const jitter = Math.floor(Math.random() * JITTER_MS);
        setTimeout(pollOnce, _pollDelay + jitter);
    }

    function pollOnce() {
        if (_polling) return;
        _polling = true;

        const url = nextPollURL();

        gmGetJSON(
            url,
            async (data) => {
                _polling = false;

                // back to fast polling on success
                _pollDelay = POLL_MIN_MS;

                // Esperado: { ok:true, msg:null } o { ok:true, msg:{type:"tv_signal", ...}}
                const msg = data?.msg;

                if (msg?.type === "tv_signal") {
                    console.log("[Bridge HTTP] señal recibida", msg);
                    try {
                        await handleTVSignal(msg);
                    } catch (e) {
                        console.warn("[Bridge HTTP] handleTVSignal error", e);
                    }

                    // opcional: ACK para borrar del server la señal consumida
                    // (solo si tu backend soporta /ack)
                    // GM_xmlhttpRequest({ method:"POST", url:`http://localhost:8788/ack?clientId=${CLIENT_ID}`, data:"" });
                }

                scheduleNextPoll();
            },
            (err) => {
                _polling = false;
                console.warn("[Bridge HTTP] poll error", err);

                // backoff suave si falla
                _pollDelay = Math.min(POLL_MAX_MS, Math.floor(_pollDelay * 1.6));

                scheduleNextPoll();
            }
        );
    }

    function startBridgeHTTP() {
        console.log("[Bridge HTTP] start polling…");
        _pollIdx = 0;
        _pollDelay = POLL_MIN_MS;
        scheduleNextPoll();
    }

    // END POLLING

    function symbolFromURL() {
        try {
            const u = new URL(location.href);
            const p = u.pathname.split("/").filter(Boolean);
            return p[p.length - 1] || "";
        } catch {
            return "";
        }
    }

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

    // Limit the leverage per order
    function capQtyByLeverage({ entry, qtyRisk, side, sl, balance, atr }) {
        const L = STORE.lev;
        const mmr = STORE.mmr;
        const bufA = STORE.liqBufATR * atr; // buffer mínimo absoluto en precio

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

    // Buy/Sell buttons selectors
    function findSideButtons() {
        const buyBtn = document.querySelector('[data-type="BUY"]');
        const sellBtn = document.querySelector('[data-type="SELL"]');
        return { buyBtn, sellBtn };
    }

    function getSide() {

        const saved = JSON.parse(localStorage.getItem("last_tv_signal") || "null");

        return saved.side === 'short' ? 'sell' : 'buy';
    }

    function setSideInUI(targetSide) {
        debugger;
        const { buyBtn, sellBtn } = findSideButtons();
        const target = targetSide === "sell" ? sellBtn : buyBtn;

        if (!target) {
            console.warn("[Side] botón no encontrado");
            return;
        }


        setTimeout(() => {
            target.click()
        }, 100);
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

    function readPrice() {
        const ctx =
              findContextWith(PRICE_TITLE) ||
              findContextWith(PRICE_VALUE) ||
              findContextWith(CLASS_ITEM);
        if (!ctx) return NaN;
        return readPriceFromCtx(ctx);
    }

    // Inputs .css-7gbhpa (UI)
    function getBlocks() {
        const nodes = Array.from(document.getElementsByClassName("oui-w-full oui-bg-transparent"));

        return nodes.map((div, i) => ({
            i,
            div,
            text: (div.textContent || "").trim().toLowerCase(),
        }));
    }

    function findNearbyInput(container) {
        //debugger;

        const candidates = [
            container.nextElementSibling,
            container.previousElementSibling,
            container.parentElement?.nextElementSibling,
            container.parentElement?.previousElementSibling,
        ];

        for (const node of candidates) {
            if (!node) continue;

            if (node.tagName === "INPUT") return node;

            const deepInput = node.querySelector("input");
            if (deepInput) return deepInput;
        }
        return null;
    }

    function mapIndexes(blocks, setStaticIndexes = false) {
        let iPrice, iTp, iSl, iQty;
        //debugger;
        for (const b of blocks) {
            const t = b.text;
            if (iPrice == null && /(^|[\s:])price($|\s)/.test(t)) iPrice = b.i;
            if (iTp == null && /tp\s*price/.test(t)) iTp = b.i;
            if (iSl == null && /sl\s*price|stop\s*loss/.test(t)) iSl = b.i;
            if (iQty == null && /\b(qty|quantity|size|amount|vol(ume)?)\b/.test(t))
                iQty = b.i;
        }
        if (setStaticIndexes) return { PRICE: 0, TP: 3, SL: 5, QTY: 1 };
        else return { PRICE: iPrice, TP: iTp, SL: iSl, QTY: iQty };
    }

    function resolveIndexes() {
        const blocks = getBlocks();
        const auto = mapIndexes(blocks, true);
        //debugger;
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
        const { idx, blocks } = resolveIndexes();
        //debugger;
        const pick = (j) => {
            const blk = blocks[j];
            if (!blk) return null;
            //return findNearbyInput(blk.div);
            return blk;
        };
        const inputs = {
            meta: idx,
            price: pick(idx.PRICE),
            tp: pick(idx.TP),
            sl: pick(idx.SL),
        };

        let qtyInput = Number.isInteger(idx.QTY) ? pick(idx.QTY) : null;

        inputs.qty = qtyInput;

        return inputs;
    }

    // React/Chakra input setters
    function setInputValue(input, val) {

        if (!input) return;
        const wanted = String(val);
        //input.focus();
        const inputElement = input.div;
        const proto = Object.getPrototypeOf(inputElement);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const nativeSet = desc && desc.set;
        if (nativeSet) nativeSet.call(inputElement, wanted);
        else inputElement.value = wanted;
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        inputElement.dispatchEvent(new Event("change", { bubbles: true }));
        inputElement.blur();

        /*
        setTimeout(() => {
            if (input.value !== wanted) {
                input.focus();
                if (nativeSet) nativeSet.call(input, wanted);
                else input.value = wanted;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.blur();
            }
        }, 800);
        */
    }

    function roundNumber(value, input) {
        if (!input) return Number(value.toFixed(3));
        //debugger;

        const cur = parseFloat(input.value || "0");
        const dec = (cur.toString().split(".")[1] || "").length || 3;
        return Number(value.toFixed(dec));
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
                `No encuentro Price/TP/SL. .css-7gbhpa=${meta._len} idx=(${meta.PRICE}/${meta.TP}/${meta.SL})`,
                "warn"
            );
            return;
        }

        let entry = parseFloat(priceInput.value);

        if (!Number.isFinite(entry)) {
            entry = readPrice();
            if (!Number.isFinite(entry)) {
                toast("No hay Price (input o panel).", "warn");
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
            const balanceElement = document.querySelector(".oui-text-2xl");
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
        const entry = price ? parseFloat(price.div.value || "") : NaN;
        const tpParsed = tp ? parseFloat(tp.div.value || "") : NaN;
        const slParsed = sl ? parseFloat(sl.div.value || "") : NaN;
        const qtyParsed = qty ? parseFloat(qty.div.value || "") : NaN;
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
            toast("No hay entry/TP/SL válidos para notificar apertura.", "warn");
            console.log(entry, tp, sl);
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
            clientId: '2'
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
            console.log("[auto-trade] Orden preparada con ATR bridge");
            //orderly-order-entry-submit-button-sell
            //orderly-order-entry-submit-button-buy
            if(side === "long") document.getElementsByClassName("orderly-order-entry-submit-button-buy")[0].click()
            if(side === "short") document.getElementsByClassName("orderly-order-entry-submit-button-sell")[0].click()
            sendOpenNotify();
        }, 500);

        toast(`Señal ${side.toUpperCase()} • ATR_BIN=${atrBin.toFixed(3)}`, "ok");
        console.log("[Raydium exec]", {
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
                    localStorage.setItem("last_tv_signal", JSON.stringify(msg));
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
        startBridgeHTTP();
    }

    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", init);
    else init();
})();