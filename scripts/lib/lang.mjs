/**
 * 텍스트의 언어를 판별한다.
 *
 * deslop-ko 전체가 이 파일 위에 서 있다. Phase 0 실측에서 확인한 핵심 사실:
 * 같은 CSS 속성이라도 적용되는 텍스트가 한글이냐 라틴이냐에 따라 판정이 정반대다.
 *
 *   .hero__title       letter-spacing: -0.03em  "AI를 배우는 가장 빠른 방법"  → 정상
 *   .hero__title--brand letter-spacing:  0.02em  "GPTERS"                    → 정상
 *
 * 한글 굵은 고딕은 음수 자간이 정석이고, 라틴 대문자는 양수 자간이 정석이다.
 * CSS만 봐서는 어느 쪽인지 알 수 없다.
 */

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/g;
const LATIN = /[A-Za-z]/g;

/**
 * @returns {'ko'|'latin'|'neutral'} neutral = 숫자·기호뿐이라 판정할 근거가 없음
 */
export function detectLang(text) {
  if (!text) return 'neutral';
  const hangul = (text.match(HANGUL) || []).length;
  const latin = (text.match(LATIN) || []).length;

  // 근거가 없으면 판정하지 않는다. 원칙 ②: 오탐은 정탐보다 비싸다.
  if (hangul === 0 && latin === 0) return 'neutral';
  if (hangul === 0) return 'latin';
  if (latin === 0) return 'ko';

  // 섞여 있으면 다수결. "AI를 배우는 가장 빠른 방법"은 라틴 2자를 포함해도 한글이다.
  return hangul >= latin ? 'ko' : 'latin';
}

/** 라틴 대문자 위주인가 — 대문자에는 양수 자간이 정석이라 예외 처리에 쓴다. */
export function isUpperLatin(text) {
  const latin = text.match(LATIN) || [];
  if (latin.length < 2) return false;
  const upper = latin.filter((c) => c === c.toUpperCase()).length;
  return upper / latin.length >= 0.8;
}

/**
 * 여러 텍스트 표본에서 대표 언어를 뽑는다.
 * 한 선택자가 여러 요소에 붙어 있을 때 쓴다.
 */
export function dominantLang(texts) {
  const tally = { ko: 0, latin: 0, neutral: 0 };
  for (const t of texts) tally[detectLang(t)] += t.length;
  if (tally.ko === 0 && tally.latin === 0) return 'neutral';
  return tally.ko >= tally.latin ? 'ko' : 'latin';
}

/** 문서 전체가 한국어인가 — word-break 같은 문서 단위 규칙의 전제 조건. */
export function isKoreanDocument(text) {
  const hangul = (text.match(HANGUL) || []).length;
  // 한글이 30자 미만이면 한국어 페이지로 보지 않는다.
  // 영문 사이트에 한글 한 줄이 섞였다고 조판 규칙을 들이대면 오탐이다.
  return hangul >= 30;
}
