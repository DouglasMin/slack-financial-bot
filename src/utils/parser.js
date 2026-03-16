const KOREAN_ALIASES = {
  '삼성': '005930',
  '하이닉스': '000660',
  '비트코인': 'BTC',
  '이더리움': 'ETH',
  '도지코인': 'DOGE',
  '리플': 'XRP',
  '솔라나': 'SOL',
  '에이다': 'ADA',
  '카카오': '035720',
  '네이버': '035420',
  'LG에너지': '373220',
  '현대차': '005380',
};

const CRYPTO_SET = new Set([
  'BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'DOT', 'MATIC', 'AVAX', 'LINK',
  'LTC', 'USDC', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP',
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
