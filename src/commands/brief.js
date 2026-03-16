import { normalizeSymbol, determineCategory, buildPriceRequest } from '../utils/parser.js';
import { formatPriceSection, formatNewsSection, formatError } from '../utils/slack.js';
import * as market from '../services/market.js';
import * as news from '../services/news.js';
import * as openai from '../services/openai.js';

/**
 * /brief {symbol} — 특정 종목의 현재가, 뉴스, AI 코멘트를 제공합니다.
 */
export async function execute(userId, args) {
  try {
    if (!args[0]) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*사용법:* `/brief {종목코드}`\n예: `/brief BTC`, `/brief 삼성`, `/brief AAPL`',
          },
        },
      ];
    }

    const symbol = normalizeSymbol(args[0]);
    const category = determineCategory(symbol);
    const req = buildPriceRequest(symbol, category);

    // 종목 유형에 따라 가격 조회
    let priceData;
    if (category === 'coin') {
      const result = await market.getCryptoPrice(req.symbol);
      priceData = {
        symbol,
        price: result.price,
        change: result.change24h ?? 0,
        changePercent: result.changePercent24h ? result.changePercent24h.toFixed(2) : '0.00',
      };
    } else if (category === 'fx') {
      const result = await market.getFxRate(req.from, req.to);
      priceData = {
        symbol,
        price: result.rate,
        change: 0,
        changePercent: '0.00',
      };
    } else {
      const result = await market.getStockPrice(req.symbol);
      priceData = {
        symbol,
        price: result.price,
        change: result.change,
        changePercent: parseFloat(result.changePercent) || 0,
      };
    }

    // 뉴스 조회 (최대 2개)
    const articles = await news.fetchNews([symbol]);
    const topArticles = articles.slice(0, 2);

    // 뉴스 요약 생성
    let summarizedArticles = topArticles.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.source,
      summary: '',
    }));

    if (topArticles.length > 0) {
      summarizedArticles = await news.summarizeArticles(topArticles);
    }

    // AI 코멘트 생성
    const aiComment = await openai.chat(
      [
        {
          role: 'system',
          content:
            '당신은 금융 분석 전문가입니다. 주어진 가격 데이터와 뉴스를 바탕으로 간단한 시장 코멘트를 한국어로 3~4줄로 작성해주세요.',
        },
        {
          role: 'user',
          content: `종목: ${symbol}\n현재가: ${priceData.price.toLocaleString()}\n변동: ${priceData.change} (${priceData.changePercent}%)\n\n관련 뉴스:\n${summarizedArticles.map((a) => `- ${a.title}`).join('\n') || '관련 뉴스 없음'}`,
        },
      ],
      { model: 'gpt-5-mini', maxTokens: 500 },
    );

    // Block Kit 응답 구성
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${symbol} 종목 분석`,
          emoji: true,
        },
      },
      ...formatPriceSection([priceData]),
      { type: 'divider' },
    ];

    if (summarizedArticles.length > 0) {
      blocks.push(...formatNewsSection(summarizedArticles));
      blocks.push({ type: 'divider' });
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*AI 코멘트*\n${aiComment}`,
      },
    });

    return blocks;
  } catch (error) {
    console.error('[brief.execute] Error:', error.message);
    return formatError(`종목 분석 중 오류가 발생했습니다: ${error.message}`);
  }
}
