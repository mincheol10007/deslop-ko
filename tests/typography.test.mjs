/**
 * 오탐 테스트가 정탐 테스트보다 많다. 의도한 비율이다.
 *
 * 원칙 ②: 오탐은 정탐보다 비싸다. 한국어 규칙이 한 번이라도 정상 조판을 지적하면
 * 사용자는 스캐너 전체를 안 믿는다. 못 잡는 것보다 틀리게 잡는 것이 더 나쁘다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collect, classify, collectIgnores } from '../scripts/lib/scope.mjs';
import { buildContext } from '../scripts/scan.mjs';
import { rules as typographyRules } from '../scripts/rules/typography.mjs';
import { detectLang, isUpperLatin, isKoreanDocument } from '../scripts/lib/lang.mjs';
import {
  parseCssRules, extractElements, computeDecls, stripCssComments, maxPx, toEm,
} from '../scripts/lib/parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function scanFixture(name) {
  const root = path.join(HERE, 'fixtures', name);
  // 픽스처는 tests/ 아래라 기본 제외 대상이다. 테스트에서만 포함시킨다.
  const { files } = collect(root, { includeArchives: true });
  const ctx = buildContext(root, files);
  return typographyRules.flatMap((rule) => rule(ctx));
}

const ruleIds = (findings) => [...new Set(findings.map((f) => f.rule))].sort();

// ─── 오탐 방지 ────────────────────────────────────────────────────────────────

test('정상 조판에는 아무것도 지적하지 않는다', () => {
  const findings = scanFixture('clean');
  assert.deepEqual(
    findings.map((f) => `${f.rule} @ ${f.selector}`),
    [],
    '정상 픽스처에서 지적이 나오면 규칙이 틀린 것이다'
  );
});

test('라틴 대문자의 양수 자간은 정석이므로 지적하지 않는다', () => {
  const findings = scanFixture('clean').filter((f) => f.rule === 'ko-letter-spacing');
  assert.equal(findings.length, 0);
});

test('한글의 음수 자간은 정석이므로 지적하지 않는다', () => {
  const findings = scanFixture('clean').filter((f) => f.rule === 'ko-letter-spacing');
  assert.equal(findings.length, 0);
});

test('라틴 제목의 좁은 행간은 받침이 없으므로 지적하지 않는다', () => {
  const findings = scanFixture('clean').filter((f) => f.rule === 'ko-line-height');
  assert.equal(findings.length, 0);
});

test('라틴 폰트가 앞에 오면 폰트 순서를 지적하지 않는다', () => {
  const findings = scanFixture('clean').filter((f) => f.rule === 'ko-font-order');
  assert.equal(findings.length, 0);
});

test('한글이 거의 없는 문서는 한국어 페이지로 보지 않는다', () => {
  // 영문 페이지에 한글 몇 자가 섞였다고 조판 규칙을 들이대면 그것이 곧 오탐이다.
  assert.equal(isKoreanDocument('Mostly English copy with 한글 조금'), false);
  assert.equal(isKoreanDocument('네비게이션 항목 정도만 한글인 경우'), false, '한글 16자로는 부족하다');
  assert.equal(
    isKoreanDocument('한국어가 충분히 들어 있는 문서라면 조판 규칙을 적용해야 마땅합니다. 이 정도 분량이면 한국어 페이지입니다.'),
    true
  );
});

test('CSS 주석은 카피가 아니므로 파싱에서 제거된다', () => {
  const css = '/* 시안 5 — 듀오톤 (오렌지 ↔ 딥 플럼) */\n.a { color: red; }';
  const stripped = stripCssComments(css);
  assert.equal(stripped.includes('↔'), false, '주석 내용이 남으면 안 된다');
  assert.equal(stripped.split('\n').length, 2, '줄 번호 보존을 위해 줄 수는 유지되어야 한다');
});

test('마크다운과 아카이브는 스코프에서 빠진다', () => {
  assert.equal(classify('GUIDE.md').include, false);
  assert.equal(classify('GUIDE.md').reason, 'markdown');
  assert.equal(classify('steps/v1/style.css').include, false);
  assert.equal(classify('steps/v1/style.css').reason, 'archive');
  assert.equal(classify('bg-samples.html').include, false);
  assert.equal(classify('making.html').include, false);
  assert.equal(classify('style.css').include, true);
  assert.equal(classify('steps/v1/style.css', { includeArchives: true }).include, true);
});

test('면제 주석은 사유를 함께 요구한다', () => {
  const ignores = collectIgnores('/* deslop-ko-ignore ko-letter-spacing: 워드마크라 의도한 자간 */');
  assert.equal(ignores.get('ko-letter-spacing')[0], '워드마크라 의도한 자간');
  assert.equal(collectIgnores('/* deslop-ko-ignore ko-letter-spacing */').size, 0, '사유가 없으면 면제되지 않는다');
});

// ─── 정탐 ─────────────────────────────────────────────────────────────────────

test('슬롭 픽스처에서 조판 규칙 다섯 개가 모두 걸린다', () => {
  assert.deepEqual(ruleIds(scanFixture('slop')), [
    'ko-font-order', 'ko-letter-spacing', 'ko-line-height', 'ko-split-word-break', 'ko-word-break',
  ]);
});

test('글자 분해가 있어도 어절 래퍼로 묶여 있으면 지적하지 않는다', () => {
  // gpters-landing 실측에서 나온 규칙이다. keep-all 을 제대로 넣었는데도 한글이
  // 어절 중간에서 끊겼고, 원인은 JS가 글자를 낱개 inline-block으로 쪼갠 것이었다.
  const findings = scanFixture('clean').filter((f) => f.rule === 'ko-split-word-break');
  assert.equal(findings.length, 0);
});

test('BEM 수식자에만 자간이 있어도 부모 블록의 굵기와 합쳐서 판정한다', () => {
  const findings = scanFixture('slop').filter((f) => f.rule === 'ko-letter-spacing');
  const selectors = findings.map((f) => f.selector);
  assert.ok(
    selectors.includes('.title--wide'),
    '캐스케이드를 합치지 않으면 이 케이스를 놓친다'
  );
});

// ─── 언어 판별 — 이 프로젝트의 핵심 ───────────────────────────────────────────

test('언어 판별', () => {
  assert.equal(detectLang('AI를 배우는 가장 빠른 방법'), 'ko', '라틴 두 글자가 섞여도 한글이다');
  assert.equal(detectLang('GPTERS'), 'latin');
  assert.equal(detectLang('2026'), 'neutral', '판정 근거가 없으면 판정하지 않는다');
  assert.equal(detectLang(''), 'neutral');
  assert.equal(isUpperLatin('GPTERS'), true);
  assert.equal(isUpperLatin('Gpters'), false);
});

// ─── 파서 ─────────────────────────────────────────────────────────────────────

test('@media 안의 규칙도 살아서 나온다', () => {
  const rules = parseCssRules('@media (min-width: 768px) { .a { color: red; } }');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, '.a');
});

test('바깥 요소가 안쪽 요소를 삼키지 않는다', () => {
  const elements = extractElements('<html><body><h1 class="t">제목</h1><p>본문</p></body></html>');
  const tags = elements.map((e) => e.tag);
  assert.ok(tags.includes('h1'), 'html이 전부 삼키면 h1을 놓친다');
  assert.ok(tags.includes('p'));
  const h1 = elements.find((e) => e.tag === 'h1');
  assert.deepEqual(h1.classes, ['t']);
  assert.equal(h1.text, '제목');
});

test('요소에 적용되는 선언은 소스 순서로 합쳐지고 나중 것이 이긴다', () => {
  const cssRules = parseCssRules('.t { font-weight: 900; letter-spacing: -0.03em; } .t--w { letter-spacing: 0.06em; }')
    .map((r) => ({ ...r, file: 'x.css' }));
  const el = { tag: 'h1', classes: ['t', 't--w'], id: null, text: '제목' };
  const decls = computeDecls(el, cssRules);
  assert.equal(decls['font-weight'].value, '900');
  assert.equal(decls['letter-spacing'].value, '0.06em');
  assert.equal(decls['letter-spacing'].selector, '.t--w');
});

test('반응형 값에서 최대 px를 뽑는다', () => {
  assert.equal(maxPx('clamp(38px, 7vw, 92px)'), 92);
  assert.equal(maxPx('1.5rem'), 24);
  assert.equal(maxPx('7vw'), null, '판정 근거가 없으면 null');
  assert.equal(toEm('-0.03em'), -0.03);
  assert.equal(toEm('1.1'), 1.1);
  assert.equal(toEm('normal'), null);
});
