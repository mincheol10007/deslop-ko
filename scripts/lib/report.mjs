/**
 * 리포트가 이 스킬의 얼굴이다.
 *
 * deslop-ko는 자동 수정을 하지 않는다. 전부 리포트하고 사람이 승인한다.
 * 그래서 사용자는 매 지적을 읽는다 — 그게 유일하고 확실한 교육 접점이다.
 * 지적 하나당 "무엇을 / 왜 기계처럼 보이는지 / 어떻게 고치는지" 세 줄이 반드시 붙는다.
 *
 * 그리고 짧아야 한다. Phase 0에서 impeccable이 bg-samples.html의 같은 대비 문제를
 * 9번 반복 보고했다. 원인은 하나인데 리포트는 9줄이었다. 승인제에서 리포트 길이는
 * 곧 사용성이다.
 */

import path from 'node:path';

const TIER_LABEL = { classic: '널리 알려진', evolved: '새로 굳은' };

/**
 * 규칙 하나에 항목 하나. 값이 조금씩 달라도 원인이 같으면 같은 항목이다.
 * 구체적인 값은 위치 줄에 붙는다.
 */
export function merge(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.rule)) groups.set(f.rule, { ...f, locations: [] });
    groups.get(f.rule).locations.push({
      file: f.file,
      line: f.line,
      selector: f.selector,
      detail: f.detail ?? null,
      sample: f.sample ?? null,
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.stage !== b.stage) return a.stage - b.stage;
    return b.locations.length - a.locations.length;
  });
}

function rel(root, file) {
  const r = path.relative(root, file);
  return (r || path.basename(file)).replace(/\\/g, '/');
}

export function formatText(merged, meta) {
  const lines = [];
  const { root, scanned, skipped } = meta;

  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  lines.push('');
  lines.push(`deslop-ko — ${scanned}개 파일 검사${skippedTotal ? ` (제외 ${skippedTotal}개)` : ''}`);

  if (skipped.archive) {
    lines.push(`  · 아카이브·실험 파일 ${skipped.archive}개는 최종 산출물이 아니라 건너뜀 (--include-archives로 포함)`);
  }
  if (skipped.markdown) {
    lines.push(`  · 마크다운 ${skipped.markdown}개는 이 스킬의 대상이 아님 (문서용 스킬이 따로 있음)`);
  }
  for (const note of meta.notes || []) lines.push(`  · ${note}`);

  if (merged.length === 0) {
    lines.push('');
    lines.push('  지적할 것이 없습니다.');
    lines.push('');
    return lines.join('\n');
  }

  let currentAxis = null;
  for (const f of merged) {
    if (f.axis !== currentAxis) {
      currentAxis = f.axis;
      lines.push('');
      lines.push(`■ ${currentAxis}`);
    }
    lines.push('');
    lines.push(`${f.rule}  ${f.title}   [${f.locations.length}곳 · ${TIER_LABEL[f.tier] ?? f.tier}]`);
    lines.push(`    왜   ${f.why}`);
    lines.push(`    수정 ${f.fix}`);
    if (f.caveat) lines.push(`    주의 ${f.caveat}`);
    lines.push('');

    const shown = f.locations.slice(0, 8);
    const where = shown.map((l) => `${rel(root, l.file)}${l.line ? ':' + l.line : ''}`);
    const sel = shown.map((l) => l.selector || '');
    const wWhere = Math.max(...where.map((s) => s.length));
    const wSel = Math.max(...sel.map((s) => s.length));

    shown.forEach((loc, i) => {
      let line = `      ${where[i].padEnd(wWhere)}  ${sel[i].padEnd(wSel)}`;
      if (loc.detail) line += `  ${loc.detail}`;
      if (loc.sample) line += `   "${loc.sample}"`;
      lines.push(line.trimEnd());
    });
    if (f.locations.length > shown.length) {
      lines.push(`      … ${f.locations.length - shown.length}곳 더`);
    }
  }

  lines.push('');
  lines.push(`→ ${merged.length}개 항목, ${merged.reduce((n, f) => n + f.locations.length, 0)}곳.`);
  lines.push('  자동으로 고치지 않습니다. 각 항목을 확인하고 적용할 것만 알려주세요.');
  lines.push('  의도한 것이면 deslop-ko-ignore 주석으로 사유와 함께 면제할 수 있습니다.');
  lines.push('');
  return lines.join('\n');
}

export function formatJson(merged, meta) {
  return JSON.stringify(
    {
      version: 1,
      root: meta.root,
      scanned: meta.scanned,
      skipped: meta.skipped,
      findings: merged.map((f) => ({
        rule: f.rule,
        axis: f.axis,
        tier: f.tier,
        stage: f.stage,
        title: f.title,
        why: f.why,
        fix: f.fix,
        caveat: f.caveat ?? null,
        locations: f.locations.map((l) => ({
          file: rel(meta.root, l.file),
          line: l.line ?? null,
          selector: l.selector ?? null,
          detail: l.detail ?? null,
          sample: l.sample ?? null,
        })),
      })),
    },
    null,
    2
  );
}
