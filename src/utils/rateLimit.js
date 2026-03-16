/**
 * DynamoDB-backed API rate limit tracker.
 * Uses atomic counters so limits are shared across all Lambda instances.
 *
 * Rate limit records stored in ConversationTable with:
 *   userId = "ratelimit#{apiName}"
 *   timestamp = window key (e.g. "2026-03-17" for day, "2026-03-17T07:30" for minute)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE = () => process.env.CONVERSATION_TABLE;

const API_LIMITS = {
  alpha_vantage: { maxCalls: 25, window: 'day' },
  finnhub: { maxCalls: 60, window: 'minute' },
  newsdata: { maxCalls: 200, window: 'day' },
};

/**
 * Get the current window key for the given window type.
 */
function getWindowKey(windowType) {
  const now = new Date();
  if (windowType === 'minute') {
    return now.toISOString().slice(0, 16); // "2026-03-17T07:30"
  }
  // day
  return now.toISOString().slice(0, 10); // "2026-03-17"
}

/**
 * Get TTL for the window (auto-cleanup of old counters).
 */
function getTTL(windowType) {
  const now = Math.floor(Date.now() / 1000);
  if (windowType === 'minute') return now + 120;    // 2 minutes
  return now + 86400 * 2;                            // 2 days
}

/**
 * Record one API call. Returns true if allowed, false if limit exceeded.
 * Uses DynamoDB atomic increment to avoid race conditions.
 * @param {string} name - API name (e.g. 'alpha_vantage')
 * @returns {Promise<boolean>}
 */
export async function consume(name) {
  const config = API_LIMITS[name];
  if (!config) return true; // untracked API, allow

  const windowKey = getWindowKey(config.window);
  const pk = `ratelimit#${name}`;

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { userId: pk, timestamp: windowKey },
      UpdateExpression: 'SET calls = if_not_exists(calls, :zero) + :inc, expireAt = if_not_exists(expireAt, :ttl)',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':ttl': getTTL(config.window),
      },
      ReturnValues: 'ALL_NEW',
    }));

    const currentCalls = result.Attributes.calls;
    if (currentCalls > config.maxCalls) {
      // Over limit — the increment already happened but we return false
      // The counter will reset with the next window key
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[rateLimit.consume] Error for ${name}:`, error.message);
    // On error, allow the call (fail-open) to avoid blocking functionality
    return true;
  }
}

/**
 * Get remaining calls for an API.
 * @param {string} name
 * @returns {Promise<{ name: string, remaining: number, max: number, used: number, window: string } | null>}
 */
export async function getRemaining(name) {
  const config = API_LIMITS[name];
  if (!config) return null;

  const windowKey = getWindowKey(config.window);
  const pk = `ratelimit#${name}`;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE(),
      Key: { userId: pk, timestamp: windowKey },
    }));

    const used = result.Item?.calls || 0;

    return {
      name,
      remaining: Math.max(0, config.maxCalls - used),
      max: config.maxCalls,
      used,
      window: config.window,
    };
  } catch (error) {
    console.error(`[rateLimit.getRemaining] Error for ${name}:`, error.message);
    return { name, remaining: config.maxCalls, max: config.maxCalls, used: 0, window: config.window };
  }
}

/**
 * Get status of all tracked APIs.
 * @returns {Promise<Array>}
 */
export async function getAllStatus() {
  const results = await Promise.all(
    Object.keys(API_LIMITS).map((name) => getRemaining(name)),
  );
  return results.filter(Boolean);
}
