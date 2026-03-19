import { tool } from '@openai/agents';
import { z } from 'zod';
import * as news from '../../services/news.js';

export const fetchCompanyNewsTool = tool({
  name: 'fetchCompanyNews',
  description: '개별 주식 종목의 뉴스를 검색합니다. 미국주(NVDA, AAPL, TSLA 등)와 한국주의 영문 ticker를 지원합니다. 최대 5건의 최신 기사를 반환합니다.',
  parameters: z.object({
    symbol: z.string().describe('주식 ticker (예: NVDA, AAPL, TSLA, MSFT)'),
    keywords: z.array(z.string()).default([]).describe('추가 검색 키워드 (예: ["Nvidia", "AI chip"])'),
  }),
  execute: async ({ symbol, keywords }) => {
    try {
      const articles = await news.fetchCompanyNews(symbol, keywords);
      if (articles.length === 0) {
        return JSON.stringify({ message: `${symbol} 관련 최신 뉴스를 찾지 못했습니다.`, articles: [] });
      }
      return JSON.stringify(articles);
    } catch (error) {
      return JSON.stringify({ error: true, message: `주식 뉴스 검색 중 오류가 발생했습니다.` });
    }
  },
});

export const fetchCryptoNewsTool = tool({
  name: 'fetchCryptoNews',
  description: '암호화폐 관련 뉴스를 검색합니다. 키워드로 코인 이름이나 ticker를 넣으세요. 최대 5건의 최신 기사를 반환합니다.',
  parameters: z.object({
    keywords: z.array(z.string()).describe('검색 키워드 (예: ["bitcoin", "BTC"] 또는 ["ethereum", "ETH"])'),
  }),
  execute: async ({ keywords }) => {
    try {
      const articles = await news.fetchCryptoNews(keywords);
      if (articles.length === 0) {
        return JSON.stringify({ message: `관련 암호화폐 뉴스를 찾지 못했습니다.`, articles: [] });
      }
      return JSON.stringify(articles);
    } catch (error) {
      return JSON.stringify({ error: true, message: `암호화폐 뉴스 검색 중 오류가 발생했습니다.` });
    }
  },
});

export const fetchGeneralNewsTool = tool({
  name: 'fetchGeneralNews',
  description: '일반 시장/경제 뉴스를 검색합니다. 특정 종목이 아닌 시장 전반, 금리, 환율, 경제 동향 뉴스에 사용하세요. 최대 5건의 최신 기사를 반환합니다.',
  parameters: z.object({
    keywords: z.array(z.string()).default([]).describe('검색 키워드 (예: ["Fed", "interest rate"] 또는 ["금리", "인플레이션"])'),
  }),
  execute: async ({ keywords }) => {
    try {
      const articles = await news.fetchGeneralNews(keywords);
      if (articles.length === 0) {
        return JSON.stringify({ message: `관련 뉴스를 찾지 못했습니다.`, articles: [] });
      }
      return JSON.stringify(articles);
    } catch (error) {
      return JSON.stringify({ error: true, message: `뉴스 검색 중 오류가 발생했습니다.` });
    }
  },
});

export const summarizeArticlesTool = tool({
  name: 'summarizeArticles',
  description: '뉴스 기사 목록을 한국어로 배치 요약하고 [상승]/[하락]/[중립] 감성 태그를 붙입니다. fetchCompanyNews, fetchCryptoNews, fetchGeneralNews로 가져온 기사들을 요약할 때 사용하세요.',
  parameters: z.object({
    articles: z.array(z.object({
      title: z.string(),
      description: z.string().default(''),
      url: z.string().default(''),
      publishedAt: z.string().default(''),
    })).describe('요약할 기사 목록'),
  }),
  execute: async ({ articles }) => {
    try {
      const result = await news.summarizeArticles(articles);
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({ error: true, message: `기사 요약에 실패했습니다.` });
    }
  },
});
