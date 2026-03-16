import { tool } from '@openai/agents';
import { z } from 'zod';
import * as market from '../../services/market.js';

export const getCryptoPriceTool = tool({
  name: 'getCryptoPrice',
  description: 'BTC, ETH 등 코인 현재 시세와 24시간 변동률 조회',
  parameters: z.object({
    symbol: z.string().describe('코인 심볼 (예: BTC, ETH, SOL)'),
  }),
  execute: async ({ symbol }) => {
    const result = await market.getCryptoPrice(symbol);
    return JSON.stringify(result);
  },
});

export const getStockPriceTool = tool({
  name: 'getStockPrice',
  description: '주식 현재 시세와 변동률 조회 (미국주, 국내주)',
  parameters: z.object({
    symbol: z.string().describe('종목 코드 (예: AAPL, 005930)'),
  }),
  execute: async ({ symbol }) => {
    const result = await market.getStockPrice(symbol);
    return JSON.stringify(result);
  },
});

export const getFxRateTool = tool({
  name: 'getFxRate',
  description: '환율 조회 (예: USD→KRW, EUR→USD)',
  parameters: z.object({
    from: z.string().describe('기준 통화 코드 (예: USD)'),
    to: z.string().describe('대상 통화 코드 (예: KRW)'),
  }),
  execute: async ({ from, to }) => {
    const result = await market.getFxRate(from, to);
    return JSON.stringify(result);
  },
});
