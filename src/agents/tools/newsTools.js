import { tool } from '@openai/agents';
import { z } from 'zod';
import * as news from '../../services/news.js';

export const fetchNewsTool = tool({
  name: 'fetchNews',
  description: '금융 뉴스를 검색합니다. 사용자가 특정 종목, 시장, 경제 관련 뉴스나 동향을 물으면 이 도구를 사용하세요. 키워드는 영어와 한국어 모두 가능합니다. 여러 키워드를 넣으면 OR 조건으로 검색합니다. 최대 5건의 최신 기사(제목, 설명, 출처, URL)를 반환합니다.',
  parameters: z.object({
    keywords: z.array(z.string()).describe('검색 키워드 목록. 영어 ticker와 풀네임을 함께 넣으면 결과가 좋습니다. 예: ["bitcoin", "BTC"] 또는 ["삼성", "Samsung", "005930"]'),
  }),
  execute: async ({ keywords }) => {
    const articles = await news.fetchNews(keywords);
    return JSON.stringify(articles);
  },
});

export const summarizeArticleTool = tool({
  name: 'summarizeArticle',
  description: '뉴스 기사를 한국어로 요약하고 [상승]/[하락]/[중립] 감성 태그를 붙입니다. fetchNews로 가져온 기사의 상세 요약이 필요할 때 사용하세요.',
  parameters: z.object({
    url: z.string().describe('기사 URL'),
    title: z.string().describe('기사 제목'),
    description: z.string().default('').describe('기사 설명/요약 (있으면 전달, 없으면 빈 문자열)'),
  }),
  execute: async ({ url, title, description }) => {
    const result = await news.summarizeArticle(url, title, description);
    return JSON.stringify(result);
  },
});
