import { load } from 'cheerio';
import { COUNTRIES } from './classify';
import { cachedPage, descriptionEmployerCountry, htmlToText, type Board, type SourceUnit } from './sources';
import type { RawJob } from './types';

// Public career-site feeds that many European employers use. Each is a read-only, unauthenticated feed
// published for embedding job lists on the employer's own website.
const countryName = (value: unknown): string => typeof value === 'string' ? (COUNTRIES[value.toUpperCase()] || value) : '';
const slug = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const cleanLegalName = (name: string) => name.replace(/\s*,?\s*\b(?:GmbH(?: & Co\.? KG)?|SE & Co\.? KG|SE|AG|B\.?V\.?|N\.?V\.?|Ltd\.?|Limited|S\.?A\.?S?|S\.?L\.?U?|S\.?r\.?l\.?|SpA|Oy|AB|ApS|A\/S|Inc\.?|LLC|plc)\s*$/i, '').trim() || name;

export function parseWorkable(data: any, board: Board, observedAt: string): RawJob[] {
  if (!Array.isArray(data?.jobs)) throw new Error('Workable jobs array missing');
  return data.jobs.map((job: any): RawJob => {
    if (!job?.shortcode || typeof job.title !== 'string' || typeof job.url !== 'string') throw new Error('Workable posting schema changed');
    const places = Array.isArray(job.locations) && job.locations.length ? job.locations : [{ city: job.city, region: job.state, country: job.country }];
    const location = [...new Set(places.filter((p: any) => !p?.hidden || places.length === 1).map((p: any) => [p?.city, p?.region, p?.country || countryName(p?.countryCode)].filter(Boolean).join(', ')).filter(Boolean))].join('; ');
    const description = htmlToText(String(job.description || ''));
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    return { externalId: String(job.shortcode), title: job.title, company: board.company,
      location: location + (job.telecommuting === true ? ' (Remote)' : ''), description,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? job.url : undefined),
      applyUrl: typeof job.application_url === 'string' ? job.application_url : job.url, sourceUrl: job.url,
      source: 'Workable', sourceKey: `workable-${board.board}`, observedAt,
      updatedAt: typeof job.published_on === 'string' ? job.published_on : undefined, workplace: job.telecommuting === true ? 'Remote' : undefined,
    };
  });
}
export function workableUnit(board: Board): SourceUnit {
  if (!slug.test(board.board)) throw new Error('Invalid Workable account');
  const url = `https://apply.workable.com/api/v1/widget/accounts/${board.board}?details=true`;
  const unit: SourceUnit = { key: `workable-${board.board}`, group: 'workable', name: `${board.company} · Workable`, url, collect: async () => {
    const page = await cachedPage(url, 3600);
    const rows = parseWorkable(JSON.parse(page.body), board, page.fetchedAt);
    unit.coverage = `Complete public widget feed; ${rows.length} open postings. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}
export function workableName(data: any): string | undefined {
  return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : undefined;
}

export function parseRecruitee(data: any, board: Board, observedAt: string): RawJob[] {
  if (!Array.isArray(data?.offers)) throw new Error('Recruitee offers array missing');
  return data.offers.filter((job: any) => !job?.status || job.status === 'published').map((job: any): RawJob => {
    if (!job?.id || typeof job.title !== 'string' || typeof job.careers_url !== 'string') throw new Error('Recruitee offer schema changed');
    const places = Array.isArray(job.locations) && job.locations.length ? job.locations.map((l: any) => [l?.city || l?.name, l?.country || countryName(l?.country_code)].filter(Boolean).join(', ')) : [job.location || [job.city, job.country].filter(Boolean).join(', ')];
    const description = [htmlToText(String(job.description || '')), htmlToText(String(job.requirements || ''))].filter(Boolean).join('\n\n');
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    const workplace = job.remote === true ? 'Remote' : job.hybrid === true ? 'Hybrid' : job.on_site === true ? 'Onsite' : undefined;
    return { externalId: String(job.id), title: job.title, company: board.company,
      location: [...new Set(places.filter(Boolean))].join('; ') + (workplace === 'Remote' ? ' (Remote)' : ''), description,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? job.careers_url : undefined),
      applyUrl: typeof job.careers_apply_url === 'string' ? job.careers_apply_url : job.careers_url, sourceUrl: job.careers_url,
      source: 'Recruitee', sourceKey: `recruitee-${board.board}`, observedAt, workplace,
      updatedAt: typeof job.published_at === 'string' ? new Date(job.published_at.replace(' UTC', 'Z').replace(' ', 'T')).toISOString() : undefined,
    };
  });
}
export function recruiteeUnit(board: Board): SourceUnit {
  if (!slug.test(board.board)) throw new Error('Invalid Recruitee company');
  const url = `https://${board.board}.recruitee.com/api/offers/`;
  const unit: SourceUnit = { key: `recruitee-${board.board}`, group: 'recruitee', name: `${board.company} · Recruitee`, url, collect: async () => {
    const page = await cachedPage(url, 3600);
    const rows = parseRecruitee(JSON.parse(page.body), board, page.fetchedAt);
    unit.coverage = `Complete public offers feed; ${rows.length} published postings. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}
export function recruiteeName(data: any): string | undefined {
  const name = data?.offers?.find((o: any) => typeof o?.company_name === 'string' && o.company_name.trim())?.company_name;
  return name ? cleanLegalName(name.trim()) : undefined;
}

export function parsePersonio(xml: string, board: Board, observedAt: string): RawJob[] {
  const $ = load(xml, { xml: true });
  if (!$('workzag-jobs').length) throw new Error('Personio XML feed schema changed');
  const origin = `https://${board.board}.jobs.personio.${board.region === 'com' ? 'com' : 'de'}`;
  return $('position').toArray().map((el): RawJob => {
    const p = $(el);
    const id = p.children('id').text().trim(), title = p.children('name').text().trim();
    if (!/^\d+$/.test(id) || !title) throw new Error('Personio position schema changed');
    const offices = [p.children('office').text().trim(), ...p.find('additionalOffices > office').toArray().map(o => $(o).text().trim())].filter(Boolean);
    const description = p.find('jobDescriptions > jobDescription').toArray().map(d => `${$(d).children('name').text().trim()}\n${htmlToText($(d).children('value').text())}`).join('\n\n');
    const url = `${origin}/job/${id}?language=en&display=en`;
    const employerCountry = board.employerCountry || descriptionEmployerCountry(description);
    const remote = /\bremote\b/i.test(offices.join(' ') + ' ' + p.children('schedule').text());
    // Group boards list several subsidiaries. Same-brand entities ("Sungrow Italy") stay under the board's name so
    // the company groups together; a differently named subsidiary keeps its own employer name.
    const subcompany = cleanLegalName(p.children('subcompany').text().trim());
    const brand = board.board.split(/[-_.]/)[0].toLowerCase();
    const own = subcompany && !isPlaceName(subcompany) && !subcompany.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(brand);
    return { externalId: id, title, company: own ? subcompany : board.company, location: [...new Set(offices)].join('; '), description,
      employerCountry, employerCountrySource: board.employerCountrySource || (employerCountry ? url : undefined),
      applyUrl: url, sourceUrl: url, source: 'Personio', sourceKey: `personio-${board.board}`, observedAt,
      updatedAt: p.children('createdAt').text().trim() || undefined, workplace: remote ? 'Remote' : undefined,
    };
  });
}
export function personioUnit(board: Board): SourceUnit {
  if (!slug.test(board.board)) throw new Error('Invalid Personio company');
  const url = `https://${board.board}.jobs.personio.${board.region === 'com' ? 'com' : 'de'}/xml?language=en`;
  const unit: SourceUnit = { key: `personio-${board.board}`, group: 'personio', name: `${board.company} · Personio`, url, collect: async () => {
    const page = await cachedPage(url, 3600);
    const rows = parsePersonio(page.body, board, page.fetchedAt);
    unit.coverage = `Complete public XML feed; ${rows.length} open positions. Cache: 1 hour.`;
    return rows;
  } };
  return unit;
}
// Personio's subcompany is sometimes a regional entity ("Greece", "FRANCE"); those are not employer names.
const PLACE = new RegExp(`^(?:${[...Object.values(COUNTRIES), 'Europe', 'EMEA', 'DACH', 'Benelux', 'Nordics', 'UK', 'USA', 'Remote', 'Global', 'International', 'Headquarters', 'HQ'].join('|')})$`, 'i');
export function isPlaceName(name: string): boolean { return PLACE.test(name.trim()); }
/** Board-level name only when every position names the same employer; group boards keep their slug name. */
export function personioName(xml: string): string | undefined {
  const $ = load(xml, { xml: true });
  const names = new Set($('position > subcompany').toArray().map(el => cleanLegalName($(el).text().trim())).filter(name => name && !isPlaceName(name)));
  return names.size === 1 ? [...names][0] : undefined;
}

/** Company name from an ATS board landing page title: "Tracebit Jobs" (Ashby), "Spotify" (Lever). */
export function nameFromBoardPage(html: string): string | undefined {
  const title = load(html)('title').first().text().replace(/\s+/g, ' ').trim();
  if (!title || /not found|404|error|page not/i.test(title)) return undefined;
  const name = title.replace(/\s*[-–|·]?\s*(?:jobs|careers|job board|open positions)(?: page)?$/i, '').replace(/^(?:jobs|careers) (?:at|@)\s+/i, '').trim();
  return name && name.length <= 120 ? name : undefined;
}
