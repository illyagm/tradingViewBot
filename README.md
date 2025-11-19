# TradingView → Raydium Automation Bridge

This project links **TradingView** and **Raydium Perpetuals** through a local WebSocket/HTTP bridge and three userscripts.  
The system enables automated trade execution, real-time signal synchronization, and cross-platform state tracking.

> **Important:**  
> Each userscript in this repository must be installed **separately** in Tampermonkey and assigned to **its corresponding website**:
>
> - TradingView scripts must be added under `https://www.tradingview.com/*` and the active that you would like to trade
> - Raydium scripts must be added under `https://perps.raydium.io/*`
> - Do not mix them. Each website loads only the script intended for that platform

**TradingView**
<img width="1325" height="211" alt="image" src="https://github.com/user-attachments/assets/54235087-8440-45d3-bc94-8fa17a3f5323" />

**Raydium**
<img width="1456" height="192" alt="image" src="https://github.com/user-attachments/assets/33a04cf3-7383-426c-836b-790a82c84df7" />


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

*And why the Screen Blocker? This is one of the limitations of this approach. Trading view bridge script is based on numeric label values, on each candle when interacting with the chart, this value changes.*
*This could lead to an undesired order execution.*

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

## Backend (Express.js)

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

<img width="286" height="212" alt="image" src="https://github.com/user-attachments/assets/a91264c6-ac50-4e44-a758-e18f452ec9d1" />


---

## Requirements

- Node.js 18+
- Tampermonkey or compatible userscript runner
- TradingView (no need for paid tiers, this project has an objective, bypass all the subscription costs)
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
```

### DISCLAIMER

By using this code, you acknowledge that:

- **You understand the risks of automating trading-related actions.**
- **You are solely responsible for complying with the Terms of Service of any platform involved.**
- **You accept that improper use may lead to unexpected behavior, losses, or account restrictions.**
- **The authors of this project assume no liability for damages, financial losses, malfunction, or any other consequences resulting from the use, misuse, or inability to use this software.**
- **If the words 'automate' and 'trading' appear in the same sentence, you should always proceed with caution. Really.**
