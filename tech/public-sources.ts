import { load } from 'cheerio';
import { classifyRole, safePublicUrl, COUNTRIES } from './classify';
import { cachedPage, descriptionEmployerCountry, htmlToText, validateSourceUrl, stopAfterSourceError, type SourceUnit } from './sources';
import type { RawJob } from './types';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const asArray = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];
const countryName = (value: any): string => typeof value === 'string' ? COUNTRIES[value.toUpperCase()] || value : typeof value?.name === 'string' ? value.name : '';

export function jackAndJillLinks(xml: string): string[] {
  const $ = load(xml, { xml: true });
  if (!$('urlset').length) throw new Error('Jack & Jill sitemap schema changed');
  return [...new Set($('url > loc').map((_, el) => $(el).text().trim()).get())].filter(url => {
    try {
      validateSourceUrl(url);
      const u = new URL(url);
      return u.hostname === 'www.jackandjill.ai' && /^\/jobs\/(engineer|engineering|data|product|design)\//.test(u.pathname);
    } catch { return false; }
  });
}

export function parseJackAndJill(html: string, url: string, observedAt: string): RawJob | null {
  validateSourceUrl(url);
  if (new URL(url).hostname !== 'www.jackandjill.ai') throw new Error('Wrong job origin');
  const $ = load(html);
  const nodes: any[] = [];
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const parsed = JSON.parse($(el).text());
    for (const node of asArray(parsed)) nodes.push(node, ...asArray(node?.['@graph']));
  }
  const job = nodes.find(node => asArray(node?.['@type']).includes('JobPosting'));
  // Some live pages carry no structured vacancy (and no country); they cannot be placed in a region, so skip them.
  if (!job) {
    if (!nodes.some(node => asArray(node?.['@type']).includes('Organization') || asArray(node?.['@type']).includes('BreadcrumbList') || node?.itemListElement)) throw new Error('Jack & Jill page has no structured data; page may have changed');
    return null;
  }
  if (job.validThrough && Date.parse(job.validThrough) < Date.now()) return null;
  if (/\b(?:no longer accepting applications|this (?:job|role) is (?:closed|no longer available))\b/i.test($('main').text())) return null;
  if (typeof job.title !== 'string' || typeof job.description !== 'string' || typeof job.hiringOrganization?.name !== 'string') throw new Error('Jack & Jill job fields missing');
  const id = job.identifier?.value;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !new URL(url).pathname.endsWith(id)) throw new Error('Jack & Jill posting identity mismatch');
  const locations = asArray(job.jobLocation).map(place => {
    const a = place?.address || {};
    return [a.addressLocality, a.addressRegion, countryName(a.addressCountry)].filter(v => typeof v === 'string' && v.trim()).join(', ');
  }).filter(Boolean);
  const remote = job.jobLocationType === 'TELECOMMUTE';
  const eligible = asArray(job.applicantLocationRequirements).map(countryName).filter(Boolean);
  // An employer's headquarters is never evidence for the applicant's location.
  const location = [...locations, ...eligible].join('; ') + (remote ? ' (Remote)' : '');
  const description = htmlToText(job.description.replace(/\\n/g, '\n'));
  const employerCountry = descriptionEmployerCountry(description);
  return { externalId: id, title: job.title, company: job.hiringOrganization.name, location, description,
    source: 'Jack & Jill', sourceKey: 'jackandjill', sourceUrl: url, applyUrl: url,
    observedAt, updatedAt: job.datePosted, workplace: remote ? 'Remote' : undefined,
    employerCountry, employerCountrySource: employerCountry ? url : undefined,
    attributionUrl: 'https://www.jackandjill.ai',
  };
}

export function jackAndJillUnit(maxJobs: number): SourceUnit {
  const url = 'https://www.jackandjill.ai/jobs/sitemap.xml';
  const unit: SourceUnit = { key: 'jackandjill', name: 'Jack & Jill · public vacancies', url, exhaustive: false, collect: async () => {
    unit.partialError = undefined;
    const sitemap = await cachedPage(url, 21600);
    const links = jackAndJillLinks(sitemap.body);
    if (!links.length) throw new Error('Jack & Jill sitemap contains no technical job links');
    const rows: RawJob[] = [];
    let failed = 0, checked = 0, consecutiveFailures = 0;
    for (const link of links.slice(0, Math.min(1000, Math.max(1, maxJobs)))) {
      try {
        const page = await cachedPage(link, 21600);
        const job = parseJackAndJill(page.body, link, page.fetchedAt);
        if (job) rows.push(job);
        checked++;
        consecutiveFailures = 0;
        if (!page.cacheHit) await pause(1000);
      } catch (error: any) {
        failed++; consecutiveFailures++;
        unit.partialError = `${failed} detail page(s) failed: ${String(error.message || error).slice(0, 170)}`;
        if (stopAfterSourceError(String(error.message), consecutiveFailures)) break;
        await pause(1000);
      }
    }
    if (!rows.length && failed) throw new Error(unit.partialError);
    unit.exhaustive = checked === links.length && !failed;
    unit.coverage = `${checked}/${links.length} technical sitemap pages checked. Public JobPosting data; employer names come from each vacancy. Introduction/application continues on Jack & Jill. Cache: 6 hours.`;
    return rows;
  } };
  return unit;
}

export interface LinkedinQuery { keywords: string; location: string; companyId?: string }
export interface LinkedinConfig { enabled: boolean; queries: LinkedinQuery[]; pagesPerQuery: number; maxJobs: number }
export interface LinkedinCard { id: string; title: string; company: string; location: string; datePosted?: string }
export function parseLinkedinCards(html: string): LinkedinCard[] {
  const $ = load(html);
  const cards: LinkedinCard[] = [];
  for (const el of $('[data-entity-urn]').toArray()) {
    const id = ($(el).attr('data-entity-urn') || '').match(/^urn:li:jobPosting:(\d{6,15})$/)?.[1];
    if (!id) continue;
    const title = $(el).find('.base-search-card__title').text().trim();
    const company = $(el).find('.base-search-card__subtitle').text().trim();
    const location = $(el).find('.job-search-card__location').text().trim();
    if (!title || !company || !location) throw new Error('LinkedIn search card schema changed');
    cards.push({ id, title, company, location, datePosted: $(el).find('time').attr('datetime') });
  }
  if (!cards.length && html.trim() && !/no results|no matching jobs|no jobs found/i.test($.text())) throw new Error('LinkedIn returned no recognizable job cards');
  return cards;
}

export function parseLinkedinJob(html: string, card: LinkedinCard, observedAt: string): RawJob | null {
  if (!/^\d{6,15}$/.test(card.id)) throw new Error('Invalid LinkedIn job ID');
  const $ = load(html);
  if (/no longer accepting applications|this job is no longer available/i.test($('.closed-job,.top-card-layout,.topcard').text())) return null;
  const title = $('.top-card-layout__title').first().text().trim();
  const listedBy = $('.topcard__org-name-link').first().text().trim();
  const location = $('.topcard__flavor--bullet').first().text().trim();
  const desc = $('.show-more-less-html__markup').first();
  if (!title || !listedBy || !location || !desc.length) throw new Error('LinkedIn public detail missing; sign-in wall or schema change');
  const description = htmlToText(desc.html() || '');
  if (description.length < 80) throw new Error('LinkedIn description is incomplete');
  let company = listedBy, cleanTitle = title;
  // Jack & Jill publishes customer roles. Preserve a named customer instead of counting the recruiter as that employer.
  if (/^Jack\s*(?:&|and)\s*Jill$/i.test(listedBy)) {
    const match = title.match(/^(.+?)\s+at\s+(.+)$/);
    if (match) { cleanTitle = match[1]; company = match[2]; }
  }
  const sourceUrl = `https://www.linkedin.com/jobs/view/${card.id}`;
  const applyLink = $('a[data-tracking-control-name="public_jobs_apply-link-offsite"]').attr('href');
  const applyUrl = applyLink && safePublicUrl(applyLink) || sourceUrl;
  const employerCountry = descriptionEmployerCountry(description);
  return { externalId: card.id, title: cleanTitle, company, location, description, applyUrl, sourceUrl,
    source: 'LinkedIn', sourceKey: 'linkedin-public', observedAt, updatedAt: card.datePosted,
    employerCountry, employerCountrySource: employerCountry ? sourceUrl : undefined, attributionUrl: 'https://www.linkedin.com/jobs',
  };
}

export function linkedinUnit(config: LinkedinConfig): SourceUnit {
  const base = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
  const unit: SourceUnit = { key: 'linkedin-public', name: 'LinkedIn · public job search', url: base, exhaustive: false, collect: async () => {
    unit.partialError = undefined;
    unit.closedJobIds = [];
    const cards = new Map<string, LinkedinCard>();
    const rows: RawJob[] = [];
    let searches = 0, details = 0, consecutiveFailures = 0;
    let blocked = false;
    const maxJobs = Math.min(500, Math.max(1, config.maxJobs));
    const failures: string[] = [];
    for (const query of config.queries.slice(0, 40)) {
      if (blocked || details >= maxJobs) break;
      for (let pageNumber = 0; pageNumber < Math.min(5, Math.max(1, config.pagesPerQuery)); pageNumber++) {
        const url = new URL(base);
        url.searchParams.set('keywords', query.keywords.slice(0, 200)); url.searchParams.set('location', query.location.slice(0, 100));
        url.searchParams.set('start', String(pageNumber * 10)); url.searchParams.set('f_TPR', 'r2592000');
        if (query.companyId && /^\d{1,15}$/.test(query.companyId)) url.searchParams.set('f_C', query.companyId);
        try {
          const page = await cachedPage(url.href, 21600);
          const parsed = parseLinkedinCards(page.body);
          consecutiveFailures = 0;
          searches++;
          if (!page.cacheHit) await pause(2000);
          let added = 0;
          for (const card of parsed) {
            if (!classifyRole(card.title) || cards.has(card.id) || details >= maxJobs) continue;
            cards.set(card.id, card); added++; details++;
            try {
              const detail = await cachedPage(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.id}`, 21600);
              const job = parseLinkedinJob(detail.body, card, detail.fetchedAt);
              if (job) rows.push(job);
              else unit.closedJobIds.push(`${unit.key}:${card.id}`);
              consecutiveFailures = 0;
              if (!detail.cacheHit) await pause(2000);
            } catch (error: any) {
              failures.push(String(error.message || error).slice(0, 180));
              consecutiveFailures++;
              blocked = stopAfterSourceError(String(error.message), consecutiveFailures);
              if (blocked) break;
              await pause(2000);
            }
          }
          if (blocked || details >= maxJobs || parsed.length < 10 || !added) break;
        } catch (error: any) {
          failures.push(String(error.message || error).slice(0, 180));
          consecutiveFailures++;
          blocked = stopAfterSourceError(String(error.message), consecutiveFailures) || /no recognizable/i.test(String(error.message));
          break;
        }
      }
    }
    if (failures.length) unit.partialError = `${failures.length} request(s) incomplete: ${failures[0]}`;
    if (!rows.length && failures.length) throw new Error(unit.partialError);
    unit.coverage = `${searches} public search pages, ${cards.size} technical candidates, ${rows.length} full descriptions. Bounded 30-day searches, not all LinkedIn jobs. Apply may require LinkedIn sign-in. Cache: 6 hours; stops on access blocks.`;
    return rows;
  } };
  return unit;
}
