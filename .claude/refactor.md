# Refactoring Plan — Financial Briefing Bot

## 1. 뉴스 검색 품질 (최우선)

### 1-1. 뉴스 description 필드 활용 + 요약 프롬프트 개선
- **현재**: 제목 + URL만 GPT에 전달. LLM이 제목만 보고 추측
- **개선**:
  - NewsData.io `description` 필드를 파싱하여 함께 전달
  - Finnhub `summary` 필드도 활용
  - Chain-of-Thought 프롬프트: "1) 핵심 이벤트 파악 2) 해당 종목 영향 3) 한국어 2줄 요약"
- **임팩트**: 높음 / **난이도**: 낮음

### 1-2. 키워드 확장 전략
- **현재**: `fetchNews(["dogecoin"])` → API에 그대로 전달. 관련 뉴스 못 찾는 경우 빈번
- **개선**:
  - 종목별 keyword alias map 구축: `DOGE → ["dogecoin", "DOGE", "doge coin", "도지코인"]`
  - Finnhub `/company-news?symbol=AAPL` 엔드포인트 활용 (현재 `category=general`만 사용)
  - NewsData.io `category` 파라미터를 동적으로 설정 (crypto → `business,technology,science`)
- **임팩트**: 높음 / **난이도**: 중간

### 1-3. 뉴스 감성 태그
- **현재**: 뉴스에 상승/하락 방향성 표시 없음
- **개선**:
  - 요약 프롬프트에 감성 분류 포함: "요약 후 [상승] / [하락] / [중립] 태그를 붙여줘"
  - 별도 API 호출 없이 기존 요약 호출에 합침
  - Slack 표시: `*[상승]* Fed 금리 동결 시사 — Reuters (2시간 전)`
- **임팩트**: 중간 / **난이도**: 낮음

### 1-4. 뉴스 배치 요약 (1회 호출)
- **현재**: 기사마다 별도 GPT 호출 (3~5회)
- **개선**: 3개 기사 제목+설명을 하나의 프롬프트에 넣고 한 번에 요약
- **효과**: API 호출 1/3, 비용 절감, 속도 향상
- **임팩트**: 중간 / **난이도**: 중간

### 1-5. 뉴스 캐싱
- **현재**: 매 호출마다 Finnhub + NewsData.io 새로 호출
- **개선**: DynamoDB에 5~15분 TTL로 캐싱. 같은 키워드 연속 질문 시 API 절약
- **임팩트**: 중간 / **난이도**: 중간

---

## 2. Agent 동작 방식

### 2-1. Tool Description 개선
- **현재**: `'키워드 관련 최신 뉴스 RSS 수집 (최대 5건)'` — "RSS" 틀림, 설명 모호
- **개선**: 각 도구에 **언제 쓰는지** + **예시**를 명확하게
  - fetchNews: "사용자가 특정 종목이나 키워드의 뉴스를 원할 때 사용. 키워드는 영어와 한국어 모두 가능. 예: ["bitcoin", "BTC"]. 최대 5건의 최신 기사를 반환."
  - getCryptoPrice: "암호화폐 현재 시세 조회. 24시간 변동률, 고가, 저가, 거래량 포함. 예: symbol='BTC'"
- **임팩트**: 높음 / **난이도**: 낮음

### 2-2. Agent Instructions 구조화
- **현재**: 한 덩어리 텍스트로 규칙 나열
- **개선**: 역할/제약/출력포맷/도구사용법을 섹션으로 구분
  ```
  <role>한국어 금융 분석 봇</role>
  <constraints>도구를 예고 없이 즉시 호출</constraints>
  <output_format>Slack mrkdwn, 가격은 쉼표 포함, 변동은 emoji</output_format>
  <tools>각 도구별 사용 시나리오</tools>
  ```
- **임팩트**: 중간 / **난이도**: 낮음

### 2-3. 복합 질문 처리
- **현재**: "비트코인 시세와 뉴스 알려줘" → 도구 1개만 호출하는 경우 있음
- **개선**:
  - Instructions에 명시: "시세+뉴스 요청 시 두 도구 모두 호출"
  - 또는 compound tool `getAssetBriefing(symbol)` 추가 — 시세+뉴스+감성 한 번에 반환
- **임팩트**: 중간 / **난이도**: 중간

### 2-4. 에러 시 사용자 안내
- **현재**: 도구 실패 시 generic "오류 발생" 메시지
- **개선**: 도구 execute에서 에러를 사람 읽기 좋게 반환
  - "Alpha Vantage API 한도 초과로 주식 시세를 조회할 수 없습니다. 코인이나 환율은 조회 가능합니다."
- **임팩트**: 중간 / **난이도**: 낮음

---

## 3. 텍스트 파싱 / 한국어 처리

### 3-1. 한국어 별칭 대폭 확장
- **현재**: 12개 (삼성, 하이닉스, 비트코인, 이더리움, 도지코인, 리플, 솔라나, 에이다, 카카오, 네이버, LG에너지, 현대차)
- **개선**: 주요 코인 20개 + 한국 대형주 20개 + 미국 대형주 10개
  - "테슬라" → TSLA, "애플" → AAPL, "엔비디아" → NVDA
  - "삼성전자" → 005930 (부분 매칭: "삼성"도 "삼성전자"도 동일)
  - "바이낸스코인" → BNB, "폴카닷" → DOT
- **임팩트**: 중간 / **난이도**: 낮음

### 3-2. FX 한국어 매핑
- **현재**: "USDKRW" 또는 "USD/KRW"만 인식
- **개선**: "달러" → USD/KRW, "엔화" → JPY/KRW, "유로" → EUR/KRW
- **임팩트**: 중간 / **난이도**: 낮음

### 3-3. 자연어 의도 힌트
- **현재**: 에이전트에게 전적으로 의존
- **개선**: parser에서 간단한 intent 감지 → 에이전트에 힌트 전달
  - "시세", "가격", "얼마" → `[의도: 시세조회]`
  - "뉴스", "소식", "동향" → `[의도: 뉴스검색]`
- **임팩트**: 낮음 / **난이도**: 낮음

---

## 4. Slack UX 개선

### 4-1. 가격 포맷 — 통화 단위
- **현재**: `*BTC* 84,234 🔺 +1,234 (+1.5%)` — 단위 없음
- **개선**: 코인 `$`, 한국 주식 `₩`, 환율 `₩/$ 1,456.78`
- **임팩트**: 낮음 / **난이도**: 낮음

### 4-2. Section fields 레이아웃
- **현재**: 단일 텍스트 블록에 모든 정보
- **개선**: Section `fields` 2열 레이아웃 — 좌: 종목+가격, 우: 변동률
- **임팩트**: 낮음 / **난이도**: 낮음

### 4-3. 브리핑 구조 정리
```
📊 오전 브리핑 — 2026-03-18
━━━ 시세 ━━━
BTC  $84,234  🔺 +2.3%
ETH  $3,456   🔻 -0.8%
━━━ 뉴스 (3건) ━━━
[상승] Fed 금리 동결 시사...
[중립] 삼성전자 실적 발표...
━━━ AI 분석 ━━━
오늘 시장은...
```

### 4-4. 인터랙티브 버튼 (향후)
- 브리핑 하단에 "더 보기", "관심 종목 추가", "알림 설정" 버튼
- Slack `actions` 블록 활용 — 별도 interaction endpoint 필요

---

## 5. 비용 & 성능 최적화

### 5-1. 응답 캐싱
- `/summary` 결과를 5분간 캐싱 — 동일 명령 반복 시 GPT 호출 없이 반환
- `/brief BTC` 결과도 1분 캐싱
- DynamoDB TTL 활용

### 5-2. Briefing 실패 데이터 처리
- **현재**: 주식 API 실패하면 빈 결과가 분석에 전달
- **개선**: 성공 데이터만 분석에 넘기고, 누락 데이터 명시
  - "※ AAPL, TSLA 데이터는 API 한도 초과로 제외됨"

---

## 실행 우선순위

| 순위 | 항목 | 임팩트 | 난이도 |
|------|------|--------|--------|
| 1 | 뉴스 description 활용 + 요약 프롬프트 개선 (1-1) | 높음 | 낮음 |
| 2 | Tool description 개선 (2-1) | 높음 | 낮음 |
| 3 | 키워드 확장 alias map (1-2) | 높음 | 중간 |
| 4 | 뉴스 감성 태그 (1-3) | 중간 | 낮음 |
| 5 | 한국어 별칭 + FX 한국어 (3-1, 3-2) | 중간 | 낮음 |
| 6 | 뉴스 배치 요약 (1-4) | 중간 | 중간 |
| 7 | Agent instructions 구조화 (2-2) | 중간 | 낮음 |
| 8 | 뉴스 캐싱 (1-5) | 중간 | 중간 |
| 9 | Slack 가격 포맷 통화 단위 (4-1) | 낮음 | 낮음 |
| 10 | Compound tool 시세+뉴스 (2-3) | 중간 | 중간 |

---

## 참고 자료

- [OpenAI Agents SDK — Tools](https://openai.github.io/openai-agents-python/tools/)
- [Multi-Agent Portfolio Collaboration Cookbook](https://cookbook.openai.com/examples/agents_sdk/multi-agent-portfolio-collaboration/)
- [Personalized CoT Financial News Summarization](https://arxiv.org/html/2511.05508)
- [Slack Block Kit Table Block](https://docs.slack.dev/reference/block-kit/blocks/table-block/)
- [Finnhub API Docs](https://finnhub.io/docs/api/)
- [NewsData.io Rate Limit](https://newsdata.io/blog/newsdata-rate-limit/)
