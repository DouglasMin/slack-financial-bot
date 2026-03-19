import { WebClient } from '@slack/web-api';
import { runConversation } from '../agents/orchestrator.js';
import * as store from '../services/store.js';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function handler(event) {
  const { userId, text, channel, threadTs } = event;

  try {
    // 1. Load user's watchlist for context
    let watchlist = [];
    try {
      watchlist = await store.queryItems(process.env.WATCHLIST_TABLE, {
        expression: 'userId = :uid',
        values: { ':uid': userId },
      });
    } catch (err) {
      console.warn('Failed to load watchlist:', err.message);
    }

    // 2. Send "processing" indicator immediately
    await slackClient.chat.postMessage({
      channel,
      text: '🔍 분석 중입니다. 잠시만 기다려주세요...',
      thread_ts: threadTs,
    });

    // 3. Run conversation through orchestrator agent
    const response = await runConversation(userId, text, watchlist);

    // 4. Reply in thread
    await slackClient.chat.postMessage({
      channel,
      text: response || '응답을 생성하지 못했습니다.',
      thread_ts: threadTs,
    });
  } catch (error) {
    console.error('ConversationWorker error:', error);

    // Send error message to user
    try {
      await slackClient.chat.postMessage({
        channel,
        text: '죄송합니다. 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        thread_ts: threadTs,
      });
    } catch (slackErr) {
      console.error('Failed to send error message:', slackErr);
    }
  }
}
