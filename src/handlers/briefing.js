import * as market from '../services/market.js';
import * as news from '../services/news.js';
import * as openai from '../services/openai.js';
import * as store from '../services/store.js';
import { formatBriefing, postMessage } from '../utils/slack.js';
import { buildPriceRequest } from '../utils/parser.js';

export async function handler(event) {
  try {
    // 1. Determine AM/PM based on current KST hour (UTC+9)
    const now = new Date();
    const kstHour = (now.getUTCHours() + 9) % 24;
    const isAM = kstHour < 12;

    // 2. getBatchPrices for default symbols (using buildPriceRequest for consistent formatting)
    const defaultSymbols = ['BTC', 'ETH', 'AAPL', 'TSLA', '005930', '000660', 'USDKRW'];
    const symbols = defaultSymbols.map((s) => buildPriceRequest(s));
    const prices = await market.getBatchPrices(symbols);

    // 3. fetchNews() — top 3 articles (limit to reduce summarization time)
    const articles = await news.fetchNews();
    const topArticles = articles.slice(0, 3);

    // 4. summarizeArticles with gpt-5-mini
    const summarizedNews = await news.summarizeArticles(topArticles);

    // 5. analyze with gpt-5 (deep analysis) — wrap with timeout fallback
    let analysis = '';
    try {
      analysis = await openai.analyze(
        { prices, news: summarizedNews },
        '주어진 시장 데이터와 뉴스를 분석하여 투자자를 위한 종합 브리핑을 작성하세요. 한국어로 작성하세요. 간결하게 핵심만 10줄 이내로.',
      );
    } catch (analysisError) {
      console.error('[briefing] GPT-5 analysis failed, posting without it:', analysisError.message);
      analysis = '(AI 분석을 생성하지 못했습니다)';
    }

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
