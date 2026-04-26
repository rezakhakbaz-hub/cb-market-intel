/*
CB Market Intelligence Telegram monitor

Setup:
1. Create a Google Sheet named "CB Market Pulse".
2. Add a tab named "Market Pulse" with columns:
   Indicator | Source | Current Value | Previous Value | Change % | Threshold % | Updated At
3. In Extensions > Apps Script, paste this file.
4. Set Script Properties:
   TELEGRAM_BOT_TOKEN = token from @BotFather
   TELEGRAM_CHAT_ID = your chat_id
5. Run setupMarketPulse() once, approve permissions, then run createQuarterHourTrigger().
*/

const MARKET_PULSE_SHEET = 'Market Pulse';

const INDICATORS = [
  { name: 'Brent', source: 'BZ=F', threshold: 2 },
  { name: 'Natural Gas', source: 'NG=F', threshold: 3 },
  { name: 'Methanol', source: 'Manual/SGX:MTF1!', threshold: 2 },
  { name: 'Benzene', source: 'RB=F', threshold: 2 },
  { name: 'Freight', source: 'Manual/INDEX:BDI', threshold: 5 },
  { name: 'Ethylene', source: 'MEOH', threshold: 3 },
  { name: 'Aluminium', source: 'ALI=F', threshold: 3 },
];

function setupMarketPulse() {
  const sheet = getMarketPulseSheet_();
  sheet.clear();
  sheet.appendRow(['Indicator', 'Source', 'Current Value', 'Previous Value', 'Change %', 'Threshold %', 'Updated At']);
  INDICATORS.forEach((item) => sheet.appendRow([item.name, item.source, '', '', '', item.threshold, '']));
}

function createQuarterHourTrigger() {
  ScriptApp.newTrigger('checkMarketPulse').timeBased().everyMinutes(15).create();
}

function checkMarketPulse() {
  const sheet = getMarketPulseSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i += 1) {
    const [indicator, source, current, previous, , threshold] = rows[i];
    const liveValue = fetchYahooClose_(source);
    if (!liveValue) continue;

    const priorValue = Number(current || previous || liveValue);
    const changePct = priorValue ? ((liveValue - priorValue) / priorValue) * 100 : 0;

    sheet.getRange(i + 1, 3, 1, 5).setValues([[liveValue, priorValue, changePct, threshold, new Date()]]);

    if (Math.abs(changePct) >= Number(threshold)) {
      sendTelegram_(`CB Market Alert: ${indicator} moved ${changePct.toFixed(2)}% to ${liveValue}. Threshold: ${threshold}%.`);
      MailApp.sendEmail('rezakhakbaz1@me.com', `CB Market Alert: ${indicator}`, `${indicator} moved ${changePct.toFixed(2)}% to ${liveValue}.`);
    }
  }
}

function fetchYahooClose_(symbol) {
  if (!symbol || symbol.indexOf('Manual/') === 0) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const payload = JSON.parse(response.getContentText());
  const closes = payload.chart.result[0].indicators.quote[0].close.filter((value) => typeof value === 'number');
  return closes.length ? closes[closes.length - 1] : null;
}

function sendTelegram_(message) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) throw new Error('Missing Telegram script properties.');

  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'post',
    payload: {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    },
    muteHttpExceptions: true,
  });
}

function getMarketPulseSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(MARKET_PULSE_SHEET) || ss.insertSheet(MARKET_PULSE_SHEET);
}
