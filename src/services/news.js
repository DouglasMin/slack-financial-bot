import axios from 'axios';
import Parser from 'rss-parser';
import { consume } from '../utils/rateLimit.js';
import { chat } from './openai.js';
import * as store from './store.js';

const rssParser = new Parser();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const NEWSDATA_API_KEY = process.env.NEWSDATA_API_KEY;
const NEWS_CACHE_TABLE = process.env.NEWS_CACHE_TABLE;
const NEWS_CACHE_TTL = 5 * 60; // 5 minutes

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const NEWSDATA_BASE = 'https://newsdata.io/api/1';

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function getCached(cacheKey) {
  if (!NEWS_CACHE_TABLE) return null;
  try {
    const cached = await store.getItem(NEWS_CACHE_TABLE, { cacheKey });
    if (cached && cached.expireAt > Math.floor(Date.now() / 1000)) {
      console.log(`[news] Cache hit for "${cacheKey}"`);
      return JSON.parse(cached.articles);
    }
  } catch {
    // Cache miss or error
  }
  return null;
}

function setCache(cacheKey, articles) {
  if (!NEWS_CACHE_TABLE) return;
  store.putItem(NEWS_CACHE_TABLE, {
    cacheKey,
    articles: JSON.stringify(articles),
    expireAt: Math.floor(Date.now() / 1000) + NEWS_CACHE_TTL,
  }).catch((err) => console.warn('[news] Cache write failed:', err.message));
}

// ---------------------------------------------------------------------------
// Dedup + sort helper
// ---------------------------------------------------------------------------

function dedupeAndSort(articles, limit = 5) {
  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = article.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });

  return deduped.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 1. Company News — 개별 주식 종목 뉴스 (Finnhub company-news + NewsData.io)
// ---------------------------------------------------------------------------

/**
 * Fetch news for a specific stock ticker.
 * @param {string} symbol - Stock ticker (e.g. "NVDA", "AAPL", "TSLA")
 * @param {string[]} keywords - Additional search keywords for NewsData.io
 */
export async function fetchCompanyNews(symbol, keywords = []) {
  const cacheKey = `company:${symbol}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const sources = [];

  // Finnhub company-news (ticker-specific)
  sources.push(fetchFinnhubCompanyNews(symbol));

  // Google News RSS + NewsData.io keyword search
  if (keywords.length > 0) {
    sources.push(fetchGoogleNewsArticles(keywords));
    if (NEWSDATA_API_KEY) sources.push(fetchNewsDataArticles(keywords));
  }

  const results = await Promise.allSettled(sources);
  const articles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const final = dedupeAndSort(articles);
  setCache(cacheKey, final);
  return final;
}

// ---------------------------------------------------------------------------
// 2. Crypto News — 암호화폐 뉴스 (Finnhub crypto category + NewsData.io)
// ---------------------------------------------------------------------------

/**
 * Fetch cryptocurrency-related news.
 * @param {string[]} keywords - Search keywords (e.g. ["bitcoin", "BTC"])
 */
export async function fetchCryptoNews(keywords = []) {
  const cacheKey = `crypto:${keywords.map((k) => k.toLowerCase()).sort().join('|')}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const sources = [];

  // Finnhub crypto category
  sources.push(fetchFinnhubNews('crypto'));

  // Google News RSS + NewsData.io keyword search
  if (keywords.length > 0) {
    sources.push(fetchGoogleNewsArticles(keywords));
    if (NEWSDATA_API_KEY) sources.push(fetchNewsDataArticles(keywords));
  }

  const results = await Promise.allSettled(sources);
  const articles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const final = dedupeAndSort(articles);
  setCache(cacheKey, final);
  return final;
}

// ---------------------------------------------------------------------------
// 3. General News — 일반 시장/경제 뉴스 (Finnhub general + NewsData.io)
// ---------------------------------------------------------------------------

/**
 * Fetch general market/economy news.
 * @param {string[]} keywords - Optional keywords to search NewsData.io + Google News
 */
export async function fetchGeneralNews(keywords = []) {
  const cacheKey = keywords.length > 0
    ? `general:${keywords.map((k) => k.toLowerCase()).sort().join('|')}`
    : 'general:__all__';
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  let articles = [];

  if (keywords.length > 0) {
    // Keyword search: use NewsData.io + Google News RSS only (no Finnhub general noise)
    const sources = [fetchGoogleNewsArticles(keywords)];
    if (NEWSDATA_API_KEY) sources.push(fetchNewsDataArticles(keywords));

    const results = await Promise.allSettled(sources);
    articles = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  } else {
    // No keywords — general market overview from Finnhub
    try {
      articles = await fetchFinnhubNews('general');
    } catch {
      articles = [];
    }
  }

  const final = dedupeAndSort(articles);
  setCache(cacheKey, final);
  return final;
}

// ---------------------------------------------------------------------------
// Legacy fetchNews — slash command 등에서 아직 사용. 추후 제거 예정.
// ---------------------------------------------------------------------------

export async function fetchNews(keywords = []) {
  return fetchGeneralNews(keywords);
}

// ---------------------------------------------------------------------------
// Finnhub API calls
// ---------------------------------------------------------------------------

async function fetchFinnhubNews(category = 'general') {
  try {
    if (!(await consume('finnhub'))) {
      console.warn('[news] Finnhub rate limit reached (60/min)');
      return [];
    }
    const response = await axios.get(`${FINNHUB_BASE}/news`, {
      params: { category, token: FINNHUB_API_KEY },
    });

    console.log(`[news.fetchFinnhubNews] category=${category}, results=${(response.data || []).length}`);
    return (response.data || []).slice(0, 10).map((item) => ({
      title: item.headline || '',
      description: item.summary || '',
      url: item.url || '',
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : '',
      source: item.source || 'Finnhub',
    }));
  } catch (error) {
    console.error('[news.fetchFinnhubNews] Failed:', error.message);
    return [];
  }
}

async function fetchFinnhubCompanyNews(symbol) {
  try {
    if (!(await consume('finnhub'))) {
      console.warn('[news] Finnhub rate limit reached (60/min)');
      return [];
    }
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const response = await axios.get(`${FINNHUB_BASE}/company-news`, {
      params: { symbol, from, to, token: FINNHUB_API_KEY },
    });

    console.log(`[news.fetchFinnhubCompanyNews] symbol=${symbol}, results=${(response.data || []).length}`);
    return (response.data || []).slice(0, 10).map((item) => ({
      title: item.headline || '',
      description: item.summary || '',
      url: item.url || '',
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : '',
      source: item.source || 'Finnhub',
    }));
  } catch (error) {
    console.error(`[news.fetchFinnhubCompanyNews] Failed for ${symbol}:`, error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Google News RSS (free, no API key, good Korean news coverage)
// ---------------------------------------------------------------------------

async function fetchGoogleNewsArticles(keywords) {
  try {
    const query = encodeURIComponent(keywords.join(' '));
    const url = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;

    console.log(`[news.fetchGoogleNewsArticles] query="${keywords.join(' ')}"`);
    const feed = await rssParser.parseURL(url);

    const articles = (feed.items || []).slice(0, 10).map((item) => ({
      title: item.title || '',
      description: item.contentSnippet || item.content || '',
      url: item.link || '',
      publishedAt: item.isoDate || item.pubDate || '',
      source: item.source?.name || 'Google News',
    }));

    console.log(`[news.fetchGoogleNewsArticles] results=${articles.length}`);
    return articles;
  } catch (error) {
    console.error('[news.fetchGoogleNewsArticles] Failed:', error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// NewsData.io
// ---------------------------------------------------------------------------

async function fetchNewsDataArticles(keywords) {
  try {
    if (!(await consume('newsdata'))) {
      console.warn('[news] NewsData.io daily limit reached (200/day)');
      return [];
    }
    const response = await axios.get(`${NEWSDATA_BASE}/latest`, {
      params: {
        apikey: NEWSDATA_API_KEY,
        q: keywords.join(' OR '),
        category: 'business,technology',
        language: 'en,ko',
        size: 5,
      },
    });

    const results = response.data?.results || [];
    console.log(`[news.fetchNewsDataArticles] query="${keywords.join(' OR ')}", results=${results.length}`);
    return results.map((item) => ({
      title: item.title || '',
      description: item.description || '',
      url: item.link || '',
      publishedAt: item.pubDate || '',
      source: item.source_name || 'NewsData',
    }));
  } catch (error) {
    console.error('[news.fetchNewsDataArticles] Failed:', error.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

/**
 * Batch-summarize articles with sentiment tags using gpt-5-mini.
 */
export async function summarizeArticles(articles) {
  if (articles.length === 0) return [];

  const articleList = articles.map((a, i) => {
    let entry = `${i + 1}. 제목: ${a.title}`;
    if (a.description) entry += `\n   내용: ${a.description}`;
    return entry;
  }).join('\n\n');

  try {
    const response = await chat(
      [
        {
          role: 'system',
          content: `당신은 금융 뉴스 분석 전문가입니다. 아래 기사들을 각각 분석해주세요.

각 기사마다 다음 형식으로 출력하세요:
[상승] 또는 [하락] 또는 [중립] 감성 태그 + 한국어 요약 1~2줄

규칙:
- 시장/자산 가격에 긍정적 영향 → [상승]
- 시장/자산 가격에 부정적 영향 → [하락]
- 방향성 불명확 또는 정보 전달 → [중립]
- 각 기사 번호를 앞에 붙여주세요
- 추측이나 의견 없이 사실 위주로 간결하게`,
        },
        { role: 'user', content: articleList },
      ],
      { model: 'gpt-5-mini', maxTokens: 2048 },
    );

    const lines = response.split('\n').filter((l) => l.trim());
    return articles.map((article, i) => {
      const prefix = `${i + 1}.`;
      const matchedLines = lines.filter((l) => l.trim().startsWith(prefix));
      const summary = matchedLines.length > 0
        ? matchedLines.map((l) => l.replace(/^\d+\.\s*/, '').trim()).join(' ')
        : lines[i]?.replace(/^\d+\.\s*/, '').trim() || '';

      return {
        title: article.title,
        summary,
        url: article.url,
        publishedAt: article.publishedAt,
      };
    });
  } catch (error) {
    console.error('[news.summarizeArticles] Batch summarization failed:', error.message);
    return articles.map((article) => ({
      title: article.title,
      summary: '요약을 생성할 수 없습니다.',
      url: article.url,
      publishedAt: article.publishedAt,
    }));
  }
}

export async function summarizeArticle(url, title, description = '') {
  try {
    const content = description
      ? `제목: ${title}\n내용: ${description}`
      : `제목: ${title}`;

    const summary = await chat(
      [
        {
          role: 'system',
          content: `금융 뉴스 분석 전문가입니다. 다음 형식으로 출력하세요:
[상승] 또는 [하락] 또는 [중립] 감성 태그 + 한국어 요약 1~2줄
사실 위주로 간결하게 작성하세요.`,
        },
        { role: 'user', content },
      ],
      { model: 'gpt-5-mini', maxTokens: 1024 },
    );

    return { title, summary, url };
  } catch (error) {
    console.error(`[news.summarizeArticle] Failed to summarize "${title}":`, error.message);
    throw error;
  }
}
