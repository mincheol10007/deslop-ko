/**
 * 색 파싱과 WCAG 대비 계산. 의존성 없음.
 *
 * 저대비는 취향이 아니라 측정값이라 규칙으로 삼기 좋다. Phase 0에서 impeccable이
 * 지피터스 랜딩에서 40건을 잡았고 그중 다수가 브랜드 오렌지 위 흰 글씨(3.5:1)였다.
 * 이건 디자인 토큰 레벨의 문제라 페이지마다 고칠 게 아니라 한 번에 고쳐야 한다.
 */

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], transparent: [0, 0, 0, 0],
};

/** @returns {{r:number,g:number,b:number,a:number}|null} 판정할 수 없으면 null */
export function parseColor(input) {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();

  if (NAMED[value]) {
    const [r, g, b, a = 1] = NAMED[value];
    return { r, g, b, a };
  }

  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1
      : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100
      : parseFloat(rgb[4]);
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: Number.isNaN(alpha) ? 1 : alpha };
  }

  return null;
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 대비율. 1:1 ~ 21:1 */
export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 무채색인가 — 그림자가 색을 띠는지 판정할 때 쓴다. */
export function isNeutral({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 16;
}

/** :root 등에서 선언한 CSS 커스텀 프로퍼티를 모은다. */
export function collectVars(cssRules) {
  const vars = new Map();
  for (const rule of cssRules) {
    for (const [prop, value] of Object.entries(rule.decls)) {
      if (prop.startsWith('--')) vars.set(prop, value);
    }
  }
  return vars;
}

/** var(--x) 를 실제 값으로 편다. 순환 참조는 깊이 제한으로 막는다. */
export function resolveVar(value, vars, depth = 0) {
  if (!value || depth > 8 || !value.includes('var(')) return value;
  const replaced = value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) =>
    vars.get(name) ?? fallback ?? ''
  );
  return replaced === value ? value : resolveVar(replaced, vars, depth + 1);
}

/** box-shadow / gradient 문자열에서 색 토큰을 뽑는다. */
export function extractColors(value) {
  if (!value) return [];
  const found = [];
  for (const m of value.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const c = parseColor(m[0]);
    if (c) found.push(c);
  }
  return found;
}
