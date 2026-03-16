import { verifySlackSignature } from '../utils/verify.js';
import { parseCommand } from '../utils/parser.js';
import { formatError, postToResponseUrl } from '../utils/slack.js';

// Import command modules
import { execute as executeBrief } from '../commands/brief.js';
import { execute as executeWatch } from '../commands/watch.js';
import { execute as executeAlert } from '../commands/alert.js';
import { execute as executeHistory } from '../commands/history.js';
import { execute as executeSummary } from '../commands/summary.js';

const COMMAND_MAP = {
  '/brief': executeBrief,
  '/watch': executeWatch,
  '/alert': executeAlert,
  '/history': executeHistory,
  '/summary': executeSummary,
};

export async function handler(event) {
  try {
    // 1. Verify Slack signature
    const rawBody = event.body;
    const isBase64 = event.isBase64Encoded;
    const body = isBase64 ? Buffer.from(rawBody, 'base64').toString() : rawBody;

    if (!verifySlackSignature(event.headers, body)) {
      return { statusCode: 401, body: 'Invalid signature' };
    }

    // 2. Parse form-encoded body
    const params = new URLSearchParams(body);
    const command = params.get('command');
    const text = params.get('text') || '';
    const userId = params.get('user_id');
    const responseUrl = params.get('response_url');

    // 3. Return 200 immediately - but since Lambda can't respond and continue,
    //    we process and respond via response_url, then return 200.
    //    The Slack 3-sec timeout is handled by Lambda's fast execution.

    const { subcommand, args } = parseCommand(text);
    const allArgs = subcommand ? [subcommand, ...args] : args;

    const commandFn = COMMAND_MAP[command];
    if (!commandFn) {
      const blocks = formatError(
        `알 수 없는 명령어입니다: ${command}\n사용 가능: /brief, /watch, /alert, /history, /summary`,
      );
      await postToResponseUrl(responseUrl, blocks);
      return { statusCode: 200, body: '' };
    }

    const blocks = await commandFn(userId, allArgs);
    await postToResponseUrl(responseUrl, blocks);

    return { statusCode: 200, body: '' };
  } catch (error) {
    console.error('SlashCommand error:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({ text: '처리 중 오류가 발생했습니다.' }),
    };
  }
}
