/**
 * 배포된 사이트를 URL로 가져온다.
 *
 * 로컬 파일 스캔에는 두 가지 한계가 있다. 하나는 남의 사이트를 못 본다는 것,
 * 다른 하나는 실측에서 확인한 대로 로컬에는 아카이브와 실험 파일이 섞여 있다는 것이다.
 * URL 스캔은 실제로 배포된 것만 본다.
 *
 * 브라우저를 쓰지 않는다. HTML과 링크된 스타일시트만 받아 온다.
 * 런타임에 DOM을 그리는 사이트는 --deep 경로가 필요하다.
 */

const SKIP_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\./i;
const TIMEOUT_MS = 15000;
const MAX_STYLESHEETS = 12;

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // 한국어 페이지를 받기 위해 명시한다.
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5',
        'user-agent': 'deslop-ko/0.1 (+https://github.com/mincheol10007/deslop-ko)',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{entries: Array<{path: string, source: string, kind: 'html'|'css'}>, notes: string[]}>}
 */
export async function fetchSite(pageUrl) {
  const notes = [];
  const html = await get(pageUrl);
  if (html === null) throw new Error(`가져오지 못했습니다: ${pageUrl}`);

  const entries = [{ path: pageUrl, source: html, kind: 'html' }];

  const hrefs = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag[0])) continue;
    const href = tag[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let abs;
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (SKIP_HOSTS.test(abs)) continue;
    if (!hrefs.includes(abs)) hrefs.push(abs);
  }

  if (hrefs.length > MAX_STYLESHEETS) {
    notes.push(`스타일시트 ${hrefs.length}개 중 ${MAX_STYLESHEETS}개만 받았습니다`);
    hrefs.length = MAX_STYLESHEETS;
  }

  const sheets = await Promise.all(hrefs.map(async (href) => [href, await get(href)]));
  for (const [href, css] of sheets) {
    if (css === null) {
      notes.push(`스타일시트를 못 받음: ${href}`);
      continue;
    }
    entries.push({ path: href, source: css, kind: 'css' });
  }

  if (entries.length === 1) {
    notes.push('외부 스타일시트를 하나도 받지 못했습니다. 인라인 <style>만 검사합니다.');
  }
  return { entries, notes };
}

export function isUrl(value) {
  return /^https?:\/\//i.test(value);
}
