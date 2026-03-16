import { formatError } from '../utils/slack.js';
import * as store from '../services/store.js';

const TABLE = process.env.BRIEFING_TABLE;

/**
 * 현재 KST 날짜를 YYYY-MM-DD 형식으로 반환
 */
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

/**
 * /history [date|list] — 과거 브리핑 조회
 */
export async function execute(userId, args) {
  try {
    const subcommand = args[0]?.toLowerCase();

    // /history list — 최근 7일 브리핑 날짜 목록
    // Query "global" user's briefings (sorted by date desc) instead of full table scan
    if (subcommand === 'list') {
      const items = await store.queryItems(TABLE, {
        expression: 'userId = :uid',
        values: { ':uid': 'global' },
      }, { limit: 7, scanForward: false });

      if (items.length === 0) {
        return [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '저장된 브리핑이 없습니다.',
            },
          },
        ];
      }

      const dateList = items.map((item) => `• ${item.date}`).join('\n');

      return [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '최근 브리핑 목록',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${dateList}\n\n특정 날짜의 브리핑을 보려면 \`/history {날짜}\`를 입력하세요.`,
          },
        },
      ];
    }

    // /history 또는 /history {date}
    const date = subcommand || getTodayKST();

    // 날짜 형식 검증 (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return formatError(`날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.\n예: \`/history 2026-03-16\``);
    }

    const briefing = await store.getItem(TABLE, { userId: 'global', date });

    if (!briefing) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${date} 날짜의 브리핑이 없습니다.`,
          },
        },
      ];
    }

    // 저장된 브리핑 데이터로 블록 구성
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${date} 금융 브리핑`,
          emoji: true,
        },
      },
    ];

    // 브리핑에 blocks가 저장되어 있으면 그대로 사용
    if (briefing.blocks && Array.isArray(briefing.blocks)) {
      blocks.push(...briefing.blocks);
    } else {
      // 분석 텍스트만 저장된 경우
      if (briefing.analysis) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: briefing.analysis,
          },
        });
      }

      if (briefing.summary) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*요약:* ${briefing.summary}`,
          },
        });
      }
    }

    return blocks;
  } catch (error) {
    console.error('[history.execute] Error:', error.message);
    return formatError(`브리핑 조회 중 오류가 발생했습니다: ${error.message}`);
  }
}
