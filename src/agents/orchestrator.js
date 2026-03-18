import { Agent, run } from '@openai/agents';
import { getCryptoPriceTool, getStockPriceTool, getFxRateTool } from './tools/marketTools.js';
import { fetchNewsTool, summarizeArticleTool } from './tools/newsTools.js';
import { checkApiQuotaTool } from './tools/rateLimitTools.js';
import * as store from '../services/store.js';

const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE;

// ---------------------------------------------------------------------------
// Input guardrail: reject clearly non-financial topics
// ---------------------------------------------------------------------------

const FINANCIAL_KEYWORDS = [
  // Korean
  '주식', '코인', '비트코인', '이더리움', '환율', '달러', '원화', '엔화', '유로',
  '금리', '채권', '펀드', '투자', '매수', '매도', '시세', '차트', '상승', '하락',
  '경제', '인플레이션', '디플레이션', 'GDP', '고용', '실업', '기준금리', '연준',
  '한은', 'ETF', '선물', '옵션', '배당', '수익률', 'PER', 'PBR', '시가총액',
  '뉴스', '브리핑', '분석', '전망', '리포트', '요약', '동향', '이슈',
  '삼성', '애플', '테슬라', '엔비디아', 'S&P', '나스닥', '코스피', '코스닥',
  // English
  'stock', 'crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'forex', 'fx',
  'price', 'market', 'trade', 'invest', 'rate', 'bond', 'fund', 'dividend',
  'economy', 'inflation', 'fed', 'interest', 'bull', 'bear', 'rally',
  'nasdaq', 'dow', 'kospi', 'kosdaq', 'nikkei', 'news', 'briefing',
  'aapl', 'tsla', 'nvda', 'msft', 'goog', 'amzn',
];

const financialGuardrail = {
  name: 'FinancialTopicGuardrail',
  execute: async ({ input }) => {
    // input can be a string or an array of conversation items (when session has history)
    let text = input;
    if (Array.isArray(input)) {
      // Extract the last user message text from the conversation array
      const lastUserItem = [...input].reverse().find(
        (item) => item.role === 'user',
      );
      if (!lastUserItem) return { tripwire: false };
      text = typeof lastUserItem.content === 'string'
        ? lastUserItem.content
        : Array.isArray(lastUserItem.content)
          ? lastUserItem.content.map((c) => c.text || '').join(' ')
          : '';
    }

    // Allow short messages (likely follow-up context or greetings)
    if (!text || text.length < 4) {
      return { tripwire: false };
    }

    const lowerInput = text.toLowerCase();

    // Check if any financial keyword appears in the input
    const isFinancial = FINANCIAL_KEYWORDS.some((kw) =>
      lowerInput.includes(kw.toLowerCase()),
    );

    if (isFinancial) {
      return { tripwire: false };
    }

    // Also allow if the message looks like a question or greeting (context-dependent)
    const conversationalPatterns = [
      /^(안녕|hi|hello|hey|감사|고마|thanks|도움)/i,
      /\?$/,        // ends with question mark
      /^(뭐|어떻|왜|언제|어디|how|what|why|when|where|which)/i,
    ];

    const isConversational = conversationalPatterns.some((pattern) =>
      pattern.test(text.trim()),
    );

    if (isConversational) {
      return { tripwire: false };
    }

    // Non-financial topic detected
    return {
      tripwire: true,
      message: '죄송합니다. 저는 금융/경제 관련 질문만 도와드릴 수 있습니다. 시세 조회, 뉴스 요약, 시장 분석 등을 요청해주세요.',
    };
  },
};

// ---------------------------------------------------------------------------
// Orchestrator agent with handoffs to specialist agents
// ---------------------------------------------------------------------------

export const orchestratorAgent = new Agent({
  name: 'FinancialAgent',
  instructions: `<role>
당신은 Slack 금융 브리핑 봇입니다. 사용자의 금융 관련 질문에 도구를 사용하여 실시간 데이터를 조회하고 답변합니다.
</role>

<constraints>
- 사용자에게 옵션을 묻지 말고 즉시 도구를 호출하세요.
- "조회하겠습니다", "확인해보겠습니다" 같은 예고 없이 바로 실행하세요.
- 시세와 뉴스를 함께 요청하면 getCryptoPrice/getStockPrice와 fetchNews를 모두 호출하세요.
- 도구 호출 실패 시 어떤 데이터를 조회할 수 없었는지 사용자에게 알려주세요.
- 항상 한국어로 응답하세요.
</constraints>

<tools>
- getCryptoPrice: 코인 시세 조회. symbol에 티커(BTC, ETH, DOGE 등) 전달.
- getStockPrice: 주식 시세 조회. 미국주(AAPL), 한국주(005930.KS — 6자리 코드에 .KS 필수).
- getFxRate: 환율 조회. from(기준통화), to(대상통화) 전달. 달러→원화는 from=USD, to=KRW.
- fetchNews: 뉴스 검색. keywords에 영어 ticker+풀네임을 함께 넣으면 효과적. 예: ["bitcoin", "BTC"], ["dogecoin", "DOGE"].
- summarizeArticle: 개별 기사 요약. fetchNews 결과의 url, title, description을 전달.
- checkApiQuota: API 잔여 호출 횟수 확인.
</tools>

<output_format>
Slack mrkdwn 형식:
- 종목명 *굵게*, 가격에 쉼표 포함, 변동률에 🔺(상승)/🔻(하락) 이모지
- 코인 가격은 $ 접두사, 한국 주식은 ₩ 접두사
- 뉴스는 번호 매기고 *굵은 제목* + [상승]/[하락]/[중립] 태그 + 1~2줄 요약
- 간결하게 핵심만. 장황한 설명 금지.
</output_format>`,
  model: 'gpt-5-mini',
  tools: [
    getCryptoPriceTool,
    getStockPriceTool,
    getFxRateTool,
    fetchNewsTool,
    summarizeArticleTool,
    checkApiQuotaTool,
  ],
  inputGuardrails: [financialGuardrail],
});

// ---------------------------------------------------------------------------
// DynamoDB-backed conversation session
// ---------------------------------------------------------------------------

export class DynamoDBSession {
  /**
   * @param {{ sessionId: string }} opts
   */
  constructor({ sessionId }) {
    this.sessionId = sessionId;
  }

  /**
   * Load the most recent 20 conversation turns from DynamoDB.
   * Returns items in chronological order (oldest first) so the LLM sees
   * the conversation flow naturally.
   * @returns {Promise<Array<{ role: string, content: string }>>}
   */
  async getItems() {
    try {
      const items = await store.queryItems(
        CONVERSATION_TABLE,
        {
          expression: 'userId = :uid',
          values: { ':uid': this.sessionId },
        },
        {
          limit: 20,
          scanForward: false,
        },
      );

      // Return items in chronological order, parsing stored JSON back to SDK format
      return items
        .reverse()
        .filter((item) => item.rawItem && !item.userId?.startsWith('dedup#'))
        .map((item) => {
          try {
            return JSON.parse(item.rawItem);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      console.error('[DynamoDBSession.getItems] Error:', error.message);
      return [];
    }
  }

  /**
   * Persist multiple conversation turns to DynamoDB.
   * Each item gets a 24-hour TTL for automatic cleanup.
   * @param {Array<Object>} items - AgentInputItem array from SDK
   */
  async addItems(items) {
    try {
      // Persist user messages, assistant messages, AND reasoning items.
      // GPT-5 requires reasoning items to precede their associated message;
      // omitting them causes "message was provided without its required reasoning item" errors.
      // Skip tool calls/results which cause stale call_id errors on reload.
      const ALLOWED_TYPES = new Set(['message', 'reasoning']);
      const ALLOWED_ROLES = new Set(['user', 'assistant']);

      for (const item of items) {
        const role = item.role || item.type || 'unknown';
        const type = item.type || '';

        // Skip tool calls and function outputs
        if (type === 'function_call' || type === 'function_call_output') continue;
        if (role === 'tool') continue;

        // Allow reasoning items (required by GPT-5 before assistant messages)
        if (type === 'reasoning') {
          // pass through
        } else if (!ALLOWED_ROLES.has(role) && type !== 'message') {
          continue;
        }

        const now = new Date();
        await store.putItem(CONVERSATION_TABLE, {
          userId: this.sessionId,
          timestamp: now.toISOString(),
          role,
          rawItem: JSON.stringify(item),
          expireAt: Math.floor(now.getTime() / 1000) + 86400,
        });
      }
    } catch (error) {
      console.error('[DynamoDBSession.addItems] Error:', error.message);
    }
  }

  async popItem() {
    return undefined;
  }

  async updateItem(index, item) {
    // no-op for DynamoDB session
  }

  async clear() {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Main entry point for running a conversation turn
// ---------------------------------------------------------------------------

/**
 * Run one turn of conversation through the orchestrator agent.
 *
 * @param {string} userId - Slack user ID (used as session key).
 * @param {string} message - The user's message text.
 * @param {Array<{ symbol: string, category: string }>} [watchlist=[]] - User's watchlist for context.
 * @returns {Promise<string>} The agent's final text response.
 */
export async function runConversation(userId, message, watchlist = []) {
  const session = new DynamoDBSession({ sessionId: userId });

  // Build the user message with optional watchlist context
  let userMessage = message;
  if (watchlist && watchlist.length > 0) {
    const watchlistSummary = watchlist
      .map((w) => `${w.symbol} (${w.category})`)
      .join(', ');
    userMessage = `[사용자 관심 종목: ${watchlistSummary}]\n\n${message}`;
  }

  try {
    const result = await run(orchestratorAgent, userMessage, { session });
    return result.finalOutput;
  } catch (error) {
    // Handle guardrail tripwire
    if (error.message?.includes('Guardrail') || error.name === 'GuardrailTripwireTriggered') {
      return '죄송합니다. 저는 금융/경제 관련 질문만 도와드릴 수 있습니다. 시세 조회, 뉴스 요약, 시장 분석 등을 요청해주세요.';
    }

    console.error('[runConversation] Error:', error.message);
    throw error;
  }
}
