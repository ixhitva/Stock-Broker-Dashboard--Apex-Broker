/**
 * app.js
 * Core application controller. Manages user sessions, real-time DOM renders,
 * limit orders matching, SVG technical indicators, news feed updates, and CSV exports.
 */

(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const urlUser = urlParams.get('user');
  const isDemoFrame = urlParams.get('demo') === 'true';

  // Use sessionStorage for active session to support multi-tab logins, preserving localStorage for portfolios
  let activeUserEmail = urlUser || sessionStorage.getItem('stock_active_user') || null;
  let activeStock = 'GOOG';
  let userProfile = null;

  const DEFAULT_PROFILE = {
    cash: 10000.00,
    holdings: {},
    subscriptions: ['GOOG', 'TSLA', 'AMZN'],
    transactions: [],
    limitOrders: [] // [ { id, ticker, type, shares, limitPrice, status, timestamp } ]
  };

  // Math Utilities for Technical Indicators
  function computeSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push(null);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        sma.push(Number((sum / period).toFixed(2)));
      }
    }
    return sma;
  }

  function computeBollingerBands(data, period, stdDevMultiplier = 2) {
    const sma = computeSMA(data, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < data.length; i++) {
      if (sma[i] === null) {
        upper.push(null);
        lower.push(null);
      } else {
        const slice = data.slice(i - period + 1, i + 1);
        const mean = sma[i];
        const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        upper.push(Number((mean + stdDevMultiplier * stdDev).toFixed(2)));
        lower.push(Number((mean - stdDevMultiplier * stdDev).toFixed(2)));
      }
    }
    return { sma, upper, lower };
  }

  // Toast System
  function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
      const parentContainer = window.parent.document.getElementById('toast-container');
      if (parentContainer) {
        triggerToastInContainer(parentContainer, title, message, type);
      }
      return;
    }
    triggerToastInContainer(container, title, message, type);
  }

  function triggerToastInContainer(container, title, message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-header">${title}</div>
      <div class="toast-message">${message}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3500);
  }

  // 1. Session and Profile Management
  function initUserSession() {
    const pathname = window.location.pathname;
    const isLoginPage = pathname.includes('login.html');
    const isDemoPage = pathname.includes('demo.html');
    const isIndexPage = pathname.endsWith('index.html') || pathname.endsWith('/');

    if (isDemoPage) return;

    if (!activeUserEmail) {
      if (!isLoginPage && !isIndexPage && !isDemoFrame) {
        window.location.href = 'login.html';
        return;
      }
    } else {
      loadUserProfile();
      if (isLoginPage) {
        window.location.href = 'dashboard.html';
        return;
      }
    }
  }

  function loadUserProfile() {
    if (!activeUserEmail) return;
    const key = `stock_profile_${activeUserEmail}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        userProfile = JSON.parse(stored);
        userProfile.cash = userProfile.cash !== undefined ? userProfile.cash : 10000.00;
        userProfile.holdings = userProfile.holdings || {};
        userProfile.subscriptions = userProfile.subscriptions || ['GOOG', 'TSLA', 'AMZN'];
        userProfile.transactions = userProfile.transactions || [];
        userProfile.limitOrders = userProfile.limitOrders || [];
      } catch (e) {
        userProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
      }
    } else {
      userProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
      saveUserProfile();
    }
  }

  function saveUserProfile() {
    if (!activeUserEmail || !userProfile) return;
    const key = `stock_profile_${activeUserEmail}`;
    localStorage.setItem(key, JSON.stringify(userProfile));
  }

  // 2. Limit Orders Engine
  function processLimitOrders(marketState) {
    if (!userProfile || !userProfile.limitOrders) return;
    let stateChanged = false;

    userProfile.limitOrders.forEach(order => {
      if (order.status !== 'pending') return;

      const currentPrice = marketState.prices[order.ticker]?.price;
      if (!currentPrice) return;

      let triggered = false;
      const totalCost = order.shares * currentPrice;

      if (order.type === 'buy') {
        if (currentPrice <= order.limitPrice) {
          triggered = true;
          if (userProfile.cash >= totalCost) {
            userProfile.cash -= totalCost;
            userProfile.holdings[order.ticker] = (userProfile.holdings[order.ticker] || 0) + order.shares;
            order.status = 'executed';
            order.executedPrice = currentPrice;
            order.executedTime = Date.now();
            
            userProfile.transactions.unshift({
              id: Math.random().toString(36).substr(2, 9),
              type: 'buy',
              ticker: order.ticker,
              shares: order.shares,
              price: currentPrice,
              total: totalCost,
              timestamp: Date.now(),
              note: `Limit Order triggered at $${order.limitPrice}`
            });

            showToast('Order Executed', `Limit Buy of ${order.shares} ${order.ticker} filled at $${currentPrice.toFixed(2)}`, 'success');
          } else {
            order.status = 'failed';
            showToast('Order Failed', `Limit Buy of ${order.shares} ${order.ticker} failed. Insufficient funds.`, 'danger');
          }
          stateChanged = true;
        }
      } else if (order.type === 'sell') {
        if (currentPrice >= order.limitPrice) {
          triggered = true;
          const owned = userProfile.holdings[order.ticker] || 0;
          if (owned >= order.shares) {
            userProfile.cash += totalCost;
            userProfile.holdings[order.ticker] = owned - order.shares;
            if (userProfile.holdings[order.ticker] === 0) {
              delete userProfile.holdings[order.ticker];
            }
            order.status = 'executed';
            order.executedPrice = currentPrice;
            order.executedTime = Date.now();

            userProfile.transactions.unshift({
              id: Math.random().toString(36).substr(2, 9),
              type: 'sell',
              ticker: order.ticker,
              shares: order.shares,
              price: currentPrice,
              total: totalCost,
              timestamp: Date.now(),
              note: `Limit Order triggered at $${order.limitPrice}`
            });

            showToast('Order Executed', `Limit Sell of ${order.shares} ${order.ticker} filled at $${currentPrice.toFixed(2)}`, 'success');
          } else {
            order.status = 'failed';
            showToast('Order Failed', `Limit Sell of ${order.shares} ${order.ticker} failed. Insufficient shares.`, 'danger');
          }
          stateChanged = true;
        }
      }
    });

    if (stateChanged) {
      saveUserProfile();
      renderHeader();
      
      const pathname = window.location.pathname;
      if (pathname.includes('portfolio.html')) {
        renderPortfolioDetails(marketState);
      } else if (pathname.includes('dashboard.html')) {
        renderTradePanel(marketState);
      }
    }
  }

  // 3. Renderers
  function renderHeader() {
    const userBadge = document.getElementById('user-badge');
    const cashValue = document.getElementById('cash-value');
    const navLogout = document.getElementById('nav-logout');

    if (userBadge) userBadge.textContent = activeUserEmail;
    if (cashValue && userProfile) {
      cashValue.textContent = `$${userProfile.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (navLogout) {
      navLogout.onclick = (e) => {
        e.preventDefault();
        sessionStorage.removeItem('stock_active_user');
        window.location.href = 'login.html';
      };
    }
  }

  function renderTickerTape(marketState) {
    const track = document.getElementById('ticker-tape-track');
    if (!track) return;

    const tickers = window.MarketEngine.getStocks();
    let trackContent = '';

    function buildItemHTML(ticker) {
      const data = marketState.prices[ticker];
      if (!data) return '';
      const prefix = data.change >= 0 ? '+' : '';
      const cl = data.change >= 0 ? 'price-up' : 'price-down';
      return `
        <div class="ticker-item">
          <span class="ticker-ticker">${ticker}</span>
          <span class="ticker-val">$${data.price.toFixed(2)}</span>
          <span class="ticker-pct ${cl}">${prefix}${data.changePercent.toFixed(2)}%</span>
        </div>
      `;
    }

    tickers.forEach(t => { trackContent += buildItemHTML(t); });
    track.innerHTML = trackContent + trackContent;
  }

  function renderStockGrid(marketState) {
    const grid = document.getElementById('stock-cards-grid');
    if (!grid || !userProfile) return;

    const subscribed = userProfile.subscriptions;
    const currentCards = Array.from(grid.children);

    currentCards.forEach(card => {
      const ticker = card.dataset.ticker;
      if (!subscribed.includes(ticker)) grid.removeChild(card);
    });

    subscribed.forEach(ticker => {
      const stockData = marketState.prices[ticker];
      const history = marketState.history[ticker] || [];
      if (!stockData) return;

      let card = grid.querySelector(`.stock-card[data-ticker="${ticker}"]`);
      const isNew = !card;

      const priceStr = `$${stockData.price.toFixed(2)}`;
      const changePrefix = stockData.change >= 0 ? '+' : '';
      const changeClass = stockData.change >= 0 ? 'price-up' : 'price-down';
      const changeStr = `${changePrefix}${stockData.change.toFixed(2)} (${changePrefix}${stockData.changePercent.toFixed(2)}%)`;

      if (isNew) {
        card = document.createElement('div');
        card.className = 'glass-panel glass-panel-interactive stock-card';
        card.dataset.ticker = ticker;
        card.innerHTML = `
          <div class="stock-card-header">
            <div>
              <div class="stock-ticker">${ticker}</div>
              <div class="stock-name">${stockData.name}</div>
            </div>
            <div class="stock-price-section">
              <div class="stock-price">${priceStr}</div>
              <div class="stock-change ${changeClass}">${changeStr}</div>
            </div>
          </div>
          <div class="stock-card-chart">
            <svg class="sparkline-svg" width="100%" height="100%" viewBox="0 0 100 50" preserveAspectRatio="none">
              <path class="sparkline-path" fill="none" stroke-width="2" d=""></path>
            </svg>
          </div>
        `;
        card.onclick = () => selectActiveStock(ticker);
        grid.appendChild(card);
      } else {
        const priceEl = card.querySelector('.stock-price');
        const changeEl = card.querySelector('.stock-change');
        const oldPrice = parseFloat(priceEl.textContent.replace('$', ''));
        const newPrice = stockData.price;

        priceEl.textContent = priceStr;
        changeEl.textContent = changeStr;
        changeEl.className = `stock-change ${changeClass}`;

        if (newPrice > oldPrice) {
          priceEl.classList.remove('flash-down');
          priceEl.classList.add('flash-up');
        } else if (newPrice < oldPrice) {
          priceEl.classList.remove('flash-up');
          priceEl.classList.add('flash-down');
        }
      }

      const sparklinePath = card.querySelector('.sparkline-path');
      if (sparklinePath && history.length > 1) {
        const minVal = Math.min(...history);
        const maxVal = Math.max(...history);
        const range = maxVal - minVal || 1;
        const width = 100;
        const height = 40;
        const points = history.map((val, index) => {
          const x = (index / (history.length - 1)) * width;
          const y = height - ((val - minVal) / range) * height + 5;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        sparklinePath.setAttribute('d', `M ${points.join(' L ')}`);
        sparklinePath.setAttribute('stroke', stockData.changePercent >= 0 ? '#10b981' : '#f43f5e');
      }

      if (ticker === activeStock) {
        card.style.borderColor = 'var(--color-accent)';
        card.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.25)';
      } else {
        card.style.borderColor = 'var(--glass-border)';
        card.style.boxShadow = 'none';
      }
    });

    if (subscribed.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 2.5rem; text-align: center; color: var(--text-secondary);" class="glass-panel">
          No active subscriptions. Select tickers in the manager panel.
        </div>
      `;
    }
  }

  function selectActiveStock(ticker) {
    activeStock = ticker;
    const cards = document.querySelectorAll('.stock-card');
    cards.forEach(card => {
      if (card.dataset.ticker === ticker) {
        card.style.borderColor = 'var(--color-accent)';
        card.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.25)';
      } else {
        card.style.borderColor = 'var(--glass-border)';
        card.style.boxShadow = 'none';
      }
    });

    const marketState = window.MarketEngine.getCurrentState();
    renderMainChart(marketState);
    renderTradePanel(marketState);
    renderOrderBook(marketState);
  }

  function renderMainChart(marketState) {
    const titleEl = document.getElementById('chart-stock-ticker');
    const nameEl = document.getElementById('chart-stock-name');
    const priceEl = document.getElementById('chart-price-display');
    const changeEl = document.getElementById('chart-change-display');
    const svgEl = document.getElementById('interactive-chart-svg');

    if (!titleEl || !marketState || !activeStock) return;

    const data = marketState.prices[activeStock];
    const history = marketState.history[activeStock] || [];

    if (!data) return;

    titleEl.textContent = activeStock;
    nameEl.textContent = data.name;
    priceEl.textContent = `$${data.price.toFixed(2)}`;

    const changePrefix = data.change >= 0 ? '+' : '';
    changeEl.textContent = `${changePrefix}${data.change.toFixed(2)} (${changePrefix}${data.changePercent.toFixed(2)}%)`;
    changeEl.className = `stat-change ${data.change >= 0 ? 'up' : 'down'}`;

    if (history.length < 2) return;

    const svgWidth = svgEl.clientWidth || 700;
    const svgHeight = 280;
    svgEl.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    const minVal = Math.min(...history);
    const maxVal = Math.max(...history);
    const range = maxVal - minVal || 1;
    const yPadding = 25;
    const usableHeight = svgHeight - (yPadding * 2);

    const points = history.map((val, index) => {
      const x = (index / (history.length - 1)) * svgWidth;
      const y = svgHeight - yPadding - ((val - minVal) / range) * usableHeight;
      return { x, y, val };
    });

    const existingIndicators = svgEl.querySelectorAll('.indicator-drawn');
    existingIndicators.forEach(el => el.parentNode.removeChild(el));

    const showSMA = document.getElementById('indicator-sma')?.checked;
    const showBollinger = document.getElementById('indicator-bollinger')?.checked;

    if (showBollinger && history.length >= 10) {
      const bands = computeBollingerBands(history, 10, 2);
      const upperPts = [];
      const lowerPts = [];

      points.forEach((p, idx) => {
        if (bands.upper[idx] !== null) {
          const uy = svgHeight - yPadding - ((bands.upper[idx] - minVal) / range) * usableHeight;
          const ly = svgHeight - yPadding - ((bands.lower[idx] - minVal) / range) * usableHeight;
          upperPts.push({ x: p.x, y: uy });
          lowerPts.push({ x: p.x, y: ly });
        }
      });

      if (upperPts.length > 0) {
        const bandPathD = 
          `M ${upperPts[0].x} ${upperPts[0].y} ` +
          upperPts.slice(1).map(pt => `L ${pt.x} ${pt.y}`).join(' ') + ' ' +
          lowerPts.slice().reverse().map(pt => `L ${pt.x} ${pt.y}`).join(' ') + ' Z';

        const bandFill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        bandFill.setAttribute('d', bandPathD);
        bandFill.setAttribute('class', 'main-chart-bollinger-band indicator-drawn');
        svgEl.insertBefore(bandFill, svgEl.firstChild);

        const upperBorderD = `M ${upperPts[0].x} ${upperPts[0].y} ` + upperPts.slice(1).map(pt => `L ${pt.x} ${pt.y}`).join(' ');
        const lowerBorderD = `M ${lowerPts[0].x} ${lowerPts[0].y} ` + lowerPts.slice(1).map(pt => `L ${pt.x} ${pt.y}`).join(' ');

        const uLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        uLine.setAttribute('d', upperBorderD);
        uLine.setAttribute('class', 'main-chart-bollinger-line indicator-drawn');
        uLine.setAttribute('fill', 'none');
        svgEl.appendChild(uLine);

        const lLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lLine.setAttribute('d', lowerBorderD);
        lLine.setAttribute('class', 'main-chart-bollinger-line indicator-drawn');
        lLine.setAttribute('fill', 'none');
        svgEl.appendChild(lLine);
      }
    }

    if (showSMA && history.length >= 10) {
      const smaData = computeSMA(history, 10);
      const smaPts = points.map((p, idx) => {
        if (smaData[idx] === null) return null;
        const y = svgHeight - yPadding - ((smaData[idx] - minVal) / range) * usableHeight;
        return `${p.x.toFixed(1)} ${y.toFixed(1)}`;
      }).filter(pt => pt !== null);

      if (smaPts.length > 0) {
        const smaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        smaPath.setAttribute('d', `M ${smaPts.join(' L ')}`);
        smaPath.setAttribute('class', 'main-chart-sma indicator-drawn');
        smaPath.setAttribute('fill', 'none');
        smaPath.setAttribute('stroke-width', '1.5');
        svgEl.appendChild(smaPath);
      }
    }

    const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const fillPathData = `${pathData} L ${svgWidth} ${svgHeight} L 0 ${svgHeight} Z`;

    const strokePath = svgEl.querySelector('.main-chart-line');
    const fillPath = svgEl.querySelector('.main-chart-fill');

    if (strokePath && fillPath) {
      strokePath.setAttribute('d', pathData);
      fillPath.setAttribute('d', fillPathData);
      const themeColor = data.changePercent >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
      strokePath.setAttribute('stroke', themeColor);
      const gradStop = document.getElementById('chart-grad-color');
      if (gradStop) gradStop.setAttribute('stop-color', themeColor);
    }

    setupChartHover(svgEl, points, svgHeight);
  }

  function setupChartHover(svgEl, points, svgHeight) {
    const hoverLine = svgEl.querySelector('.chart-hover-line');
    const hoverCircle = svgEl.querySelector('.chart-hover-circle');
    const tooltip = document.getElementById('chart-custom-tooltip');

    if (!hoverLine || !hoverCircle || !tooltip) return;

    svgEl.onmousemove = function (e) {
      const rect = svgEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const width = rect.width;
      const index = Math.round((mouseX / width) * (points.length - 1));
      
      if (index >= 0 && index < points.length) {
        const pt = points[index];
        
        hoverLine.setAttribute('x1', pt.x);
        hoverLine.setAttribute('x2', pt.x);
        hoverLine.setAttribute('y1', 0);
        hoverLine.setAttribute('y2', svgHeight);
        hoverLine.style.display = 'block';

        hoverCircle.setAttribute('cx', pt.x);
        hoverCircle.setAttribute('cy', pt.y);
        hoverCircle.style.display = 'block';

        const tooltipPrice = tooltip.querySelector('.chart-tooltip-price');
        const tooltipTime = tooltip.querySelector('.chart-tooltip-time');

        if (tooltipPrice && tooltipTime) {
          tooltipPrice.textContent = `$${pt.val.toFixed(2)}`;
          tooltipTime.textContent = `Tick ${index + 1}`;
        }

        tooltip.style.display = 'block';
        tooltip.style.left = `${pt.x + rect.left - tooltip.offsetWidth / 2}px`;
        tooltip.style.top = `${pt.y + rect.top - tooltip.offsetHeight - 12}px`;
      }
    };

    svgEl.onmouseleave = function () {
      hoverLine.style.display = 'none';
      hoverCircle.style.display = 'none';
      tooltip.style.display = 'none';
    };
  }

  function renderOrderBook(marketState) {
    const container = document.getElementById('order-book-depth');
    if (!container || !activeStock) return;

    const stock = marketState.prices[activeStock];
    if (!stock) return;

    const basePrice = stock.price;
    const bids = [];
    const asks = [];

    for (let i = 1; i <= 4; i++) {
      const spread = i * 0.04;
      const sizeMultiplier = 1 - (i * 0.15);
      
      bids.push({
        price: Number((basePrice - spread).toFixed(2)),
        size: Math.round((200 + Math.random() * 500) * sizeMultiplier)
      });

      asks.push({
        price: Number((basePrice + spread).toFixed(2)),
        size: Math.round((200 + Math.random() * 500) * sizeMultiplier)
      });
    }

    asks.sort((a, b) => b.price - a.price);
    bids.sort((a, b) => b.price - a.price);

    const maxVol = 700;
    let html = '';
    
    asks.forEach(ask => {
      const barWidth = Math.min((ask.size / maxVol) * 100, 100);
      html += `
        <div class="order-book-row">
          <span class="depth-ask-price">$${ask.price.toFixed(2)}</span>
          <span>${ask.size}</span>
          <span style="text-align: right;">$${(ask.price * ask.size).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <div class="order-book-bar ask" style="width: ${barWidth}%;"></div>
        </div>
      `;
    });

    const spreadVal = asks[asks.length - 1].price - bids[0].price;
    html += `
      <div class="depth-spread-row">
        Spread: $${spreadVal.toFixed(2)} (${((spreadVal / basePrice) * 100).toFixed(2)}%)
      </div>
    `;

    bids.forEach(bid => {
      const barWidth = Math.min((bid.size / maxVol) * 100, 100);
      html += `
        <div class="order-book-row">
          <span class="depth-bid-price">$${bid.price.toFixed(2)}</span>
          <span>${bid.size}</span>
          <span style="text-align: right;">$${(bid.price * bid.size).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <div class="order-book-bar bid" style="width: ${barWidth}%;"></div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function renderNewsFeed(marketState) {
    const container = document.getElementById('market-news-feed');
    if (!container || !marketState.news) return;

    const subscribed = userProfile?.subscriptions || [];
    const news = marketState.news.filter(n => subscribed.includes(n.ticker) || n.ticker === 'NVDA' || n.id === 'init-news');

    container.innerHTML = '';
    news.forEach(item => {
      const timeStr = new Date(item.timestamp).toLocaleTimeString();
      const card = document.createElement('div');
      card.className = 'news-card';
      card.innerHTML = `
        <div class="news-meta">
          <span class="news-ticker-badge">${item.ticker}</span>
          <span class="news-sentiment-badge ${item.sentiment}">${item.sentiment}</span>
        </div>
        <div class="news-headline">${item.headline}</div>
        <div class="news-time">${timeStr}</div>
      `;
      container.appendChild(card);
    });

    if (news.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); padding: 2rem;">
          No recent articles matching your subscriptions.
        </div>
      `;
    }
  }

  function renderSubscriptionManager() {
    const container = document.getElementById('subscription-manager-list');
    if (!container || !userProfile) return;

    const list = window.MarketEngine.getStocks();
    container.innerHTML = '';

    list.forEach(ticker => {
      const config = window.MarketEngine.getStockConfig(ticker);
      const isSubscribed = userProfile.subscriptions.includes(ticker);
      
      const item = document.createElement('div');
      item.className = 'subscription-item';
      item.innerHTML = `
        <div class="sub-meta">
          <span class="sub-ticker">${ticker}</span>
          <span class="sub-name">${config.name}</span>
        </div>
        <label class="switch">
          <input type="checkbox" data-ticker="${ticker}" ${isSubscribed ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      `;

      const toggle = item.querySelector('input');
      toggle.onchange = (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
          if (!userProfile.subscriptions.includes(ticker)) userProfile.subscriptions.push(ticker);
        } else {
          userProfile.subscriptions = userProfile.subscriptions.filter(s => s !== ticker);
          if (activeStock === ticker) activeStock = userProfile.subscriptions[0] || '';
        }
        saveUserProfile();
        
        const marketState = window.MarketEngine.getCurrentState();
        renderStockGrid(marketState);
        if (activeStock) {
          selectActiveStock(activeStock);
        } else {
          clearChartAndTradePanel();
        }
      };
      container.appendChild(item);
    });
  }

  function clearChartAndTradePanel() {
    const titleEl = document.getElementById('chart-stock-ticker');
    if (titleEl) titleEl.textContent = 'None';
    const nameEl = document.getElementById('chart-stock-name');
    if (nameEl) nameEl.textContent = 'Please subscribe to a stock';
    const priceEl = document.getElementById('chart-price-display');
    if (priceEl) priceEl.textContent = '$0.00';
    const changeEl = document.getElementById('chart-change-display');
    if (changeEl) changeEl.textContent = '';
    const strokePath = document.querySelector('.main-chart-line');
    const fillPath = document.querySelector('.main-chart-fill');
    if (strokePath) strokePath.setAttribute('d', '');
    if (fillPath) fillPath.setAttribute('d', '');

    const tradeStockName = document.getElementById('trade-stock-name');
    if (tradeStockName) tradeStockName.textContent = 'Select a stock';
    const tradeAvailableHoldings = document.getElementById('trade-holdings-count');
    if (tradeAvailableHoldings) tradeAvailableHoldings.textContent = '0 shares';
  }

  function renderTradePanel(marketState) {
    const stockNameEl = document.getElementById('trade-stock-name');
    const inputShares = document.getElementById('trade-shares-input');
    const costValue = document.getElementById('trade-total-cost');
    const holdingsCount = document.getElementById('trade-holdings-count');

    if (!stockNameEl || !marketState || !activeStock) return;

    const stock = marketState.prices[activeStock];
    if (!stock) return;

    stockNameEl.textContent = `${activeStock} - ${stock.name}`;
    const count = userProfile.holdings[activeStock] || 0;
    holdingsCount.textContent = `${count} share${count !== 1 ? 's' : ''} owned`;

    function calculateTotal() {
      const shares = parseInt(inputShares.value) || 0;
      const total = shares * stock.price;
      costValue.textContent = `$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (!inputShares.dataset.listenerSet) {
      inputShares.oninput = calculateTotal;
      inputShares.dataset.listenerSet = 'true';
    }
    calculateTotal();
  }

  function setupTradeForms() {
    const tabBuy = document.getElementById('trade-tab-buy');
    const tabSell = document.getElementById('trade-tab-sell');
    const typeMarket = document.getElementById('order-type-market');
    const typeLimit = document.getElementById('order-type-limit');
    const limitPriceContainer = document.getElementById('limit-price-container');
    const inputLimitPrice = document.getElementById('trade-limit-price-input');
    const inputShares = document.getElementById('trade-shares-input');
    const submitBtn = document.getElementById('trade-submit-btn');

    if (!tabBuy || !tabSell || !submitBtn) return;

    let tradeType = 'buy';
    let executionMode = 'market';

    tabBuy.onclick = () => {
      tradeType = 'buy';
      tabBuy.classList.add('active');
      tabSell.classList.remove('active');
      submitBtn.className = 'btn-success';
      submitBtn.textContent = executionMode === 'market' ? 'Place Buy Order' : 'Submit Limit Buy';
    };

    tabSell.onclick = () => {
      tradeType = 'sell';
      tabSell.classList.add('active');
      tabBuy.classList.remove('active');
      submitBtn.className = 'btn-danger';
      submitBtn.textContent = executionMode === 'market' ? 'Place Sell Order' : 'Submit Limit Sell';
    };

    if (typeMarket && typeLimit && limitPriceContainer) {
      typeMarket.onclick = () => {
        executionMode = 'market';
        typeMarket.classList.add('active');
        typeLimit.classList.remove('active');
        limitPriceContainer.style.display = 'none';
        submitBtn.textContent = tradeType === 'buy' ? 'Place Buy Order' : 'Place Sell Order';
      };

      typeLimit.onclick = () => {
        executionMode = 'limit';
        typeLimit.classList.add('active');
        typeMarket.classList.remove('active');
        limitPriceContainer.style.display = 'flex';
        submitBtn.textContent = tradeType === 'buy' ? 'Submit Limit Buy' : 'Submit Limit Sell';
        
        if (!inputLimitPrice.value && activeStock) {
          const currentMarket = window.MarketEngine.getCurrentState();
          const p = currentMarket.prices[activeStock]?.price;
          if (p) inputLimitPrice.value = p.toFixed(2);
        }
      };
    }

    submitBtn.onclick = (e) => {
      e.preventDefault();
      const shares = parseInt(inputShares.value) || 0;
      if (shares <= 0) return;

      const marketState = window.MarketEngine.getCurrentState();
      const stock = marketState.prices[activeStock];
      if (!stock) return;

      if (executionMode === 'market') {
        const totalCost = shares * stock.price;
        if (tradeType === 'buy') {
          if (userProfile.cash < totalCost) {
            showToast('Order Rejected', 'Insufficient funds to execute trade.', 'danger');
            return;
          }
          userProfile.cash -= totalCost;
          userProfile.holdings[activeStock] = (userProfile.holdings[activeStock] || 0) + shares;
          showToast('Order Executed', `Bought ${shares} ${activeStock} at $${stock.price.toFixed(2)}`, 'success');
        } else {
          const owned = userProfile.holdings[activeStock] || 0;
          if (owned < shares) {
            showToast('Order Rejected', 'Insufficient shares to execute trade.', 'danger');
            return;
          }
          userProfile.cash += totalCost;
          userProfile.holdings[activeStock] = owned - shares;
          if (userProfile.holdings[activeStock] === 0) delete userProfile.holdings[activeStock];
          showToast('Order Executed', `Sold ${shares} ${activeStock} at $${stock.price.toFixed(2)}`, 'success');
        }

        userProfile.transactions.unshift({
          id: Math.random().toString(36).substr(2, 9),
          type: tradeType,
          ticker: activeStock,
          shares: shares,
          price: stock.price,
          total: totalCost,
          timestamp: Date.now()
        });

      } else {
        const limitPrice = parseFloat(inputLimitPrice.value);
        if (!limitPrice || limitPrice <= 0) {
          alert('Please input a valid limit target price.');
          return;
        }

        const newLimitOrder = {
          id: Math.random().toString(36).substr(2, 9),
          ticker: activeStock,
          type: tradeType,
          shares: shares,
          limitPrice: limitPrice,
          status: 'pending',
          timestamp: Date.now()
        };

        userProfile.limitOrders.unshift(newLimitOrder);
        showToast('Limit Order Registered', `Trigger limit set for ${shares} ${activeStock} at $${limitPrice.toFixed(2)}`, 'info');
      }

      saveUserProfile();
      renderHeader();
      renderTradePanel(marketState);
      inputShares.value = '';
    };
  }

  function renderPortfolioDetails(marketState) {
    const tableBody = document.getElementById('holdings-table-body');
    const transactionList = document.getElementById('transaction-log-list');
    const limitTableBody = document.getElementById('limit-orders-table-body');
    const totalWorthEl = document.getElementById('portfolio-total-value');
    const returnValEl = document.getElementById('portfolio-return-value');
    const returnPctEl = document.getElementById('portfolio-return-pct');

    if (!userProfile) return;

    let totalStockValuation = 0;
    let initialCostValuation = 0;

    if (tableBody) {
      tableBody.innerHTML = '';
      const ownedTickers = Object.keys(userProfile.holdings);

      if (ownedTickers.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 2rem;">
              No current holdings. Go to the dashboard to start trading.
            </td>
          </tr>
        `;
      } else {
        ownedTickers.forEach(ticker => {
          const shares = userProfile.holdings[ticker];
          const stock = marketState.prices[ticker];
          if (!stock) return;

          const txs = userProfile.transactions.filter(t => t.ticker === ticker);
          let totalCostForHolding = 0;
          let totalBoughtShares = 0;
          txs.forEach(t => {
            if (t.type === 'buy') {
              totalCostForHolding += t.total;
              totalBoughtShares += t.shares;
            }
          });
          const avgBuyPrice = totalBoughtShares > 0 ? (totalCostForHolding / totalBoughtShares) : stock.price;

          const currentVal = shares * stock.price;
          const costBasisVal = shares * avgBuyPrice;
          
          totalStockValuation += currentVal;
          initialCostValuation += costBasisVal;

          const gainLoss = currentVal - costBasisVal;
          const gainLossPct = costBasisVal > 0 ? (gainLoss / costBasisVal) * 100 : 0;

          const glClass = gainLoss >= 0 ? 'price-up' : 'price-down';
          const glPrefix = gainLoss >= 0 ? '+' : '';

          const row = document.createElement('tr');
          row.innerHTML = `
            <td>
              <div style="font-weight: 700;">${ticker}</div>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">${stock.name}</div>
            </td>
            <td>${shares}</td>
            <td>$${stock.price.toFixed(2)}</td>
            <td>$${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="${glClass}">${glPrefix}$${gainLoss.toFixed(2)} (${glPrefix}${gainLossPct.toFixed(2)}%)</td>
          `;
          tableBody.appendChild(row);
        });
      }
    }

    const netWorth = userProfile.cash + totalStockValuation;
    const initialInvested = 10000.00;
    const overallGain = netWorth - initialInvested;
    const overallPct = (overallGain / initialInvested) * 100;

    if (totalWorthEl) {
      totalWorthEl.textContent = `$${netWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (returnValEl && returnPctEl) {
      returnValEl.textContent = `${overallGain >= 0 ? '+' : ''}$${overallGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      returnPctEl.textContent = `${overallGain >= 0 ? '+' : ''}${overallPct.toFixed(2)}%`;
      returnValEl.parentElement.className = `stat-change ${overallGain >= 0 ? 'up' : 'down'}`;
    }

    renderAllocationDonut(totalStockValuation);

    if (limitTableBody) {
      limitTableBody.innerHTML = '';
      const orders = userProfile.limitOrders || [];
      const pendingOrders = orders.filter(o => o.status === 'pending');

      if (pendingOrders.length === 0) {
        limitTableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">
              No active pending orders.
            </td>
          </tr>
        `;
      } else {
        pendingOrders.forEach(order => {
          const row = document.createElement('tr');
          const typeClass = order.type === 'buy' ? 'price-up' : 'price-down';
          
          row.innerHTML = `
            <td><span style="font-weight:700;">${order.ticker}</span></td>
            <td><span class="${typeClass}" style="text-transform:uppercase; font-weight:600;">${order.type}</span></td>
            <td>${order.shares}</td>
            <td>$${order.limitPrice.toFixed(2)}</td>
            <td>
              <button class="btn-logout cancel-btn" data-id="${order.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
                Cancel
              </button>
            </td>
          `;

          row.querySelector('.cancel-btn').onclick = (e) => {
            const id = e.target.dataset.id;
            userProfile.limitOrders = userProfile.limitOrders.filter(o => o.id !== id);
            saveUserProfile();
            showToast('Order Cancelled', 'Limit order removed successfully.', 'info');
            renderPortfolioDetails(marketState);
          };

          limitTableBody.appendChild(row);
        });
      }
    }

    if (transactionList) {
      transactionList.innerHTML = '';
      if (userProfile.transactions.length === 0) {
        transactionList.innerHTML = `
          <div style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">
            No transactions executed.
          </div>
        `;
      } else {
        userProfile.transactions.slice(0, 15).forEach(tx => {
          const item = document.createElement('div');
          item.className = `transaction-item ${tx.type}`;
          const dateStr = new Date(tx.timestamp).toLocaleTimeString();
          const subtitle = tx.note ? `<div style="font-size:0.7rem; color:var(--text-secondary);">${tx.note}</div>` : '';
          const title = tx.type === 'buy' ? `Bought ${tx.shares} ${tx.ticker}` : `Sold ${tx.shares} ${tx.ticker}`;
          
          item.innerHTML = `
            <div class="tx-main">
              <span class="tx-title">${title}</span>
              <span class="tx-date">${dateStr}</span>
              ${subtitle}
            </div>
            <span class="tx-amount">$${tx.total.toFixed(2)}</span>
          `;
          transactionList.appendChild(item);
        });
      }
    }
  }

  function renderAllocationDonut(totalStockValuation) {
    const svgEl = document.getElementById('allocation-donut-svg');
    if (!svgEl) return;

    const legendEl = document.getElementById('allocation-legend');
    const totalCash = userProfile.cash;
    const totalVal = totalCash + totalStockValuation;

    const slices = [{ label: 'Cash', value: totalCash, color: 'var(--color-accent)' }];
    const colors = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
    
    let colorIdx = 0;
    Object.entries(userProfile.holdings).forEach(([ticker, shares]) => {
      const marketState = window.MarketEngine.getCurrentState();
      const stock = marketState.prices[ticker];
      if (stock) {
        slices.push({
          label: ticker,
          value: shares * stock.price,
          color: colors[colorIdx % colors.length]
        });
        colorIdx++;
      }
    });

    const radius = 60;
    const circ = 2 * Math.PI * radius;
    svgEl.innerHTML = '';
    
    let accumulatedPct = 0;
    if (legendEl) legendEl.innerHTML = '';

    slices.forEach(slice => {
      const pct = slice.value / totalVal;
      if (pct <= 0) return;

      const strokeDashArray = `${pct * circ} ${circ}`;
      const strokeDashOffset = -accumulatedPct * circ;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', 80);
      circle.setAttribute('cy', 80);
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', 'transparent');
      circle.setAttribute('stroke', slice.color);
      circle.setAttribute('stroke-width', 16);
      circle.setAttribute('stroke-dasharray', strokeDashArray);
      circle.setAttribute('stroke-dashoffset', strokeDashOffset);
      svgEl.appendChild(circle);

      accumulatedPct += pct;

      if (legendEl) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
          <span class="legend-dot" style="background-color: ${slice.color};"></span>
          <span>${slice.label}: ${(pct * 100).toFixed(0)}%</span>
        `;
        legendEl.appendChild(item);
      }
    });

    const centerVal = document.getElementById('allocation-center-val');
    if (centerVal) centerVal.textContent = `$${totalVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function exportTransactionsToCSV() {
    if (!userProfile || !userProfile.transactions || userProfile.transactions.length === 0) {
      alert('No transactions logged to export.');
      return;
    }

    let csvContent = 'ID,Date,Time,Type,Ticker,Shares,Price,Total\n';
    
    userProfile.transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString().replace(/,/g, '');
      csvContent += `${tx.id},${dateStr},${timeStr},${tx.type.toUpperCase()},${tx.ticker},${tx.shares},${tx.price.toFixed(2)},${tx.total.toFixed(2)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `apex_terminal_statement_${activeUserEmail}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function setupLoginEvents() {
    const loginForm = document.getElementById('login-form');
    if (!loginForm) return;

    loginForm.onsubmit = (e) => {
      e.preventDefault();
      const emailField = document.getElementById('login-email');
      const email = emailField.value.trim().toLowerCase();
      if (!email) return;

      sessionStorage.setItem('stock_active_user', email);
      activeUserEmail = email;
      loadUserProfile();
      window.location.href = 'dashboard.html';
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    initUserSession();

    if (activeUserEmail) {
      renderHeader();
    }

    const pathname = window.location.pathname;

    if (pathname.includes('login.html')) {
      setupLoginEvents();
    } 
    else if (pathname.includes('dashboard.html')) {
      renderSubscriptionManager();
      setupTradeForms();

      const indSMA = document.getElementById('indicator-sma');
      const indBollinger = document.getElementById('indicator-bollinger');

      if (indSMA) indSMA.onchange = () => {
        const ms = window.MarketEngine.getCurrentState();
        renderMainChart(ms);
      };
      if (indBollinger) indBollinger.onchange = () => {
        const ms = window.MarketEngine.getCurrentState();
        renderMainChart(ms);
      };

      window.addEventListener('market-tick', (event) => {
        const marketState = event.detail;
        
        processLimitOrders(marketState);

        if (!activeStock && userProfile.subscriptions.length > 0) {
          activeStock = userProfile.subscriptions[0];
        }

        renderTickerTape(marketState);
        renderStockGrid(marketState);
        renderNewsFeed(marketState);

        if (activeStock) {
          renderMainChart(marketState);
          renderTradePanel(marketState);
          renderOrderBook(marketState);
        }
      });
      
      const initialMarket = window.MarketEngine.getCurrentState();
      if (initialMarket) {
        renderTickerTape(initialMarket);
        renderStockGrid(initialMarket);
        renderNewsFeed(initialMarket);
        if (activeStock) {
          renderMainChart(initialMarket);
          renderTradePanel(initialMarket);
          renderOrderBook(initialMarket);
        }
      }
    } 
    else if (pathname.includes('portfolio.html')) {
      const csvBtn = document.getElementById('export-statement-btn');
      if (csvBtn) {
        csvBtn.onclick = (e) => {
          e.preventDefault();
          exportTransactionsToCSV();
        };
      }

      window.addEventListener('market-tick', (event) => {
        const marketState = event.detail;
        processLimitOrders(marketState);
        renderPortfolioDetails(marketState);
      });

      const initialMarket = window.MarketEngine.getCurrentState();
      if (initialMarket) {
        renderPortfolioDetails(initialMarket);
      }
    }
  });

})();
