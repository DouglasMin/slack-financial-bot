import { normalizeSymbol, determineCategory, buildPriceRequest } from '../utils/parser.js';
import { formatError } from '../utils/slack.js';
import * as market from '../services/market.js';
import * as store from '../services/store.js';

const TABLE = process.env.WATCHLIST_TABLE;

/**
 * /watch add|remove|list — 관심 종목 관리
 */
export async function execute(userId, args) {
  try {
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || !['add', 'remove', 'list'].includes(subcommand)) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*사용법:*\n• `/watch add {종목코드}` — 관심 종목 추가\n• `/watch remove {종목코드}` — 관심 종목 제거\n• `/watch list` — 관심 종목 목록 조회',
          },
        },
      ];
    }

    if (subcommand === 'add') {
      if (!args[1]) {
        return formatError('종목코드를 입력해주세요. 예: `/watch add BTC`');
      }

      const symbol = normalizeSymbol(args[1]);
      const category = determineCategory(symbol);

      // 중복 확인
      const existing = await store.getItem(TABLE, { userId, symbol });
      if (existing) {
        return [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${symbol}*은(는) 이미 관심 종목에 등록되어 있습니다.`,
            },
          },
        ];
      }

      await store.putItem(TABLE, {
        userId,
        symbol,
        category,
        createdAt: new Date().toISOString(),
      });

      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${symbol}* (${category})을(를) 관심 종목에 추가했습니다.`,
          },
        },
      ];
    }

    if (subcommand === 'remove') {
      if (!args[1]) {
        return formatError('종목코드를 입력해주세요. 예: `/watch remove BTC`');
      }

      const symbol = normalizeSymbol(args[1]);

      await store.deleteItem(TABLE, { userId, symbol });

      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${symbol}*을(를) 관심 종목에서 제거했습니다.`,
          },
        },
      ];
    }

    if (subcommand === 'list') {
      const items = await store.queryItems(TABLE, {
        expression: 'userId = :uid',
        values: { ':uid': userId },
      });

      if (items.length === 0) {
        return [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '등록된 관심 종목이 없습니다. `/watch add {종목코드}`로 추가해보세요.',
            },
          },
        ];
      }

      // 각 종목의 현재가를 일괄 조회
      const priceRequests = items.map((item) =>
        buildPriceRequest(item.symbol, item.category),
      );

      const prices = await market.getBatchPrices(priceRequests);

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '관심 종목 목록',
            emoji: true,
          },
        },
      ];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const priceInfo = prices[i];
        let priceText = '가격 조회 실패';

        if (priceInfo) {
          if (item.category === 'fx') {
            priceText = `${priceInfo.rate?.toLocaleString() ?? '-'}`;
          } else {
            priceText = `${priceInfo.price?.toLocaleString() ?? '-'}`;
          }
        }

        const categoryLabel = { coin: '암호화폐', stock: '주식', fx: '환율' }[item.category] || item.category;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${item.symbol}* [${categoryLabel}]  —  ${priceText}`,
          },
        });
      }

      return blocks;
    }
  } catch (error) {
    console.error('[watch.execute] Error:', error.message);
    return formatError(`관심 종목 처리 중 오류가 발생했습니다: ${error.message}`);
  }
}
