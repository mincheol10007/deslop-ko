#!/usr/bin/env node
/**
 * deslop-ko — 한국어 웹을 위한 AI 슬롭 검사기
 *
 *   node scripts/scan.mjs <경로> [옵션]
 *
 * 의존성 없음. LLM도 API 키도 필요 없다. 그래서 CI에 붙고, 재현되고, 반박할 수 있다.
 * 아무것도 고치지 않는다 — 보고만 하고 결정은 사람이 한다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { collect, collectIgnores } from './lib/scope.mjs';
import { parseCssRules, extractElements, computeDecls, visibleText } from './lib/parse.mjs';
import { merge, formatText, formatJson } from './lib/report.mjs';
import { rules as typographyRules } from './rules/typography.mjs';

const ALL_RULES = [...typographyRules];

function parseArgs(argv) {
  const options = {
    root: null,
    json: false,
    only: null,
    skip: [],
    exclude: [],
    includeArchives: false,
    stage: 1,
  };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--include-archives') options.includeArchives = true;
    else if (arg.startsWith('--only=')) options.only = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--skip=')) options.skip = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--exclude=')) options.exclude.push(arg.slice(10));
    else if (arg.startsWith('--stage=')) options.stage = parseInt(arg.slice(8), 10) || 1;
    else if (!arg.startsWith('-') && !options.root) options.root = arg;
  }
  return options;
}

/** 파일들을 읽어 규칙이 필요로 하는 것을 한 번에 만들어 둔다. */
export function buildContext(root, files) {
  const cssRules = [];
  const cssFiles = [];
  const rawElements = [];
  const visibleChunks = [];
  const ignores = new Map();

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const [rule, reasons] of collectIgnores(source)) {
      if (!ignores.has(rule)) ignores.set(rule, []);
      ignores.get(rule).push(...reasons);
    }

    const ext = path.extname(file).toLowerCase();

    if (ext === '.css') {
      cssFiles.push(file);
      for (const rule of parseCssRules(source)) cssRules.push({ ...rule, file });
      continue;
    }

    // HTML: <style> 블록도 CSS로 취급한다.
    for (const block of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const offset = source.slice(0, block.index).split('\n').length - 1;
      for (const rule of parseCssRules(block[1])) {
        cssRules.push({ ...rule, file, line: rule.line + offset });
      }
    }

    for (const el of extractElements(source)) rawElements.push({ ...el, file });
    visibleChunks.push(visibleText(source));
  }

  // CSS 파일이 하나도 없으면 <style>을 가진 HTML을 T1의 보고 위치로 쓴다.
  if (cssFiles.length === 0 && cssRules.length > 0) cssFiles.push(cssRules[0].file);

  // 요소마다 적용되는 선언을 미리 합쳐 둔다. BEM 수식자처럼 여러 블록에 흩어진
  // 선언을 한자리에 모아야 "굵은 한글에 양수 자간"인지 판정할 수 있다.
  const elements = rawElements.map((el) => ({ ...el, decls: computeDecls(el, cssRules) }));

  return {
    root,
    cssRules,
    cssFiles,
    elements,
    allVisibleText: visibleChunks.join(' '),
    ignores,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.root) {
    console.error('사용법: node scripts/scan.mjs <경로> [--json] [--only=규칙] [--include-archives]');
    process.exit(2);
  }

  const root = path.resolve(options.root);
  if (!fs.existsSync(root)) {
    console.error(`경로를 찾을 수 없습니다: ${root}`);
    process.exit(2);
  }

  const { files, skipped } = collect(root, options);
  const ctx = buildContext(root, files);

  let findings = [];
  for (const rule of ALL_RULES) findings.push(...rule(ctx));

  findings = findings.filter((f) => {
    if (f.stage > options.stage) return false;
    if (options.only && !options.only.includes(f.rule)) return false;
    if (options.skip.includes(f.rule)) return false;
    if (ctx.ignores.has(f.rule)) return false;
    return true;
  });

  const merged = merge(findings);
  const meta = { root, scanned: files.length, skipped };

  console.log(options.json ? formatJson(merged, meta) : formatText(merged, meta));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('scan.mjs')) {
  main();
}
