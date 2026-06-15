/**
 * market.js
 * Handles real-time stock price simulation and news generation.
 * Runs locally inside each tab/iframe context to prevent host election race conditions
 * and cross-origin iframe security errors, keying state by the active user's session.
 */

(function () {
  const STOCKS = {
    GOOG: { name: 'Alphabet Inc.', base: 175.40 },
    TSLA: { name: 'Tesla Inc.', base: 184.20 },
    AMZN: { name: 'Amazon.com Inc.', base: 181.10 },
    META: { name: 'Meta Platforms Inc.', base: 505.60 },
    NVDA: { name: 'NVIDIA Corp.', base: 127.30 }
  };

  const NEWS_TEMPLATES = {
    GOOG: [
      { text: 'Alphabet introduces next-generation quantum computing processor', sentiment: 'positive' },
      { text: 'Google Cloud signs strategic partnership with global energy grid provider', sentiment: 'positive' },
      { text: 'Antitrust review panel extends investigation deadline', sentiment: 'negative' },
      { text: 'YouTube ad-revenue projections fall slightly short of institutional estimates', sentiment: 'negative' },
      { text: 'Alphabet researcher publishes breakthrough paper on multimodal agents', sentiment: 'neutral' }
    ],
    TSLA: [
      { text: 'Tesla Gigafactory achieves record-breaking weekly vehicle output rate', sentiment: 'positive' },
      { text: 'TSLA Full Self Driving systems receive regulatory validation in Europe', sentiment: 'positive' },
      { text: 'Cybercab production scale-up experiences minor supplier delays', sentiment: 'negative' },
      { text: 'Global battery cell raw material costs show unexpected rise', sentiment: 'negative' },
      { text: 'TSLA schedules shareholder conference to showcase battery developments', sentiment: 'neutral' }
    ],
    AMZN: [
      { text: 'AWS launches advanced AI model fine-tuning tool for enterprise clients', sentiment: 'positive' },
      { text: 'Prime Day sales volume hits historical high, beating analyst targets', sentiment: 'positive' },
      { text: 'Logistics division automates key warehouse facilities to cut costs', sentiment: 'positive' },
      { text: 'Regulatory authorities challenge seller fee structure policy', sentiment: 'negative' },
      { text: 'AMZN launches new eco-packaging standard across regional hubs', sentiment: 'neutral' }
    ],
    META: [
      { text: 'Meta releases open-weights Llama 4 model family with superior benchmarks', sentiment: 'positive' },
      { text: 'AI ad personalization engine boosts advertiser conversions by fifteen percent', sentiment: 'positive' },
      { text: 'Metaverse division operating expenses narrow ahead of schedule', sentiment: 'positive' },
      { text: 'European data regulators issue compliance assessment notice', sentiment: 'negative' },
      { text: 'META hosts developer workshops focused on augmented reality applications', sentiment: 'neutral' }
    ],
    NVDA: [
      { text: 'Blackwell chip pre-orders exceed manufacturing capacity by three fold', sentiment: 'positive' },
      { text: 'NVIDIA announces liquid-cooling standard partnership with major servers', sentiment: 'positive' },
      { text: 'Rival firms form consortium to develop open accelerator software standard', sentiment: 'negative' },
      { text: 'Chip packaging supply limits cause temporary shipping backlog', sentiment: 'negative' },
      { text: 'NVDA CEO scheduled to deliver keynote at advanced computing summit', sentiment: 'neutral' }
    ]
  };

  const TICK_INTERVAL = 1000;
  const MAX_HISTORY = 30;
  const MAX_NEWS = 12;

  // Resolve active user session to isolate market simulation storage
  const urlParams = new URLSearchParams(window.location.search);
  const urlUser = urlParams.get('user');
  const activeUserEmail = urlUser || sessionStorage.getItem('stock_active_user') || 'default';
  const STORAGE_KEY = `stock_market_state_${activeUserEmail}`;
  
  let marketState = {
    prices: {},
    history: {},
    biases: {}, // { ticker: { direction: 1/-1, ticksRemaining: X } }
    news: []    // [ { id, ticker, headline, sentiment, timestamp } ]
  };

  let tickerIntervalId = null;
  let tickCounter = 0;

  function initializeMarketStorage() {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        marketState = JSON.parse(stored);
        marketState.biases = marketState.biases || {};
        marketState.news = marketState.news || [];
        
        let mismatch = false;
        for (const ticker of Object.keys(STOCKS)) {
          if (!marketState.prices[ticker] || !marketState.history[ticker]) {
            mismatch = true;
            break;
          }
        }
        
        if (!mismatch) {
          // If news is empty, seed it
          if (marketState.news.length === 0) {
            marketState.news = [{
              id: 'init-news',
              ticker: 'NVDA',
              headline: 'Apex Broker Terminal initializes real-time data feeds',
              sentiment: 'neutral',
              timestamp: Date.now()
            }];
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marketState));
          }
          return;
        }
      } catch (e) {
        // Rebuild below
      }
    }

    // Reset fresh setup
    marketState.prices = {};
    marketState.history = {};
    marketState.biases = {};
    marketState.news = [
      {
        id: 'init-news',
        ticker: 'NVDA',
        headline: 'Apex Broker Terminal initializes real-time data feeds',
        sentiment: 'neutral',
        timestamp: Date.now()
      }
    ];

    const now = Date.now();
    for (const [ticker, config] of Object.entries(STOCKS)) {
      marketState.prices[ticker] = {
        ticker: ticker,
        name: config.name,
        price: config.base,
        change: 0,
        changePercent: 0,
        direction: 'up',
        timestamp: now
      };
      marketState.history[ticker] = [config.base];
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marketState));
  }

  function generateNewsEvent() {
    const tickers = Object.keys(STOCKS);
    const randomTicker = tickers[Math.floor(Math.random() * tickers.length)];
    const templates = NEWS_TEMPLATES[randomTicker];
    const template = templates[Math.floor(Math.random() * templates.length)];

    const newsItem = {
      id: Math.random().toString(36).substr(2, 9),
      ticker: randomTicker,
      headline: template.text,
      sentiment: template.sentiment,
      timestamp: Date.now()
    };

    marketState.news.unshift(newsItem);
    if (marketState.news.length > MAX_NEWS) {
      marketState.news.pop();
    }

    if (template.sentiment === 'positive') {
      marketState.biases[randomTicker] = { direction: 1, ticksRemaining: 12 };
    } else if (template.sentiment === 'negative') {
      marketState.biases[randomTicker] = { direction: -1, ticksRemaining: 12 };
    }
  }

  function tickPrices() {
    tickCounter++;
    
    if (tickCounter % 12 === 0) {
      generateNewsEvent();
    }

    const now = Date.now();
    for (const [ticker, config] of Object.entries(STOCKS)) {
      const currentObj = marketState.prices[ticker];
      const oldPrice = currentObj.price;

      let pctChange = (Math.random() * 1.6 - 0.8) / 100;

      const activeBias = marketState.biases[ticker];
      if (activeBias && activeBias.ticksRemaining > 0) {
        const drift = (Math.random() * 0.4 + 0.3) / 100 * activeBias.direction;
        pctChange += drift;
        activeBias.ticksRemaining--;
        if (activeBias.ticksRemaining === 0) {
          delete marketState.biases[ticker];
        }
      }

      let newPrice = oldPrice * (1 + pctChange);
      if (newPrice < 5.0) newPrice = 5.0;

      const absoluteChange = newPrice - config.base;
      const pctFromBase = (absoluteChange / config.base) * 100;
      const direction = newPrice >= oldPrice ? 'up' : 'down';

      marketState.prices[ticker] = {
        ticker: ticker,
        name: config.name,
        price: Number(newPrice.toFixed(2)),
        change: Number(absoluteChange.toFixed(2)),
        changePercent: Number(pctFromBase.toFixed(2)),
        direction: direction,
        timestamp: now
      };

      const list = marketState.history[ticker] || [];
      list.push(Number(newPrice.toFixed(2)));
      if (list.length > MAX_HISTORY) {
        list.shift();
      }
      marketState.history[ticker] = list;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marketState));
  }

  function startTicker() {
    if (tickerIntervalId) return;

    tickerIntervalId = setInterval(() => {
      tickPrices();
      window.dispatchEvent(new CustomEvent('market-tick', { detail: marketState }));
    }, TICK_INTERVAL);

    // Run first tick immediately
    tickPrices();
    window.dispatchEvent(new CustomEvent('market-tick', { detail: marketState }));
  }

  // Setup initial local state and run local ticker
  initializeMarketStorage();
  startTicker();

  window.MarketEngine = {
    getStocks: () => Object.keys(STOCKS),
    getCurrentState: () => {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch(e) {}
      }
      return marketState;
    },
    getStockConfig: (ticker) => STOCKS[ticker]
  };
})();
