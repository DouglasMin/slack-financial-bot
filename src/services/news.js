import axios from 'axios';
import { consume } from '../utils/rateLimit.js';
import { chat } from './openai.js';

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const NEWSDATA_API_KEY = process.env.NEWSDATA_API_KEY;

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const NEWSDATA_BASE = 'https://newsdata.io/api/1';

/**
 * Fetch financial news from Finnhub (general market news) + NewsData.io (keyword search).
 * Falls back gracefully if one source fails.
 * @param {string[]} keywords - If provided, also searches NewsData.io for keyword-specific articles.
 * @returns {Promise<Array<{title: string, url: string, publishedAt: string, source: string}>>} Top 5 articles sorted by date desc.
 */
export async function fetchNews(keywords = []) {
  const sources = [];

  // Detect crypto-related keywords to also fetch crypto-specific news from Finnhub
  const cryptoTerms = ['crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'doge', 'dogecoin', 'sol', 'solana', 'xrp', '코인', '비트코인', '이더리움', '도지', '리플'];
  const hasCryptoKeyword = keywords.some((kw) =>
    cryptoTerms.includes(kw.toLowerCase()),
  );

  // Source 1: Finnhub market news
  sources.push(fetchFinnhubNews('general'));
  if (hasCryptoKeyword) {
    sources.push(fetchFinnhubNews('crypto'));
  }

  // Source 2: NewsData.io keyword search (if keywords provided and API key exists)
  if (keywords.length > 0 && NEWSDATA_API_KEY) {
    sources.push(fetchNewsDataArticles(keywords));
  }

  const results = await Promise.allSettled(sources);

  let articles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  // Deduplicate by title similarity
  const seen = new Set();
  articles = articles.filter((article) => {
    const key = article.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date descending
  articles.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });

  return articles.slice(0, 5);
}

/**
 * Fetch general market news from Finnhub.
 * Free tier: 60 calls/min, no credit card required.
 */
async function fetchFinnhubNews(category = 'general') {
  try {
    if (!(await consume('finnhub'))) {
      console.warn('[news] Finnhub rate limit reached (60/min)');
      return [];
    }
    const response = await axios.get(`${FINNHUB_BASE}/news`, {
      params: {
        category,
        token: FINNHUB_API_KEY,
      },
    });

    console.log(`[news.fetchFinnhubNews] category=${category}, results=${(response.data || []).length}`);
    return (response.data || []).slice(0, 10).map((item) => ({
      title: item.headline || '',
      url: item.url || '',
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : '',
      source: item.source || 'Finnhub',
    }));
  } catch (error) {
    console.error('[news.fetchFinnhubNews] Failed:', error.message);
    return [];
  }
}

/**
 * Search NewsData.io for keyword-specific financial articles.
 * Free tier: 200 credits/day (~200 requests).
 */
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
      url: item.link || '',
      publishedAt: item.pubDate || '',
      source: item.source_name || 'NewsData',
    }));
  } catch (error) {
    console.error('[news.fetchNewsDataArticles] Failed:', error.message);
    return [];
  }
}

/**
 * Summarize multiple articles using gpt-5-mini (Korean).
 * Individual failures are logged but do not break the batch.
 */
export async function summarizeArticles(articles) {
  const promises = articles.map(async (article) => {
    try {
      const summary = await chat(
        [
          {
            role: 'system',
            content: '당신은 금융 뉴스 요약 전문가입니다. 기사 제목을 바탕으로 핵심 내용을 한국어로 2~3줄로 요약해주세요.',
          },
          {
            role: 'user',
            content: `기사 제목: ${article.title}\nURL: ${article.url}`,
          },
        ],
        { model: 'gpt-5-mini', maxTokens: 300 },
      );

      return {
        title: article.title,
        summary,
        url: article.url,
        publishedAt: article.publishedAt,
      };
    } catch (error) {
      console.error(`[news.summarizeArticles] Failed to summarize "${article.title}":`, error.message);
      return {
        title: article.title,
        summary: '요약을 생성할 수 없습니다.',
        url: article.url,
        publishedAt: article.publishedAt,
      };
    }
  });

  const results = await Promise.allSettled(promises);

  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Summarize a single article by URL and title (for agents/tools).
 */
export async function summarizeArticle(url, title) {
  try {
    const summary = await chat(
      [
        {
          role: 'system',
          content: '당신은 금융 뉴스 요약 전문가입니다. 기사 제목과 URL을 바탕으로 핵심 내용을 한국어로 2~3줄로 요약해주세요.',
        },
        {
          role: 'user',
          content: `기사 제목: ${title}\nURL: ${url}`,
        },
      ],
      { model: 'gpt-5-mini', maxTokens: 300 },
    );

    return { title, summary, url };
  } catch (error) {
    console.error(`[news.summarizeArticle] Failed to summarize "${title}":`, error.message);
    throw error;
  }
}
