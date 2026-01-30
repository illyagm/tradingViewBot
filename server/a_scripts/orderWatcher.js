// ==UserScript==
// @name         Raydium • Pending/Positions Watcher
// @namespace    illya-utils
// @version      3.0.0
// @description  Alt+Click para fijar los tabs reales de Pending y Positions. Emite: order_pending (Pending 0→>0), order_confirmed (Positions 0→>0), order_closed (Positions >0→0). Dedupe y auto-refresh opcional.
// @match        https://perps.raydium.io/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(() => {
  "use strict";

  // ───────────── Singleton guard ─────────────
  if (window.__RAY_WATCHER_RUNNING__) return;
  window.__RAY_WATCHER_RUNNING__ = true;

  // ───────────── Config ─────────────
  const WEBHOOK = "http://localhost:8787/notify"; // <- ÚNICO
  const AUTH_HEADER = ""; // opcional
  const POLL_MS = 350;
  const STABLE_MS = 250;
  const DEDUPE_MS = 1500;

  const AUTO_REFRESH = true;
  const REFRESH_EVERY_MS = 5000;
  const MAX_REFRESHES_PER_CYCLE = 24;

  const DEBUG = false;

  // Variantes por si el UI cambia idioma
  const LABELS = {
    pending: ["Pending"],
    positions: ["Positions", "Position", "Posiciones"],
  };

  // ───────────── Utils ─────────────
  const postJSON = (obj) =>
    GM_xmlhttpRequest({
      method: "POST",
      url: WEBHOOK,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        AUTH_HEADER ? { "X-Auth": AUTH_HEADER } : {}
      ),
      data: JSON.stringify(obj),
      onload: () => DEBUG && console.log("[notify ok]", obj),
      onerror: (e) => console.warn("[notify error]", e, obj),
    });

  const lastEmitTs = Object.create(null);
  function emit(type) {
    const now = Date.now();
    if (now - (lastEmitTs[type] || 0) < DEDUPE_MS) return;
    lastEmitTs[type] = now;
    postJSON({ type, ts: now });
  }

  const isVisible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      r.width > 0 &&
      r.height > 0
    );
  };

  const getAllDocs = () => {
    const docs = [document];
    for (const f of document.querySelectorAll("iframe")) {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d) docs.push(d);
      } catch { }
    }
    return docs;
  };

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Busca un único candidato por lista de etiquetas
  function findNodeByLabels(labelList) {
    const exactRes = labelList.map((l) => ({
      reExact: new RegExp(`^${l}(?:\\s*\\(\\d+\\))?$`, "i"),
      reNum: new RegExp(`^${l}\\s*\\((\\d+)\\)$`, "i"),
      reBare: new RegExp(`^${l}$`, "i"),
    }));

    // 1) role=tab visibles
    for (const d of getAllDocs()) {
      const tabs = Array.from(d.querySelectorAll('[role="tab"]')).filter(
        isVisible
      );
      const hits = tabs.filter((el) =>
        exactRes.some(({ reExact }) => reExact.test(text(el)))
      );
      if (hits.length) {
        // preferimos el que tenga número
        const withNum = hits.find((el) =>
          exactRes.some(({ reNum }) => reNum.test(text(el)))
        );
        return withNum || hits[0];
      }
    }

    // 2) Fallback: nodos pequeños cuyo texto coincida
    for (const d of getAllDocs()) {
      const nodes = Array.from(d.querySelectorAll("*")).filter((el) => {
        const t = text(el);
        return (
          t &&
          t.length <= 40 &&
          isVisible(el) &&
          exactRes.some(({ reExact }) => reExact.test(t))
        );
      });
      if (nodes.length) {
        const withNum = nodes.find((el) =>
          exactRes.some(({ reNum }) => reNum.test(text(el)))
        );
        return withNum || nodes[0];
      }
    }

    return null;
  }

  function readCountFromNode(node, labelList) {
    if (!node) return null;
    const t = text(node);
    for (const l of labelList) {
      const reNum = new RegExp(`^${l}\\s*\\((\\d+)\\)$`, "i");
      const reBare = new RegExp(`^${l}$`, "i");
      const m = t.match(reNum);
      if (m) return parseInt(m[1], 10) || 0;
      if (reBare.test(t)) return 0;
    }
    // si no encaja con ninguna variante, lectura no concluyente
    return null;
  }

  // ───────────── Binding manual por Alt+Click ─────────────
  let PENDING_NODE = null;
  let POSITIONS_NODE = null;

  function toast(msg, ms = 1400) {
    let t = document.getElementById("watch-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "watch-toast";
      Object.assign(t.style, {
        position: "fixed",
        right: "12px",
        top: "12px",
        padding: "6px 8px",
        borderRadius: "10px",
        background: "rgba(25,35,45,.95)",
        color: "#fff",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "12px",
        zIndex: 2147483647,
        boxShadow: "0 8px 30px rgba(0,0,0,.35)",
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(t._ttl);
    t._ttl = setTimeout(() => t.remove(), ms);
  }

  function bindByAltClick(e) {
    if (!e.altKey) return;
    const t = text(e.target);
    if (LABELS.pending.some((lbl) => new RegExp(`^${lbl}`, "i").test(t))) {
      PENDING_NODE = e.target;
      toast("Bound: Pending");
    } else if (
      LABELS.positions.some((lbl) => new RegExp(`^${lbl}`, "i").test(t))
    ) {
      POSITIONS_NODE = e.target;
      toast("Bound: Positions");
    }
  }
  window.addEventListener("click", bindByAltClick, true);

  // ───────────── Estado / FSM ─────────────
  let lastPending = 0;
  let lastPositions = 0;

  let debouncePndTimer = null;
  let debouncePosTimer = null;

  let refreshTimer = null;
  let refreshesThisCycle = 0;

  function startRefreshing() {
    if (!AUTO_REFRESH || refreshTimer) return;
    refreshesThisCycle = 0;
    refreshTimer = setInterval(() => {
      if (refreshesThisCycle >= MAX_REFRESHES_PER_CYCLE) {
        stopRefreshing();
        return;
      }
      refreshesThisCycle++;
      location.reload();
    }, REFRESH_EVERY_MS);
  }
  function stopRefreshing() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    refreshesThisCycle = 0;
  }

  function readPending() {
    const node = PENDING_NODE || findNodeByLabels(LABELS.pending);
    return readCountFromNode(node, LABELS.pending);
  }
  function readPositions() {
    const node = POSITIONS_NODE || findNodeByLabels(LABELS.positions);
    return readCountFromNode(node, LABELS.positions);
  }

  function handlePending(prev) {
    clearTimeout(debouncePndTimer);
    debouncePndTimer = setTimeout(() => {
      const v = readPending();
      const val = v === null ? prev : v;
      if (val === lastPending) return;

      // 0 -> >0
      if (prev === 0 && val > 0) {
        emit("order_pending");
        startRefreshing();
      }
      // >0 -> 0
      if (prev > 0 && val === 0) {
        stopRefreshing();
      }
      lastPending = val;
    }, STABLE_MS);
  }

  function handlePositions(prev) {
    clearTimeout(debouncePosTimer);
    debouncePosTimer = setTimeout(() => {
      const v = readPositions();
      const val = v === null ? prev : v;
      if (val === lastPositions) return;

      // 0 -> >0
      if (prev === 0 && val > 0) {
        emit("order_confirmed");
      }
      // >0 -> 0
      if (prev > 0 && val === 0) {
        emit("trade_closed");
      }
      lastPositions = val;
    }, STABLE_MS);
  }

  function tick() {
    const p = readPending();
    const s = readPositions();
    if (p !== null && p !== lastPending) handlePending(lastPending);
    if (s !== null && s !== lastPositions) handlePositions(lastPositions);
  }

  function init() {
    // Init state con lecturas actuales
    lastPending = readPending();
    lastPositions = readPositions();
    if (lastPending === null) lastPending = 0;
    if (lastPositions === null) lastPositions = 0;

    if (lastPending > 0) startRefreshing();

    setInterval(tick, POLL_MS);

    toast(
      "Watcher listo. Alt+Click en Pending y Positions para fijarlos.",
      2200
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
