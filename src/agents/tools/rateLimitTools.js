import { tool } from '@openai/agents';
import { z } from 'zod';
import { getRemaining, getAllStatus } from '../../utils/rateLimit.js';

export const checkApiQuotaTool = tool({
  name: 'checkApiQuota',
  description: '외부 API 잔여 호출 횟수 조회. 특정 API 또는 전체 현황 확인 가능. API 호출 전에 한도를 확인할 때 사용.',
  parameters: z.object({
    apiName: z
      .enum(['alpha_vantage', 'finnhub', 'newsdata', 'all'])
      .describe('조회할 API 이름 (alpha_vantage, finnhub, newsdata) 또는 all'),
  }),
  execute: async ({ apiName }) => {
    if (apiName === 'all') {
      return JSON.stringify(await getAllStatus());
    }
    const status = await getRemaining(apiName);
    if (!status) {
      return JSON.stringify({ error: `알 수 없는 API: ${apiName}` });
    }
    return JSON.stringify(status);
  },
});
