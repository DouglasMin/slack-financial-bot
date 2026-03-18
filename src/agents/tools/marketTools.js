import { tool } from '@openai/agents';
import { z } from 'zod';
import * as market from '../../services/market.js';

export const getCryptoPriceTool = tool({
  name: 'getCryptoPrice',
  description: '암호화폐 현재 시세를 조회합니다. 현재가, 24시간 변동률, 고가, 저가, 거래량을 반환합니다. 사용자가 코인 가격, 시세, 현황을 물으면 이 도구를 사용하세요. 지원 코인: BTC, ETH, XRP, SOL, ADA, DOGE, DOT, MATIC, AVAX, LINK 등.',
  parameters: z.object({
    symbol: z.string().describe('코인 티커 심볼 (예: BTC, ETH, DOGE, SOL, XRP)'),
  }),
  execute: async ({ symbol }) => {
    const result = await market.getCryptoPrice(symbol);
    return JSON.stringify(result);
  },
});

export const getStockPriceTool = tool({
  name: 'getStockPrice',
  description: '주식 현재 시세를 조회합니다. 현재가, 전일 대비 변동, 변동률을 반환합니다. 사용자가 주식 가격, 주가를 물으면 이 도구를 사용하세요. 미국주(AAPL, TSLA, NVDA)와 한국주(005930.KS, 000660.KS)를 지원합니다. 한국 주식 6자리 코드에는 .KS 접미사를 붙여야 합니다.',
  parameters: z.object({
    symbol: z.string().describe('종목 코드 (예: AAPL, TSLA, NVDA, 005930.KS)'),
  }),
  execute: async ({ symbol }) => {
    const result = await market.getStockPrice(symbol);
    return JSON.stringify(result);
  },
});

export const getFxRateTool = tool({
  name: 'getFxRate',
  description: '환율을 조회합니다. 사용자가 달러, 엔화, 유로 등 환율을 물으면 이 도구를 사용하세요. from에 기준 통화, to에 대상 통화를 넣으세요.',
  parameters: z.object({
    from: z.string().describe('기준 통화 코드 (예: USD, EUR, JPY)'),
    to: z.string().describe('대상 통화 코드 (예: KRW, USD)'),
  }),
  execute: async ({ from, to }) => {
    const result = await market.getFxRate(from, to);
    return JSON.stringify(result);
  },
});
