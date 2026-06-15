# Apex Broker Client Terminal

A professional-grade, multi-page stock broker web dashboard designed with a glassmorphic dark-theme UI. This application simulates a live market ticker, generates real-time news headlines that bias price drifts, supports market and limit orders, draws technical charting overlays, visualizes asset allocations, and supports concurrent multi-user testing.

Check it out here: https://apexbrokerproj.netlify.app/login.html

Built entirely using optimized, modern vanilla HTML5, CSS3, and JavaScript, the terminal requires no third-party compilation, external framework packages, or node installations.

## Features

- **Decentralized Multi-Tab Syncing**: Coordinates real-time price ticks across multiple browser tabs using a BroadcastChannel. An automated election protocol designates a single active tab as the Host Ticker to run the generator, while other tabs act as listeners. If the Host tab is closed, another tab takes over host duties immediately.
- **Dynamic Price Simulation**: Evaluates prices every second using a random walk step (-0.8% to +0.8%) across five supported tickers: GOOG, TSLA, AMZN, META, and NVDA.
- **News Sentiment Bias**: Generates random financial headlines. Positive or negative news triggers temporary drift biases (for the next 12 ticks) affecting that specific stock's random walk direction.
- **Technical Chart Overlays**: Dynamic SVG charting terminal displaying price history with checkboxes to toggle a Simple Moving Average (SMA-10) line and standard deviation Bollinger Bands (10, 2).
- **Level 2 Market Depth**: Displays simulated live bid and ask queues surrounding the current market rate, coupled with proportional volume depth bar graphs.
- **Simulated Trading Engine**: Supports instant Market Orders and automated Limit Orders. Limit orders are evaluated on every price tick and trigger a filled transaction once the trigger price is crossed.
- **Portfolio Analytics**: Visualizes total assets (buying power and stock holdings valuation) via a real-time responsive SVG donut chart and includes a CSV export function for transaction statements.
- **Split-Screen Demo**: A dual-view testing bench (demo.html) containing side-by-side iframe terminals loaded with different mock profiles, proving simultaneous asynchronous updates in real-time.

## Directory Structure

```text
stock-dashboard/
├── index.html         # Session checker; redirects to dashboard.html or login.html
├── login.html         # Portal entrance with session creation and split-screen link
├── dashboard.html     # Main trade station containing tickers, depth lists, and chartings
├── portfolio.html     # Asset summaries, allocations, limit order logs, and transaction tables
├── demo.html          # Dual-user side-by-side sandbox environment
├── styles.css         # Frosted glass layout parameters, keyframed flashes, and transitions
├── market.js          # Core background simulation engine and cross-tab sync manager
├── app.js             # Client-side DOM controllers, order matching, math indicators, and exports
└── README.md          # Project documentation
```

## Running the Application Locally

Since the application leverages modern web features like BroadcastChannel, iframes, and local file exports, it should be run through a web server rather than opening the HTML files directly from the filesystem.

You can spin up a local server using any standard utility.

### Option 1: Python (Built-in)
If you have Python installed, navigate to the directory and run:
```bash
python -m http.server 8000
```
Open your browser and navigate to: `http://localhost:8000`

### Option 2: Node.js (http-server)
If you prefer Node.js, install and start a static server:
```bash
npx http-server -p 8000
```
Open your browser and navigate to: `http://localhost:8000`

## Under the Hood

### State & Storage Management
Authentication is fully client-side. Profiles are saved under separate `localStorage` keys using the email as a suffix (`stock_profile_name@domain.com`). This isolation guarantees that independent users maintain distinct cash, transaction records, and holdings when testing the split-screen view.

### SVG Painting Routines
Charts and graphs are computed in the DOM using raw SVG tags. 
- **Sparklines**: Renders a polyline path scaled to the card container size using price boundaries:
  `y_pixel = height - ((current_price - min_price) / (max_price - min_price)) * height`
- **Bollinger Bands**: Formulates a closed polygon path combining upper band points moving left-to-right and lower band points moving right-to-left to create a shaded container ribbon.
