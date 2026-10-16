import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedNextPage, normalizeHimalayasLocations, descriptionEmployerCountry, validateSourceUrl, parseGreenhouse, parseAshby, parseLever, parseRelocate, parseSmartRecruiters, parseJobicy } from '../sources';
import { classifyJob, classifyRole, countriesFromLocation, sponsorshipFromText } from '../classify';
import { mergeSourceJobs } from '../pipeline';
import type { RawJob, SourceResult } from '../types';

const raw: RawJob = { externalId: 'one', title: 'Backend Engineer', company: 'Test Employer', location: 'Berlin', description: '', applyUrl: 'https://example.com/jobs/one', sourceUrl: 'https://example.com/jobs/one', source: 'Greenhouse', sourceKey: 'test' };
const now = new Date().toISOString();

test('pagination reconstructs page on original allowed feed and keeps original filters', () => {
  assert.equal(pinnedNextPage('https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=false&page=2', 'https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=true'), 'https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=true&page=2');
  for (const next of ['https://evil.example/api/job-board-api?page=2', 'http://www.arbeitnow.com/api/job-board-api?page=2', 'https://www.arbeitnow.com/private?page=2', 'https://www.arbeitnow.com/api/job-board-api?page=-2']) assert.throws(() => pinnedNextPage(next, 'https://www.arbeitnow.com/api/job-board-api'));
});
test('additional feed allowlist does not permit arbitrary paths', () => {
  assert.doesNotThrow(() => validateSourceUrl('https://himalayas.app/jobs/api/search?country=GB'));
  for (const url of ['https://himalayas.app/account', 'https://www.arbeitnow.com/admin', 'http://127.0.0.1/jobs/api']) assert.throws(() => validateSourceUrl(url));
});
test('new employer APIs pin hosts and read-only posting routes', () => {
  for (const url of ['https://api.ashbyhq.com/posting-api/job-board/qdrant.tech', 'https://api.lever.co/v0/postings/qonto?mode=json', 'https://api.eu.lever.co/v0/postings/example', 'https://relocate.me/portugal/lisbon/example/software-engineer-123', 'https://remotive.com/api/remote-jobs']) assert.doesNotThrow(() => validateSourceUrl(url));
  for (const url of ['https://api.ashbyhq.com/admin', 'https://api.lever.co/v0/postings/company/job/apply', 'https://api.lever.co.evil.test/v0/postings/company', 'https://relocate.me/account', 'https://remotive.com/admin', 'https://boards-api.greenhouse.io/v1/boards/company/jobs/123', 'https://api.ashbyhq.com:8080/posting-api/job-board/test']) assert.throws(() => validateSourceUrl(url));
});
test('Ashby excludes unlisted postings and preserves secondary-country eligibility', () => {
  const posting = { id: 'a', title: 'Backend Engineer', jobUrl: 'https://jobs.ashbyhq.com/example/a', applyUrl: 'https://jobs.ashbyhq.com/example/a/application', descriptionPlain: 'Visa sponsorship and relocation support are available.', location: 'San Francisco', secondaryLocations: [{ location: 'Paris', address: { addressCountry: 'France' } }], address: { postalAddress: { addressCountry: 'United States' } }, workplaceType: 'Hybrid' };
  const jobs = parseAshby({ jobs: [posting, { ...posting, id: 'hidden', isListed: false }] }, { board: 'example', company: 'Example' }, now);
  assert.equal(jobs.length, 1); assert.match(jobs[0].location, /Paris, France/);
  assert.ok(classifyJob(jobs[0], now)?.markets.includes('eu'));
  assert.equal(classifyJob(jobs[0], now)?.sponsorship.status, 'yes');
  assert.throws(() => parseAshby({ jobs: [{ title: 'bad' }] }, { board: 'example', company: 'Example' }, now));
});
test('Greenhouse uses per-posting offices when display location is only Hybrid', () => {
  const [raw] = parseGreenhouse({ jobs: [{ id: 1, title: 'Software Engineer', absolute_url: 'https://example.com/jobs/1', content: '<p>Build software</p>', location: { name: 'Hybrid' }, offices: [{ location: 'London, United Kingdom' }], metadata: [{ name: 'Job Posting Location', value: ['Berlin, Germany'] }, { name: 'Salary Country', value: 'United States' }] }] }, { board: 'example', company: 'Example' }, now);
  const job = classifyJob(raw, now)!;
  assert.deepEqual(job.countries, ['GB', 'DE']); assert.equal(job.workplace, 'Hybrid');
  assert.equal(job.employerCountry, undefined); assert.doesNotMatch(raw.location, /United States/);
});
test('Lever sponsorship evidence includes lists and closing text, and retains all locations', () => {
  const jobs = parseLever([{ id: 'a', text: 'Software Engineer', hostedUrl: 'https://jobs.lever.co/example/a', applyUrl: 'https://jobs.lever.co/example/a/apply', descriptionPlain: 'Build our platform.', categories: { allLocations: ['London', 'Berlin'] }, country: 'GB', workplaceType: 'hybrid', lists: [{ text: 'Benefits', content: '<ul><li>We offer visa sponsorship.</li></ul>' }], additionalPlain: 'Join us.' }], { board: 'example', company: 'Example' }, now);
  const job = classifyJob(jobs[0], now)!;
  assert.deepEqual(job.countries, ['GB', 'DE']); assert.equal(job.sponsorship.status, 'yes');
  assert.match(job.description, /Join us/); assert.doesNotMatch(job.description, /<li>/);
});
test('Relocate.me extracts role content without newsletter sponsorship ads', () => {
  const job = parseRelocate('<h1>Platform Engineer</h1><div class="job-info__company">Example</div><div class="job-info__country">Lisbon, Portugal</div><aside>Visa sponsorship jobs newsletter</aside><div class="job-info__description"><p>Build reliable services.</p></div>', 'https://relocate.me/portugal/lisbon/example/platform-engineer-123', now);
  assert.equal(classifyJob(job, now)?.sponsorship.status, 'unknown'); assert.doesNotMatch(job.description, /newsletter/);
});
test('SmartRecruiters rejects non-public jobs and reads additional-information evidence', () => {
  const posting = { id: '123', name: 'Software Engineer', applyUrl: 'https://jobs.smartrecruiters.com/Example/123', active: true, visibility: 'PUBLIC', location: { fullLocation: 'Tallinn, Estonia', country: 'ee' }, jobAd: { sections: { jobDescription: { title: 'Role', text: '<p>Build software</p>' }, additionalInformation: { title: 'Benefits', text: '<p>We offer visa sponsorship.</p>' } } } };
  assert.equal(parseSmartRecruiters({ ...posting, visibility: 'INTERNAL' }, { board: 'Example', company: 'Example' }, now), null);
  assert.equal(parseSmartRecruiters({ ...posting, active: false }, { board: 'Example', company: 'Example' }, now), null);
  const job = classifyJob(parseSmartRecruiters(posting, { board: 'Example', company: 'Example' }, now)!, now)!;
  assert.deepEqual(job.countries, ['EE']); assert.equal(job.sponsorship.status, 'yes');
  assert.throws(() => validateSourceUrl('https://api.smartrecruiters.com/v1/candidates'));
});
test('Jobicy preserves canonical source links and distinguishes worldwide from restricted remote', () => {
  const posting = { id: 1, jobTitle: 'Software Engineer', companyName: 'Example', jobDescription: '<p>Build software</p>', jobGeo: 'Anywhere', url: 'https://jobicy.com/jobs/1-software-engineer' };
  const [job] = parseJobicy({ success: true, jobs: [posting] }, now);
  assert.equal(classifyJob({ ...job, employerCountry: 'US' }, now)?.remoteEligibility, 'worldwide');
  const [restricted] = parseJobicy({ jobs: [{ ...posting, jobGeo: 'USA Only' }] }, now);
  assert.equal(classifyJob({ ...restricted, employerCountry: 'US' }, now), null);
  assert.equal(job.applyUrl, posting.url); assert.equal(job.attributionUrl, 'https://jobicy.com');
  assert.throws(() => validateSourceUrl('https://jobicy.com/api/v2/accounts'));
});
test('both documented and actual country restriction schemas are accepted', () => {
  assert.deepEqual(normalizeHimalayasLocations(['India', 'United Kingdom']), ['India', 'United Kingdom']);
  assert.deepEqual(normalizeHimalayasLocations([{ alpha2: 'IN', name: 'India' }]), ['India']);
  assert.deepEqual(normalizeHimalayasLocations([]), []);
  assert.throws(() => normalizeHimalayasLocations(undefined));
});
test('US employer identity requires explicit headquarters wording', () => {
  assert.equal(descriptionEmployerCountry('We are headquartered in San Francisco, California.'), 'US');
  assert.equal(descriptionEmployerCountry('This job pays USD and is based in New York.'), undefined);
  assert.equal(descriptionEmployerCountry('Headquartered in Germany, with offices in California.'), undefined);
  assert.equal(descriptionEmployerCountry('We are US-based, with a development center in India.'), 'US');
  assert.equal(descriptionEmployerCountry('We help US-based companies hire developers.'), undefined);
});
test('broader tech titles and EU city aliases are recognized', () => {
  for (const title of ['Director of Analytics', 'Senior Fullstack Engineer', 'Java Softwareentwickler', 'SAP Consultant', 'IT-Administrator', 'Forward-Deployed Engineer', 'Product Engineer', 'Application Engineer', 'ML Research Engineer', 'Head of Solutions Architecture']) assert.ok(classifyRole(title), title);
  assert.equal(classifyRole('Clinical Research Scientist'), null);
  assert.deepEqual(countriesFromLocation('Riga; Vienna; Tallinn'), ['AT', 'EE', 'LV']);
});
test('country-scoped visa offer cannot imply sponsorship for all advertised countries', () => {
  const job = classifyJob({ ...raw, location: 'United Kingdom; Germany', description: 'We can sponsor visas to Germany; for any other country, you need existing right to work.' }, now)!;
  assert.equal(job.sponsorship.status, 'unknown');
  const germany = classifyJob({ ...raw, description: 'We can sponsor visas to Germany.' }, now)!;
  assert.equal(germany.sponsorship.status, 'yes');
});
test('real listing benefit wording is recognized without inflating missing evidence', () => {
  for (const text of ['A Relocation Package: Includes visa support for those who need it.', 'Competitive relocation packages and visa sponsorship where necessary for expats.', 'Surfly can provide or transfer Dutch visa sponsorship.', 'Visa sponsorship and relocation support for candidates joining us.', 'London-based, with UK Skilled Worker visa sponsorship and support for Global Talent applications.']) {
    assert.equal(sponsorshipFromText(text).status, 'yes', text);
  }
  for (const text of ['Candidates must be legally authorized without employer sponsorship.', 'We do not provide visa assistance.', 'Relocation and/or Visa are not supported for this role.']) assert.equal(sponsorshipFromText(text).status, 'no', text);
  assert.deepEqual(sponsorshipFromText('Experience with Visa, Mastercard and AMEX.').evidence, []);
});
test('feed country fallback is visible and never assigned to employer headquarters', () => {
  const job = classifyJob({ ...raw, location: 'Remote', countryHints: ['GB'] }, now)!;
  assert.deepEqual(job.countries, ['GB']); assert.match(job.location, /source region/); assert.equal(job.employerCountry, undefined);
});
test('bounded recent feeds retain earlier rows, complete employer feeds remove closed rows', () => {
  const job = classifyJob(raw, now)!;
  const source: SourceResult = { key: 'test', name: 'Test', url: 'https://example.com', status: 'ok', checkedAt: now, accepted: 0, fetched: 0, exhaustive: false };
  assert.equal(mergeSourceJobs([job], [], [source]).length, 1);
  assert.equal(mergeSourceJobs([job], [], [{ ...source, closedJobIds: [job.id] }]).length, 0);
  assert.equal(mergeSourceJobs([job], [], [{ ...source, exhaustive: true }]).length, 0);
});
test('same application from multiple providers deduplicates; distinct locations remain', () => {
  const first = classifyJob(raw, now)!;
  const duplicate = { ...first, id: 'other', sourceKey: 'other', source: 'Himalayas', applyUrl: first.applyUrl + '?utm_source=test' };
  assert.equal(mergeSourceJobs([], [duplicate, first], []).length, 1);
  const different = { ...duplicate, id: 'second', applyUrl: 'https://example.com/jobs/two', location: 'Paris', countries: ['FR'] };
  assert.equal(mergeSourceJobs([], [first, different], []).length, 2);
  const casingVariant = { ...different, company: 'TEST EMPLOYER' };
  assert.equal(new Set(mergeSourceJobs([], [first, casingVariant], []).map(job => job.company)).size, 1);
  const ashby = { ...first, applyUrl: 'https://jobs.ashbyhq.com/example/one/application' };
  const ashbyDetail = { ...different, applyUrl: 'https://jobs.ashbyhq.com/example/one' };
  assert.equal(mergeSourceJobs([], [ashby, ashbyDetail], []).length, 1);
});
test('cross-provider copies merge by city (and by content between aggregators), while distinct requisitions survive', () => {
  const first = { ...classifyJob(raw, now)!, description: 'Build our distributed data systems with a team of engineers. '.repeat(18), location: 'London; Berlin', countries: ['GB', 'DE'] };
  const copy = { ...first, id: 'aggregate', source: 'Arbeitnow', sourceKey: 'aggregate', location: 'London', countries: ['GB'], applyUrl: 'https://example.com/aggregate', description: first.description + ' Apply now.' };
  assert.equal(mergeSourceJobs([], [first, copy], []).length, 1);
  // The employer's own board is authoritative: a reformatted aggregator copy of the same title and city is a mirror.
  const reformatted = { ...copy, description: 'Build network security systems for our clients. '.repeat(20) };
  assert.equal(mergeSourceJobs([], [first, reformatted], []).length, 1);
  const twoAggregators = { ...reformatted, id: 'aggregate-2', source: 'Himalayas', sourceKey: 'aggregate-2', applyUrl: 'https://example.com/aggregate-2' };
  assert.equal(mergeSourceJobs([], [copy, twoAggregators], []).length, 2);
  const differentCity = { ...copy, location: 'Manchester' };
  assert.equal(mergeSourceJobs([], [first, differentCity], []).length, 2);
  const differentRequisition = { ...first, id: 'second-requisition', applyUrl: 'https://example.com/jobs/second' };
  assert.equal(mergeSourceJobs([], [first, differentRequisition], []).length, 2);
});
