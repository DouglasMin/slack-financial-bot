import { verifySlackSignature } from '../utils/verify.js';
import * as store from '../services/store.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});

// In-memory dedup for warm Lambda invocations
const processedEvents = new Set();

export async function handler(event) {
  try {
    const rawBody = event.body;
    const isBase64 = event.isBase64Encoded;
    const body = isBase64 ? Buffer.from(rawBody, 'base64').toString() : rawBody;
    const payload = JSON.parse(body);

    // 1. url_verification challenge
    if (payload.type === 'url_verification') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: payload.challenge }),
      };
    }

    // 2. Verify Slack signature
    if (!verifySlackSignature(event.headers, body)) {
      return { statusCode: 401, body: 'Invalid signature' };
    }

    const slackEvent = payload.event;
    if (!slackEvent) {
      return { statusCode: 200, body: 'OK' };
    }

    // 3. Only handle app_mention and message.im
    const isAppMention = slackEvent.type === 'app_mention';
    const isDM = slackEvent.type === 'message' && slackEvent.channel_type === 'im';
    if (!isAppMention && !isDM) {
      return { statusCode: 200, body: 'OK' };
    }

    // Ignore bot messages
    if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') {
      return { statusCode: 200, body: 'OK' };
    }

    // 4. Event dedup
    const eventId = payload.event_id;
    if (processedEvents.has(eventId)) {
      return { statusCode: 200, body: 'OK' };
    }
    processedEvents.add(eventId);
    if (processedEvents.size > 1000) {
      const oldest = processedEvents.values().next().value;
      processedEvents.delete(oldest);
    }

    // 5. DynamoDB dedup — only succeeds if this event_id hasn't been written before
    try {
      await store.putItem(
        process.env.CONVERSATION_TABLE,
        {
          userId: `dedup#${eventId}`,
          timestamp: new Date().toISOString(),
          role: 'system',
          content: 'dedup',
          expireAt: Math.floor(Date.now() / 1000) + 300,
        },
        { conditionExpression: 'attribute_not_exists(userId)' },
      );
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`[conversation] Duplicate event skipped: ${eventId}`);
        return { statusCode: 200, body: 'OK' };
      }
    }

    // 6. Invoke worker Lambda asynchronously (InvocationType: Event)
    const userId = slackEvent.user;
    const text = slackEvent.text?.replace(/<@[^>]+>/g, '').trim();
    const channel = slackEvent.channel;
    const threadTs = slackEvent.thread_ts || slackEvent.ts;

    if (!text) {
      return { statusCode: 200, body: 'OK' };
    }

    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.WORKER_FUNCTION_NAME,
      InvocationType: 'Event', // async — returns immediately
      Payload: JSON.stringify({ userId, text, channel, threadTs }),
    }));

    // 7. Return 200 immediately to Slack
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Conversation error:', error);
    return { statusCode: 200, body: 'OK' };
  }
}
