import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
  BellRing,
  ChevronRight,
  Clock3,
  ExternalLink,
  Moon,
  Newspaper,
  ShieldAlert,
  Sun,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'cb-market-intel-v1';
const ALERT_THRESHOLD = 3;
const shutdownKeywords = ['shutdown', 'shut down', 'closing', 'closure', 'closed', 'outage', 'offline', 'force majeure', 'maintenance', 'turnaround', 'restart', 'fire', 'explosion', 'disruption'];

const commodities = [
  {
    id: 'brent',
    name: 'Brent Crude',
    short: 'Brent',
    tvSymbol: 'TVC:UKOIL',
    yahoo: 'BZ=F',
    unit: 'USD/bbl',
    threshold: 2,
    impact: ['PE Wax', 'Paraffin Wax', 'Butyl Glycol', 'IPA', 'PM/PMA', 'PE Resin', 'PP Resin', 'White Spirit'],
  },
  {
    id: 'gas',
    name: 'Natural Gas',
    short: 'Gas',
    tvSymbol: 'TVC:NATURALGAS',
    yahoo: 'NG=F',
    unit: 'USD/MMBtu',
    threshold: 3,
    impact: ['Methanol', 'DMF', 'MDC', 'MMA', 'Acetic Acid'],
  },
  {
    id: 'methanol',
    name: 'Methanol',
    short: 'MeOH',
    tvSymbol: 'SGX:MTF1!',
    unit: 'USD/MT',
    threshold: 2,
    manual: 317,
    impact: ['DMF', 'MDC', 'MMA', 'Formic Acid', 'Formaldehyde'],
  },
  {
    id: 'benzene',
    name: 'Benzene proxy',
    short: 'Benzene',
    tvSymbol: 'NYMEX:RB1!',
    yahoo: 'RB=F',
    unit: 'USD/gal',
    threshold: 2,
    impact: ['Cyclohexane', 'Styrene', 'Organic Pigments', 'Resin chain', 'Aniline'],
  },
  {
    id: 'freight',
    name: 'Baltic Dry Index',
    short: 'Freight',
    tvSymbol: 'INDEX:BDI',
    unit: 'points',
    threshold: 5,
    manual: 1760,
    impact: ['All MEA bulk imports', 'All India shipments', 'Container landed cost'],
  },
  {
    id: 'ethylene',
    name: 'Ethylene proxy',
    short: 'Ethylene',
    tvSymbol: 'NASDAQ:MEOH',
    yahoo: 'MEOH',
    unit: 'USD/MT',
    threshold: 3,
    impact: ['PE Resin', 'PP Resin', 'EG', 'MEG', 'Ethylene Oxide'],
  },
  {
    id: 'aluminium',
    name: 'Aluminium',
    short: 'Aluminium',
    tvSymbol: 'TVC:ALUMINIUM',
    yahoo: 'ALI=F',
    unit: 'USD/MT',
    threshold: 3,
    impact: ['Packaging cost', 'Masterbatch inputs', 'Aerosol containers'],
  },
];

const plantAlerts = [
  { region: 'Asia', asset: 'Methanol unit maintenance', severity: 'Watch', note: 'Track China and SEA restarts before confirming offers.' },
  { region: 'GCC', asset: 'Gas-linked feedstock volatility', severity: 'Medium', note: 'DMF, Acetic Acid, and MMA landed costs need quote buffers.' },
  { region: 'Europe', asset: 'Aromatics operating rates', severity: 'Watch', note: 'Benzene chain remains sensitive to refinery run cuts.' },
];

const newsFeeds = [
  { name: 'Chemweek', url: 'https://www.chemweek.com/rss' },
  { name: 'Hydrocarbon Processing', url: 'https://www.hydrocarbonprocessing.com/rss/news' },
  { name: 'S&P Global Chemicals', url: 'https://www.spglobal.com/content/spglobal/energy/us/en/rss/chemicals.xml' },
  { name: 'Oil & Gas Journal Refining', url: 'https://www.ogj.com/__rss/website-scheduled-content.xml?input=%7B%22sectionAlias%22%3A%22refining-processing%22%7D' },
  { name: 'OilPrice', url: 'https://oilprice.com/rss/main' },
  { name: 'FreightWaves', url: 'https://www.freightwaves.com/feed' },
];

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function formatPrice(value) {
  if (value === null || Number.isNaN(value)) return 'N/A';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function stripHtml(value = '') {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isShutdownItem(item) {
  const haystack = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.toLowerCase();
  return shutdownKeywords.some((keyword) => haystack.includes(keyword));
}

function createFallbackQuote(item, stored) {
  const seed = item.manual || 100 + item.id.length * 13;
  const drift = (((Date.now() / 3600000 + item.id.length * 17) % 11) - 5) / 100;
  const price = stored?.manualPrices?.[item.id] ?? seed;
  const previous = price / (1 + drift);
  return {
    price,
    previous,
    changePct: ((price - previous) / previous) * 100,
    source: item.yahoo ? 'Delayed source unavailable' : 'Manual reference',
    status: item.yahoo ? 'fallback' : 'manual',
    updatedAt: new Date().toISOString(),
  };
}

async function fetchYahooQuote(symbol) {
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Quote request failed: ${response.status}`);
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close?.filter((value) => Number.isFinite(value)) || [];
  if (!closes.length) throw new Error('No close prices returned');
  const price = closes.at(-1);
  const previous = closes.length > 1 ? closes.at(-2) : result.meta?.chartPreviousClose || price;
  return {
    price,
    previous,
    changePct: previous ? ((price - previous) / previous) * 100 : 0,
    source: `Yahoo delayed (${symbol})`,
    status: 'live',
    updatedAt: new Date().toISOString(),
  };
}

function useQuotes(manualPrices) {
  const [quotes, setQuotes] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const stored = { manualPrices };
      const pairs = await Promise.all(
        commodities.map(async (item) => {
          if (!item.yahoo) return [item.id, createFallbackQuote(item, stored)];
          try {
            return [item.id, await fetchYahooQuote(item.yahoo)];
          } catch {
            return [item.id, createFallbackQuote(item, stored)];
          }
        }),
      );
      if (!cancelled) setQuotes(Object.fromEntries(pairs));
    }

    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [manualPrices]);

  return quotes;
}

function TradingViewChart({ symbol, theme }) {
  const html = {
    symbol,
    interval: 'D',
    timezone: 'Asia/Dubai',
    theme,
    style: '1',
    range: '12M',
    locale: 'en',
    allow_symbol_change: false,
    calendar: false,
    support_host: 'https://www.tradingview.com',
    autosize: true,
  };

  return (
    <div className="chart-frame">
      <iframe
        title={`TradingView chart ${symbol}`}
        src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_cb&symbol=${encodeURIComponent(symbol)}&interval=D&range=12M&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=[]&theme=${theme}&style=1&timezone=Asia%2FDubai&withdateranges=1&hideideas=1&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=en&utm_source=cb-market-intel&utm_medium=widget&utm_campaign=chart&utm_term=${encodeURIComponent(symbol)}`}
        loading="lazy"
      />
      <script type="application/json">{JSON.stringify(html)}</script>
    </div>
  );
}

function App() {
  const [stored, setStored] = useState(readState);
  const [selectedId, setSelectedId] = useState('brent');
  const [now, setNow] = useState(new Date());
  const [news, setNews] = useState([]);
  const [selectedNews, setSelectedNews] = useState(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(Boolean(stored.notificationsEnabled));

  const manualPrices = stored.manualPrices || {};
  const quotes = useQuotes(manualPrices);
  const theme = stored.theme || 'dark';
  const selected = commodities.find((item) => item.id === selectedId) || commodities[0];
  const shutdownNews = news.filter(isShutdownItem).slice(0, 4);

  const alerts = useMemo(() => {
    return commodities
      .map((item) => ({ item, quote: quotes[item.id] }))
      .filter(({ quote }) => quote && Math.abs(quote.changePct) >= ALERT_THRESHOLD)
      .map(({ item, quote }) => ({
        id: `${item.id}-${quote.updatedAt}`,
        text: `${item.short} moved ${quote.changePct.toFixed(2)}%, crossing the fixed ${ALERT_THRESHOLD}% threshold.`,
        at: quote.updatedAt,
        direction: quote.changePct > 0 ? 'up' : 'down',
      }));
  }, [quotes]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.title = 'Price Trend For Chembridges';
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const existing = stored.alertLog || [];
    const fresh = alerts.filter((alert) => !existing.some((old) => old.id === alert.id));
    if (!fresh.length) return;

    const nextLog = [...fresh, ...existing].slice(0, 10);
    const next = { ...stored, alertLog: nextLog };
    setStored(next);
    saveState(next);

    const browserAllowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (notificationsEnabled && browserAllowed) {
      fresh.forEach((alert) => new Notification('CB Market Alert', { body: alert.text, icon: `${import.meta.env.BASE_URL}icons/icon-192.svg` }));
    }
  }, [alerts, notificationsEnabled]);

  useEffect(() => {
    if (!notificationsEnabled || !shutdownNews.length) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const existing = stored.eventAlertLog || [];
    const fresh = shutdownNews
      .map((item) => ({
        id: item.guid || item.link || item.title,
        text: `Market event: ${item.title}`,
        at: item.pubDate || new Date().toISOString(),
        sourceName: item.sourceName || 'Market feed',
      }))
      .filter((alert) => alert.id && !existing.some((old) => old.id === alert.id));

    if (!fresh.length) return;

    const next = { ...stored, eventAlertLog: [...fresh, ...existing].slice(0, 10) };
    setStored(next);
    saveState(next);
    fresh.forEach((alert) => new Notification('CB Shutdown/Event Alert', { body: alert.text, icon: `${import.meta.env.BASE_URL}icons/icon-192.svg` }));
  }, [shutdownNews, notificationsEnabled]);

  useEffect(() => {
    async function loadNews() {
      try {
        const responses = await Promise.allSettled(
          newsFeeds.map(async (feed) => {
            const feedUrl = encodeURIComponent(feed.url);
            const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${feedUrl}`);
            if (!response.ok) throw new Error(feed.name);
            const data = await response.json();
            return (data.items || []).map((item) => ({ ...item, sourceName: feed.name }));
          }),
        );
        const items = responses
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => result.value)
          .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
          .slice(0, 12);
        setNews(items);
      } catch {
        setNews([
          { title: 'Chemical market feed unavailable', link: 'https://www.chemweek.com/', pubDate: new Date().toISOString(), sourceName: 'Fallback' },
          { title: 'Use TradingView chart panel for live market context', link: 'https://www.tradingview.com/markets/commodities/', pubDate: new Date().toISOString(), sourceName: 'Fallback' },
        ]);
      }
    }
    loadNews();
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    }
  }, []);

  function updateStored(patch) {
    const next = { ...stored, ...patch };
    setStored(next);
    saveState(next);
  }

  async function toggleNotifications() {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      updateStored({ notificationsEnabled: false });
      return;
    }
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    setNotificationsEnabled(enabled);
    updateStored({ notificationsEnabled: enabled });
  }

  function updateManualPrice(id, value) {
    updateStored({ manualPrices: { ...manualPrices, [id]: Number(value) } });
  }

  const clockParts = [
    { city: 'Dubai', time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) },
    { city: 'London', time: now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) },
    { city: 'New York', time: now.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) },
    { city: 'Shanghai', time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }) },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="cb-logo-banner">
            <img className="cb-logo" src={`${import.meta.env.BASE_URL}brand/cb-logo-clean.png`} alt="Chembridges" />
            <div className="rk-signature">
              <img src={`${import.meta.env.BASE_URL}brand/rk-logo-flat-beige.png`} alt="RK" />
            </div>
          </div>
          <h1>Price Trend For Chembridges</h1>
          <p className="eyebrow">MEA Chemical Distribution</p>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => updateStored({ theme: theme === 'dark' ? 'light' : 'dark' })} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className={`primary-action ${notificationsEnabled ? 'enabled' : ''}`} onClick={toggleNotifications}>
            {notificationsEnabled ? <BellRing size={17} /> : <Bell size={17} />}
            {notificationsEnabled ? 'Disable Notifications' : 'Enable Notifications'}
          </button>
        </div>
      </header>

      <section className="ticker" aria-label="Price ticker">
        <div className="ticker-track">
          {[...commodities, ...commodities].map((item, index) => {
            const quote = quotes[item.id];
            const isUp = (quote?.changePct || 0) >= 0;
            return (
              <span className="ticker-item" key={`${item.id}-${index}`}>
                <strong>{item.short}</strong>
                {formatPrice(quote?.price ?? null)}
                <em className={isUp ? 'up' : 'down'}>{quote ? `${isUp ? '+' : ''}${quote.changePct.toFixed(2)}%` : 'loading'}</em>
              </span>
            );
          })}
        </div>
      </section>

      <section className="status-row">
        <div className="session-clock">
          <Clock3 size={17} />
          {clockParts.map((part) => (
            <span key={part.city}>{part.city} {part.time}</span>
          ))}
        </div>
        <a href="https://www.chembridgesgroup.com" target="_blank" rel="noreferrer">
          chembridgesgroup.com <ExternalLink size={14} />
        </a>
      </section>

      <section className="dashboard-grid">
        <div className="cards-grid">
          {commodities.map((item) => {
            const quote = quotes[item.id];
            const breached = quote && Math.abs(quote.changePct) >= ALERT_THRESHOLD;
            const isUp = (quote?.changePct || 0) >= 0;
            return (
              <button
                className={`commodity-card ${selectedId === item.id ? 'selected' : ''} ${breached ? 'breach' : ''}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="card-head">
                  <span>
                    <strong>{breached ? '⚠️ ' : ''}{item.name}</strong>
                    <small>{item.tvSymbol}</small>
                  </span>
                  {isUp ? <TrendingUp className="up" size={20} /> : <TrendingDown className="down" size={20} />}
                </span>
                <span className="price-line">
                  {formatPrice(quote?.price ?? null)}
                  <small>{item.unit}</small>
                </span>
                <span className="metric-row">
                  <em className={isUp ? 'up' : 'down'}>{quote ? `${isUp ? '+' : ''}${quote.changePct.toFixed(2)}%` : 'Loading'}</em>
                  <span>{breached ? 'Alert active' : `Fixed ${ALERT_THRESHOLD}% alert`}</span>
                </span>
                <span className="impact-pills" aria-label={`${item.short} affected products`}>
                  {item.impact.slice(0, 4).map((product) => (
                    <span key={product}>{product}</span>
                  ))}
                </span>
                <span className="source-note">{quote?.source || 'Loading source'}</span>
              </button>
            );
          })}
        </div>

        <aside className="side-panel">
          <div className="panel-header">
            <h2>Notification Center</h2>
            <ShieldAlert size={18} />
          </div>
          <div className={`notification-mode ${notificationsEnabled ? 'enabled' : ''}`}>
            <span>{notificationsEnabled ? 'Browser alerts enabled' : 'Browser alerts disabled'}</span>
            <small>Only price moves over {ALERT_THRESHOLD}% and shutdown/event RSS items send alerts.</small>
          </div>
          {(stored.alertLog || []).length ? (
            <div className="alert-list">
              {(stored.alertLog || []).map((alert) => (
                <div className="alert-item" key={alert.id}>
                  <strong>{alert.text}</strong>
                  <span>{new Date(alert.at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No threshold breaches recorded in this browser yet.</p>
          )}
        </aside>
      </section>

      <section className="shutdown-panel">
        <div className="section-title compact">
          <div>
            <p className="eyebrow">Shutdown Radar</p>
            <h2>Manufacturer closing, outage, and maintenance signals</h2>
          </div>
          <span>RSS scan</span>
        </div>
        {shutdownNews.length ? (
          <div className="shutdown-grid">
            {shutdownNews.map((item) => (
              <button className="shutdown-card" onClick={() => setSelectedNews(item)} key={item.guid || item.link || item.title}>
                <strong>⚠️ {item.title}</strong>
                <span>{item.sourceName || 'Market feed'} | {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : 'Latest'}</span>
                <p>{stripHtml(item.description || item.content).slice(0, 150)}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No shutdown, closing, outage, or maintenance headline detected in the loaded RSS feeds.</p>
        )}
      </section>

      <section className="detail-grid">
        <div className="chart-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">TradingView Advanced Chart</p>
              <h2>{selected.name}</h2>
            </div>
            <span>{selected.tvSymbol}</span>
          </div>
          <TradingViewChart symbol={selected.tvSymbol} theme={theme} />
        </div>

        <div className="insight-panel">
          <div className="section-title compact">
            <div>
              <p className="eyebrow">CB Product Impact</p>
              <h2>{selected.short} exposure</h2>
            </div>
            <ChevronRight size={18} />
          </div>
          <div className="chips">
            {selected.impact.map((product) => <span key={product}>{product}</span>)}
          </div>

          {!selected.yahoo && (
            <label className="manual-price">
              <span>Manual price reference</span>
              <input type="number" value={manualPrices[selected.id] ?? selected.manual} onChange={(event) => updateManualPrice(selected.id, event.target.value)} />
            </label>
          )}

          <div className="plant-list">
            <h3>Plant Shutdown Watch</h3>
            {plantAlerts.map((alert) => (
              <div className="plant-alert" key={`${alert.region}-${alert.asset}`}>
                <strong>{alert.region} | {alert.asset}</strong>
                <span>{alert.severity}</span>
                <p>{alert.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="news-panel">
        <div className="section-title compact">
          <div>
            <p className="eyebrow">Market News</p>
            <h2>Related intelligence feed</h2>
          </div>
          <Newspaper size={19} />
        </div>
        <div className="news-grid">
          {news.map((item) => (
            <button className="news-card" onClick={() => setSelectedNews(item)} key={item.link || item.title}>
              <strong>{item.title}</strong>
              <span>{item.sourceName || 'Market feed'} | {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : 'Latest'}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedNews && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedNews(null)}>
          <article className="news-modal" role="dialog" aria-modal="true" aria-label={selectedNews.title} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedNews(null)} aria-label="Close news detail">X</button>
            <p className="eyebrow">{selectedNews.sourceName || 'Market feed'}</p>
            <h2>{selectedNews.title}</h2>
            <p>{stripHtml(selectedNews.description || selectedNews.content || 'Open the full article for more details.')}</p>
            <a className="primary-action article-link" href={selectedNews.link} target="_blank" rel="noreferrer">
              Open full news <ExternalLink size={15} />
            </a>
          </article>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
