import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Board } from './sources';

// Common Crawl's public URL index is the bulk equivalent of `site:jobs.ashbyhq.com` searches: it lists
// every ATS board URL the crawler saw. Only identifiers are extracted here; nothing found is trusted
// until the board's own public feed is fetched and verified by discover-cli.
const INDEX = 'https://index.commoncrawl.org';
const CACHE = path.join(path.resolve(__dirname, '..'), '.local/cc-harvest');
type Provider = NonNullable<Board['provider']>;
interface Target { query: string; domain?: boolean; provider: Provider; region?: Board['region']; slugFrom: 'path' | 'subdomain'; suffix?: string }
export const TARGETS: Target[] = [
  { query: 'job-boards.greenhouse.io/*', provider: 'greenhouse', slugFrom: 'path' },
  { query: 'boards.greenhouse.io/*', provider: 'greenhouse', slugFrom: 'path' },
  { query: 'job-boards.eu.greenhouse.io/*', provider: 'greenhouse', slugFrom: 'path' },
  { query: 'jobs.ashbyhq.com/*', provider: 'ashby', slugFrom: 'path' },
  { query: 'jobs.lever.co/*', provider: 'lever', slugFrom: 'path' },
  { query: 'jobs.eu.lever.co/*', provider: 'lever', region: 'eu', slugFrom: 'path' },
  { query: 'apply.workable.com/*', provider: 'workable', slugFrom: 'path' },
  { query: 'recruitee.com', domain: true, provider: 'recruitee', slugFrom: 'subdomain', suffix: '.recruitee.com' },
  { query: 'jobs.personio.de', domain: true, provider: 'personio', slugFrom: 'subdomain', suffix: '.jobs.personio.de' },
  { query: 'jobs.personio.com', domain: true, provider: 'personio', region: 'com', slugFrom: 'subdomain', suffix: '.jobs.personio.com' },
];
const RESERVED = new Set(['api', 'embed', 'j', 'jobs', 'job', 'careers', 'www', 'app', 'static', 'assets', 'cdn', 'robots.txt', 'sitemap.xml', 'favicon.ico', 'search', 'login', 'signup', 'apply', 'oauth', 'help', 'support', 'status', 'blog', 'docs', 'admin', 'portal', 'v1', 'v2', 'board', 'boards', 'demo', 'test', 'example', 'sample']);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function indexGet(url: string, attempts = 6): Promise<string | null> {
  const parsed = new URL(url);
  if (parsed.origin !== INDEX || !/^\/CC-MAIN-\d{4}-\d{2}-index$/.test(parsed.pathname)) throw new Error('Unexpected index URL');
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(150000), headers: { 'User-Agent': 'TechOpportunities/1.0 (ATS board discovery)' } });
      if (response.ok) return await response.text();
      await response.body?.cancel();
      if (response.status === 404) return '';
    } catch {}
    await wait(5000 * (i + 1));
  }
  return null;
}
export async function recentCrawls(count: number): Promise<string[]> {
  const response = await fetch(`${INDEX}/collinfo.json`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Common Crawl index list HTTP ${response.status}`);
  const list = await response.json() as { id: string }[];
  return list.map(c => c.id).filter(id => /^CC-MAIN-\d{4}-\d{2}$/.test(id)).slice(0, Math.max(1, Math.min(6, count)));
}
export function slugFromUrl(raw: string, target: Target): string | null {
  try {
    const url = new URL(raw);
    let slug: string | undefined;
    if (target.slugFrom === 'path') slug = url.pathname.split('/').filter(Boolean)[0];
    else if (target.suffix && url.hostname.endsWith(target.suffix)) slug = url.hostname.slice(0, -target.suffix.length);
    slug = decodeURIComponent(slug || '').toLowerCase();
    if (!slug || RESERVED.has(slug) || slug.includes('.') && target.provider !== 'lever' && target.provider !== 'ashby') return null;
    return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(slug) ? slug : null;
  } catch { return null; }
}
/** Distinct board identifiers for one crawl and target; cached on disk because the index is slow. */
export async function harvest(crawl: string, target: Target, log: (m: string) => void = () => {}): Promise<string[]> {
  if (!/^CC-MAIN-\d{4}-\d{2}$/.test(crawl)) throw new Error('Invalid crawl id');
  const file = path.join(CACHE, `${crawl}-${target.query.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  try { const cached = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(cached)) return cached; } catch {}
  const base = new URL(`${INDEX}/${crawl}-index`);
  base.searchParams.set('url', target.query); base.searchParams.set('output', 'json'); base.searchParams.set('fl', 'url');
  if (target.domain) base.searchParams.set('matchType', 'domain');
  const count = new URL(base); count.searchParams.set('showNumPages', 'true');
  const meta = await indexGet(count.href);
  if (meta === null) { log(`${crawl} ${target.query}: index unavailable`); return []; }
  const pages = meta ? Number(JSON.parse(meta).pages) || 0 : 0;
  const slugs = new Set<string>();
  let complete = true;
  for (let page = 0; page < Math.min(pages, 50); page++) {
    const url = new URL(base); url.searchParams.set('page', String(page));
    const body = await indexGet(url.href);
    if (body === null) { complete = false; continue; }
    for (const line of body.split('\n')) {
      if (!line) continue;
      try { const slug = slugFromUrl(JSON.parse(line).url, target); if (slug) slugs.add(slug); } catch {}
    }
    log(`${crawl} ${target.query}: page ${page + 1}/${pages}, ${slugs.size} boards`);
  }
  const result = [...slugs].sort();
  if (complete) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(result), { mode: 0o600 }); }
  return result;
}
export async function harvestBoards(crawls: string[], log: (m: string) => void = () => {}): Promise<Board[]> {
  const boards = new Map<string, Board>();
  for (const crawl of crawls) for (const target of TARGETS) {
    for (const board of await harvest(crawl, target, log)) {
      const key = `${target.provider}:${target.region || 'global'}:${board}`;
      if (!boards.has(key)) boards.set(key, { board, company: '', provider: target.provider, ...(target.region ? { region: target.region } : {}), discoveryUrl: `commoncrawl:${crawl}` });
    }
  }
  return [...boards.values()];
}
