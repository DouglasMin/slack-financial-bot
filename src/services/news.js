import axios from 'axios';
import { consume } from '../utils/rateLimit.js';
import { chat } from './openai.js';

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const NEWSDATA_API_KEY = process.env.NEWSDATA_API_KEY;

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const NEWSDATA_BASE = 'https://newsdata.io/api/1';

// Keyword expansion map: user keyword → search variants for better news coverage
const KEYWORD_ALIASES = {
  BTC: ['bitcoin', 'BTC'],
  bitcoin: ['bitcoin', 'BTC'],
  비트코인: ['bitcoin', 'BTC'],
  ETH: ['ethereum', 'ETH'],
  ethereum: ['ethereum', 'ETH'],
  이더리움: ['ethereum', 'ETH'],
  DOGE: ['dogecoin', 'DOGE'],
  dogecoin: ['dogecoin', 'DOGE'],
  도지코인: ['dogecoin', 'DOGE'],
  도지: ['dogecoin', 'DOGE'],
  XRP: ['ripple', 'XRP'],
  ripple: ['ripple', 'XRP'],
  리플: ['ripple', 'XRP'],
  SOL: ['solana', 'SOL'],
  solana: ['solana', 'SOL'],
  솔라나: ['solana', 'SOL'],
  ADA: ['cardano', 'ADA'],
  에이다: ['cardano', 'ADA'],
  AAPL: ['Apple', 'AAPL'],
  애플: ['Apple', 'AAPL'],
  TSLA: ['Tesla', 'TSLA'],
  테슬라: ['Tesla', 'TSLA'],
  NVDA: ['Nvidia', 'NVDA'],
  엔비디아: ['Nvidia', 'NVDA'],
  삼성: ['Samsung Electronics', '삼성전자'],
  삼성전자: ['Samsung Electronics', '삼성전자'],
  하이닉스: ['SK Hynix', 'SK하이닉스'],
  카카오: ['Kakao', '카카오'],
  네이버: ['Naver', '네이버'],
};

/**
 * Expand user keywords into broader search terms using alias map.
 */
function expandKeywords(keywords) {
  const expanded = new Set();
  for (const kw of keywords) {
    const aliases = KEYWORD_ALIASES[kw] || KEYWORD_ALIASES[kw.toUpperCase()];
    if (aliases) {
      aliases.forEach((a) => expanded.add(a));
    }
    expanded.add(kw); // always keep original
  }
  return [...expanded];
}

/**
 * Fetch financial news from Finnhub (general market news) + NewsData.io (keyword search).
 * Falls back gracefully if one source fails.
 * @param {string[]} keywords - If provided, also searches NewsData.io for keyword-specific articles.
 * @returns {Promise<Array<{title: string, url: string, publishedAt: string, source: string}>>} Top 5 articles sorted by date desc.
 */
export async function fetchNews(keywords = []) {
  const sources = [];

  // Expand keywords for better coverage (e.g. "DOGE" → ["dogecoin", "DOGE"])
  const expanded = keywords.length > 0 ? expandKeywords(keywords) : [];

  // Detect crypto-related keywords to also fetch crypto-specific news from Finnhub
  const cryptoTerms = new Set(['crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'doge', 'dogecoin', 'sol', 'solana', 'xrp', 'ripple', 'cardano', 'ada', '코인', '비트코인', '이더리움', '도지', '리플', '솔라나', '에이다']);
  const hasCryptoKeyword = expanded.some((kw) => cryptoTerms.has(kw.toLowerCase()));

  // Source 1: Finnhub market news
  sources.push(fetchFinnhubNews('general'));
  if (hasCryptoKeyword) {
    sources.push(fetchFinnhubNews('crypto'));
  }

  // Source 2: NewsData.io keyword search (if keywords provided and API key exists)
  if (expanded.length > 0 && NEWSDATA_API_KEY) {
    sources.push(fetchNewsDataArticles(expanded));
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

/**
 * Summarize multiple articles using gpt-5-mini (Korean).
 * Individual failures are logged but do not break the batch.
 */
export async function summarizeArticles(articles) {
  // Batch all articles into a single GPT call for efficiency
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
        {
          role: 'user',
          content: articleList,
        },
      ],
      { model: 'gpt-5-mini', maxTokens: 2048 },
    );

    // Parse batch response back into individual summaries
    const lines = response.split('\n').filter((l) => l.trim());
    return articles.map((article, i) => {
      // Find lines matching this article number
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

/**
 * Summarize a single article by URL and title (for agents/tools).
 */
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
        {
          role: 'user',
          content,
        },
      ],
      { model: 'gpt-5-mini', maxTokens: 1024 },
    );

    return { title, summary, url };
  } catch (error) {
    console.error(`[news.summarizeArticle] Failed to summarize "${title}":`, error.message);
    throw error;
  }
}
