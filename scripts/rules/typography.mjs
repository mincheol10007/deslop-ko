/**
 * 한글 조판 규칙 — deslop-ko의 오리지널.
 *
 * 이 네 개는 kill-ai-slop·impeccable·taste-skill·hallmark 어디에도 없다.
 * 영어권 규칙이라 존재할 이유가 없었을 뿐이다. Phase 0에서 두 스캐너 합계 228건 중
 * 한글 조판 지적이 0건이었던 게 근거다.
 *
 * 모든 규칙은 "오탐 조건"을 caveat로 함께 내보낸다. 원칙 ②: 오탐은 정탐보다 비싸다.
 * 한 번 틀리게 지적하면 사용자는 스캐너 전체를 안 믿는다.
 */

import { detectLang, isUpperLatin, isKoreanDocument } from '../lib/lang.mjs';
import { maxPx, toEm, toWeight } from '../lib/parse.mjs';

/** 라틴 글리프를 따로 설계하지 않은 한글 전용 폰트. 스택 맨 앞에 오면 영문·숫자까지 이 폰트가 그린다. */
const KOREAN_ONLY_FONTS = [
  'noto sans kr', 'noto serif kr', 'noto sans korean', 'noto sans k r',
  'nanum gothic', 'nanum myeongjo', 'nanumsquare', 'nanum barun gothic', 'nanumgothic',
  'malgun gothic', '맑은 고딕', 'apple sd gothic neo', 'applesdgothicneo',
  'spoqa han sans', 'spoqa han sans neo', 'ibm plex sans kr',
  'gmarket sans', 's-core dream', 'gothic a1', 'black han sans', 'do hyeon', 'jua',
  'batang', 'dotum', 'gulim', '굴림', '돋움', '바탕', '나눔고딕', '본고딕',
];

/** 한글과 라틴을 함께 설계한 폰트. 맨 앞에 와도 정상이다. */
const DUAL_SCRIPT_FONTS = [
  'pretendard', 'suit', 'wanted sans', 'freesentation', 'paperlogy', 'pretendard variable',
];

function firstFamily(value) {
  const first = value.split(',')[0] || '';
  return first.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/** 같은 CSS 선언을 여러 요소가 공유할 때 한 번만 보고한다. */
function originKey(origin) {
  return `${origin.file}:${origin.line}:${origin.selector}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 · word-break: keep-all 부재 — 문서 단위 판정
// ─────────────────────────────────────────────────────────────────────────────
function koWordBreak(ctx) {
  if (!isKoreanDocument(ctx.allVisibleText)) return [];

  const hasKeepAll = ctx.cssRules.some((r) => {
    const wb = (r.decls['word-break'] || '').toLowerCase();
    const ow = (r.decls['overflow-wrap'] || '').toLowerCase();
    return wb.includes('keep-all') || ow.includes('break-word');
  });
  if (hasKeepAll) return [];

  const target = ctx.cssFiles[0];
  if (!target) return [];

  return [{
    rule: 'ko-word-break',
    axis: '한글 조판',
    tier: 'classic',
    stage: 1,
    title: 'word-break: keep-all 이 없습니다',
    why: '한국어는 이게 없으면 어절 한가운데서 줄이 끊깁니다 — "가장 빠른 방 / 법". 라틴 문자는 단어 단위로 끊기니 영어권 규칙에는 이 항목이 아예 없습니다.',
    fix: '본문 컨테이너나 body에 word-break: keep-all 을 주고, 긴 URL이 깨질 자리에만 overflow-wrap: anywhere 를 따로 붙입니다.',
    caveat: '한글이 거의 없는 페이지라면 넘어가도 됩니다.',
    file: target,
    line: null,
    selector: null,
  }];
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 · 한글 전용 폰트가 스택 맨 앞
// ─────────────────────────────────────────────────────────────────────────────
function koFontOrder(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    const value = rule.decls['font-family'] || rule.decls['font'];
    if (!value) continue;

    const first = firstFamily(value);
    if (!first) continue;
    if (DUAL_SCRIPT_FONTS.some((f) => first.includes(f))) continue;
    if (!KOREAN_ONLY_FONTS.some((f) => first.includes(f))) continue;

    findings.push({
      rule: 'ko-font-order',
      axis: '한글 조판',
      tier: 'classic',
      stage: 1,
      title: '한글 전용 폰트가 스택 맨 앞이라 영문·숫자까지 그립니다',
      why: '한글용으로 설계된 폰트를 맨 앞에 두면 영문과 숫자도 그 폰트의 라틴 글리프로 렌더됩니다. 라틴 전용 폰트보다 자간과 형태가 거칠어서, 큰 숫자를 쓰는 통계 섹션에서 특히 티가 납니다.',
      fix: '한글·라틴을 함께 설계한 Pretendard·SUIT 계열로 바꾸는 것이 가장 깔끔합니다. 라틴 폰트를 앞에 세우는 방법도 있지만, 그 자리에 Inter나 Arial을 넣으면 이번에는 default-font 에 걸립니다. 두 규칙을 같이 보세요.',
      caveat: '한글만 나오는 페이지이거나 이 폰트의 라틴 글리프를 의도적으로 고른 것이면 정상입니다.',
      detail: value.length > 60 ? value.slice(0, 60) + '…' : value,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 · 한글 제목의 행간이 너무 좁음
// ─────────────────────────────────────────────────────────────────────────────
const KO_HEADLINE_MIN_LINE_HEIGHT = 1.25;
const HEADLINE_MIN_PX = 24;

function koLineHeight(ctx) {
  const findings = [];
  const reported = new Set();

  for (const el of ctx.elements) {
    if (detectLang(el.text) !== 'ko') continue;

    const lhDecl = el.decls['line-height'];
    if (!lhDecl) continue;
    const lh = toEm(lhDecl.value);
    if (lh === null || lh <= 0 || lh >= KO_HEADLINE_MIN_LINE_HEIGHT) continue;

    // 제목 크기일 때만 본다. 작은 글씨는 행간이 좁아도 받침이 닿지 않는다.
    const sizeDecl = el.decls['font-size'];
    const size = maxPx(sizeDecl?.value);
    if (size === null || size < HEADLINE_MIN_PX) continue;

    const key = originKey(lhDecl);
    if (reported.has(key)) continue;
    reported.add(key);

    findings.push({
      rule: 'ko-line-height',
      axis: '한글 조판',
      tier: 'classic',
      stage: 1,
      title: '한글 제목의 행간이 좁습니다',
      why: `한글은 받침 때문에 라틴보다 글자의 시각적 높이가 큽니다. ${KO_HEADLINE_MIN_LINE_HEIGHT} 아래는 라틴 헤드라인에서는 단단해 보이지만 한글에서는 받침이 윗줄에 닿습니다. 제목이 두 줄이 되는 순간 드러납니다.`,
      fix: `한글 제목은 ${KO_HEADLINE_MIN_LINE_HEIGHT} 이상으로 둡니다. 굵을수록 더 필요합니다.`,
      caveat: '한 줄로만 쓰이는 제목이면 행간이 드러나지 않으니 넘어가도 됩니다.',
      detail: `line-height: ${lhDecl.value}`,
      sample: el.text.slice(0, 24),
      file: lhDecl.file,
      line: lhDecl.line,
      selector: lhDecl.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// T4 · 언어에 따라 자간 판정이 뒤집힌다 — Phase 0의 핵심 발견
// ─────────────────────────────────────────────────────────────────────────────
const BOLD_THRESHOLD = 700;
const TRACKING_MIN_PX = 24;

function koLetterSpacing(ctx) {
  const findings = [];
  const reported = new Set();

  for (const el of ctx.elements) {
    if (detectLang(el.text) !== 'ko') continue;
    if (isUpperLatin(el.text)) continue;

    const lsDecl = el.decls['letter-spacing'];
    if (!lsDecl) continue;
    const ls = toEm(lsDecl.value);
    if (ls === null || ls <= 0) continue;

    // 굵을 때만. 얇은 한글에 자간을 조금 벌리는 건 정상이다.
    const weight = toWeight(el.decls['font-weight']?.value);
    if (weight === null || weight < BOLD_THRESHOLD) continue;

    // 큰 글씨만. 작은 한글 eyebrow에 자간을 넓히는 건 국내에서 통용되는 관행이다.
    const sizeDecl = el.decls['font-size'];
    const size = maxPx(sizeDecl?.value);
    if (size === null || size < TRACKING_MIN_PX) continue;

    const key = originKey(lsDecl);
    if (reported.has(key)) continue;
    reported.add(key);

    findings.push({
      rule: 'ko-letter-spacing',
      axis: '한글 조판',
      tier: 'classic',
      stage: 1,
      title: '한글 굵은 제목에 양수 자간',
      why: '한글 굵은 고딕은 글자 자체가 이미 꽉 차 있어서 자간을 벌리면 낱글자가 흩어져 보입니다. 국내 관행은 -0.02em ~ -0.04em 입니다. 같은 양수 자간이 라틴 대문자에서는 정석이라 CSS만 보고는 구분할 수 없습니다.',
      fix: '한글 제목의 자간을 0 이하로 내립니다. 굵을수록 더 조입니다.',
      caveat: '워드마크나 로고타입처럼 의도적으로 벌린 것이면 deslop-ko-ignore 로 면제하세요.',
      detail: `letter-spacing: ${lsDecl.value} · weight ${el.decls['font-weight'].value}`,
      sample: el.text.slice(0, 24),
      file: lsDecl.file,
      line: lsDecl.line,
      selector: lsDecl.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// T5 · 글자 분해 애니메이션이 word-break: keep-all 을 무력화한다
//
// 실측에서 나온 규칙이다. gpters-landing에 keep-all 을 제대로 넣었는데도 한글이
// 여전히 어절 중간에서 끊겼다. computed style은 keep-all 이 맞았다. 원인은 JS였다 —
// 글자 마스크 애니메이션이 각 글자를 inline-block span으로 쪼개면서 keep-all 이
// 적용될 텍스트 노드가 남지 않았고, 브라우저는 박스 사이 아무 데서나 줄을 바꿨다.
//
// "CSS를 고쳤는데 안 고쳐지는" 경우라 이 규칙이 없으면 사용자가 원인을 못 찾는다.
// ─────────────────────────────────────────────────────────────────────────────
const SPLIT_SELECTOR = /(char|letter|glyph|grapheme|split)/i;

function koSplitWordBreak(ctx) {
  if (!isKoreanDocument(ctx.allVisibleText)) return [];

  const splitter = ctx.cssRules.find(
    (r) => SPLIT_SELECTOR.test(r.selector) && (r.decls['display'] || '').includes('inline-block')
  );
  if (!splitter) return [];

  // 어절 래퍼가 이미 있으면 해결된 상태다.
  // 두 속성이 같은 규칙에 있어야 한다 — 마퀴처럼 nowrap만 쓰는 곳과 구분해야 하기 때문이다.
  const hasWordWrapper = ctx.cssRules.some(
    (r) =>
      (r.decls['white-space'] || '').includes('nowrap') &&
      (r.decls['display'] || '').includes('inline-block')
  );
  if (hasWordWrapper) return [];

  return [{
    rule: 'ko-split-word-break',
    axis: '한글 조판',
    tier: 'evolved',
    stage: 1,
    title: '글자 분해 애니메이션이 어절 줄바꿈을 무너뜨립니다',
    why: '글자를 낱개 inline-block으로 쪼개면 word-break: keep-all 이 적용될 텍스트 노드가 남지 않습니다. CSS를 제대로 넣어도 한글이 어절 한가운데서 끊깁니다. computed style은 정상으로 보이기 때문에 원인을 찾기 어렵습니다.',
    fix: '분해한 글자를 어절 단위로 한 번 더 감싸고, 그 래퍼에 display: inline-block 과 white-space: nowrap 을 줍니다. 줄바꿈 기회는 어절 사이 공백에만 남깁니다.',
    caveat: '한 줄로만 쓰이거나 줄바꿈이 없는 짧은 제목이면 문제되지 않습니다.',
    detail: `display: inline-block`,
    file: splitter.file,
    line: splitter.line,
    selector: splitter.selector,
  }];
}

export const rules = [koWordBreak, koFontOrder, koLineHeight, koLetterSpacing, koSplitWordBreak];

export const RULE_IDS = [
  'ko-word-break', 'ko-font-order', 'ko-line-height', 'ko-letter-spacing', 'ko-split-word-break',
];
