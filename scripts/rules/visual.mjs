/**
 * 시각 슬롭 규칙.
 *
 * 우선순위는 Phase 0 실측에서 나왔다. kill-ai-slop과 impeccable을 같은 사이트에
 * 독립적으로 돌렸을 때 **둘 다 잡은 것**을 Classic 티어로 승계했다. 두 도구가
 * 서로를 모르고 같은 결론에 도달했다면 그건 취향이 아니라 합의다.
 *
 * 규칙 텍스트는 베끼지 않았다. 같은 문제를 한국어로 다시 썼고, 한국 맥락에서만
 * 나오는 변종(플랫폼 브랜드 컬러 차용)을 더했다.
 *
 * 주의: 이 축은 언어를 가리지 않는다. 한글 조판 규칙과 달리 한국어 페이지가
 * 아니어도 성립한다.
 */

import { parseColor, contrastRatio, isNeutral, resolveVar, extractColors } from '../lib/color.mjs';
import { maxPx, toWeight } from '../lib/parse.mjs';

const AXIS = '시각 슬롭';

/** 상태 표시용 선택자. 여기 붙은 색은 장식이 아니라 정보다. */
const STATE_SELECTOR = /:(focus|focus-visible|focus-within|active|checked|invalid)\b|\.focus-visible/i;

/** 화면을 덮는 레이어. 그림자가 커도 성립한다. */
const OVERLAY_SELECTOR = /dialog|modal|overlay|popup|popover|drawer|sheet|tooltip|dropdown|lightbox/i;

/**
 * 눈에 띄게 색을 띠는가.
 *
 * 임계값을 16으로 잡았다가 오늘의집에서 rgba(68,87,101,.1) 같은 쿨그레이 그림자를
 * 글로우로 지적했다. 실무에서 흔히 쓰는 살짝 푸른 회색이라 오탐이다.
 * 파란 버튼 그림자 rgba(15,122,199,.26) 은 채널 차이가 184다 — 둘은 확실히 갈린다.
 */
const COLORFUL_MIN = 60;

function isColorful({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b) >= COLORFUL_MIN;
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 · 그라디언트로 채운 글자
// ─────────────────────────────────────────────────────────────────────────────
function gradientText(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    const clip = rule.decls['background-clip'] || rule.decls['-webkit-background-clip'];
    if (!clip || !clip.includes('text')) continue;

    const bg = resolveVar(rule.decls['background'] || rule.decls['background-image'] || '', ctx.vars);
    if (!bg.includes('gradient')) continue;

    findings.push({
      rule: 'gradient-text',
      axis: AXIS,
      tier: 'classic',
      stage: 1,
      title: '글자를 그라디언트로 채웠습니다',
      why: 'AI가 만든 페이지의 가장 흔한 표식입니다. 대비를 예측할 수 없게 만들고, 읽는 사람이 얻는 정보는 하나도 늘지 않습니다. 장식이 메시지를 먹습니다.',
      fix: '제목은 단색으로 두고 위계는 크기·굵기·여백으로 만듭니다. 그라디언트를 꼭 써야 한다면 글자가 아니라 면에 씁니다.',
      caveat: '워드마크 한 곳에만 쓴 것이라면 의도로 볼 수 있습니다.',
      detail: bg.length > 54 ? bg.slice(0, 54) + '…' : bg,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 · 색을 띠는 그림자 (글로우)
// ─────────────────────────────────────────────────────────────────────────────
function glowShadow(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    // 포커스 링은 상태를 알리는 것이지 장식이 아니다. 접근성상 색이 있어야 한다.
    if (STATE_SELECTOR.test(rule.selector)) continue;

    const raw = rule.decls['box-shadow'];
    if (!raw || raw === 'none') continue;
    const value = resolveVar(raw, ctx.vars);

    // 번짐 없이 퍼지기만 하는 그림자(0 0 0 3px)는 링이다.
    if (maxShadowBlur(value) === 0) continue;

    const colored = extractColors(value).filter((c) => c.a > 0.05 && isColorful(c));
    if (colored.length === 0) continue;

    findings.push({
      rule: 'glow-shadow',
      axis: AXIS,
      tier: 'classic',
      stage: 1,
      title: '그림자에 색을 넣었습니다',
      why: '실제 그림자는 빛을 가려서 생기므로 색이 없습니다. 색을 띤 그림자는 물체가 스스로 빛난다는 뜻인데, 대부분 그럴 이유가 없습니다. 어두운 배경에서 "고급스러워 보이려고" 넣는 기본 동작입니다.',
      fix: '그림자는 무채색으로 낮은 투명도만 씁니다. 강조가 필요하면 테두리 한 줄이나 배경 대비로 해결합니다.',
      caveat: '포커스 링처럼 상태를 알리는 용도라면 정당합니다.',
      detail: value.length > 54 ? value.slice(0, 54) + '…' : value,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V3 · 요소보다 큰 그림자
// ─────────────────────────────────────────────────────────────────────────────
const SHADOW_BLUR_MAX = 40;

/**
 * box-shadow 에서 가장 큰 번짐 값을 뽑는다.
 *
 * `0 20px 60px rgba(...)` 의 첫 값처럼 단위 없는 0이 섞이므로 px만 세면 자리가 밀린다.
 * 색 함수 안의 숫자도 길이로 오인하면 안 되니 먼저 걷어낸다.
 * 그림자는 쉼표로 여러 개 겹칠 수 있어 각각 보고 최댓값을 쓴다.
 */
export function maxShadowBlur(value) {
  const layers = value.replace(/rgba?\([^)]*\)/g, ' ').replace(/#[0-9a-fA-F]{3,8}/g, ' ').split(',');
  let max = null;
  for (const layer of layers) {
    const lengths = [...layer.matchAll(/(-?[\d.]+)(px|rem|em)?/g)].map((m) => {
      const n = parseFloat(m[1]);
      return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
    });
    const blur = lengths[2]; // x, y, blur 순
    if (blur === undefined || Number.isNaN(blur)) continue;
    if (max === null || blur > max) max = blur;
  }
  return max;
}

function oversizedShadow(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    // 모달·툴팁처럼 떠 있는 레이어는 그림자가 커야 떠 보인다.
    if (OVERLAY_SELECTOR.test(rule.selector) || STATE_SELECTOR.test(rule.selector)) continue;

    const raw = rule.decls['box-shadow'];
    if (!raw || raw === 'none') continue;
    const value = resolveVar(raw, ctx.vars);

    const blur = maxShadowBlur(value);
    if (blur === null || blur < SHADOW_BLUR_MAX) continue;

    findings.push({
      rule: 'oversized-shadow',
      axis: AXIS,
      tier: 'classic',
      stage: 1,
      title: `그림자 번짐이 ${blur}px 입니다`,
      why: '카드보다 큰 그림자는 물리적으로 성립하지 않습니다. 요소가 공중에 떠 있는 것처럼 보이게 만드는 손쉬운 수법이라 AI가 자주 씁니다. 여러 카드에 같이 걸리면 화면 전체가 흐릿해집니다.',
      fix: '번짐을 요소 높이보다 작게 잡습니다. 대개 8~24px이면 충분하고, 깊이는 그림자보다 배경 대비로 만드는 편이 낫습니다.',
      caveat: '모달 뒤 오버레이처럼 화면 전체를 덮는 용도라면 클 수 있습니다.',
      detail: value.length > 54 ? value.slice(0, 54) + '…' : value,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V4 · 글래스모피즘
// ─────────────────────────────────────────────────────────────────────────────
function glassmorphism(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    const blur = rule.decls['backdrop-filter'] || rule.decls['-webkit-backdrop-filter'];
    if (!blur || !blur.includes('blur')) continue;

    findings.push({
      rule: 'glassmorphism',
      axis: AXIS,
      tier: 'classic',
      stage: 1,
      title: '반투명 유리 표면입니다',
      why: '2020년 전후에 굳은 기본값이라 지금은 시대를 드러냅니다. 뒤에 무엇이 오느냐에 따라 대비가 매번 달라져서 글자 가독성을 보장할 수 없습니다.',
      fix: '불투명한 배경 한 가지를 정하고 테두리 한 줄로 경계를 만듭니다. 스크롤 시 배경이 필요하면 색을 바꾸는 편이 안전합니다.',
      caveat: '고정 네비게이션 한 곳에만 쓴 것이라면 관행으로 볼 수 있습니다.',
      detail: blur,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V5 · 기본 폰트
//
// 우리가 만든 문제이기도 하다. ko-font-order 를 고치면서 라틴 폰트를 앞에 두라고
// 했더니 Inter를 골랐고, Inter는 네 도구가 공통으로 지목하는 AI 기본값이다.
// 두 규칙이 함께 읽혀야 한다 — 라틴 폰트를 앞에, 단 아무거나는 아니게.
// ─────────────────────────────────────────────────────────────────────────────
const OVERUSED_FONTS = [
  'inter', 'arial', 'helvetica', 'helvetica neue', 'roboto', 'segoe ui',
  'system-ui', '-apple-system', 'sans-serif', 'open sans',
];

function defaultFont(ctx) {
  const findings = [];
  const seen = new Set();

  for (const rule of ctx.cssRules) {
    if (!/^(body|html|:root|\*)$/.test(rule.selector.trim())) continue;
    const value = resolveVar(rule.decls['font-family'] || '', ctx.vars);
    if (!value) continue;

    const first = (value.split(',')[0] || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!OVERUSED_FONTS.includes(first)) continue;
    if (seen.has(first)) continue;
    seen.add(first);

    findings.push({
      rule: 'default-font',
      axis: AXIS,
      tier: 'evolved',
      stage: 1,
      title: '본문 서체가 기본값입니다',
      why: `"${first}" 는 아무도 고르지 않았을 때 나오는 서체입니다. 특히 Inter는 AI가 만든 화면의 표식으로 굳었습니다. 서체는 페이지에서 가장 많은 면적을 차지하는 요소라 여기서 결정을 안 하면 나머지를 아무리 다듬어도 티가 납니다.`,
      fix: '왜 이 서체인지 한 문장으로 말할 수 있는 것을 고릅니다. 한글 페이지라면 한글·라틴을 함께 설계한 Pretendard·SUIT 계열이 폰트 순서 문제까지 같이 풉니다.',
      caveat: '브랜드 가이드가 이 서체를 지정했다면 정상입니다.',
      detail: value.length > 54 ? value.slice(0, 54) + '…' : value,
      file: rule.file,
      line: rule.line,
      selector: rule.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V6 · WCAG 대비 미달
// ─────────────────────────────────────────────────────────────────────────────
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;

function lowContrast(ctx) {
  const findings = [];
  const reported = new Set();

  for (const el of ctx.elements) {
    if (!el.text || el.text.length < 2) continue;

    const fgDecl = el.decls['color'];
    const bgDecl = el.decls['background-color'] || el.decls['background'];
    if (!fgDecl || !bgDecl) continue;

    // 두 색이 같은 선언 블록에서 와야 한다.
    // 선택자 매칭이 조상 조건을 무시하므로(.a .b 의 .a 를 안 봄) 서로 다른 블록에서
    // 온 색을 짝지으면 실제로는 만나지 않는 조합이 나온다. 오늘의집에서 1.0:1 이
    // 세 건 나왔는데 전부 그 탓이었다.
    if (fgDecl.selector !== bgDecl.selector || fgDecl.line !== bgDecl.line) continue;

    const fg = parseColor(resolveVar(fgDecl.value, ctx.vars));
    const bgValue = resolveVar(bgDecl.value, ctx.vars);
    if (bgValue.includes('gradient') || bgValue.includes('url(')) continue;
    const bg = parseColor(bgValue.split(/\s+/)[0]);
    // 반투명은 뒤에 무엇이 오는지 알 수 없다. 근거가 없으면 판정하지 않는다.
    if (!fg || !bg || fg.a < 0.95 || bg.a < 0.95) continue;

    const size = maxPx(el.decls['font-size']?.value) ?? 16;
    const weight = toWeight(el.decls['font-weight']?.value) ?? 400;
    const isLarge = size >= LARGE_PX || (weight >= 700 && size >= LARGE_BOLD_PX);
    const required = isLarge ? AA_LARGE : AA_NORMAL;

    const ratio = contrastRatio(fg, bg);
    if (ratio >= required) continue;

    const key = `${fgDecl.selector}|${bgDecl.selector}`;
    if (reported.has(key)) continue;
    reported.add(key);

    findings.push({
      rule: 'low-contrast',
      axis: AXIS,
      tier: 'classic',
      stage: 1,
      title: 'WCAG AA 대비에 미달합니다',
      why: `${ratio.toFixed(1)}:1 인데 ${required}:1 이 필요합니다. 취향 문제가 아니라 측정값입니다. 브랜드 색 위에 흰 글씨를 얹는 조합에서 자주 나오고, 밝은 화면이나 시력이 약한 사람에게는 글자가 사라집니다.`,
      fix: '글자색이나 배경색 하나를 조정합니다. 브랜드 색이 원인이면 페이지마다 고치지 말고 디자인 토큰에서 한 번에 바꿉니다.',
      caveat: '장식용 글자이거나 뒤에 다른 배경이 겹치는 구조라면 실제 대비는 다를 수 있습니다.',
      detail: `${ratio.toFixed(1)}:1 (필요 ${required}:1)`,
      sample: el.text.slice(0, 20),
      file: fgDecl.file,
      line: fgDecl.line,
      selector: fgDecl.selector,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// V7 · 한국 플랫폼 브랜드 컬러 차용 — 이 축의 한국 오리지널
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORM_COLORS = {
  '#fee500': '카카오',
  '#03c75a': '네이버',
  '#3182f6': '토스',
  '#ff6f0f': '당근',
  '#2ac1bc': '배달의민족',
  '#0064ff': '토스',
};

function borrowedBrandColor(ctx) {
  const findings = [];
  for (const rule of ctx.cssRules) {
    for (const [prop, value] of Object.entries(rule.decls)) {
      if (!prop.startsWith('--')) continue;
      const hex = value.trim().toLowerCase();
      const owner = PLATFORM_COLORS[hex];
      if (!owner) continue;
      // 실제 소셜 로그인 버튼용 토큰이면 정당하다.
      if (/kakao|naver|toss|karrot|baemin|카카오|네이버|토스/i.test(prop)) continue;

      findings.push({
        rule: 'borrowed-brand-color',
        axis: AXIS,
        tier: 'evolved',
        stage: 1,
        title: '국내 플랫폼의 브랜드 색을 토큰으로 썼습니다',
        why: `${hex} 는 ${owner}의 브랜드 색입니다. 한국 사용자는 이 색을 그 서비스로 인식하기 때문에, 브랜드 토큰으로 쓰면 남의 정체성을 빌려 입은 것처럼 보입니다. AI에게 "친근한 한국 서비스 느낌"을 시키면 나오는 결과입니다.`,
        fix: '브랜드 색을 직접 정합니다. 이 색을 꼭 써야 한다면 소셜 로그인 버튼처럼 그 서비스를 가리키는 자리에만 씁니다.',
        caveat: '우연히 같은 색을 고른 것일 수 있습니다. 의도한 것이면 면제하세요.',
        detail: `${prop}: ${hex}`,
        file: rule.file,
        line: rule.line,
        selector: rule.selector,
      });
    }
  }
  return findings;
}

export const rules = [
  gradientText, glowShadow, oversizedShadow, glassmorphism,
  defaultFont, lowContrast, borrowedBrandColor,
];

export const RULE_IDS = [
  'gradient-text', 'glow-shadow', 'oversized-shadow', 'glassmorphism',
  'default-font', 'low-contrast', 'borrowed-brand-color',
];
