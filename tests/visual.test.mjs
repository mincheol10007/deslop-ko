/**
 * 시각 슬롭 규칙 테스트.
 *
 * 이 축은 뒤늦게 붙였다. 처음에는 "금지 목록은 기존 도구가 이미 한다"는 이유로
 * 한글 조판만 만들었는데, 그 결과 그라디언트 텍스트와 글로우가 가득한 페이지에
 * "지적할 것이 없습니다"라고 답하는 검사기가 됐다. 이름은 슬롭 검사기인데
 * 실제로는 조판 린터였다.
 *
 * 규칙 텍스트를 베끼지 않는 것과 같은 영역을 다루지 않는 것은 다른 얘기다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collect } from '../scripts/lib/scope.mjs';
import { buildContext } from '../scripts/scan.mjs';
import { rules as visualRules, maxShadowBlur } from '../scripts/rules/visual.mjs';
import { parseColor, contrastRatio, isNeutral, resolveVar } from '../scripts/lib/color.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function scanFixture(name) {
  const root = path.join(HERE, 'fixtures', name);
  const { files } = collect(root, { includeArchives: true });
  const ctx = buildContext(
    root,
    files.map((f) => ({ path: f, source: readFileSync(f, 'utf8'), kind: f.endsWith('.css') ? 'css' : 'html' }))
  );
  return visualRules.flatMap((rule) => rule(ctx));
}

const has = (name, rule) => scanFixture(name).some((f) => f.rule === rule);

// ─── 오탐 방지 ────────────────────────────────────────────────────────────────

test('정상 픽스처에서 시각 규칙이 하나도 걸리지 않는다', () => {
  assert.deepEqual(scanFixture('clean').map((f) => `${f.rule} @ ${f.selector}`), []);
});

test('무채색 그림자는 실제 그림자이므로 지적하지 않는다', () => {
  assert.equal(has('clean', 'glow-shadow'), false);
  assert.equal(isNeutral(parseColor('rgba(0,0,0,0.12)')), true);
  assert.equal(isNeutral(parseColor('#6366f1')), false);
});

test('작고 낮은 그림자는 지적하지 않는다', () => {
  assert.equal(has('clean', 'oversized-shadow'), false);
});

test('대비가 충분하면 지적하지 않는다', () => {
  assert.equal(has('clean', 'low-contrast'), false);
  assert.equal(Math.round(contrastRatio(parseColor('#000'), parseColor('#fff'))), 21);
});

test('한글·라틴 겸용 서체는 기본값으로 보지 않는다', () => {
  assert.equal(has('clean', 'default-font'), false, 'Pretendard 는 고른 서체다');
});

test('소셜 로그인용임이 이름에 드러나면 브랜드 색 차용이 아니다', () => {
  // --kakao-yellow 는 카카오 버튼에 쓰겠다는 뜻이다. --brand: #fee500 과는 다르다.
  assert.equal(has('clean', 'borrowed-brand-color'), false);
});

// ─── 정탐 ─────────────────────────────────────────────────────────────────────

test('슬롭 픽스처에서 시각 규칙 여섯 개가 걸린다', () => {
  const ids = [...new Set(scanFixture('slop').map((f) => f.rule))].sort();
  assert.deepEqual(ids, [
    'borrowed-brand-color', 'glassmorphism', 'glow-shadow',
    'gradient-text', 'low-contrast', 'oversized-shadow',
  ]);
});

// ─── 그림자 파싱 — 한 번 틀렸던 곳 ────────────────────────────────────────────

test('단위 없는 0 때문에 번짐 자리가 밀리지 않는다', () => {
  // px만 세면 "0 20px 60px" 에서 blur 를 60이 아니라 undefined 로 읽는다.
  assert.equal(maxShadowBlur('0 20px 60px rgba(235,90,16,0.18)'), 60);
  assert.equal(maxShadowBlur('0 2px 8px rgba(0,0,0,0.12)'), 8);
});

test('색 함수 안의 숫자를 길이로 오인하지 않는다', () => {
  assert.equal(maxShadowBlur('0 1px 2px rgba(255, 255, 255, 0.5)'), 2);
});

test('그림자를 여러 겹 쌓으면 가장 큰 번짐을 본다', () => {
  assert.equal(maxShadowBlur('0 1px 2px rgba(0,0,0,.1), 0 8px 48px rgba(0,0,0,.2)'), 48);
});

// ─── 색 ───────────────────────────────────────────────────────────────────────

test('색 파싱', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#eb5a10'), { r: 235, g: 90, b: 16, a: 1 });
  assert.equal(parseColor('rgba(0,0,0,0.5)').a, 0.5);
  assert.equal(parseColor('var(--x)'), null, '판정 근거가 없으면 null');
});

test('커스텀 프로퍼티를 펴야 색을 볼 수 있다', () => {
  const vars = new Map([['--ink', '#111318'], ['--fg', 'var(--ink)']]);
  assert.equal(resolveVar('var(--fg)', vars), '#111318');
  assert.equal(resolveVar('var(--missing, #fff)', vars), '#fff');
});

test('브랜드 오렌지 위 흰 글씨는 AA 미달이다', () => {
  // Phase 0 에서 impeccable 이 지피터스 랜딩에서 40건 잡았던 조합이다.
  const ratio = contrastRatio(parseColor('#ffffff'), parseColor('#eb5a10'));
  assert.ok(ratio < 4.5, `${ratio.toFixed(2)}:1 이라 본문 기준 4.5:1 에 미달한다`);
  assert.ok(ratio > 3.0, '큰 글씨 기준 3:1 은 넘는다');
});
