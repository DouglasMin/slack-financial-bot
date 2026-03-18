import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * 정기 브리핑 Block Kit 포맷 (오전/오후 구분)
 */
export function formatBriefing({ prices, news, analysis, isAM }) {
  const period = isAM ? '오전' : '오후';
  const date = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 ${period} 금융 브리핑 — ${date}`,
        emoji: true,
      },
    },
  ];

  // 가격 섹션
  if (prices && prices.length > 0) {
    blocks.push(...formatPriceSection(prices));
  }

  blocks.push({ type: 'divider' });

  // 뉴스 섹션
  if (news && news.length > 0) {
    blocks.push(...formatNewsSection(news));
  }

  blocks.push({ type: 'divider' });

  // AI 분석 섹션
  if (analysis) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🤖 AI 분석*\n${analysis}`,
      },
    });
  }

  return blocks;
}

/**
 * 가격 데이터 블록 배열 반환
 */
export function formatPriceSection(prices) {
  const blocks = [];

  for (const item of prices) {
    if (!item) continue;
    const { symbol, price, rate, change, changePercent, from, to } = item;
    const displayPrice = price ?? rate ?? 0;
    const displayChange = change ?? 0;
    const displayPercent = changePercent ?? '0.00';
    const displaySymbol = from && to ? `${from}/${to}` : symbol;
    const emoji = displayChange >= 0 ? '🔺' : '🔻';
    const sign = displayChange >= 0 ? '+' : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${displaySymbol}*  ${displayPrice.toLocaleString()}  ${emoji} ${sign}${displayChange.toLocaleString()} (${sign}${displayPercent}%)`,
      },
    });
  }

  return blocks;
}

/**
 * 뉴스 기사 블록 배열 반환
 */
export function formatNewsSection(articles) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📰 주요 뉴스*',
      },
    },
  ];

  for (const { title, url, summary, source } of articles) {
    const link = url ? `<${url}|${title}>` : title;
    const sourceLine = source ? ` — _${source}_` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${link}${sourceLine}\n${summary || ''}`,
      },
    });
  }

  return blocks;
}

/**
 * 가격 알림 DM 블록 반환
 */
export function formatAlertMessage({ symbol, targetPrice, currentPrice, direction }) {
  const directionText = direction === 'above' ? '이상' : '이하';
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🚨 가격 알림',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${symbol}* 가격이 설정한 기준에 도달했습니다.`,
          `• 목표가: ${targetPrice.toLocaleString()} ${directionText}`,
          `• 현재가: ${currentPrice.toLocaleString()}`,
        ].join('\n'),
      },
    },
  ];
}

/**
 * 에러 메시지 블록 반환
 */
export function formatError(message) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ 오류가 발생했습니다: ${message}`,
      },
    },
  ];
}

/**
 * 채널에 메시지 전송
 */
export async function postMessage(channel, blocks) {
  try {
    return await slack.chat.postMessage({ channel, blocks });
  } catch (error) {
    console.error('postMessage 실패:', error);
    throw error;
  }
}

/**
 * Ephemeral 메시지 전송 (특정 사용자에게만 보임)
 */
export async function postEphemeral(channel, userId, blocks) {
  try {
    return await slack.chat.postEphemeral({ channel, user: userId, blocks });
  } catch (error) {
    console.error('postEphemeral 실패:', error);
    throw error;
  }
}

/**
 * response_url로 비동기 응답 전송
 */
export async function postToResponseUrl(responseUrl, blocks) {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks,
        response_type: 'ephemeral',
      }),
    });

    if (!response.ok) {
      throw new Error(`response_url 요청 실패: ${response.status}`);
    }

    return response;
  } catch (error) {
    console.error('postToResponseUrl 실패:', error);
    throw error;
  }
}
