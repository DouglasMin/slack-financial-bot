import * as market from '../services/market.js';
import * as news from '../services/news.js';
import * as openai from '../services/openai.js';
import * as store from '../services/store.js';
import { formatBriefing, postMessage } from '../utils/slack.js';

export async function handler(event) {
  try {
    // 1. Determine AM/PM based on current KST hour (UTC+9)
    const now = new Date();
    const kstHour = (now.getUTCHours() + 9) % 24;
    const isAM = kstHour < 12;

    // 2. getBatchPrices for default symbols
    const symbols = [
      { type: 'crypto', symbol: 'BTC' },
      { type: 'crypto', symbol: 'ETH' },
      { type: 'stock', symbol: 'AAPL' },
      { type: 'stock', symbol: 'TSLA' },
      { type: 'stock', symbol: '005930' },
      { type: 'stock', symbol: '000660' },
      { type: 'fx', symbol: 'USD', from: 'USD', to: 'KRW' },
    ];
    const prices = await market.getBatchPrices(symbols);

    // 3. fetchNews() — top 5 articles
    const articles = await news.fetchNews();

    // 4. summarizeArticles with gpt-5-mini
    const summarizedNews = await news.summarizeArticles(articles);

    // 5. analyze with gpt-5 (deep analysis)
    const analysis = await openai.analyze(
      { prices, news: summarizedNews },
      '주어진 시장 데이터와 뉴스를 분석하여 투자자를 위한 종합 브리핑을 작성하세요. 한국어로 작성하세요.',
    );

    // 6. Save to BriefingTable (date in KST)
    const today = new Date(now.getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    await store.putItem(process.env.BRIEFING_TABLE, {
      userId: 'global',
      date: today,
      content: analysis,
      marketData: JSON.stringify({ prices, news: summarizedNews }),
      createdAt: now.toISOString(),
    });

    // 7. Format and post to Slack
    const blocks = formatBriefing({ prices, news: summarizedNews, analysis, isAM });
    await postMessage(process.env.SLACK_CHANNEL_ID, blocks);

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Briefing error:', error);
    return { statusCode: 500, body: error.message };
  }
}
