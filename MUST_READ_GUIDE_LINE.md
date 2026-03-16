
## AI 금융 브리핑 봇 — Final Project Guideline

````markdown
# AI Financial Briefing Bot — Project Bootstrap Guideline

## 서비스 개요
Slack 기반 AI 금융 브리핑 봇.
- 오전 9시 / 오후 6시 (KST) 정기 브리핑 자동 발송
- Slash Command 기반 즉석 조회
- 자유 대화 (멘션 or DM) — OpenAI Agents SDK 사용
- AI 모델: OpenAI gpt-5-mini (기본) / gpt-5 (브리핑 종합 분석)

---

## 기술 스택
- Runtime: Node.js 22.x
- Framework: Serverless Framework v4
- Cloud: AWS (ap-northeast-2)
- AI: OpenAI API + `@openai/agents` SDK (대화 한정)
- 외부 API: CoinGecko (코인), Alpha Vantage (주식/환율), RSS (뉴스)
- Storage: DynamoDB
- 자동화: EventBridge Scheduler
- 알림: Slack Web API (`@slack/web-api`)

---

## AI 호출 방식 구분

| 기능 | 방식 | 이유 |
|------|------|------|
| 자유 대화 (`conversation.js`) | `@openai/agents` SDK | Handoff, Sessions, Guardrails 활용 |
| 정기 브리핑 (`briefing.js`) | OpenAI API 직접 호출 | 순서 고정 파이프라인, SDK 불필요 |
| Slash Command | OpenAI API 직접 호출 | 단순 조회, SDK 오버킬 |
| 가격 알림 폴링 | OpenAI API 직접 호출 | AI 불필요, 단순 조건 비교 |

---

## 프로젝트 구조

```
financial-bot/
├── serverless.yml
├── package.json
└── src/
    ├── handlers/
    │   ├── briefing.js          ← EventBridge → 정기 브리핑 (직접 호출)
    │   ├── slashCommand.js      ← Slash Command 라우터 (직접 호출)
    │   ├── conversation.js      ← 자유 대화 (Agents SDK)
    │   └── alertPoller.js       ← 가격 알림 폴링 (직접 호출)
    ├── commands/
    │   ├── brief.js             ← /brief {symbol}
    │   ├── watch.js             ← /watch add|remove|list
    │   ├── alert.js             ← /alert add|list|remove
    │   ├── history.js           ← /history {date}|list
    │   └── summary.js           ← /summary
    ├── agents/
    │   ├── orchestrator.js      ← OrchestratorAgent 정의 (Agents SDK)
    │   ├── marketAgent.js       ← MarketAgent 정의
    │   ├── newsAgent.js         ← NewsAgent 정의
    │   └── tools/
    │       ├── marketTools.js   ← getCryptoPrice, getStockPrice, getFxRate
    │       └── newsTools.js     ← fetchRSS, summarizeArticle
    ├── services/
    │   ├── openai.js            ← OpenAI API 직접 호출 유틸
    │   ├── market.js            ← 시세 수집 (CoinGecko, Alpha Vantage)
    │   ├── news.js              ← RSS 스크래핑 + 요약
    │   └── store.js             ← DynamoDB CRUD 유틸
    └── utils/
        ├── slack.js             ← Slack Block Kit 포맷터 + 메시지 발송
        ├── parser.js            ← Slash Command 파싱 유틸
        └── verify.js            ← Slack 서명 검증 미들웨어
```

---

## DynamoDB 테이블 설계 (4개)

### 1. BriefingTable
- PK: `userId` (S) — 정기 브리핑은 "global"
- SK: `date` (S) — "2026-03-16"
- 필드: content (전문), marketData (JSON), createdAt
- GSI: `date-index` (PK: date) — 날짜 기반 전체 조회용

### 2. WatchlistTable
- PK: `userId` (S)
- SK: `symbol` (S) — "BTC", "AAPL", "005930"
- 필드: category ("coin" | "stock" | "fx"), addedAt

### 3. AlertTable
- PK: `userId` (S)
- SK: `alertId` (S) — uuid
- 필드: symbol, targetPrice (N), direction ("above" | "below"), active (BOOL), createdAt
- GSI: `active-index` (PK: active) — active=true 알림 빠른 조회용

### 4. ConversationTable
- PK: `userId` (S)
- SK: `timestamp` (S) — ISO string
- 필드: role ("user" | "assistant"), content
- TTL: `expireAt` — 현재 Unix timestamp + 86400 (24시간)

---

## serverless.yml 전체 명세

```yaml
service: financial-bot

provider:
  name: aws
  runtime: nodejs22.x
  region: ap-northeast-2
  timeout: 29
  environment:
    OPENAI_API_KEY: ${env:OPENAI_API_KEY}
    SLACK_BOT_TOKEN: ${env:SLACK_BOT_TOKEN}
    SLACK_SIGNING_SECRET: ${env:SLACK_SIGNING_SECRET}
    SLACK_CHANNEL_ID: ${env:SLACK_CHANNEL_ID}
    COINGECKO_API_KEY: ${env:COINGECKO_API_KEY}
    ALPHA_VANTAGE_API_KEY: ${env:ALPHA_VANTAGE_API_KEY}
    BRIEFING_TABLE: ${self:service}-${sls:stage}-briefings
    WATCHLIST_TABLE: ${self:service}-${sls:stage}-watchlist
    ALERT_TABLE: ${self:service}-${sls:stage}-alerts
    CONVERSATION_TABLE: ${self:service}-${sls:stage}-conversations
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:GetItem
            - dynamodb:Query
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
            - dynamodb:Scan
          Resource:
            - arn:aws:dynamodb:ap-northeast-2:*:table/financial-bot-*
            - arn:aws:dynamodb:ap-northeast-2:*:table/financial-bot-*/index/*

functions:
  briefing:
    handler: src/handlers/briefing.handler
    timeout: 120
    events:
      - schedule: cron(0 0 * * ? *)    # 오전 9시 KST
      - schedule: cron(0 9 * * ? *)    # 오후 6시 KST

  slashCommand:
    handler: src/handlers/slashCommand.handler
    timeout: 29
    events:
      - httpApi:
          path: /slack/commands
          method: POST

  conversation:
    handler: src/handlers/conversation.handler
    timeout: 29
    events:
      - httpApi:
          path: /slack/events
          method: POST

  alertPoller:
    handler: src/handlers/alertPoller.handler
    timeout: 30
    events:
      - schedule: rate(5 minutes)

resources:
  Resources:
    BriefingTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.BRIEFING_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
          - AttributeName: date
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
          - AttributeName: date
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: date-index
            KeySchema:
              - AttributeName: date
                KeyType: HASH
            Projection:
              ProjectionType: ALL

    WatchlistTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.WATCHLIST_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
          - AttributeName: symbol
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
          - AttributeName: symbol
            KeyType: RANGE

    AlertTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.ALERT_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
          - AttributeName: alertId
            AttributeType: S
          - AttributeName: active
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
          - AttributeName: alertId
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: active-index
            KeySchema:
              - AttributeName: active
                KeyType: HASH
            Projection:
              ProjectionType: ALL

    ConversationTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.CONVERSATION_TABLE}
        BillingMode: PAY_PER_REQUEST
        TimeToLiveSpecification:
          AttributeName: expireAt
          Enabled: true
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
          - AttributeName: timestamp
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
          - AttributeName: timestamp
            KeyType: RANGE
```

---

## handlers/ 구현 명세

### handlers/briefing.js
트리거: EventBridge Scheduler (오전 9시 / 오후 6시 KST)
AI 방식: OpenAI API 직접 호출

처리 순서:
1. market.js → getBatchPrices(['BTC','ETH','AAPL','TSLA','005930','000660','USD/KRW']) 일괄 조회
2. news.js → fetchNews() → RSS 기사 5개 수집
3. news.js → summarizeArticles(articles) → gpt-5-mini로 각 기사 2~3줄 요약
4. openai.js → analyze(marketData + newsData) → gpt-5로 종합 분석 코멘트 생성
5. store.js → BriefingTable PutItem (userId: "global", date: 오늘)
6. slack.js → formatBriefing() → SLACK_CHANNEL_ID로 Block Kit 발송

### handlers/slashCommand.js
트리거: POST /slack/commands
AI 방식: OpenAI API 직접 호출 (commands/ 내부에서)

처리 순서:
1. verify.js → Slack 서명 검증 (X-Slack-Signature)
2. HTTP 200 즉시 ack 반환 (Slack 3초 제한 대응)
3. command + text 파싱
4. commands/ 하위로 라우팅:
   - `/brief` → commands/brief.js
   - `/watch` → commands/watch.js
   - `/alert` → commands/alert.js
   - `/history` → commands/history.js
   - `/summary` → commands/summary.js
   - 알 수 없는 명령어 → 사용법 안내
5. 결과를 response_url로 비동기 POST 발송

### handlers/conversation.js
트리거: POST /slack/events
AI 방식: @openai/agents SDK (OrchestratorAgent)

처리 순서:
1. url_verification → challenge 즉시 반환
2. verify.js → Slack 서명 검증
3. event_id 기반 중복 이벤트 방지 (DynamoDB 조건부 쓰기)
4. app_mention 또는 message.im 이벤트만 처리
5. store.js → WatchlistTable에서 userId 관심 종목 조회
6. agents/orchestrator.js → run(orchestratorAgent, message, { session })
   - session: DynamoDBSession (userId 기반, ConversationTable 연동)
7. result.finalOutput → Slack 스레드 응답 발송

### handlers/alertPoller.js
트리거: EventBridge rate(5 minutes)
AI 방식: 없음 (단순 조건 비교)

처리 순서:
1. store.js → AlertTable GSI(active-index) Scan (active: "true")
2. symbol 기준 그룹핑 후 market.js 일괄 시세 조회
3. 조건 비교:
   - above: currentPrice >= targetPrice
   - below: currentPrice <= targetPrice
4. 조건 충족 시:
   - slack.js → 해당 userId에게 DM 발송
   - store.js → AlertTable active: "false" 업데이트
5. 개별 알림 실패가 전체에 영향 없도록 try/catch 처리

---

## agents/ 구현 명세 (Agents SDK)

### agents/tools/marketTools.js
```javascript
import { tool } from '@openai/agents';
import { z } from 'zod';
import * as market from '../../services/market.js';

export const getCryptoPriceTool = tool({
  name: 'getCryptoPrice',
  description: 'BTC, ETH 등 코인 현재 시세와 24시간 변동률 조회',
  parameters: z.object({
    symbol: z.string().describe('코인 심볼 (예: bitcoin, ethereum)')
  }),
  execute: async ({ symbol }) => market.getCryptoPrice(symbol)
});

export const getStockPriceTool = tool({
  name: 'getStockPrice',
  description: '주식 현재 시세와 변동률 조회 (미국주, 국내주)',
  parameters: z.object({
    symbol: z.string().describe('종목 코드 (예: AAPL, 005930)')
  }),
  execute: async ({ symbol }) => market.getStockPrice(symbol)
});

export const getFxRateTool = tool({
  name: 'getFxRate',
  description: '환율 조회',
  parameters: z.object({
    from: z.string(),
    to: z.string()
  }),
  execute: async ({ from, to }) => market.getFxRate(from, to)
});
```

### agents/tools/newsTools.js
```javascript
export const fetchNewsTool = tool({
  name: 'fetchNews',
  description: '키워드 관련 최신 뉴스 RSS 수집',
  parameters: z.object({
    keywords: z.array(z.string()).describe('검색 키워드 목록')
  }),
  execute: async ({ keywords }) => news.fetchNews(keywords)
});

export const summarizeArticleTool = tool({
  name: 'summarizeArticle',
  description: '뉴스 기사 URL을 받아 2~3줄 요약 생성',
  parameters: z.object({
    url: z.string(),
    title: z.string()
  }),
  execute: async ({ url, title }) => news.summarizeArticle(url, title)
});
```

### agents/marketAgent.js
```javascript
import { Agent } from '@openai/agents';
import { getCryptoPriceTool, getStockPriceTool, getFxRateTool }
  from './tools/marketTools.js';

export const marketAgent = new Agent({
  name: 'MarketAgent',
  instructions: `당신은 금융 시장 전문가입니다.
    코인, 주식, 환율 시세를 조회하고 분석합니다.
    수치는 항상 전일 대비 변동률과 함께 제공하세요.
    한국어로 응답하세요.`,
  model: 'gpt-5-mini',
  tools: [getCryptoPriceTool, getStockPriceTool, getFxRateTool],
});
```

### agents/newsAgent.js
```javascript
export const newsAgent = new Agent({
  name: 'NewsAgent',
  instructions: `당신은 금융/경제 뉴스 전문가입니다.
    관련 뉴스를 수집하고 핵심 내용을 요약합니다.
    반드시 원문 링크를 함께 제공하세요.
    한국어로 응답하세요.`,
  model: 'gpt-5-mini',
  tools: [fetchNewsTool, summarizeArticleTool],
});
```

### agents/orchestrator.js
```javascript
import { Agent, run } from '@openai/agents';
import { marketAgent } from './marketAgent.js';
import { newsAgent } from './newsAgent.js';

// 인풋 Guardrail: 금융 외 주제 차단
const financialGuardrail = {
  name: 'FinancialTopicGuardrail',
  execute: async ({ input }) => {
    const nonFinancial = await checkNonFinancialTopic(input);
    return { tripwire: nonFinancial };
  }
};

export const orchestratorAgent = new Agent({
  name: 'OrchestratorAgent',
  instructions: `당신은 금융 브리핑 봇의 오케스트레이터입니다.
    사용자 메시지를 분석하여 적절한 전문 Agent에 위임하세요.
    - 시세/가격/차트 관련 → MarketAgent
    - 뉴스/동향/이슈 관련 → NewsAgent
    - 두 가지 모두 필요하면 순서대로 위임 후 결과 취합
    항상 한국어로 응답하세요.`,
  model: 'gpt-5-mini',
  handoffs: [marketAgent, newsAgent],
  inputGuardrails: [financialGuardrail],
});

// DynamoDB 기반 Session 클래스
export class DynamoDBSession {
  constructor({ sessionId }) {
    this.sessionId = sessionId;
  }
  async getItems() {
    // store.js → ConversationTable Query (최근 20개)
    // role, content 형태로 반환
  }
  async addItem(item) {
    // store.js → ConversationTable PutItem
    // expireAt: Math.floor(Date.now() / 1000) + 86400
  }
}

// 실행 함수
export async function runConversation(userId, message, watchlist) {
  const session = new DynamoDBSession({ sessionId: userId });
  const result = await run(orchestratorAgent, message, { session });
  return result.finalOutput;
}
```

---

## commands/ 구현 명세

### commands/brief.js
입력: `/brief {symbol}`
처리:
1. parser.js → symbol 추출 (없으면 사용법 안내)
2. market.js → 현재 시세 + 전일 대비 변동률
3. news.js → symbol 관련 뉴스 2개
4. openai.js → gpt-5-mini → 즉석 분석 코멘트
5. slack.js → Block Kit 응답

### commands/watch.js
- `add {symbol}`: WatchlistTable PutItem (중복 체크)
- `remove {symbol}`: WatchlistTable DeleteItem
- `list`: WatchlistTable Query → 각 symbol 현재 시세 포함 목록

### commands/alert.js
- `add {symbol} {price} above|below`:
  - price 숫자 유효성 검증
  - direction above/below 검증
  - AlertTable PutItem (alertId: uuid, active: "true")
- `list`: AlertTable Query → active="true" 목록
- `remove {alertId}`: AlertTable UpdateItem (active: "false")

### commands/history.js
- `{date}` (예: 2026-03-16): BriefingTable GetItem
- `list`: BriefingTable GSI(date-index) → 최근 7개 날짜 목록
- 인수 없음: 오늘 날짜 브리핑 반환

### commands/summary.js
1. market.js → 전체 종목 시세
2. BriefingTable → 오늘 브리핑 조회 (있으면 재활용)
3. openai.js → gpt-5-mini → 한 줄 요약
4. Slack 응답

---

## services/ 구현 명세

### services/openai.js
```javascript
// 직접 호출용 기본 유틸
async function chat(messages, options = {})
// model: options.model || 'gpt-5-mini'
// max_tokens: options.maxTokens || 1000

// 브리핑 종합 분석 (gpt-5 사용)
async function analyze(data, instruction)
// model: 'gpt-5'
```

### services/market.js
```javascript
async function getCryptoPrice(symbol)
// CoinGecko API → { price, change24h, changePercent24h }

async function getStockPrice(symbol)
// Alpha Vantage API → { price, change, changePercent }

async function getFxRate(from, to)
// Alpha Vantage API → { rate, change, changePercent }

async function getBatchPrices(symbols)
// symbols: [{ type: 'crypto'|'stock'|'fx', symbol }]
// API 호출 최소화를 위해 그룹핑 후 일괄 처리
```

### services/news.js
```javascript
async function fetchNews(keywords = [])
// RSS 소스: Reuters Business, BBC Business, 연합뉴스 경제
// 반환: [{ title, url, publishedAt, source }]

async function summarizeArticles(articles)
// openai.js gpt-5-mini 호출
// 반환: [{ title, summary, url, publishedAt }]

async function summarizeArticle(url, title)
// 단건 요약 (agents/tools/newsTools.js용)
```

### services/store.js
```javascript
async function putItem(tableName, item)
async function getItem(tableName, key)
async function queryItems(tableName, keyCondition, options)
async function updateItem(tableName, key, updateExpression, values)
async function deleteItem(tableName, key)
async function scanByIndex(tableName, indexName, filterExpression, values)
```

---

## utils/ 구현 명세

### utils/slack.js
```javascript
// 정기 브리핑 Block Kit (isAM: 오전/오후 구분)
function formatBriefing({ prices, news, analysis, isAM })

// 시세 섹션
function formatPriceSection(prices)

// 뉴스 섹션 (링크 포함)
function formatNewsSection(articles)

// 가격 알림 DM
function formatAlertMessage({ symbol, targetPrice, currentPrice, direction })

// 에러 메시지
function formatError(message)

// Slack 메시지 발송
async function postMessage(channel, blocks)
async function postEphemeral(channel, userId, blocks)  // 본인에게만 보이는 응답
async function postToResponseUrl(responseUrl, blocks)  // Slash Command 비동기 응답
```

### utils/verify.js
```javascript
// Slack 서명 검증
function verifySlackSignature(headers, rawBody)
// X-Slack-Signature, X-Slack-Request-Timestamp 검증
// timestamp 5분 이상 차이나면 reject
```

### utils/parser.js
```javascript
// Slash Command 텍스트 파싱
function parseCommand(text)
// 입력: "add BTC 90000 above"
// 반환: { subcommand: 'add', args: ['BTC', '90000', 'above'] }

// symbol 정규화
function normalizeSymbol(symbol)
// 'btc' → 'BTC'
// '삼성' → '005930'
// '하이닉스' → '000660'
```

---

## package.json

```json
{
  "name": "financial-bot",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@openai/agents": "latest",
    "openai": "latest",
    "zod": "latest",
    "@slack/web-api": "latest",
    "@aws-sdk/client-dynamodb": "latest",
    "@aws-sdk/lib-dynamodb": "latest",
    "axios": "latest",
    "rss-parser": "latest",
    "uuid": "latest"
  }
}
```

---

## Slack 앱 설정 체크리스트

### Bot Token Scopes
```
chat:write
commands
im:history
im:write
app_mentions:read
channels:history
```

### Slash Commands (모두 동일한 Request URL)
```
Request URL: https://{API_GW_URL}/slack/commands

/brief    — 종목 즉석 분석
/watch    — 관심 종목 관리
/alert    — 가격 알림 설정
/history  — 브리핑 이력 조회
/summary  — 오늘 시장 한 줄 요약
```

### Event Subscriptions
```
Request URL: https://{API_GW_URL}/slack/events
Subscribe to bot events:
  - app_mention
  - message.im
```

---

## 환경변수 목록
```
OPENAI_API_KEY
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CHANNEL_ID
COINGECKO_API_KEY
ALPHA_VANTAGE_API_KEY
```

---

## 작업 완료 조건
- [ ] 모든 파일 생성 완료
- [ ] npm install 실행
- [ ] serverless deploy --stage dev 실행 가능한 상태
- [ ] 모든 핸들러 try/catch 에러 처리 포함
- [ ] verify.js Slack 서명 검증 모든 엔드포인트 적용
- [ ] conversation.js 중복 이벤트 방지 (event_id dedup)
- [ ] slashCommand.js 즉시 200 ack → 비동기 처리
- [ ] alertPoller.js 개별 알림 실패 격리 처리
- [ ] README.md 작성:
  - 로컬 실행 방법
  - 환경변수 설정 방법
  - Slack 앱 설정 방법 (위 체크리스트 포함)
  - 배포 명령어: `serverless deploy --stage dev`
````
