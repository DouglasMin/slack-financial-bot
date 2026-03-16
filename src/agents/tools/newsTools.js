import { tool } from '@openai/agents';
import { z } from 'zod';
import * as news from '../../services/news.js';

export const fetchNewsTool = tool({
  name: 'fetchNews',
  description: '키워드 관련 최신 뉴스 RSS 수집 (최대 5건)',
  parameters: z.object({
    keywords: z.array(z.string()).describe('검색 키워드 목록 (예: ["bitcoin", "금리"])'),
  }),
  execute: async ({ keywords }) => {
    const articles = await news.fetchNews(keywords);
    return JSON.stringify(articles);
  },
});

export const summarizeArticleTool = tool({
  name: 'summarizeArticle',
  description: '뉴스 기사 URL과 제목을 받아 2~3줄 한국어 요약 생성',
  parameters: z.object({
    url: z.string().describe('기사 URL'),
    title: z.string().describe('기사 제목'),
  }),
  execute: async ({ url, title }) => {
    const result = await news.summarizeArticle(url, title);
    return JSON.stringify(result);
  },
});
