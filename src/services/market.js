import axios from 'axios';
import { consume } from '../utils/rateLimit.js';

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

// OKX public API — no auth required
const OKX_BASE = 'https://www.okx.com/api/v5';

// ExchangeRate-API — no auth required
const FX_BASE = 'https://open.er-api.com/v6/latest';

// Map common ticker symbols to OKX instId format (SYMBOL-USDT)
const CRYPTO_TICKER_MAP = {
  BTC: 'BTC-USDT',
  ETH: 'ETH-USDT',
  XRP: 'XRP-USDT',
  SOL: 'SOL-USDT',
  ADA: 'ADA-USDT',
  DOGE: 'DOGE-USDT',
  DOT: 'DOT-USDT',
  MATIC: 'MATIC-USDT',
  AVAX: 'AVAX-USDT',
  LINK: 'LINK-USDT',
  // CoinGecko legacy IDs → OKX (for backward compat)
  bitcoin: 'BTC-USDT',
  ethereum: 'ETH-USDT',
  ripple: 'XRP-USDT',
  solana: 'SOL-USDT',
  cardano: 'ADA-USDT',
  dogecoin: 'DOGE-USDT',
  polkadot: 'DOT-USDT',
  polygon: 'MATIC-USDT',
  'avalanche-2': 'AVAX-USDT',
  chainlink: 'LINK-USDT',
};

/**
 * Fetch cryptocurrency price from OKX public API.
 * No API key required.
 * @param {string} symbol - Ticker (e.g. "BTC", "ETH") or OKX instId (e.g. "BTC-USDT")
 */
export async function getCryptoPrice(symbol) {
  try {
    const instId = CRYPTO_TICKER_MAP[symbol] || `${symbol.toUpperCase()}-USDT`;

    const response = await axios.get(`${OKX_BASE}/market/ticker`, {
      params: { instId },
    });

    const data = response.data?.data?.[0];
    if (!data) {
      throw new Error(`No OKX data for: ${instId}`);
    }

    const last = parseFloat(data.last);
    const open24h = parseFloat(data.open24h);
    const changePercent24h = open24h ? ((last - open24h) / open24h) * 100 : null;

    return {
      symbol: symbol.toUpperCase(),
      instId,
      price: last,
      open24h,
      high24h: parseFloat(data.high24h),
      low24h: parseFloat(data.low24h),
      volume24h: parseFloat(data.vol24h),
      change24h: last - open24h,
      changePercent24h: changePercent24h ? parseFloat(changePercent24h.toFixed(2)) : null,
    };
  } catch (error) {
    console.error(`[market.getCryptoPrice] Error for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Fetch stock price from Alpha Vantage GLOBAL_QUOTE.
 * @param {string} symbol - Ticker symbol (e.g. "AAPL", "005930.KS")
 */
export async function getStockPrice(symbol) {
  try {
    if (!(await consume('alpha_vantage'))) {
      throw new Error('Alpha Vantage 일일 API 호출 한도 초과 (25/day)');
    }
    const response = await axios.get(ALPHA_VANTAGE_BASE, {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol,
        apikey: ALPHA_VANTAGE_API_KEY,
      },
    });

    const quote = response.data['Global Quote'];
    if (!quote || !quote['05. price']) {
      throw new Error(`No data returned for stock symbol: ${symbol}`);
    }

    return {
      symbol,
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change']),
      changePercent: quote['10. change percent'],
    };
  } catch (error) {
    console.error(`[market.getStockPrice] Error for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Fetch foreign exchange rate from ExchangeRate-API (free, no key).
 * @param {string} from - Source currency code (e.g. "USD")
 * @param {string} to - Target currency code (e.g. "KRW")
 */
export async function getFxRate(from, to) {
  try {
    const response = await axios.get(`${FX_BASE}/${from}`);

    const rates = response.data?.rates;
    if (!rates || !rates[to]) {
      throw new Error(`No FX data for ${from}/${to}`);
    }

    return {
      from,
      to,
      rate: rates[to],
      change: null,
      changePercent: null,
    };
  } catch (error) {
    console.error(`[market.getFxRate] Error for ${from}/${to}:`, error.message);
    throw error;
  }
}

/**
 * Batch-fetch prices for multiple symbols grouped by type.
 * Uses Promise.allSettled so individual failures don't break the batch.
 * @param {Array<{type: 'crypto'|'stock'|'fx', symbol: string, from?: string, to?: string}>} symbols
 */
export async function getBatchPrices(symbols) {
  // Crypto/FX can run in parallel; stocks must be sequential (Alpha Vantage 5/min limit)
  const results = new Array(symbols.length).fill(null);

  // 1. Fire all crypto/fx requests in parallel
  const parallelPromises = [];
  for (let i = 0; i < symbols.length; i++) {
    const item = symbols[i];
    if (item.type === 'crypto') {
      parallelPromises.push(
        getCryptoPrice(item.symbol)
          .then((r) => { results[i] = r; })
          .catch((e) => console.error(`[getBatchPrices] crypto ${item.symbol}:`, e.message)),
      );
    } else if (item.type === 'fx') {
      parallelPromises.push(
        getFxRate(item.from, item.to)
          .then((r) => { results[i] = r; })
          .catch((e) => console.error(`[getBatchPrices] fx ${item.from}/${item.to}:`, e.message)),
      );
    }
  }

  // 2. Fetch stocks sequentially with 1.5s delay between calls
  const stockEntries = symbols
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.type === 'stock');

  const stockPromise = (async () => {
    for (let si = 0; si < stockEntries.length; si++) {
      const { item, i } = stockEntries[si];
      if (si > 0) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      try {
        results[i] = await getStockPrice(item.symbol);
      } catch (e) {
        console.error(`[getBatchPrices] stock ${item.symbol}:`, e.message);
      }
    }
  })();

  // 3. Wait for everything
  await Promise.all([...parallelPromises, stockPromise]);

  return results.filter(Boolean);
}
