import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSourceConfig, getOutputPaths, ensureOutputDir, generatePrimaryKey, updateDataAsOf } from '../lib/source-config';
import { classifyJob, classifyRole, COUNTRIES, inferUsEmployer } from './classify';
import { configuredSources, descriptionEmployerCountry, pruneFeedCache, ROOT, SOURCE_DIR, type SourceUnit } from './sources';
import { applySponsorRegisters, refreshRegisters } from './registers';
import { createEmployerEnricher } from './employers';
import type { ContractRecord, RawJob, Snapshot, SourceResult, RunState, Job } from './types';

export const STORE = path.join(ROOT, '.local');
export const SNAPSHOT_FILE = path.join(STORE, 'jobs.json');
const LOCK = path.join(STORE, 'refresh.lock');
export const runState: RunState = { running: false, startedAt: null, finishedAt: null, completed: 0, total: 0, message: 'Ready to refresh', error: null };
export const emptySnapshot = (): Snapshot => ({ version: 1, updatedAt: null, jobs: [], sources: [] });
export function readSnapshot(): Snapshot {
  if (!fs.existsSync(SNAPSHOT_FILE)) return emptySnapshot();
  const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error('Invalid local snapshot; refresh to rebuild');
  return data;
}
export function atomicWrite(file: string, value: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function acquireLock(): () => void {
  fs.mkdirSync(STORE, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch (err: any) { if (err.code !== 'ESRCH') alive = true; }
    }
    if (alive) throw new Error('Another refresh is already running');
    fs.unlinkSync(LOCK);
  }
  fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx', mode: 0o600 });
  return () => { try { fs.unlinkSync(LOCK); } catch {} };
}
export const companyKey = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const EMPLOYER_GROUPS = new Set(['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workable', 'recruitee', 'personio']);
export const EMPLOYER_FEEDS = ['Greenhouse', 'Ashby', 'Lever', 'SmartRecruiters', 'Workable', 'Recruitee', 'Personio'];
// Parallel requests per provider host. Each provider is rate-limited separately; single-feed sources run alone.
const GROUP_LIMITS: Record<string, number> = { greenhouse: 6, ashby: 6, lever: 4, smartrecruiters: 2, workable: 2, recruitee: 6, personio: 6 };
export async function runGrouped<T>(units: SourceUnit[], work: (unit: SourceUnit, index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(units.length);
  const groups = new Map<string, number[]>();
  units.forEach((unit, index) => { const g = unit.group || unit.key; groups.set(g, [...(groups.get(g) || []), index]); });
  await Promise.all([...groups.entries()].map(async ([group, indexes]) => {
    let next = 0;
    const lane = async () => { while (next < indexes.length) { const index = indexes[next++]; results[index] = await work(units[index], index); } };
    await Promise.all(Array.from({ length: Math.min(GROUP_LIMITS[group] || 1, indexes.length) }, lane));
  }));
  return results;
}
export function mergeSourceJobs(previous: Job[], fresh: Job[], results: SourceResult[]): Job[] {
  const retainedSources = new Set(results.filter(s => s.status !== 'ok' || s.exhaustive === false).map(s => s.key));
  // A bounded recent feed cannot tell us whether an older vacancy closed.
  const cutoff = Date.now() - 45 * 86400000;
  const closed = new Set(results.flatMap(source => source.closedJobIds || []));
  const retained = previous.filter(j => !closed.has(j.id) && retainedSources.has(j.sourceKey) && Date.parse(j.fetchedAt) >= cutoff).map(job => {
    const location = job.location.replace(/ · [^\n]+ \(source region\)$/, '');
    const employerCountry = job.employerCountrySource === job.sourceUrl ? descriptionEmployerCountry(job.description) : job.employerCountry;
    return classifyJob({ externalId: job.id.startsWith(job.sourceKey + ':') ? job.id.slice(job.sourceKey.length + 1) : job.id,
      title: job.title, company: job.company, location, description: job.description,
      employerCountry, employerCountrySource: job.employerCountrySource, employerCountryReason: job.employerCountryReason,
      workplace: job.workplace, countryHints: job.sourceKey === 'arbeitnow-uk' ? ['GB'] : undefined,
      applyUrl: job.applyUrl, sourceUrl: job.sourceUrl, source: job.source, sourceKey: job.sourceKey,
      updatedAt: job.sourceUpdatedAt, observedAt: job.fetchedAt, salary: job.salary, attributionUrl: job.attributionUrl,
    }, job.fetchedAt);
  }).filter((job): job is Job => job !== null);
  const seen = new Map<string, Job>();
  for (const job of [...retained, ...fresh]) seen.set(job.id, job);
  const urls = new Set<string>();
  const byTitle = new Map<string, Job[]>();
  const employerFeeds = new Set(EMPLOYER_FEEDS);
  const normalizedText = new Map<string, string>();
  const content = (job: Job) => {
    if (!normalizedText.has(job.id)) normalizedText.set(job.id, job.description.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
    return normalizedText.get(job.id)!;
  };
  const countryNames = new Set([...Object.values(COUNTRIES), ...Object.keys(COUNTRIES), 'UK', 'USA', 'Europe', 'EMEA', 'Worldwide'].map(value => value.toLowerCase()));
  const places = (job: Job) => job.location.toLowerCase().split(/[,;|\n]/).map(value => value.replace(/\([^)]*\)/g, '').replace(/\b(?:remote|hybrid|onsite|on-site|home based)\b/g, '').trim()).filter(value => value.length > 2 && !countryNames.has(value));
  const samePosting = (a: Job, b: Job) => {
    if (a.source === b.source || (employerFeeds.has(a.source) && employerFeeds.has(b.source))) return false;
    const sharedCountry = a.countries.some(country => b.countries.includes(country));
    const aPlaces = places(a), bPlaces = places(b);
    const sharedPlace = aPlaces.some(place => bPlaces.includes(place));
    const compatible = sharedCountry && (sharedPlace || (a.workplace === 'Remote' && b.workplace === 'Remote') || (!aPlaces.length && !bPlaces.length));
    if (!compatible && a.location.toLowerCase() !== b.location.toLowerCase()) return false;
    // An aggregator copy (Arbeitnow, Himalayas, LinkedIn…) of a role already on the employer's own board is a
    // mirror even when its description was reformatted. Two identical openings on one board are still kept.
    if (employerFeeds.has(a.source) !== employerFeeds.has(b.source)) return true;
    const left = content(a), right = content(b);
    const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
    return shorter.length >= 500 && shorter.length / longer.length >= 0.8 && longer.includes(shorter);
  };
  const rank: Record<string, number> = { Greenhouse: 0, Ashby: 0, Lever: 0, SmartRecruiters: 0, Workable: 0, Recruitee: 0, Personio: 0, Arbeitnow: 1, 'Relocate.me': 1, Remotive: 2, Himalayas: 2, 'Jack & Jill': 2, LinkedIn: 3 };
  const candidates = [...seen.values()].sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3) || b.fetchedAt.localeCompare(a.fetchedAt));
  // One display name per employer: "Abnormalsecurity" (an aggregator slug) and "Abnormal Security" are the same
  // company, as are "Aiven36" and "Aiven". Employer feeds rank first, so their spelling wins.
  const companyNames = new Map<string, string>(), nameRank = new Map<string, number>();
  for (const job of candidates) {
    const key = companyKey(job.company), known = companyNames.get(key), level = rank[job.source] ?? 3;
    // Employer-feed spelling wins; otherwise a spaced name beats a run-together aggregator slug.
    if (!known || (nameRank.get(key)! > 0 && !/\s/.test(known) && /\s/.test(job.company))) { companyNames.set(key, job.company); nameRank.set(key, level); }
  }
  for (const key of [...companyNames.keys()]) {
    const base = key.match(/^(.{3,}?)\d{1,3}$/)?.[1];
    if (base && companyNames.has(base)) companyNames.set(key, companyNames.get(base)!);
  }
  return candidates.filter(job => {
    const url = new URL(job.applyUrl);
    if (['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname)) url.pathname = url.pathname.replace(/\/apply\/?$/, '');
    if (url.hostname === 'jobs.ashbyhq.com') url.pathname = url.pathname.replace(/\/application\/?$/, '');
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    const identity = url.href;
    const titleKey = [job.company, job.title].map(value => value.toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
    const related = byTitle.get(titleKey) || [];
    if (urls.has(identity) || related.some(other => samePosting(job, other))) return false;
    urls.add(identity); related.push(job); byTitle.set(titleKey, related); return true;
  }).map(job => ({ ...job, company: companyNames.get(companyKey(job.company)) || job.company }))
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt) || a.company.localeCompare(b.company));
}

export async function refresh(units: SourceUnit[] = configuredSources()): Promise<Snapshot> {
  if (runState.running) throw new Error('A refresh is already running');
  const release = acquireLock();
  Object.assign(runState, { running: true, startedAt: new Date().toISOString(), finishedAt: null, completed: 0, total: units.length, message: 'Starting public job feeds', error: null });
  try {
  const config = loadSourceConfig(SOURCE_DIR);
  const paths = getOutputPaths(SOURCE_DIR);
  const previous = readSnapshot();
  const records: ContractRecord[] = [];
  const jobs: Job[] = [];
  const results: SourceResult[] = [];
  let found = 0;
  ensureOutputDir(SOURCE_DIR);
  const enrichEmployers = createEmployerEnricher();
  const previousKeys = new Set(previous.jobs.map(j => j.sourceKey));
  pruneFeedCache(3);
  runState.message = 'Checking UK and Dutch sponsor registers';
  const registers = await refreshRegisters(message => console.log(message));
    const collected = await runGrouped(units, async unit => {
      runState.message = `Reading ${unit.name}`;
      const checkedAt = new Date().toISOString();
      let result: SourceResult;
      try {
        let rawJobs = await enrichEmployers(await unit.collect());
        // A board that mostly posts US roles belongs to a US employer, which matters for "India · US companies".
        const usReason = unit.group && EMPLOYER_GROUPS.has(unit.group) && rawJobs.some(raw => !raw.employerCountry) ? inferUsEmployer(rawJobs) : undefined;
        if (usReason) rawJobs = rawJobs.map(raw => raw.employerCountry ? raw : { ...raw, employerCountry: 'US', employerCountryReason: usReason });
        const unique = new Set<string>();
        const unitJobs: Job[] = [], unitRecords: ContractRecord[] = [];
        let accepted = 0;
        let technical = 0;
        for (const raw of rawJobs) {
          if (classifyRole(raw.title)) technical++;
          const job = classifyJob(raw, checkedAt);
          if (!job || unique.has(job.id)) continue;
          unique.add(job.id);
          unitRecords.push(toContract(raw, config, checkedAt));
          unitJobs.push(job);
          accepted++;
        }
        result = { key: unit.key, group: unit.group, name: unit.name, url: unit.url, status: unit.partialError ? 'partial' : 'ok', fetched: rawJobs.length, accepted, checkedAt,
          error: unit.partialError, retainedPrevious: unit.partialError ? previousKeys.has(unit.key) : undefined,
          exhaustive: unit.exhaustive !== false, coverage: unit.coverage, closedJobIds: unit.closedJobIds,
          employers: new Set(rawJobs.map(raw => raw.company.toLowerCase())).size, techRecognized: technical,
          excludedNonTech: rawJobs.length - technical, excludedEligibility: technical - accepted,
          dataAsOf: rawJobs.map(raw => raw.observedAt || checkedAt).sort()[0] || checkedAt,
        };
        runState.completed++;
        return { result, jobs: unitJobs, records: unitRecords, found: rawJobs.length };
      } catch (error: any) {
        const message = String(error.message || error).slice(0, 300);
        result = { key: unit.key, group: unit.group, name: unit.name, url: unit.url, status: 'error', fetched: 0, accepted: 0, checkedAt, error: message, retainedPrevious: previousKeys.has(unit.key) };
        fs.appendFileSync(path.join(paths.outputDir, 'process_documentation.txt'), `${checkedAt} ${unit.key}: ${message}\n`);
      }
      runState.completed++;
      return { result, jobs: [] as Job[], records: [] as ContractRecord[], found: 0 };
    });
    for (const unit of collected) { results.push(unit.result); jobs.push(...unit.jobs); records.push(...unit.records); found += unit.found; }
    const endedAt = new Date().toISOString();
    const successful = results.filter(r => r.status !== 'error');
    const errors = results.filter(r => r.status !== 'ok').map(r => ({ type: 'http_error', url: r.url, message: r.error, attempts: 1, skipped_records: 0 }));
    const run = { source_id: config.source_id, run_id: `run_${Date.now()}`, started_at: runState.startedAt, ended_at: endedAt, records_found: found, records_valid: records.length, records_written: records.length, error_count: errors.length, errors };
    atomicWrite(path.join(paths.outputDir, 'last-attempt.json'), JSON.stringify(run, null, 2));
    if (!successful.length) throw new Error('All sources failed. The previous completed snapshot has been preserved.');
    if (fs.existsSync(paths.leadsFile)) {
      fs.mkdirSync(path.join(paths.outputDir, 'archive'), { recursive: true });
      fs.copyFileSync(paths.leadsFile, path.join(paths.outputDir, 'archive', `leads-${Date.now()}.jsonl`));
    }
    atomicWrite(paths.leadsFile, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
    atomicWrite(paths.runFile, JSON.stringify(run, null, 2));
    const sample = [...records].sort(() => Math.random() - 0.5).slice(0, 20);
    atomicWrite(paths.reviewSampleFile, JSON.stringify(sample, null, 2));
    fs.appendFileSync(path.join(paths.outputDir, 'process_documentation.txt'), `${endedAt} ${successful.length}/${results.length} feeds succeeded, ${records.length} matching tech roles. Classification is rules-v1, no inference calls.\n`);
    updateDataAsOf(SOURCE_DIR);
    const snapshot: Snapshot = { version: 1, updatedAt: endedAt, jobs: mergeSourceJobs(previous.jobs, jobs, results).map(job => applySponsorRegisters(job, registers)), sources: results };
    atomicWrite(SNAPSHOT_FILE, JSON.stringify(snapshot));
    runState.message = `${snapshot.jobs.length} matching roles · ${successful.length}/${results.length} feeds refreshed`;
    if (errors.length) runState.error = `${errors.length} feed(s) failed; any retained rows show their previous check date.`;
    return snapshot;
  } catch (error: any) {
    runState.error = String(error.message || error);
    runState.message = 'Refresh failed';
    throw error;
  } finally {
    runState.running = false;
    runState.finishedAt = new Date().toISOString();
    release();
  }
}

function toContract(raw: RawJob, config: ReturnType<typeof loadSourceConfig>, fetchedAt: string): ContractRecord {
  const record: ContractRecord = {
    core: { source_id: config.source_id, entity_type: 'company', scraped_at: fetchedAt, raw_url: raw.sourceUrl, primary_key: '' },
    company: { company_name: raw.company, ...(raw.employerCountry ? { location: { country: raw.employerCountry } } : {}) }, contact: {},
    context: { external_id: `${raw.sourceKey}:${raw.externalId}`, title: raw.title, job_location: raw.location, description: raw.description,
      apply_url: raw.applyUrl, provider: raw.source, provider_key: raw.sourceKey, source_updated_at: raw.updatedAt,
      workplace: raw.workplace, employer_country_source: raw.employerCountrySource, employer_country_reason: raw.employerCountryReason, salary: raw.salary, source_country_hints: raw.countryHints,
      source_observed_at: raw.observedAt, attribution_url: raw.attributionUrl },
  };
  record.core.primary_key = generatePrimaryKey(config, { ...record });
  return record;
}
