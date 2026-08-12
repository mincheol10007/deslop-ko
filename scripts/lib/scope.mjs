/**
 * 무엇을 검사할지 정한다. 규칙보다 먼저 오는 단계다.
 *
 * Phase 0 실측: impeccable이 gpters-landing에서 90건을 보고했는데 그중 78건(87%)이
 * 최종 산출물이 아니었다 — steps/v1~v4(실습 스냅샷), bg-samples.html(시안 실험),
 * making.html(제작기 문서). 같은 사이트를 라이브 URL로 스캔하면 12건이었다.
 * kill-ai-slop도 138건에서 아카이브를 빼자 46건이 됐다.
 *
 * 규칙이 아무리 정확해도 리포트의 87%가 노이즈면 아무도 안 쓴다.
 */

import fs from 'node:fs';
import path from 'node:path';

/** 언제나 제외 — 검사할 이유가 없는 것 */
export const HARD_EXCLUDES = [
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', 'vendor', '.vercel', '.cache', 'target',
];

/**
 * 기본 제외 — 사람이 만든 것이지만 "최종 산출물"이 아닌 것.
 * --include-archives 로 끌 수 있다.
 */
export const ARCHIVE_PATTERNS = [
  /(^|[\\/])steps?[\\/]/i,          // 단계별 실습 스냅샷
  /(^|[\\/])v\d+[\\/]/i,            // v1/ v2/ 버전 스냅샷
  /(^|[\\/])(archive|_archive|old|_old|backup|draft|drafts|wip)[\\/]/i,
  /(^|[\\/])(examples?|fixtures?|__tests__|tests?)[\\/]/i,
  /-?samples?\.[a-z]+$/i,           // bg-samples.html
  /(^|[\\/])making\.[a-z]+$/i,      // 제작기 문서
  /\.min\.(css|js)$/i,
];

/** 이번 스킬이 보는 확장자. *.md는 제외 — 문서 슬롭은 별도 스킬이 맡는다. */
export const SCANNABLE = new Set(['.html', '.htm', '.css']);

export function classify(relPath, options = {}) {
  const norm = relPath.replace(/\\/g, '/');

  for (const dir of HARD_EXCLUDES) {
    if (norm === dir || norm.startsWith(dir + '/') || norm.includes('/' + dir + '/')) {
      return { include: false, reason: 'hard' };
    }
  }

  const ext = path.extname(norm).toLowerCase();
  if (!SCANNABLE.has(ext)) {
    return { include: false, reason: ext === '.md' ? 'markdown' : 'ext' };
  }

  if (!options.includeArchives) {
    for (const pattern of ARCHIVE_PATTERNS) {
      if (pattern.test(norm)) return { include: false, reason: 'archive' };
    }
  }

  for (const pattern of options.exclude || []) {
    if (norm.includes(pattern)) return { include: false, reason: 'user' };
  }

  return { include: true, reason: null };
}

/**
 * @returns {{files: string[], skipped: Object<string, number>}}
 */
export function collect(root, options = {}) {
  const files = [];
  const skipped = { hard: 0, archive: 0, markdown: 0, ext: 0, user: 0 };

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        const verdict = classify(rel + '/x.html', options);
        if (verdict.reason === 'hard') {
          skipped.hard++;
          continue;
        }
        walk(full);
      } else if (entry.isFile()) {
        const verdict = classify(rel, options);
        if (verdict.include) files.push(full);
        else if (verdict.reason) skipped[verdict.reason]++;
      }
    }
  }

  const stat = fs.statSync(root);
  if (stat.isFile()) return { files: [root], skipped };
  walk(root);
  return { files, skipped };
}

/**
 * 면제 주석. 사유를 반드시 적게 한다 — impeccable의 방식을 따랐다.
 *   <!-- deslop-ko-ignore ko-letter-spacing: 브랜드 워드마크라 의도한 자간 -->
 *   /* deslop-ko-ignore ko-line-height: 한 줄 전용 제목 *​/
 */
const IGNORE_RE = /deslop-ko-ignore\s+([a-z0-9-]+)\s*:\s*([^\n*>-]+)/gi;

export function collectIgnores(source) {
  const ignores = new Map();
  for (const m of source.matchAll(IGNORE_RE)) {
    const rule = m[1].toLowerCase();
    if (!ignores.has(rule)) ignores.set(rule, []);
    ignores.get(rule).push(m[2].trim());
  }
  return ignores;
}
