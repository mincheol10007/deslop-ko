/**
 * 의존성 없는 경량 CSS/HTML 파서.
 *
 * 완전한 파서가 아니다. 목적은 하나 — "이 CSS 선언이 적용되는 실제 텍스트는 무엇인가"를
 * 알아내는 것. 그 이상은 --deep(브라우저) 경로가 맡는다.
 *
 * 주석 처리가 중요하다. Phase 0에서 kill-ai-slop이 CSS 주석
 * `/* 시안 5 — 듀오톤 대각 (오렌지 ↔ 딥 플럼) *​/` 의 화살표를 이모지로 잡았다.
 * 주석은 사용자에게 보이지 않으므로 카피가 아니다.
 */

/** 주석을 공백으로 치환한다. 지우지 않고 치환하는 이유는 줄 번호를 보존하기 위해서다. */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

export function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * CSS를 규칙 단위로 쪼갠다. @media 등 at-rule은 껍데기만 벗기고 내부 규칙을 살린다.
 * @returns {Array<{selector: string, decls: Object, line: number}>}
 */
export function parseCssRules(cssRaw) {
  const css = stripCssComments(cssRaw);
  const rules = [];
  const stack = [];
  let buf = '';

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const selector = buf.trim();
      stack.push({ selector, bodyStart: i + 1, isAtRule: selector.startsWith('@') });
      buf = '';
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame && !frame.isAtRule && frame.selector) {
        rules.push({
          selector: frame.selector,
          decls: parseDecls(css.slice(frame.bodyStart, i)),
          line: lineAt(css, frame.bodyStart),
        });
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return rules;
}

export function parseDecls(body) {
  const decls = {};
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (prop && value) decls[prop] = value;
  }
  return decls;
}

/**
 * 선택자에서 HTML 매칭에 쓸 키를 뽑는다.
 * `.card:hover .card__title` -> ['.card__title']  (마지막 대상만)
 * `h1, h2`                   -> ['h1', 'h2']
 */
export function selectorKeys(selector) {
  const keys = new Set();
  for (const part of selector.split(',')) {
    const withoutPseudo = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, ' ');
    const target = withoutPseudo.split(/[\s>+~]+/).filter(Boolean).pop();
    if (!target) continue;

    const classes = target.match(/\.[A-Za-z0-9_-]+/g);
    if (classes) {
      classes.forEach((c) => keys.add(c));
      continue;
    }
    const tag = target.match(/^[a-zA-Z][a-zA-Z0-9]*/);
    if (tag) keys.add(tag[0].toLowerCase());
  }
  return [...keys];
}

const VOID_TAGS = new Set([
  'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'area',
  'base', 'col', 'embed', 'param', 'track', 'wbr',
]);

/** 여는 태그 위치에서 짝이 맞는 닫는 태그까지의 내용을 잘라낸다. 같은 태그 중첩을 센다. */
function innerOf(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === '/') {
      if (--depth === 0) return html.slice(from, m.index);
    } else if (!VOID_TAGS.has(tag)) {
      depth++;
    }
  }
  return null;
}

function cleanText(inner) {
  return inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#\d+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_SAMPLE = 400;

/**
 * HTML을 요소 목록으로 편다.
 *
 * 요소 단위여야 하는 이유: BEM 수식자가 흔하다.
 *   .hero__title        { font-weight: 900; letter-spacing: -0.03em }
 *   .hero__title--brand { letter-spacing: 0.02em }
 * 두 번째 블록만 보면 font-weight를 알 수 없다. 같은 요소에 붙는 규칙을 합쳐야
 * "굵은 한글에 양수 자간"인지 판정할 수 있다.
 *
 * @returns {Array<{tag: string, classes: string[], id: string|null, text: string}>}
 */
export function extractElements(htmlRaw) {
  const html = stripHtmlComments(htmlRaw).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const elements = [];
  const openRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

  let match;
  while ((match = openRe.exec(html))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    if (VOID_TAGS.has(tag) || attrs.trimEnd().endsWith('/')) continue;

    // lastIndex를 여는 태그 바로 뒤에 둔 채로 진행한다 -> 자식 요소도 빠짐없이 순회한다.
    const inner = innerOf(html, tag, openRe.lastIndex);
    if (inner === null) continue;

    const text = cleanText(inner);
    if (!text) continue;

    const classAttr = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
    const idAttr = attrs.match(/id\s*=\s*["']([^"']*)["']/i);
    elements.push({
      tag,
      classes: classAttr ? classAttr[1].split(/\s+/).filter(Boolean) : [],
      id: idAttr ? idAttr[1] : null,
      text: text.length > MAX_SAMPLE ? text.slice(0, MAX_SAMPLE) : text,
    });
  }
  return elements;
}

/**
 * 선택자의 마지막 대상부가 이 요소에 붙는가.
 * 조상 조건(`.a .b`의 `.a`)은 보지 않는다 — 정적 분석의 한계이자 의도된 단순화다.
 * 그만큼 넓게 잡히므로 규칙 쪽에서 조건을 좁게 건다.
 */
export function selectorMatches(selector, element) {
  for (const part of selector.split(',')) {
    const withoutPseudo = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, ' ');
    const target = withoutPseudo.split(/[\s>+~]+/).filter(Boolean).pop();
    if (!target) continue;
    if (target === '*') return true;

    const tag = target.match(/^[a-zA-Z][a-zA-Z0-9]*/);
    if (tag && element.tag !== tag[0].toLowerCase()) continue;

    const id = target.match(/#([A-Za-z0-9_-]+)/);
    if (id && element.id !== id[1]) continue;

    const classes = target.match(/\.[A-Za-z0-9_-]+/g) || [];
    if (classes.some((c) => !element.classes.includes(c.slice(1)))) continue;

    if (!tag && !id && classes.length === 0) continue;
    return true;
  }
  return false;
}

/**
 * 요소에 적용되는 선언을 소스 순서로 합친다. 명시도는 보지 않고 나중에 나온 것이 이긴다.
 * @returns {Object<string, {value: string, file: string, line: number, selector: string}>}
 */
export function computeDecls(element, cssRules) {
  const computed = {};
  for (const rule of cssRules) {
    if (!selectorMatches(rule.selector, element)) continue;
    for (const [prop, value] of Object.entries(rule.decls)) {
      computed[prop] = { value, file: rule.file, line: rule.line, selector: rule.selector };
    }
  }
  return computed;
}

/** 문서에서 보이는 텍스트 전부 — 문서 단위 판정에 쓴다. */
export function visibleText(htmlRaw) {
  return stripHtmlComments(htmlRaw)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `clamp(38px, 7vw, 92px)` 같은 값에서 가장 큰 px를 뽑는다.
 * 반응형 값의 최대치를 기준으로 "큰 글씨인가"를 판정하기 위해서다.
 * @returns {number|null} px 단위. rem은 16px 기준으로 환산.
 */
export function maxPx(value) {
  if (!value) return null;
  let max = null;
  for (const m of value.matchAll(/(-?[\d.]+)\s*(px|rem|em)/g)) {
    const n = parseFloat(m[1]);
    if (Number.isNaN(n)) continue;
    const px = m[2] === 'px' ? n : n * 16;
    if (max === null || px > max) max = px;
  }
  return max;
}

/** `-0.03em`, `0.18em`, `2px` 등을 em 단위 숫자로. 판정 불가면 null. */
export function toEm(value) {
  if (!value) return null;
  const m = value.trim().match(/^(-?[\d.]+)(em|rem|px)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  if (!m[2] || m[2] === 'em' || m[2] === 'rem') return n;
  return n / 16; // px는 16px 기준 근사
}

/** font-weight를 숫자로. bold=700, normal=400. */
export function toWeight(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'bold') return 700;
  if (v === 'normal') return 400;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}
