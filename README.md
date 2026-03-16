# AI Financial Briefing Bot

Slack 기반 AI 금융 브리핑 봇. OpenAI GPT-5 모델을 활용하여 정기 브리핑, 즉석 조회, 자유 대화 기능을 제공합니다.

## 주요 기능

- **정기 브리핑** — 매일 오전 9시 / 오후 6시 (KST) 코인, 주식, 환율, 뉴스를 종합 분석하여 Slack 채널에 자동 발송 (GPT-5)
- **Slash Commands** — `/brief`, `/watch`, `/alert`, `/history`, `/summary`로 실시간 시세 조회, 관심 종목 관리, 가격 알림
- **자유 대화** — 봇 멘션(`@bot`) 또는 DM으로 금융 질문. OpenAI Agents SDK 기반 단일 에이전트가 시세 조회/뉴스 검색을 자동 수행
- **가격 알림** — 5분 주기로 시세 확인, 목표가 도달 시 DM 알림

## 기술 스택

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 22.x |
| Framework | Serverless Framework v4 |
| Cloud | AWS Lambda, DynamoDB, EventBridge (ap-northeast-2) |
| AI | OpenAI GPT-5 (브리핑 분석), GPT-5-mini (채팅/요약) |
| AI SDK | `@openai/agents` (자유 대화) |
| 시세 API | OKX (코인), Alpha Vantage (주식), ExchangeRate-API (환율) |
| 뉴스 API | Finnhub (시장 뉴스), NewsData.io (키워드 검색) |
| 메시징 | Slack Web API + Block Kit |

## 설치 및 배포

```bash
git clone https://github.com/DouglasMin/slack-financial-bot.git
cd slack-financial-bot
npm install
```

`.env` 파일을 프로젝트 루트에 생성:

```
OPENAI_API_KEY=your-openai-api-key
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_CHANNEL_ID=C0123456789
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-api-key
FINNHUB_API_KEY=your-finnhub-api-key
NEWSDATA_API_KEY=your-newsdata-api-key
```

배포:

```bash
serverless deploy --stage dev    # 개발
serverless deploy --stage prod   # 운영
```

## Slack 앱 설정

### Bot Token Scopes

```
chat:write, commands, im:history, im:write, app_mentions:read, channels:history
```

### Slash Commands

배포 후 출력되는 API Gateway URL을 사용합니다.

| 명령어 | Request URL | 설명 |
|--------|-------------|------|
| `/brief` | `{API_URL}/slack/commands` | 종목 즉석 분석 |
| `/watch` | `{API_URL}/slack/commands` | 관심 종목 관리 |
| `/alert` | `{API_URL}/slack/commands` | 가격 알림 설정 |
| `/history` | `{API_URL}/slack/commands` | 브리핑 이력 조회 |
| `/summary` | `{API_URL}/slack/commands` | 시장 한 줄 요약 |

### Event Subscriptions

Request URL: `{API_URL}/slack/events`

Subscribe to bot events: `app_mention`, `message.im`

## 사용법

```
/brief BTC                        # 비트코인 즉석 분석
/brief 삼성                       # 한국어 별칭 지원
/watch add DOGE                   # 관심 종목 추가
/watch list                       # 관심 종목 + 현재가
/alert add BTC 100000 above       # 가격 알림 설정
/history list                     # 최근 브리핑 목록
/summary                          # 시장 한 줄 요약
@financial-bot 도지코인 뉴스 알려줘  # 자유 대화
```

## 프로젝트 구조

```
src/
├── handlers/
│   ├── briefing.js            # EventBridge cron → 정기 브리핑
│   ├── slashCommand.js        # Slash Command 라우터
│   ├── conversation.js        # Slack 이벤트 수신 + 비동기 위임
│   ├── conversationWorker.js  # Agent 실행 (120s timeout)
│   └── alertPoller.js         # 5분 주기 가격 알림 체크
├── commands/
│   ├── brief.js               # /brief {symbol}
│   ├── watch.js               # /watch add|remove|list
│   ├── alert.js               # /alert add|list|remove
│   ├── history.js             # /history [date|list]
│   └── summary.js             # /summary
├── agents/
│   ├── orchestrator.js        # 단일 에이전트 + 도구 + 가드레일 + DynamoDB 세션
│   └── tools/
│       ├── marketTools.js     # getCryptoPrice, getStockPrice, getFxRate
│       ├── newsTools.js       # fetchNews, summarizeArticle
│       └── rateLimitTools.js  # checkApiQuota
├── services/
│   ├── openai.js              # OpenAI API 래퍼 (chat, analyze)
│   ├── market.js              # OKX, Alpha Vantage, ExchangeRate-API
│   ├── news.js                # Finnhub + NewsData.io
│   └── store.js               # DynamoDB CRUD
└── utils/
    ├── slack.js               # Block Kit 포맷터 + 메시지 발송
    ├── parser.js              # 커맨드 파싱, 심볼 정규화, 종목 타입 판별
    ├── verify.js              # Slack 서명 검증
    └── rateLimit.js           # DynamoDB 기반 API 호출 한도 관리

4 DynamoDB Tables:
├── briefings    (userId + date)       # 정기 브리핑 저장
├── watchlist    (userId + symbol)     # 관심 종목
├── alerts       (userId + alertId)    # 가격 알림 (active-index GSI)
└── conversations (userId + timestamp) # 대화 히스토리 + 이벤트 dedup + rate limit counters (TTL 24h)
```
