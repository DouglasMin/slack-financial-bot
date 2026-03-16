import crypto from 'crypto';

/**
 * Slack 요청 서명 검증
 * - 타임스탬프가 5분 이내인지 확인
 * - HMAC SHA256으로 서명을 계산하여 비교
 * - 타이밍 공격 방지를 위해 timingSafeEqual 사용
 *
 * @param {object} headers - 요청 헤더 (x-slack-request-timestamp, x-slack-signature)
 * @param {string} rawBody - 요청 원본 바디
 * @returns {boolean} 검증 성공 여부
 */
export function verifySlackSignature(headers, rawBody) {
  try {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      console.error('SLACK_SIGNING_SECRET 환경 변수가 설정되지 않았습니다.');
      return false;
    }

    const timestamp = headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];
    const slackSignature = headers['x-slack-signature'] || headers['X-Slack-Signature'];

    if (!timestamp || !slackSignature) {
      return false;
    }

    // 타임스탬프가 5분(300초) 이내인지 확인 (리플레이 공격 방지)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      return false;
    }

    // HMAC SHA256 서명 계산
    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(sigBasestring);
    const computedSignature = `v0=${hmac.digest('hex')}`;

    // 타이밍 안전 비교
    if (computedSignature.length !== slackSignature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'utf-8'),
      Buffer.from(slackSignature, 'utf-8'),
    );
  } catch (error) {
    console.error('Slack 서명 검증 중 오류 발생:', error);
    return false;
  }
}
