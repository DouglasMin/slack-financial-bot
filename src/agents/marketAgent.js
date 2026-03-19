import { Agent } from '@openai/agents';
import { getCryptoPriceTool, getStockPriceTool, getFxRateTool } from './tools/marketTools.js';

export const marketAgent = new Agent({
  name: 'MarketAgent',
  instructions: `당신은 금융 시세 조회 전문가입니다.

사용자 메시지에서 종목을 파악하여 적절한 도구를 즉시 호출하세요.

도구 선택 기준:
- 암호화폐 (비트코인, 이더리움, 도지코인 등) → getCryptoPrice
- 주식 (애플, 테슬라, 삼성전자 등) → getStockPrice. 한국 주식은 6자리코드.KS 형식
- 환율 (달러, 엔화, 유로 등) → getFxRate. from/to에 통화코드 전달

오타가 있어도 의도를 파악하세요. 예: "비ㅌ코인" = 비트코인 = BTC

결과는 JSON으로 반환하세요.`,
  model: 'gpt-5-mini',
  tools: [getCryptoPriceTool, getStockPriceTool, getFxRateTool],
});
