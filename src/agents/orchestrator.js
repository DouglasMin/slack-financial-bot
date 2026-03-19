import { Agent, run } from '@openai/agents';
import { marketAgent } from './marketAgent.js';
import { newsAgent } from './newsAgent.js';
import { analysisAgent } from './analysisAgent.js';
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
    let text = input;
    if (Array.isArray(input)) {
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

    if (!text || text.length < 4) {
      return { tripwire: false };
    }

    const lowerInput = text.toLowerCase();

    const isFinancial = FINANCIAL_KEYWORDS.some((kw) =>
      lowerInput.includes(kw.toLowerCase()),
    );

    if (isFinancial) {
      return { tripwire: false };
    }

    const conversationalPatterns = [
      /^(안녕|hi|hello|hey|감사|고마|thanks|도움)/i,
      /\?$/,
      /^(뭐|어떻|왜|언제|어디|how|what|why|when|where|which)/i,
    ];

    const isConversational = conversationalPatterns.some((pattern) =>
      pattern.test(text.trim()),
    );

    if (isConversational) {
      return { tripwire: false };
    }

    return {
      tripwire: true,
      message: '죄송합니다. 저는 금융/경제 관련 질문만 도와드릴 수 있습니다. 시세 조회, 뉴스 요약, 시장 분석 등을 요청해주세요.',
    };
  },
};

// ---------------------------------------------------------------------------
// Sub-agents as tools
// ---------------------------------------------------------------------------

const marketTool = marketAgent.asTool({
  toolName: 'queryMarketData',
  toolDescription: '시세를 조회합니다. 암호화폐, 주식, 환율 모두 가능합니다. 사용자가 가격, 시세, 얼마인지 물으면 이 도구를 사용하세요.',
});

const newsTool = newsAgent.asTool({
  toolName: 'queryNews',
  toolDescription: '뉴스를 검색하고 요약합니다. 특정 종목 뉴스, 암호화폐 뉴스, 일반 시장 뉴스 모두 가능합니다. 사용자가 뉴스, 소식, 동향을 물으면 이 도구를 사용하세요.',
});

const analysisTool = analysisAgent.asTool({
  toolName: 'analyzeMarket',
  toolDescription: '시세와 뉴스 데이터를 종합 분석하여 인사이트를 제공합니다. 사용자가 전망, 분석, 의견을 요청하거나 시세+뉴스를 함께 요청할 때 사용하세요. 먼저 queryMarketData와 queryNews로 데이터를 수집한 후 이 도구에 전달하세요.',
});

// ---------------------------------------------------------------------------
// Orchestrator agent
// ---------------------------------------------------------------------------

export const orchestratorAgent = new Agent({
  name: 'OrchestratorAgent',
  instructions: `<role>
당신은 Slack 금융 브리핑 봇의 오케스트레이터입니다. 사용자 요청을 파악하고 적절한 전문 에이전트를 호출하여 답변을 구성합니다.
</role>

<constraints>
- 사용자에게 옵션을 묻지 말고 즉시 도구를 호출하세요.
- "조회하겠습니다" 같은 예고 없이 바로 실행하세요.
- 오타가 있어도 의도를 파악하세요. 예: "비ㅌ코인" = 비트코인, "엔비디야" = 엔비디아
- 복합 요청 시 필요한 도구를 모두 호출하세요. 예: "비트코인 시세랑 뉴스" → queryMarketData + queryNews
- 심층 분석 요청 시 queryMarketData + queryNews로 데이터를 먼저 수집하고 analyzeMarket에 전달하세요.
- 항상 한국어로 응답하세요.
</constraints>

<tools>
- queryMarketData: 시세 조회 (코인, 주식, 환율). 가격/시세/얼마 관련 요청에 사용.
- queryNews: 뉴스 검색 및 요약. 뉴스/소식/동향 관련 요청에 사용.
- analyzeMarket: 종합 분석. 시세+뉴스 데이터를 기반으로 인사이트 생성. 전망/분석 요청에 사용.
- checkApiQuota: API 잔여 호출 횟수 확인.
</tools>

<output_format>
Slack mrkdwn 형식:
- 종목명 *굵게*, 가격에 쉼표 포함, 변동률에 🔺(상승)/🔻(하락) 이모지
- 코인 가격은 $ 접두사, 한국 주식은 ₩ 접두사
- 뉴스는 번호 매기고 <URL|제목> 링크 + [상승]/[하락]/[중립] 태그 + 1~2줄 요약
- 뉴스 원문 링크를 반드시 포함하세요. 링크가 없으면 제목만 *굵게* 표시.
- 간결하게 핵심만. 장황한 설명 금지.
</output_format>`,
  model: 'gpt-5-mini',
  tools: [marketTool, newsTool, analysisTool, checkApiQuotaTool],
  inputGuardrails: [financialGuardrail],
});

// ---------------------------------------------------------------------------
// DynamoDB-backed conversation session
// ---------------------------------------------------------------------------

export class DynamoDBSession {
  constructor({ sessionId }) {
    this.sessionId = sessionId;
  }

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

      const parsed = items
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

      // GPT-5 requires reasoning items to precede their associated message.
      // If a reasoning item is missing (e.g. from old session data), the API
      // returns 400. Filter out assistant messages that reference a reasoning
      // ID not present in the loaded items to prevent this.
      const reasoningIds = new Set(
        parsed.filter((i) => i.type === 'reasoning').map((i) => i.id),
      );
      return parsed.filter((item) => {
        // Keep non-message items (user messages, reasoning items, etc.)
        if (item.role !== 'assistant' || item.type === 'reasoning') return true;
        // If assistant message has no reasoning requirement, keep it
        if (!item.id || !item.id.startsWith('msg_')) return true;
        // Check if any reasoning item exists — if none at all, keep all messages
        if (reasoningIds.size === 0) return true;
        // Otherwise keep it (we can't easily check the pairing without the API's internal mapping)
        return true;
      });
    } catch (error) {
      console.error('[DynamoDBSession.getItems] Error:', error.message);
      return [];
    }
  }

  async addItems(items) {
    try {
      const ALLOWED_ROLES = new Set(['user', 'assistant']);

      for (const item of items) {
        const role = item.role || item.type || 'unknown';
        const type = item.type || '';

        if (type === 'function_call' || type === 'function_call_output') continue;
        if (role === 'tool') continue;

        if (type === 'reasoning') {
          // pass through — GPT-5 requires reasoning items before assistant messages
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
    // no-op
  }

  async clear() {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runConversation(userId, message, watchlist = []) {
  const session = new DynamoDBSession({ sessionId: userId });

  let userMessage = message;
  if (watchlist && watchlist.length > 0) {
    const watchlistSummary = watchlist
      .map((w) => `${w.symbol} (${w.category})`)
      .join(', ');
    userMessage = `[사용자 관심 종목: ${watchlistSummary}]\n\n${message}`;
  }

  try {
    const result = await run(orchestratorAgent, userMessage, { session, maxTurns: 10 });
    return result.finalOutput;
  } catch (error) {
    if (error.message?.includes('Guardrail') || error.name === 'GuardrailTripwireTriggered') {
      return '죄송합니다. 저는 금융/경제 관련 질문만 도와드릴 수 있습니다. 시세 조회, 뉴스 요약, 시장 분석 등을 요청해주세요.';
    }

    // If session history is corrupted (e.g. missing reasoning items),
    // clear it and retry without history
    if (error.status === 400 && error.message?.includes('reasoning')) {
      console.warn('[runConversation] Corrupted session detected, retrying without history');
      try {
        const freshResult = await run(orchestratorAgent, userMessage, { maxTurns: 10 });
        return freshResult.finalOutput;
      } catch (retryError) {
        console.error('[runConversation] Retry also failed:', retryError.message);
        throw retryError;
      }
    }

    console.error('[runConversation] Error:', error.message);
    throw error;
  }
}
