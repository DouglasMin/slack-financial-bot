import { v4 as uuidv4 } from 'uuid';
import { normalizeSymbol } from '../utils/parser.js';
import { formatError } from '../utils/slack.js';
import * as store from '../services/store.js';

const TABLE = process.env.ALERT_TABLE;

/**
 * /alert add|list|remove — 가격 알림 관리
 */
export async function execute(userId, args) {
  try {
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || !['add', 'list', 'remove'].includes(subcommand)) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*사용법:*\n• `/alert add {종목코드} {가격} above|below` — 가격 알림 추가\n• `/alert list` — 활성 알림 목록\n• `/alert remove {알림ID}` — 알림 제거',
          },
        },
      ];
    }

    if (subcommand === 'add') {
      const symbolRaw = args[1];
      const priceRaw = args[2];
      const direction = args[3]?.toLowerCase();

      if (!symbolRaw || !priceRaw || !direction) {
        return formatError('사용법: `/alert add {종목코드} {가격} above|below`\n예: `/alert add BTC 90000 above`');
      }

      if (isNaN(Number(priceRaw))) {
        return formatError(`"${priceRaw}"은(는) 유효한 가격이 아닙니다. 숫자를 입력해주세요.`);
      }

      if (direction !== 'above' && direction !== 'below') {
        return formatError(`방향은 "above" 또는 "below"만 가능합니다. 입력값: "${direction}"`);
      }

      // Normalize and strip slash from FX pairs (e.g. USD/KRW → USDKRW)
      const symbol = normalizeSymbol(symbolRaw).replace('/', '');
      const alertId = uuidv4();
      const targetPrice = Number(priceRaw);

      await store.putItem(TABLE, {
        userId,
        alertId,
        symbol,
        targetPrice,
        direction,
        active: 'true',
        createdAt: new Date().toISOString(),
      });

      const directionText = direction === 'above' ? '이상' : '이하';

      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `가격 알림이 설정되었습니다.\n• *종목:* ${symbol}\n• *목표가:* ${targetPrice.toLocaleString()} ${directionText}\n• *알림 ID:* \`${alertId}\``,
          },
        },
      ];
    }

    if (subcommand === 'list') {
      const items = await store.queryItems(TABLE, {
        expression: 'userId = :uid',
        values: { ':uid': userId },
      });

      const activeAlerts = items.filter((item) => item.active === 'true');

      if (activeAlerts.length === 0) {
        return [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '활성화된 가격 알림이 없습니다. `/alert add {종목코드} {가격} above|below`로 추가해보세요.',
            },
          },
        ];
      }

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '활성 가격 알림 목록',
            emoji: true,
          },
        },
      ];

      for (const alert of activeAlerts) {
        const directionText = alert.direction === 'above' ? '이상' : '이하';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${alert.symbol}*  ${alert.targetPrice.toLocaleString()} ${directionText}\nID: \`${alert.alertId}\`  |  생성: ${alert.createdAt}`,
          },
        });
      }

      return blocks;
    }

    if (subcommand === 'remove') {
      const alertId = args[1];

      if (!alertId) {
        return formatError('알림 ID를 입력해주세요. 예: `/alert remove {알림ID}`');
      }

      await store.updateItem(
        TABLE,
        { userId, alertId },
        'SET active = :val',
        { ':val': 'false' },
      );

      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `알림 \`${alertId}\`이(가) 비활성화되었습니다.`,
          },
        },
      ];
    }
  } catch (error) {
    console.error('[alert.execute] Error:', error.message);
    return formatError(`가격 알림 처리 중 오류가 발생했습니다: ${error.message}`);
  }
}
