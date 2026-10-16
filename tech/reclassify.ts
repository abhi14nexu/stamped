import * as fs from 'node:fs';
import { loadSourceConfig, getOutputPaths } from '../lib/source-config';
import { classifyJob } from './classify';
import { SOURCE_DIR, descriptionEmployerCountry } from './sources';
import { atomicWrite, readSnapshot, mergeSourceJobs, SNAPSHOT_FILE } from './pipeline';
import { applySponsorRegisters, loadRegisters } from './registers';
import type { ContractRecord, Job, RawJob } from './types';

// Rebuild derived decisions from the factual source snapshot, without HTTP calls.
const config = loadSourceConfig(SOURCE_DIR);
const paths = getOutputPaths(SOURCE_DIR);
const previous = readSnapshot();
const jobs: Job[] = [];
for (const line of fs.readFileSync(paths.leadsFile, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const record = JSON.parse(line) as ContractRecord;
  if (record.core.source_id !== config.source_id) throw new Error('Unexpected source contract');
  const c = record.context;
  const key = String(c.provider_key);
  const identity = String(c.external_id);
  const raw: RawJob = { externalId: identity.startsWith(key + ':') ? identity.slice(key.length + 1) : identity,
    title: String(c.title || ''), company: key.startsWith('arbeitnow') ? record.company.company_name.replace(/^([A-Z][a-z]{2,})\d{1,3}$/, '$1') : record.company.company_name, location: String(c.job_location || ''),
    description: String(c.description || ''), applyUrl: String(c.apply_url || ''), sourceUrl: record.core.raw_url,
    source: String(c.provider || ''), sourceKey: key, employerCountry: c.employer_country_source === record.core.raw_url ? descriptionEmployerCountry(String(c.description || '')) : record.company.location?.country,
    employerCountrySource: typeof c.employer_country_source === 'string' ? c.employer_country_source : undefined,
    workplace: typeof c.workplace === 'string' ? c.workplace : undefined,
    updatedAt: typeof c.source_updated_at === 'string' ? c.source_updated_at : undefined,
    observedAt: typeof c.source_observed_at === 'string' ? c.source_observed_at : record.core.scraped_at,
    countryHints: key.startsWith('arbeitnow-de') ? undefined : Array.isArray(c.source_country_hints) ? c.source_country_hints.filter((v): v is string => typeof v === 'string') : undefined,
    attributionUrl: typeof c.attribution_url === 'string' ? c.attribution_url : undefined,
    salary: typeof c.salary === 'string' ? c.salary : undefined,
  };
  const job = classifyJob(raw, record.core.scraped_at);
  if (job) jobs.push(job);
}
const registers = loadRegisters();
const snapshot = { ...previous, jobs: mergeSourceJobs(previous.jobs, jobs, previous.sources).map(job => applySponsorRegisters(job, registers)) };
atomicWrite(SNAPSHOT_FILE, JSON.stringify(snapshot));
console.log(`Reclassified ${snapshot.jobs.length} roles from source evidence and stored sponsor registers (${registers.uk ? 'UK' : 'no UK'}, ${registers.nl ? 'NL' : 'no NL'}); no network requests.`);
