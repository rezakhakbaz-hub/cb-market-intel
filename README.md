# Price Trend For Chembridges

React + Vite dashboard for Chembridges Group MEA commodity market monitoring.

## Run locally

```bash
npm install
npm run dev
```

## Build for GitHub Pages

```bash
npm run build
```

The Vite base path is `/cb-market-intel/` for `https://rezakhakbaz-hub.github.io/cb-market-intel/`.

## Notifications

The app includes an in-app enable/disable switch for browser notifications while the dashboard is open. Alerts trigger when a commodity moves more than the fixed 3% threshold.

For reliable alerts when the page is closed, use the Telegram Google Apps Script in `notifications/telegram-apps-script.js`.

Telegram is the best fit for a static GitHub Pages site because the browser app cannot run scheduled background checks while closed, and a bot token should not be exposed in frontend code.

## Price data

TradingView charts use the exact requested symbols. Card prices attempt free delayed Yahoo-compatible symbols where possible and use manual references for markets that do not have a reliable free browser-safe endpoint.
