# TradingView → Raydium Automation Bridge

This project links **TradingView** and **Raydium Perpetuals** through a local WebSocket/HTTP bridge and three userscripts.  
The system enables automated trade execution, real-time signal synchronization, and cross-platform state tracking.

> **Important:**  
> Each userscript in this repository must be installed **separately** in Tampermonkey and assigned to **its corresponding website**:
>
> - TradingView scripts must be added under `https://www.tradingview.com/*` and the active that you would like to trade
> - Raydium scripts must be added under `https://perps.raydium.io/*`
> - Do not mix them. Each website loads only the script intended for that platform.

---

## Overview

<img width="1051" height="607" alt="image" src="https://github.com/user-attachments/assets/6a5a7746-1d1d-4248-8227-b837961f5e1c" />


The system is composed of three scripts:

### 1. TradingView Bridge Script
Reads indicator values (ATR, triggers, price) and sends structured data to the backend.

It forwards:
- Trade side (long / short)
- ATR values
- Trigger variables (TRIG_LONG / TRIG_SHORT / TRIG_FLAT)
- Current price

### 2. TradingView Screen Blocker
A transparent overlay that prevents accidental clicks or movements on TradingView during automated execution.

- Toggle: **Alt + B**
- Blocks all UI interactions
- Safe for alerts/indicators

### 3. Raydium Order Executor
Runs inside Raydium Perps and:

- Reads & fills Raydium input fields (Price, SL, TP, Qty)
- Calcs ATR-based risk sizing
- Applies leverage caps
- Executes trades automatically
- Emits state events for notifications
  - `order_pending`
  - `order_confirmed`
  - `trade_closed`

---

## Backend (Node.js)

A lightweight server handles communication between platforms.

### HTTP Endpoints

- **POST `/tv`**  
  Receives TradingView webhook payloads.

- **POST `/notify`**  
  Receives Raydium status events.

- **GET `/health`**  
  Basic health check and WebSocket client count.

### WebSocket Server

Broadcasts normalized TradingView signals to all Raydium clients.

### Telegram (Optional)

If configured (`TELEGRAM_BOT_TOKEN` + `CHAT_ID`), the backend sends:

- Open position with all the parameters 

---

## Requirements

- Node.js 18+
- Tampermonkey or compatible userscript runner
- TradingView (no need for paid tiers, this project has as objective, bypass all the subscription costs)
- Raydium Perps interface
- Telegram bot

---

## Installation

### 1. Install all userscripts in Tampermonkey

You must import each script **in its website**:

| Script | Target Website |
|--------|----------------|
| TradingView Bridge Script | `https://www.tradingview.com/*` |
| TradingView Screen Blocker | `https://www.tradingview.com/*` |
| Raydium Order Executor | `https://perps.raydium.io/*` |

Tampermonkey loads scripts only on their defined domains.

### 2. Run the backend server

```bash
npm install
npm start
