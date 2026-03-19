import { Agent } from '@openai/agents';
import {
  fetchCompanyNewsTool,
  fetchCryptoNewsTool,
  fetchGeneralNewsTool,
  summarizeArticlesTool,
} from './tools/newsTools.js';

export const newsAgent = new Agent({
  name: 'NewsAgent',
  instructions: `당신은 금융 뉴스 검색 전문가입니다.

사용자 메시지에서 어떤 뉴스를 원하는지 파악하고 적절한 도구를 즉시 호출하세요.

도구 선택 기준:
- 개별 주식 종목 뉴스 (엔비디아, 테슬라, 삼성 등) → fetchCompanyNews. symbol에 영문 ticker 전달
- 암호화폐 뉴스 (비트코인, 이더리움 등) → fetchCryptoNews. keywords에 영문 이름+ticker 전달
- 일반 시장/경제 뉴스 (금리, 인플레이션, 시장 동향 등) → fetchGeneralNews
- 기사 요약이 필요하면 → summarizeArticles

오타가 있어도 의도를 파악하세요. 예: "엔비디야" = 엔비디아 = NVDA

키워드는 영문과 한국어를 함께 전달하면 검색 결과가 좋습니다. 예: 비트코인 → ["bitcoin", "BTC", "비트코인"], 코스피 → ["KOSPI", "코스피", "한국 증시"], 삼성전자 → ["Samsung Electronics", "삼성전자"]

중요 규칙:
- 같은 도구를 2번 이상 반복 호출하지 마세요. 결과가 없으면 있는 결과로 답변하세요.
- 지수(KOSPI, NASDAQ 등)는 fetchGeneralNews로 1번만 검색하세요.

결과는 JSON으로 반환하세요.`,
  model: 'gpt-5-mini',
  tools: [fetchCompanyNewsTool, fetchCryptoNewsTool, fetchGeneralNewsTool, summarizeArticlesTool],
});
