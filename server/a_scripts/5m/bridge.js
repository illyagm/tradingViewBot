// ==UserScript==
// @name          Bridge (CSP-safe)
// @match        https://www.tradingview.com/*
// @match        https://es.tradingview.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    const WEBHOOK = "http://localhost:8787/tv?clientId=2";

    const pickNum = (title) => {
        const el = document.querySelector(`[data-test-id-value-title="${title}"]`);
        if (!el) return NaN;
        const n = Number((el.textContent||"").replace(",", ".").replace(/[^\d.+-eE-]/g, ""));
        return Number.isFinite(n) ? n : NaN;
    };
    const pickInt = (title) => { const v = pickNum(title); return Number.isFinite(v) ? Math.trunc(v) : 0; };


    let lastSide = "none", lastTs = 0;

    function postJSON(url, obj){
        GM_xmlhttpRequest({
            method: "POST",
            url,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(obj),
            onerror: (e)=>console.warn("[TV→Bridge] POST error", e)
        });
    }

    function tick() {
        const atrBin    = pickNum("ATR_BINANCE");
        const trigLong  = pickInt("TRIG_LONG");
        const trigShort = pickInt("TRIG_SHORT");
        const trigFlat  = pickInt("TRIG_FLAT");
        const currentPrice = pickNum('CURRENT_PRICE'); // << nuevo

        console.log(trigFlat, lastSide, 'BOOOOOOOOOOMBOCLAT')


        let side = "none";
        if (trigLong === 1) side = "long";
        if (trigShort === 1) side = "short";

        const now = Date.now();

        // 1) evento de cierre (edge) -> reset y notifica
        if (trigFlat === 1) {
            lastSide = "none";                       // << reset local del de-duplicador
            //postJSON(WEBHOOK, { type: "trade_closed", ts: now });
            console.log("[TV→Bridge] Sent trade_closed");
        }

        if (side !== "none" && side !== lastSide && (now - lastTs > 1000)) {
            lastSide = side; lastTs = now;
            const payload = {
                type: "tv_signal",
                side,
                price: currentPrice,
                atrBin: Number.isFinite(atrBin) ? Number(atrBin.toFixed(6)) : null,
                ts: now,
                clientId: '2'
            };
            postJSON(WEBHOOK, payload);
            console.log("[TV→Bridge] Sent", payload);
        }
    }

    setInterval(tick, 700);
})();