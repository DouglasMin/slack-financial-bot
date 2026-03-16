import { formatError } from '../utils/slack.js';
import * as market from '../services/market.js';
import * as openai from '../services/openai.js';
import * as store from '../services/store.js';

const BRIEFING_TABLE = process.env.BRIEFING_TABLE;

const DEFAULT_SYMBOLS = [
  { type: 'crypto', symbol: 'BTC' },
  { type: 'crypto', symbol: 'ETH' },
  { type: 'stock', symbol: 'AAPL' },
  { type: 'stock', symbol: 'TSLA' },
  { type: 'stock', symbol: '005930.KS' },
  { type: 'stock', symbol: '000660.KS' },
  { type: 'fx', symbol: 'USD/KRW', from: 'USD', to: 'KRW' },
];

const DISPLAY_NAMES = {
  BTC: 'BTC',
  ETH: 'ETH',
  AAPL: 'AAPL',
  TSLA: 'TSLA',
  '005930.KS': '삼성전자',
  '000660.KS': 'SK하이닉스',
  'USD/KRW': 'USD/KRW',
};

/**
 * 현재 KST 날짜를 YYYY-MM-DD 형식으로 반환
 */
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

/**
 * /summary — 주요 시장 한줄 요약
 */
export async function execute(userId, args) {
  try {
    // 오늘 날짜의 기존 브리핑 확인 (재활용)
    const today = getTodayKST();
    const existingBriefing = await store.getItem(BRIEFING_TABLE, { userId: 'global', date: today });

    // 시장 데이터 일괄 조회
    const prices = await market.getBatchPrices(DEFAULT_SYMBOLS);

    // 가격 데이터 텍스트 생성
    const priceLines = prices.map((p) => {
      const name = DISPLAY_NAMES[p.symbol] || DISPLAY_NAMES[`${p.from}/${p.to}`] || p.symbol;
      if (p.rate) {
        return `${name}: ${p.rate.toLocaleString()}`;
      }
      const change = p.change24h ?? p.change ?? 0;
      const sign = change >= 0 ? '+' : '';
      return `${name}: ${p.price?.toLocaleString() ?? '-'} (${sign}${typeof change === 'number' ? change.toFixed(2) : change})`;
    });

    // 기존 브리핑 분석이 있으면 참고
    const briefingContext = existingBriefing?.analysis
      ? `\n\n오늘의 브리핑 분석:\n${existingBriefing.analysis}`
      : '';

    // AI 한줄 요약 생성
    console.log('[summary] priceLines:', priceLines);
    const summaryText = await openai.chat(
      [
        {
          role: 'system',
          content:
            '당신은 금융 시장 전문가입니다. 주어진 시장 데이터를 바탕으로 현재 시장 상황을 한국어로 1~2줄로 간결하게 요약해주세요. 핵심 트렌드와 주목할 포인트를 포함하세요.',
        },
        {
          role: 'user',
          content: `현재 시장 데이터:\n${priceLines.join('\n')}${briefingContext}`,
        },
      ],
      { model: 'gpt-5-mini', maxTokens: 300 },
    );

    console.log('[summary] summaryText:', summaryText);
    // Block Kit 응답 구성
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${today} 시장 요약`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: priceLines.map((line) => `• ${line}`).join('\n'),
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*AI 요약:* ${summaryText}`,
        },
      },
    ];

    return blocks;
  } catch (error) {
    console.error('[summary.execute] Error:', error.message);
    return formatError(`시장 요약 생성 중 오류가 발생했습니다: ${error.message}`);
  }
}
