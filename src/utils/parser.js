const KOREAN_ALIASES = {
  // 한국 대형주
  '삼성': '005930',
  '삼성전자': '005930',
  '하이닉스': '000660',
  'SK하이닉스': '000660',
  '카카오': '035720',
  '네이버': '035420',
  'LG에너지': '373220',
  'LG에너지솔루션': '373220',
  '현대차': '005380',
  '현대자동차': '005380',
  '셀트리온': '068270',
  '기아': '000270',
  '포스코': '005490',
  'POSCO': '005490',
  '삼성바이오': '207940',
  '삼성바이오로직스': '207940',
  'KB금융': '105560',
  '신한지주': '055550',
  '현대모비스': '012330',
  'LG화학': '051910',
  '삼성SDI': '006400',
  'SK이노베이션': '096770',
  '카카오뱅크': '323410',
  '크래프톤': '259960',

  // 코인
  '비트코인': 'BTC',
  '이더리움': 'ETH',
  '이더': 'ETH',
  '도지코인': 'DOGE',
  '도지': 'DOGE',
  '리플': 'XRP',
  '솔라나': 'SOL',
  '에이다': 'ADA',
  '카르다노': 'ADA',
  '폴카닷': 'DOT',
  '매틱': 'MATIC',
  '폴리곤': 'MATIC',
  '아발란체': 'AVAX',
  '체인링크': 'LINK',
  '링크': 'LINK',
  '라이트코인': 'LTC',
  '유니스왑': 'UNI',
  '아톰': 'ATOM',
  '코스모스': 'ATOM',
  '니어': 'NEAR',
  '앱토스': 'APT',
  '아비트럼': 'ARB',
  '옵티미즘': 'OP',
  '바이낸스코인': 'BNB',

  // 미국 대형주
  '애플': 'AAPL',
  '테슬라': 'TSLA',
  '엔비디아': 'NVDA',
  '마이크로소프트': 'MSFT',
  '구글': 'GOOGL',
  '알파벳': 'GOOGL',
  '아마존': 'AMZN',
  '메타': 'META',
  '넷플릭스': 'NFLX',
  'AMD': 'AMD',

  // FX 한국어 매핑
  '달러': 'USD/KRW',
  '달러환율': 'USD/KRW',
  '원달러': 'USD/KRW',
  '엔화': 'JPY/KRW',
  '엔환율': 'JPY/KRW',
  '원엔': 'JPY/KRW',
  '유로': 'EUR/KRW',
  '유로환율': 'EUR/KRW',
  '원유로': 'EUR/KRW',
  '위안': 'CNY/KRW',
  '위안화': 'CNY/KRW',
  '파운드': 'GBP/KRW',
};

const CRYPTO_SET = new Set([
  'BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'DOT', 'MATIC', 'AVAX', 'LINK',
  'LTC', 'USDC', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'BNB',
]);

/**
 * 슬래시 커맨드 텍스트를 서브커맨드와 인자로 파싱
 * 예: "add BTC 90000 above" → { subcommand: 'add', args: ['BTC', '90000', 'above'] }
 */
export function parseCommand(text) {
  if (!text || text.trim() === '') {
    return { subcommand: '', args: [] };
  }

  const parts = text.trim().split(/\s+/);
  const subcommand = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { subcommand, args };
}

/**
 * 심볼 정규화: 대문자 변환 및 한국어 별칭 매핑
 */
export function normalizeSymbol(symbol) {
  if (!symbol) {
    return '';
  }

  const trimmed = symbol.trim();

  // 한국어 별칭 확인
  if (KOREAN_ALIASES[trimmed]) {
    return KOREAN_ALIASES[trimmed];
  }

  return trimmed.toUpperCase();
}

/**
 * 종목 타입 판별: crypto / stock / fx
 * @param {string} symbol - 정규화된 심볼
 * @returns {'coin' | 'stock' | 'fx'}
 */
export function determineCategory(symbol) {
  if (CRYPTO_SET.has(symbol)) return 'coin';
  if (/^[A-Z]{3}\/?[A-Z]{3}$/.test(symbol)) return 'fx';
  return 'stock';
}

/**
 * 심볼로부터 getBatchPrices()에 전달할 price request 객체 생성
 * @param {string} symbol - 원본 심볼
 * @param {string} [category] - 카테고리 (없으면 자동 판별)
 * @returns {{type: string, symbol: string, from?: string, to?: string}}
 */
export function buildPriceRequest(symbol, category) {
  const cat = category || determineCategory(symbol);

  if (cat === 'coin') {
    return { type: 'crypto', symbol: symbol.toUpperCase() };
  }

  if (cat === 'fx') {
    const normalized = symbol.replace('/', '');
    const from = normalized.substring(0, 3);
    const to = normalized.substring(3, 6);
    return { type: 'fx', symbol: normalized, from, to };
  }

  // stock — 한국 주식 6자리는 .KS 접미사 추가
  const avSymbol = /^\d{6}$/.test(symbol) ? `${symbol}.KS` : symbol;
  return { type: 'stock', symbol: avSymbol };
}
