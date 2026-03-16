# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Financial Briefing Bot — a Slack-based service that delivers scheduled and on-demand financial briefings using OpenAI GPT-5 models. Responds in Korean.

## Tech Stack

- **Runtime**: Node.js 22.x
- **Framework**: Serverless Framework v4
- **Cloud**: AWS (ap-northeast-2)
- **AI**: OpenAI API — gpt-5-mini (chat, summaries, quick analysis), gpt-5 (deep analysis, 2x/day scheduled briefings only)
- **External APIs**: OKX (crypto, no auth), Alpha Vantage (stocks), ExchangeRate-API (FX, no auth), Finnhub + NewsData.io (news)
- **Storage**: DynamoDB (4 tables)
- **Messaging**: Slack Web API + Block Kit formatting
- **Scheduling**: AWS EventBridge

## Commands

```bash
npm install                         # Install dependencies
serverless deploy --stage dev       # Deploy to dev
serverless deploy --stage prod      # Deploy to prod
```

No test framework is configured yet.

## Architecture

Four Lambda handlers serve as entry points:

- **briefing.js** — EventBridge cron (UTC 00:00/09:00 = KST 09:00/18:00). Fetches market data + news, runs gpt-5 analysis, posts to Slack channel.
- **slashCommand.js** — POST /slack/commands. Verifies Slack signature, sends immediate 200 ack (3-second limit), routes to `commands/` modules, responds async via `response_url`.
- **conversation.js** — POST /slack/events. Handles `url_verification`, `app_mention`, `message.im`. Deduplicates by event_id. Loads 20-message history + user watchlist for context. Uses gpt-5-mini.
- **alert.js** — EventBridge rate(5 minutes). Queries active alerts via GSI, batch-fetches prices, sends Slack DM on trigger, deactivates fired alerts. Fail-safe per alert.

Five slash commands under `commands/`:
- `/brief {symbol}` — spot analysis with price + news + AI comment
- `/watch add|remove|list` — watchlist management
- `/alert add|list|remove` — price alerts (above/below threshold)
- `/history [date|list]` — retrieve past briefings
- `/summary` — one-line market summary

Four service modules under `services/`:
- **openai.js** — `chat(messages, opts)` and `analyze(data, instruction)` wrappers
- **market.js** — `getCryptoPrice`, `getStockPrice`, `getFxRate`, `getBatchPrices`
- **news.js** — `fetchNews(keywords)` via Finnhub + NewsData.io, `summarizeArticles(articles)`
- **store.js** — generic DynamoDB CRUD (`putItem`, `getItem`, `queryItems`, `updateItem`, `deleteItem`)

Utilities under `utils/`:
- **slack.js** — Block Kit formatters for briefings, prices, news, alerts, errors
- **parser.js** — `parseCommand(text)` and `normalizeSymbol(symbol)` (handles Korean aliases like 삼성→005930)

## DynamoDB Tables

All table names follow `financial-bot-{stage}-{name}` pattern.

| Table | PK | SK | GSI | Notes |
|-------|----|----|-----|-------|
| BriefingTable | userId | date (YYYY-MM-DD) | date-index | Scheduled briefings use userId="global" |
| WatchlistTable | userId | symbol | — | category: coin\|stock\|fx |
| AlertTable | userId | alertId (uuid) | active-index | direction: above\|below |
| ConversationTable | userId | timestamp (ISO) | — | TTL: expireAt (24h) |

## Key Patterns

- **Slack 3-second limit**: All HTTP handlers return 200 immediately, then process async and respond via `response_url` or Slack API.
- **Slack signature verification**: Required on all HTTP endpoints using `X-Slack-Signature` + `SLACK_SIGNING_SECRET`.
- **Event deduplication**: conversation.js tracks `event_id` to prevent duplicate processing.
- **API call batching**: market.js `getBatchPrices` groups symbols to minimize external API calls.
- **Times in KST**: All user-facing times are UTC+9. EventBridge crons are in UTC.

## Environment Variables

```
OPENAI_API_KEY
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CHANNEL_ID              # Channel for scheduled briefings
ALPHA_VANTAGE_API_KEY         # Stocks (free 25 calls/day)
FINNHUB_API_KEY               # News (free 60 calls/min)
NEWSDATA_API_KEY              # News keyword search (free 200 credits/day)
# No key needed: OKX (crypto), ExchangeRate-API (FX)
```

## Full Specification

See `MUST_READ_guideline.md` for complete implementation details including handler processing sequences, command specs, service APIs, and Slack app configuration.
