// ==UserScript==
// @name         TradingView Screen Shield
// @namespace    illya-utils
// @version      2025-10-15
// @description  Keyboard-toggleable screen blocker to prevent accidental clicks (Alt+B).
// @match        https://www.tradingview.com/chart/hjdamPtl/?symbol=BINANCE%3ASOLUSDC
// @grant        none
// ==/UserScript==

(function () {
  // LocalStorage key used to persist ON/OFF state across reloads
  const STORAGE_KEY = "screenShieldActive";

  // Creates the invisible overlay that captures all interactions
  function createShieldLayer() {
    let layer = document.getElementById("screen-shield-layer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "screen-shield-layer";

    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      background: "rgb(253 253 253 / 8%)",
      cursor: "not-allowed",
      zIndex: "2147483647",
      pointerEvents: "auto", // absolutely required to block clicks
    });

    // Block every interaction
    const blockEvent = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const eventsToBlock = [
      "click",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "dblclick",
      "contextmenu",
      "wheel",
      "touchstart",
      "touchend",
      "keydown",
      "keyup",
    ];

    eventsToBlock.forEach((ev) =>
      layer.addEventListener(ev, blockEvent, { passive: false, capture: true })
    );

    document.documentElement.appendChild(layer);
    return layer;
  }

  // Creates the small badge showing the shield is active
  function createShieldBadge() {
    let badge = document.getElementById("screen-shield-badge");
    if (badge) return badge;

    badge = document.createElement("div");
    badge.id = "screen-shield-badge";

    Object.assign(badge.style, {
      position: "fixed",
      top: "10px",
      left: "10px",
      padding: "6px 8px",
      background: "rgba(220, 0, 0, 0.85)",
      color: "#fff",
      font: "12px/1.2 system-ui, sans-serif",
      borderRadius: "8px",
      zIndex: "2147483647",
      boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      userSelect: "none",
      pointerEvents: "none", // badge is just visual
    });

    badge.textContent = "Shield ON (Alt+B)";
    document.documentElement.appendChild(badge);

    return badge;
  }

  // Enables/deactivates the screen shield
  function toggleShield(state) {
    localStorage.setItem(STORAGE_KEY, state ? "1" : "0");

    const layer = document.getElementById("screen-shield-layer");
    const badge = document.getElementById("screen-shield-badge");

    if (state) {
      if (!layer) createShieldLayer();
      if (!badge) createShieldBadge();
    } else {
      layer && layer.remove();
      badge && badge.remove();
    }
  }

  // Toggle with Alt+B
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.altKey && (event.key === "b" || event.key === "B")) {
        const currentlyActive = localStorage.getItem(STORAGE_KEY) === "1";
        toggleShield(!currentlyActive);
      }
    },
    { capture: true }
  );

  // Restore persisted state on page load
  const initialState = localStorage.getItem(STORAGE_KEY) === "1";
  if (initialState) toggleShield(true);
})();
