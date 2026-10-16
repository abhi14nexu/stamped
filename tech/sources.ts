import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { COUNTRIES, classifyRole, countriesFromLocation } from './classify';
import type { RawJob } from './types';
import { jackAndJillUnit, linkedinUnit, type LinkedinConfig } from './public-sources';
import { personioUnit, recruiteeUnit, workableUnit } from './ats';

export interface SourceUnit { key: string; group?: string; name: string; url: string; collect: () => Promise<RawJob[]>; exhaustive?: boolean; coverage?: string; partialError?: string; closedJobIds?: string[] }
export interface Board { board: string; company: string; enabled?: boolean; disabledReason?: string; provider?: 'greenhouse' | 'ashby' | 'lever' | 'smartrecruiters' | 'workable' | 'recruitee' | 'personio'; region?: 'eu' | 'com'; employerCountry?: string; employerCountrySource?: string; discoveryUrl?: string; verifiedAt?: string }
interface SourceConfig { boards: Board[]; jackAndJill?: { enabled: boolean; maxJobs: number }; linkedin?: LinkedinConfig; jobicy?: { enabled: boolean; maxPages: number }; relocate?: { enabled: boolean; maxJobs: number }; remotive?: { enabled: boolean }; arbeitnow?: { enabled: boolean; pagesPerFeed: number }; himalayas?: { enabled: boolean; pagesPerMarket: number; countries: string[]; worldwide: boolean }; hiringCafe: { enabled: boolean; daysLookback: number; maxQueries: number; countries: string[]; queries: string[] } }
export const ROOT = path.resolve(__dirname, '..');
export const SOURCE_DIR = path.join(ROOT, 'data_in_progress/jobs/tech_opportunities');
const HOSTS = new Set(['boards-api.greenhouse.io', 'api.ashbyhq.com', 'api.lever.co', 'api.eu.lever.co', 'api.smartrecruiters.com', 'relocate.me', 'remotive.com', 'jobicy.com', 'hiringcafe.com', 'www.arbeitnow.com', 'www.arbeitnow.co.uk', 'himalayas.app', 'www.jackandjill.ai', 'www.linkedin.com',
  'apply.workable.com', 'jobs.ashbyhq.com', 'jobs.lever.co', 'jobs.eu.lever.co', 'www.gov.uk', 'assets.publishing.service.gov.uk', 'ind.nl']);
const SUBDOMAIN_HOSTS = [/^[a-z0-9][a-z0-9-]{0,62}\.recruitee\.com$/, /^[a-z0-9][a-z0-9-]{0,62}\.jobs\.personio\.(?:de|com)$/];
const relocateJobPath = /^\/[a-z-]+\/[a-z-]+\/[a-z0-9-]+\/[a-z0-9-]+-\d+$/;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function stopAfterSourceError(message: string, consecutiveFailures: number): boolean {
  return consecutiveFailures >= 3 || /\b(?:403|429)\b|sign.in wall/i.test(message);
}

export function htmlToText(html: string): string {
  let value = html;
  for (let i = 0; i < 2 && /&lt;|&#60;/.test(value); i++) value = load(value).text();
  const $ = load(value);
  $('script,style,noscript,iframe').remove();
  $('br').replaceWith('\n');
  $('p,li,div,h1,h2,h3,h4,section').append('\n');
  return $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export function validateSourceUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(HOSTS.has(parsed.hostname) || SUBDOMAIN_HOSTS.some(host => host.test(parsed.hostname))) || parsed.username || parsed.password || parsed.port) throw new Error('Source URL is not allowed');
  if (parsed.hostname.endsWith('.recruitee.com') && !/^\/api\/offers\/?$/.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (/\.jobs\.personio\.(?:de|com)$/.test(parsed.hostname) && parsed.pathname !== '/xml') throw new Error('Source path is not allowed');
  if (parsed.hostname === 'apply.workable.com' && !/^\/api\/v1\/widget\/accounts\/[a-z0-9_-]+$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
  // Board landing pages are read only for the employer's display name during discovery.
  if (['jobs.ashbyhq.com', 'jobs.lever.co', 'jobs.eu.lever.co'].includes(parsed.hostname) && !/^\/[a-z0-9_.%-]{1,100}$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'www.gov.uk' && parsed.pathname !== '/api/content/government/publications/register-of-licensed-sponsors-workers') throw new Error('Source path is not allowed');
  if (parsed.hostname === 'assets.publishing.service.gov.uk' && !/^\/media\/[0-9a-f]{16,40}\/[A-Za-z0-9_.-]{1,200}\.csv$/.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'ind.nl' && parsed.pathname !== '/en/public-register-recognised-sponsors/public-register-work') throw new Error('Source path is not allowed');
  if (parsed.hostname.startsWith('www.arbeitnow.') && parsed.pathname !== '/api/job-board-api') throw new Error('Source path is not allowed');
  if (parsed.hostname === 'himalayas.app' && !['/jobs/api', '/jobs/api/search'].includes(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'boards-api.greenhouse.io' && !/^\/v1\/boards\/[a-z0-9_-]+(?:\/jobs)?$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'api.ashbyhq.com' && !/^\/posting-api\/job-board\/[a-z0-9_.-]+$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (['api.lever.co', 'api.eu.lever.co'].includes(parsed.hostname) && !/^\/v0\/postings\/[a-z0-9_.-]+$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'www.jackandjill.ai' && parsed.pathname !== '/jobs/sitemap.xml' && !/^\/jobs\/[a-z]+\/[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'www.linkedin.com' && !/^\/jobs-guest\/jobs\/api\/(?:seeMoreJobPostings\/search|jobPosting\/\d{6,15})$/.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'relocate.me' && parsed.pathname !== '/international-jobs' && !relocateJobPath.test(parsed.pathname)) throw new Error('Source path is not allowed');
  if (parsed.hostname === 'remotive.com' && parsed.pathname !== '/api/remote-jobs') throw new Error('Source path is not allowed');
  if (parsed.hostname === 'jobicy.com' && parsed.pathname !== '/api/v2/remote-jobs') throw new Error('Source path is not allowed');
  if (parsed.hostname === 'api.smartrecruiters.com' && !/^\/v1\/companies\/[a-z0-9_-]+\/postings(?:\/[a-z0-9-]+)?$/i.test(parsed.pathname)) throw new Error('Source path is not allowed');
}

export async function fetchPublic(url: string): Promise<string> {
  validateSourceUrl(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    // Large boards (thousands of postings with full content) can take longer than a minute under parallel load.
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000), headers: { 'User-Agent': 'TechOpportunities/1.0 (public job discovery)', Accept: 'application/json,text/html' } });
    } catch (error) {
      // Dropped connections and resets are usually transient: retry once, then report.
      if (attempt === 0) { await wait(3000); continue; }
      throw error;
    }
    if (response.status === 429 && new URL(url).hostname === 'www.linkedin.com') { await response.body?.cancel(); throw new Error('HTTP 429 — LinkedIn rate limited this run; stopped'); }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const retry = Number(response.headers.get('retry-after') || 0);
      await response.body?.cancel();
      if (response.status === 429 && retry > 15) throw new Error(`HTTP 429 — source requested retry after ${retry} seconds; stopped this feed`);
      await wait(Math.max(2500, Math.min(15000, retry * 1000)));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}${response.status === 403 ? ' — access blocked by source' : ''}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty source response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('Source response exceeded 20 MB'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Source retries exhausted');
}

interface CachedPage { body: string; fetchedAt: string; cacheHit?: boolean }
export async function cachedPage(url: string, ttlSeconds: number): Promise<CachedPage> {
  validateSourceUrl(url);
  const dir = path.join(ROOT, '.local/feed-cache');
  const file = path.join(dir, createHash('sha256').update(url).digest('hex') + '.json');
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedPage;
    if (typeof cached.body === 'string' && Date.now() - Date.parse(cached.fetchedAt) < ttlSeconds * 1000) return { ...cached, cacheHit: true };
  } catch {}
  const page = { body: await fetchPublic(url), fetchedAt: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(page), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return page;
}

/** Remove cached feed bodies older than maxAgeDays so discovery runs don't grow the cache forever. */
export function pruneFeedCache(maxAgeDays = 3): number {
  const dir = path.join(ROOT, '.local/feed-cache');
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
      const file = path.join(dir, name);
      if (Date.now() - fs.statSync(file).mtimeMs > maxAgeDays * 86400000) { fs.unlinkSync(file); removed++; }
    }
  } catch {}
  return removed;
}

export function pinnedNextPage(next: unknown, base: string): string | null {
  if (next === null || next === undefined) return null;
  if (typeof next !== 'string') throw new Error('Invalid pagination link');
  const parsed = new URL(next);
  const original = new URL(base);
  if (parsed.origin !== original.origin || parsed.pathname !== original.pathname || parsed.username || parsed.password) throw new Error('Source returned unsafe pagination link');
  const number = Number(parsed.searchParams.get('page'));
  if (!Number.isInteger(number) || number < 1 || number > 1000) throw new Error('Invalid pagination page');
  original.searchParams.set('page', String(number));
  return original.href;
}

export function descriptionEmployerCountry(description: string): string | undefined {
  if (/\bwe(?: are|'re)\s+(?:an?\s+)?(?:us|u\.?s\.?|united states)[ -]based\b/i.test(description.replace(/[’‘]/g, "'"))) return 'US';
  const statement = description.split(/\n|(?<=[.!?])\s+/).find(s =>
    /\b(?:headquartered|headquarters)(?:\s+(?:is|are|located|based))?\s+(?:(?:in|at)\s+)?(?:the\s+)?(?:united states|u\.?s\.?a?\b|san francisco|new york|california|seattle|boston|austin|san jose|san diego|palo alto|mountain view|denver)\b/i.test(s)
  );
  return statement ? 'US' : undefined;
}

export function arbeitnowUnit(region: 'uk' | 'de', sponsorOnly: boolean, maxPages: number): SourceUnit {
  const origin = region === 'uk' ? 'https://www.arbeitnow.co.uk' : 'https://www.arbeitnow.com';
  const base = `${origin}/api/job-board-api${sponsorOnly ? '?visa_sponsorship=true' : ''}`;
  const key = `arbeitnow-${region}${sponsorOnly ? '-sponsorship' : ''}`;
  const unit: SourceUnit = { key, group: 'arbeitnow', name: `Arbeitnow ${region === 'uk' ? 'UK' : 'Europe'}${sponsorOnly ? ' · sponsorship discovery' : ''}`, url: base, exhaustive: false, collect: async () => {
    const rows: RawJob[] = [];
    const seen = new Set<string>();
    let url: string | null = base;
    let pages = 0;
    unit.partialError = undefined;
    while (url && pages < Math.min(50, Math.max(1, maxPages))) {
      try {
        const page = await cachedPage(url, 3600);
        const data = JSON.parse(page.body);
        if (!Array.isArray(data.data)) throw new Error('Jobs array missing from source');
        for (const job of data.data) {
          if (!job?.slug || typeof job.title !== 'string' || typeof job.company_name !== 'string' || typeof job.description !== 'string' || typeof job.url !== 'string') throw new Error('Source job schema changed');
          if (seen.has(job.slug)) continue;
          seen.add(job.slug);
          const description = htmlToText(job.description);
          const location = String(job.location || 'Location unspecified');
          // Arbeitnow appends numbers to duplicate company slugs ("Addepar1").
          rows.push({ externalId: job.slug, title: job.title, company: job.company_name.replace(/^([A-Z][a-z]{2,})\d{1,3}$/, '$1'), location,
            description, countryHints: region === 'uk' ? ['GB'] : undefined,
            applyUrl: job.url, sourceUrl: job.url, source: 'Arbeitnow', sourceKey: key,
            updatedAt: typeof job.created_at === 'number' ? new Date(job.created_at * 1000).toISOString() : undefined,
            observedAt: page.fetchedAt, workplace: job.remote === true ? 'Remote' : undefined,
            employerCountry: descriptionEmployerCountry(description), employerCountrySource: job.url,
            attributionUrl: origin,
          });
        }
        pages++;
        url = pinnedNextPage(data.links?.next, base);
        if (!data.data.length) url = null;
        if (url && !page.cacheHit) await wait(650);
      } catch (error: any) {
        if (!rows.length) throw error;
        unit.partialError = `Page ${pages + 1}: ${String(error.message || error).slice(0, 200)}`;
        break;
      }
    }
    unit.exhaustive = !url && !unit.partialError;
    unit.coverage = `${pages} page(s), ${rows.length} listings; ${unit.exhaustive ? 'available feed exhausted' : 'recent listings only; deeper results remain'}. Source cache: 1 hour.${sponsorOnly ? ' Search-category membership alone is not sponsorship proof.' : ''}`;
    return rows;
  } };
  return unit;
}

export function normalizeHimalayasLocations(values: unknown): string[] {
  if (!Array.isArray(values)) throw new Error('Himalayas location restrictions missing');
  return values.map(value => typeof value === 'string' ? value : value && typeof value.name === 'string' ? value.name : '').filter(Boolean);
}

export function himalayasUnit(country: string | 'worldwide', maxPages: number, employerFacts: Map<string, Board>, query?: string): SourceUnit {
  if (country !== 'worldwide' && !COUNTRIES[country]) throw new Error('Invalid Himalayas country');
  const base = new URL('https://himalayas.app/jobs/api/search');
  if (country === 'worldwide') base.searchParams.set('worldwide', 'true');
  else { base.searchParams.set('country', country); base.searchParams.set('exclude_worldwide', 'true'); }
  base.searchParams.set('sort', 'recent');
  if (query) base.searchParams.set('q', query);
  const key = `himalayas-${country}${query ? '-' + query.replace(/\W+/g, '_') : ''}`;
  const unit: SourceUnit = { key, group: 'himalayas', name: `Himalayas · ${country === 'worldwide' ? 'worldwide' : COUNTRIES[country]}${query ? ' · ' + query : ''}`, url: base.href, exhaustive: false, collect: async () => {
    const rows: RawJob[] = [];
    const seen = new Set<string>();
    let pages = 0;
    let total: number | undefined;
    let ended = false;
    unit.partialError = undefined;
    for (let number = 1; number <= Math.min(50, Math.max(1, maxPages)); number++) {
      try {
        const url = new URL(base); url.searchParams.set('page', String(number));
        const page = await cachedPage(url.href, 86400);
        const data = JSON.parse(page.body);
        if (!Array.isArray(data.jobs)) throw new Error('Himalayas jobs array missing');
        total = typeof data.totalCount === 'number' ? data.totalCount : total;
        let added = 0;
        for (const job of data.jobs) {
          if (!job?.guid || typeof job.title !== 'string' || typeof job.companyName !== 'string' || typeof job.description !== 'string' || typeof job.applicationLink !== 'string') throw new Error('Himalayas job schema changed');
          if (seen.has(job.guid)) continue;
          seen.add(job.guid); added++;
          const expiry = typeof job.expiryDate === 'number' ? job.expiryDate * (job.expiryDate < 1e12 ? 1000 : 1) : Date.parse(job.expiryDate);
          if (Number.isFinite(expiry) && expiry < Date.now()) continue;
          const locations = normalizeHimalayasLocations(job.locationRestrictions);
          const description = htmlToText(job.description);
          const fact = employerFacts.get(job.companyName.toLowerCase().replace(/[^a-z0-9]/g, ''));
          const employerCountry = fact?.employerCountry || descriptionEmployerCountry(description);
          const timestamp = typeof job.pubDate === 'number' ? job.pubDate * (job.pubDate < 1e12 ? 1000 : 1) : Date.parse(job.pubDate);
          const salary = [job.currency, job.minSalary, job.maxSalary ? `– ${job.maxSalary}` : '', job.salaryPeriod].filter(Boolean).join(' ');
          const timezone = Array.isArray(job.timezoneRestrictions) && job.timezoneRestrictions.length ? `\nTimezone restrictions supplied by Himalayas: ${job.timezoneRestrictions.join(', ')}` : '';
          rows.push({ externalId: job.guid, title: job.title, company: job.companyName,
            location: `${locations.length ? locations.join('; ') : 'Worldwide'} (Remote)`,
            description: description + timezone, employerCountry,
            employerCountrySource: fact?.employerCountrySource || (employerCountry ? job.applicationLink : undefined),
            workplace: 'Remote', applyUrl: job.applicationLink, sourceUrl: job.applicationLink,
            source: 'Himalayas', sourceKey: key, observedAt: page.fetchedAt,
            updatedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined,
            salary: job.minSalary || job.maxSalary ? salary : undefined, attributionUrl: 'https://himalayas.app',
          });
        }
        pages++;
        if (!data.jobs.length || !added) { ended = true; break; }
        if (!page.cacheHit) await wait(700);
      } catch (error: any) {
        if (!rows.length) throw error;
        unit.partialError = `Page ${number}: ${String(error.message || error).slice(0, 200)}`;
        break;
      }
    }
    unit.exhaustive = ended && !unit.partialError;
    unit.coverage = `${pages} page(s), ${rows.length} listings${total !== undefined ? ` from ${total.toLocaleString()} source matches` : ''}; ${unit.exhaustive ? 'available result pages exhausted' : 'recent sample, not full inventory'}. Source cache: 24 hours.`;
    return rows;
  } };
  return unit;
}

export function greenhouseUnit(board: Board): SourceUnit {
  if (!/^[a-z0-9_-]{1,80}$/i.test(board.board) || !board.company) throw new Error('Invalid board configuration');
  const url = `https://boards-api.greenhouse.io/v1/boards/${board.board}/jobs?content=true`;
  const key = `greenhouse-${board.board}`;
  return { key, group: 'greenhouse', name: board.company, url, collect: async () => {
    const page = await cachedPage(url, 3600);
    return parseGreenhouse(JSON.parse(page.body), board, page.fetchedAt);
  } };
}

export function parseGreenhouse(data: any, board: Board, observedAt: string): RawJob[] {
  if (!Array.isArray(data?.jobs)) throw new Error('Greenhouse jobs array missing');
  return data.jobs.map((job: any): RawJob => {
    if (!job?.id || typeof job.title !== 'string' || typeof job.absolute_url !== 'string' || typeof job.content !== 'string') throw new Error('Employer feed schema changed; preserving previous data for this source');
    const metadata = Array.isArray(job.metadata) ? job.metadata : [];
    const locations = [job.location?.name,
      ...(Array.isArray(job.offices) ? job.offices.map((office: any) => office.location || office.name) : []),
      ...metadata.filter((field: any) => /^(job posting location|job location|locations?)$/i.test(field.name || '')).flatMap((field: any) => Array.isArray(field.value) ? field.value : [field.value]),
    ].filter((value): value is string => typeof value === 'string' && !!value.trim());
    const workplace = metadata.find((field: any) => /^(location type|workplace(?: type)?|work model)$/i.test(field.name || ''))?.value;
    const description = htmlToText(job.content);
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    return { externalId: String(job.id), title: job.title, company: board.company,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? job.absolute_url : undefined),
      location: [...new Set(locations)].join('; '), description,
      applyUrl: job.absolute_url, sourceUrl: job.absolute_url, source: 'Greenhouse', sourceKey: `greenhouse-${board.board}`,
      updatedAt: job.updated_at, observedAt, workplace: typeof workplace === 'string' ? workplace : undefined,
    };
  });
}

function validateBoard(board: Board): void {
  if (!/^[a-z0-9_.-]{1,80}$/i.test(board.board) || !board.company?.trim()) throw new Error('Invalid employer board');
}
const countryName = (country: unknown): string => typeof country === 'string' ? (COUNTRIES[country.toUpperCase()] || country) : '';

export function parseAshby(data: any, board: Board, observedAt: string): RawJob[] {
  if (!Array.isArray(data?.jobs)) throw new Error('Ashby jobs array missing');
  return data.jobs.filter((job: any) => job?.isListed !== false).map((job: any): RawJob => {
    if (!job?.id || typeof job.title !== 'string' || typeof job.jobUrl !== 'string' || typeof job.applyUrl !== 'string' || typeof job.descriptionPlain !== 'string') throw new Error('Ashby posting schema changed');
    const locations = [job.location, ...(Array.isArray(job.secondaryLocations) ? job.secondaryLocations.map((l: any) => [l.location, countryName(l.address?.addressCountry)].filter(Boolean).join(', ')) : []), countryName(job.address?.postalAddress?.addressCountry)].filter((l): l is string => typeof l === 'string' && !!l);
    const description = job.descriptionPlain;
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    return { externalId: String(job.id), title: job.title, company: board.company, location: [...new Set(locations)].join('; '), description,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? job.jobUrl : undefined),
      applyUrl: job.applyUrl, sourceUrl: job.jobUrl, source: 'Ashby', sourceKey: `ashby-${board.board}`,
      updatedAt: job.publishedAt, observedAt, workplace: job.isRemote === true || job.workplaceType === 'Remote' ? 'Remote' : job.workplaceType === 'Hybrid' ? 'Hybrid' : job.workplaceType === 'OnSite' ? 'Onsite' : undefined,
      salary: job.compensation?.scrapeableCompensationSalarySummary || undefined,
    };
  });
}
export function ashbyUnit(board: Board): SourceUnit {
  validateBoard(board);
  const url = `https://api.ashbyhq.com/posting-api/job-board/${board.board}?includeCompensation=true`;
  const unit: SourceUnit = { key: `ashby-${board.board}`, group: 'ashby', name: `${board.company} · Ashby`, url, collect: async () => {
    const page = await cachedPage(url, 3600);
    const rows = parseAshby(JSON.parse(page.body), board, page.fetchedAt);
    unit.coverage = `Complete public listed-job feed; ${rows.length} open postings. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}

export function parseLever(data: unknown, board: Board, observedAt: string): RawJob[] {
  if (!Array.isArray(data)) throw new Error('Lever postings array missing');
  return data.map((job: any): RawJob => {
    if (!job?.id || typeof job.text !== 'string' || typeof job.hostedUrl !== 'string' || typeof job.applyUrl !== 'string' || typeof job.descriptionPlain !== 'string') throw new Error('Lever posting schema changed');
    const locations = Array.isArray(job.categories?.allLocations) ? job.categories.allLocations : [job.categories?.location];
    const description = [job.descriptionPlain, ...(Array.isArray(job.lists) ? job.lists.map((list: any) => `${list.text || ''}\n${htmlToText(String(list.content || ''))}`) : []), job.additionalPlain, job.salaryDescriptionPlain].filter(Boolean).join('\n\n');
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    const salary = job.salaryRange;
    return { externalId: String(job.id), title: job.text, company: board.company,
      location: [...new Set([...locations, countryName(job.country)].filter((l): l is string => typeof l === 'string' && !!l))].join('; '), description,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? job.hostedUrl : undefined),
      applyUrl: job.applyUrl, sourceUrl: job.hostedUrl, source: 'Lever', sourceKey: `lever-${board.board}`,
      observedAt, updatedAt: typeof job.createdAt === 'number' ? new Date(job.createdAt).toISOString() : undefined,
      workplace: job.workplaceType === 'remote' ? 'Remote' : job.workplaceType === 'hybrid' ? 'Hybrid' : job.workplaceType === 'on-site' ? 'Onsite' : undefined,
      salary: salary ? [salary.currency, salary.min, salary.max ? `– ${salary.max}` : '', salary.interval].filter(Boolean).join(' ') : undefined,
    };
  });
}
export function leverUnit(board: Board): SourceUnit {
  validateBoard(board);
  const url = `https://${board.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${board.board}?mode=json&limit=100`;
  const unit: SourceUnit = { key: `lever-${board.board}`, group: 'lever', name: `${board.company} · Lever`, url, collect: async () => {
    const rows: RawJob[] = [];
    const seen = new Set<string>();
    unit.partialError = undefined; unit.exhaustive = false;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      try {
        const next = new URL(url); next.searchParams.set('skip', String(pageNumber * 100));
        const page = await cachedPage(next.href, 3600);
        const parsed = parseLever(JSON.parse(page.body), board, page.fetchedAt);
        let added = 0;
        for (const job of parsed) if (!seen.has(job.externalId)) { seen.add(job.externalId); rows.push(job); added++; }
        if (parsed.length < 100) { unit.exhaustive = true; break; }
        if (!added) { unit.partialError = 'Pagination repeated an earlier page; stopped'; break; }
        if (!page.cacheHit) await wait(500);
      } catch (error: any) {
        if (!rows.length) throw error;
        unit.partialError = `Page ${pageNumber + 1}: ${String(error.message || error).slice(0, 200)}`; break;
      }
    }
    unit.coverage = `${rows.length} published postings; ${unit.exhaustive ? 'public feed exhausted' : 'bounded at 20 pages; may be incomplete'}. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}

export function parseRelocate(html: string, url: string, observedAt: string): RawJob {
  validateSourceUrl(url);
  const $ = load(html);
  const title = $('h1').first().text().trim();
  const company = $('.job-info__company').first().text().trim();
  const location = $('.job-info__country').first().text().trim();
  const description = htmlToText($('.job-info__description').first().html() || '');
  if (!title || !company || !location || !description) throw new Error('Relocate.me listing schema changed');
  return { externalId: new URL(url).pathname.split('/').pop()!, title, company, location, description,
    applyUrl: url, sourceUrl: url, source: 'Relocate.me', sourceKey: 'relocate', observedAt, attributionUrl: 'https://relocate.me' };
}
export function relocateUnit(maxJobs: number): SourceUnit {
  const url = 'https://relocate.me/international-jobs';
  const unit: SourceUnit = { key: 'relocate', name: 'Relocate.me · international tech jobs', url, exhaustive: false, collect: async () => {
    const index = await cachedPage(url, 3600);
    const $ = load(index.body);
    const links = [...new Set($('a[href]').map((_, a) => $(a).attr('href') || '').get().filter(href => relocateJobPath.test(href)))];
    if (!links.length) throw new Error('Relocate.me job links missing');
    const rows: RawJob[] = [];
    const eligible = links.filter(link => {
      const title = $('a[href]').filter((_, a) => $(a).attr('href') === link).first().text().replace(/\s+/g, ' ');
      return classifyRole(title) && countriesFromLocation(link.split('/')[1].replace(/-/g, ' ')).some(code => code !== 'US' && code !== 'IN');
    });
    const errors: string[] = [];
    for (const link of eligible.slice(0, Math.min(100, Math.max(1, maxJobs)))) {
      const detailUrl = new URL(link, url).href;
      try {
        const page = await cachedPage(detailUrl, 3600);
        rows.push(parseRelocate(page.body, detailUrl, page.fetchedAt));
        if (!page.cacheHit) await wait(650);
      } catch (error: any) { errors.push(String(error.message || error).slice(0, 120)); }
    }
    if (errors.length && !rows.length) throw new Error(errors[0]);
    unit.partialError = errors.length ? `${errors.length} detail page(s) failed: ${errors[0]}` : undefined;
    unit.coverage = `${links.length} public job links, ${rows.length} UK/EU technical details collected. Paid newsletter ads excluded. Relocation-category membership alone is not visa proof. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}
export function remotiveUnit(): SourceUnit {
  const url = 'https://remotive.com/api/remote-jobs';
  return { key: 'remotive', name: 'Remotive · public remote jobs', url, exhaustive: true, coverage: 'Available public API inventory, delayed by provider by 24 hours. Cache: 6 hours (at most four requests/day).', collect: async () => {
    const page = await cachedPage(url, 21600);
    const data = JSON.parse(page.body);
    if (!Array.isArray(data.jobs)) throw new Error('Remotive jobs array missing');
    return data.jobs.map((job: any): RawJob => {
      if (!job?.id || typeof job.title !== 'string' || typeof job.company_name !== 'string' || typeof job.description !== 'string' || typeof job.url !== 'string') throw new Error('Remotive posting schema changed');
      const description = htmlToText(job.description);
      return { externalId: String(job.id), title: job.title, company: job.company_name,
        location: `${job.candidate_required_location || 'Location unspecified'} (Remote)`, description,
        employerCountry: descriptionEmployerCountry(description), employerCountrySource: job.url, workplace: 'Remote',
        applyUrl: job.url, sourceUrl: job.url, source: 'Remotive', sourceKey: 'remotive', updatedAt: job.publication_date,
        observedAt: page.fetchedAt, salary: job.salary || undefined, attributionUrl: 'https://remotive.com' };
    });
  } };
}

export function parseSmartRecruiters(job: any, board: Board, observedAt: string): RawJob | null {
  if (job?.active === false || (job?.visibility && job.visibility !== 'PUBLIC')) return null;
  if (!job?.id || typeof job.name !== 'string' || typeof job.applyUrl !== 'string' || !job.jobAd?.sections) throw new Error('SmartRecruiters detail schema changed');
  const description = Object.values(job.jobAd.sections).map((section: any) => `${section.title || ''}\n${htmlToText(String(section.text || ''))}`).join('\n\n');
  const location = [job.location?.fullLocation || job.location?.city, countryName(job.location?.country)].filter(Boolean).join('; ');
  const sourceUrl = job.postingUrl || `https://jobs.smartrecruiters.com/${board.board}/${job.id}`;
  const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
  return { externalId: String(job.id), title: job.name, company: board.company, location, description,
    employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? sourceUrl : undefined),
    source: 'SmartRecruiters', sourceKey: `smartrecruiters-${board.board}`, sourceUrl, applyUrl: job.applyUrl,
    workplace: job.location?.remote === true ? 'Remote' : job.location?.hybrid === true ? 'Hybrid' : undefined,
    observedAt, updatedAt: job.releasedDate,
  };
}
export function smartRecruitersUnit(board: Board): SourceUnit {
  validateBoard(board);
  const url = `https://api.smartrecruiters.com/v1/companies/${board.board}/postings`;
  const unit: SourceUnit = { key: `smartrecruiters-${board.board}`, group: 'smartrecruiters', name: `${board.company} · SmartRecruiters`, url, exhaustive: false, collect: async () => {
    const summaries: any[] = [];
    const seen = new Set<string>();
    let exhausted = false;
    unit.partialError = undefined;
    for (let number = 0; number < 20; number++) {
      try {
        const pageUrl = new URL(url); pageUrl.searchParams.set('limit', '100'); pageUrl.searchParams.set('offset', String(number * 100));
        const page = await cachedPage(pageUrl.href, 3600);
        const data = JSON.parse(page.body);
        if (!Array.isArray(data.content)) throw new Error('SmartRecruiters postings array missing');
        let added = 0;
        for (const summary of data.content) {
          if (!summary?.id || typeof summary.name !== 'string' || !/^[a-z0-9-]+$/i.test(String(summary.id))) throw new Error('SmartRecruiters listing schema changed');
          if (!seen.has(String(summary.id))) { seen.add(String(summary.id)); summaries.push(summary); added++; }
        }
        if (data.content.length < 100 || (typeof data.totalFound === 'number' && number * 100 + data.content.length >= data.totalFound)) { exhausted = true; break; }
        if (!added) throw new Error('SmartRecruiters pagination repeated a page');
        if (!page.cacheHit) await wait(500);
      } catch (error: any) {
        if (!summaries.length) throw error;
        unit.partialError = String(error.message || error).slice(0, 180); break;
      }
    }
    const eligible = summaries.filter(job => {
      if (!classifyRole(job.name)) return false;
      const countries = countriesFromLocation([job.location?.fullLocation, job.location?.city, countryName(job.location?.country)].filter(Boolean).join('; '));
      return countries.some(code => code !== 'US' && code !== 'IN') || (countries.includes('IN') && job.location?.remote === true);
    }).sort((a, b) => Number(a.location?.country?.toLowerCase() === 'in') - Number(b.location?.country?.toLowerCase() === 'in'));
    const rows: RawJob[] = [];
    if (unit.partialError && stopAfterSourceError(unit.partialError, 0)) throw new Error(unit.partialError);
    let failed = 0, consecutiveFailures = 0;
    let detailError = '';
    for (const summary of eligible.slice(0, 120)) {
      try {
        const page = await cachedPage(`${url}/${summary.id}`, 3600);
        const job = parseSmartRecruiters(JSON.parse(page.body), board, page.fetchedAt);
        if (job) rows.push(job);
        consecutiveFailures = 0;
        if (!page.cacheHit) await wait(500);
      } catch (error: any) {
        failed++; consecutiveFailures++;
        detailError = String(error.message || error).slice(0, 180);
        if (stopAfterSourceError(detailError, consecutiveFailures)) break;
      }
    }
    if (failed) unit.partialError = `${failed} posting detail(s) could not be read: ${detailError}${unit.partialError ? '; ' + unit.partialError : ''}`;
    if (failed && !rows.length) throw new Error(unit.partialError);
    unit.exhaustive = exhausted && eligible.length <= 120 && !unit.partialError;
    unit.coverage = `${summaries.length} public listings scanned, ${eligible.length} technical target-country candidates, ${rows.length} full descriptions collected. Limits: 20 listing pages / 120 details per employer. ${unit.exhaustive ? 'Target-country feed exhausted.' : 'Bounded or partial inventory.'} Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}
export function parseJobicy(data: any, observedAt: string): RawJob[] {
  if (!Array.isArray(data?.jobs) || data.success === false) throw new Error('Jobicy jobs array missing');
  return data.jobs.map((job: any): RawJob => {
    if (!job?.id || typeof job.jobTitle !== 'string' || typeof job.companyName !== 'string' || typeof job.jobDescription !== 'string' || typeof job.url !== 'string' || typeof job.jobGeo !== 'string') throw new Error('Jobicy posting schema changed');
    const description = htmlToText(job.jobDescription);
    const location = /^(anywhere|worldwide)$/i.test(job.jobGeo.trim()) ? 'Worldwide' : job.jobGeo;
    return { externalId: String(job.id), title: htmlToText(job.jobTitle), company: job.companyName,
      location: `${location} (Remote)`, description, workplace: 'Remote',
      employerCountry: descriptionEmployerCountry(description), employerCountrySource: job.url,
      source: 'Jobicy', sourceKey: 'jobicy', applyUrl: job.url, sourceUrl: job.url, observedAt,
      updatedAt: job.pubDate, attributionUrl: 'https://jobicy.com',
      salary: job.salaryMin || job.salaryMax ? [job.salaryCurrency, job.salaryMin, job.salaryMax ? `– ${job.salaryMax}` : '', job.salaryPeriod].filter(Boolean).join(' ') : undefined,
    };
  });
}
export function jobicyUnit(maxPages: number): SourceUnit {
  const url = 'https://jobicy.com/api/v2/remote-jobs?count=200';
  const unit: SourceUnit = { key: 'jobicy', name: 'Jobicy · remote jobs', url, exhaustive: false, collect: async () => {
    const rows: RawJob[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | null = null;
    let ended = false;
    unit.partialError = undefined;
    for (let number = 0; number < Math.min(20, Math.max(1, maxPages)); number++) {
      try {
        const next = new URL(url); if (cursor) next.searchParams.set('cursor', cursor);
        const page = await cachedPage(next.href, 21600);
        const data = JSON.parse(page.body);
        for (const job of parseJobicy(data, page.fetchedAt)) if (!ids.has(job.externalId)) { ids.add(job.externalId); rows.push(job); }
        cursor = data.nextCursor;
        if (cursor === null) { ended = true; break; }
        if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[a-z0-9_-]+$/i.test(cursor) || cursors.has(cursor)) throw new Error('Invalid or repeated Jobicy cursor');
        cursors.add(cursor);
        if (!page.cacheHit) await wait(1500);
      } catch (error: any) {
        if (!rows.length) throw error;
        unit.partialError = String(error.message || error).slice(0, 200); break;
      }
    }
    unit.coverage = `${rows.length} recent public listings; ${ended ? 'seven-day discovery window exhausted' : 'bounded sample; more pages may remain'}. Older vacancies may still be active. Cache: 6 hours. Canonical Jobicy links retained.`;
    return rows;
  } };
  return unit;
}

function hiringUnit(country: string, query: string, days: number): SourceUnit {
  if (!COUNTRIES[country]) throw new Error(`Unknown country ${country}`);
  const name = COUNTRIES[country];
  const state = { searchQuery: query, locations: [{ formatted_address: name, types: ['country'], id: 'user_country', address_components: [{ long_name: name, short_name: country, types: ['country'] }] }], dateFetchedPastNDays: days };
  const url = `https://hiringcafe.com/?searchState=${encodeURIComponent(JSON.stringify(state))}`;
  const key = `hiringcafe-${country}-${query.replace(/\W+/g, '_')}`;
  return { key, name: `Hiring.cafe · ${name} · ${query}`, url, collect: async () => {
    const $ = load(await fetchPublic(url));
    const embedded = $('#__NEXT_DATA__').text();
    if (!embedded) throw new Error('Hiring.cafe page has no SSR data; layout changed or access blocked');
    const data = JSON.parse(embedded)?.props?.pageProps;
    if (!Array.isArray(data?.ssrHits)) throw new Error('Hiring.cafe ssrHits missing; review source format');
    return data.ssrHits.map((job: any): RawJob => {
      const p = job.v5_processed_job_data ?? {};
      const c = job.enriched_company_data ?? {};
      return { externalId: String(job.collapse_key || job.id || ''), title: job.job_information?.title || p.core_job_title || '',
        company: c.name || p.company_name || '', employerCountry: c.hq_country === 'United States' ? 'US' : c.hq_country,
        employerCountrySource: url, location: [p.workplace_cities, p.workplace_states, p.workplace_countries].flat(2).filter(Boolean).join(', '),
        description: htmlToText(job.job_information?.description || ''), applyUrl: job.apply_url || '', sourceUrl: url,
        source: 'Hiring.cafe', sourceKey: key, workplace: p.workplace_type,
      };
    });
  } };
}

export const MAX_BOARDS = 8000;
export function boardUnit(board: Board): SourceUnit {
  switch (board.provider) {
    case 'ashby': return ashbyUnit(board);
    case 'lever': return leverUnit(board);
    case 'smartrecruiters': return smartRecruitersUnit(board);
    case 'workable': return workableUnit(board);
    case 'recruitee': return recruiteeUnit(board);
    case 'personio': return personioUnit(board);
    default: return greenhouseUnit(board);
  }
}
export function configuredSources(): SourceUnit[] {
  const config: SourceConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/tech-sources.json'), 'utf8'));
  if (!Array.isArray(config.boards) || config.boards.length > MAX_BOARDS) throw new Error(`Configure up to ${MAX_BOARDS} direct employer feeds`);
  const units = config.boards.filter(board => board.enabled !== false).map(boardUnit);
  if (config.relocate?.enabled) units.push(relocateUnit(config.relocate.maxJobs));
  if (config.remotive?.enabled) units.push(remotiveUnit());
  if (config.jobicy?.enabled) units.push(jobicyUnit(config.jobicy.maxPages));
  if (config.arbeitnow?.enabled) {
    const pages = Math.min(50, Math.max(1, config.arbeitnow.pagesPerFeed || 20));
    units.push(arbeitnowUnit('uk', false, pages), arbeitnowUnit('de', false, pages), arbeitnowUnit('de', true, pages));
  }
  if (config.himalayas?.enabled) {
    const facts = new Map(config.boards.map(board => [board.company.toLowerCase().replace(/[^a-z0-9]/g, ''), board]));
    const pages = Math.min(50, Math.max(1, config.himalayas.pagesPerMarket || 10));
    for (const country of [...new Set(config.himalayas.countries)]) units.push(himalayasUnit(country, pages, facts));
    for (const query of ['engineer', 'developer']) {
      units.push(himalayasUnit('IN', Math.min(20, pages * 2), facts, query));
      if (config.himalayas.worldwide) units.push(himalayasUnit('worldwide', Math.min(20, pages * 2), facts, query));
    }
  }
  if (config.hiringCafe?.enabled) {
    const h = config.hiringCafe;
    const max = Math.max(1, Math.min(100, Number(h.maxQueries) || 24));
    // Interleave countries so a bounded run covers each country before another role family.
    const all = h.queries.flatMap(query => h.countries.map(country => hiringUnit(country, query, Math.min(120, Math.max(1, h.daysLookback || 30)))));
    units.push(...all.slice(0, max));
  }
  if (config.jackAndJill?.enabled) units.push(jackAndJillUnit(config.jackAndJill.maxJobs));
  if (config.linkedin?.enabled) units.push(linkedinUnit(config.linkedin));
  return units;
}
