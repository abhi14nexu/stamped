import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceName, nameFromBoardPage, parsePersonio, parseRecruitee, parseWorkable, personioName, recruiteeName } from '../ats';
import { classifyJob, companyStage, isFoundingRole } from '../classify';
import { boardFromUrl } from '../discovery';
import { slugFromUrl, TARGETS } from '../commoncrawl';
import { validateSourceUrl } from '../sources';
import { runGrouped } from '../pipeline';

const now = new Date().toISOString();

test('Workable widget feed keeps every visible location and remote flag', () => {
  const rows = parseWorkable({ name: 'Acme', jobs: [{ shortcode: 'AB12', title: 'Backend Engineer', url: 'https://apply.workable.com/j/AB12', application_url: 'https://apply.workable.com/j/AB12/apply', telecommuting: true, description: '<p>We offer visa sponsorship.</p>', locations: [{ city: 'Berlin', country: 'Germany', countryCode: 'DE', hidden: false }, { city: 'Lisbon', country: 'Portugal', hidden: false }] }] }, { board: 'acme', company: 'Acme', provider: 'workable' }, now);
  assert.equal(rows[0].location, 'Berlin, Germany; Lisbon, Portugal (Remote)');
  assert.equal(rows[0].applyUrl, 'https://apply.workable.com/j/AB12/apply');
  assert.deepEqual(classifyJob(rows[0], now)?.countries, ['DE', 'PT']);
  assert.equal(classifyJob(rows[0], now)?.sponsorship.status, 'yes');
});
test('Recruitee keeps only published offers and reads requirements as evidence', () => {
  const offer = { id: 7, title: 'Data Engineer', status: 'published', careers_url: 'https://acme.recruitee.com/o/data-engineer', careers_apply_url: 'https://acme.recruitee.com/o/data-engineer/c/new', description: '<p>Role</p>', requirements: '<p>We cannot sponsor visas.</p>', locations: [{ city: 'Amsterdam', country: 'Netherlands' }], hybrid: true, company_name: 'Acme B.V.' };
  const rows = parseRecruitee({ offers: [offer, { ...offer, id: 8, status: 'draft' }] }, { board: 'acme', company: 'Acme', provider: 'recruitee' }, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workplace, 'Hybrid');
  assert.equal(classifyJob(rows[0], now)?.sponsorship.status, 'no');
  assert.equal(recruiteeName({ offers: [offer] }), 'Acme');
});
test('Personio XML positions combine offices and description sections', () => {
  const xml = `<?xml version="1.0"?><workzag-jobs><position><id>42</id><subcompany>Acme GmbH</subcompany><office>Munich</office><additionalOffices><office>Berlin</office></additionalOffices><name>Platform Engineer</name><jobDescriptions><jobDescription><name>Your role</name><value><![CDATA[<p>Build the platform.</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-09-01T10:00:00+00:00</createdAt></position></workzag-jobs>`;
  const rows = parsePersonio(xml, { board: 'acme', company: 'Acme', provider: 'personio' }, now);
  assert.equal(rows[0].location, 'Munich; Berlin');
  assert.equal(rows[0].applyUrl, 'https://acme.jobs.personio.de/job/42?language=en&display=en');
  assert.match(rows[0].description, /Your role\nBuild the platform/);
  assert.equal(personioName(xml), 'Acme');
});
test('board page titles give display names and reject error pages', () => {
  assert.equal(nameFromBoardPage('<title>Tracebit Jobs</title>'), 'Tracebit');
  assert.equal(nameFromBoardPage('<title>Spotify</title>'), 'Spotify');
  assert.equal(nameFromBoardPage('<title>Not found – 404 error</title>'), undefined);
});
test('new provider hosts are pinned to their public feed paths', () => {
  for (const url of ['https://apply.workable.com/api/v1/widget/accounts/acme?details=true', 'https://acme.recruitee.com/api/offers/', 'https://acme.jobs.personio.de/xml?language=en', 'https://acme.jobs.personio.com/xml', 'https://boards-api.greenhouse.io/v1/boards/acme', 'https://jobs.ashbyhq.com/acme', 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work']) assert.doesNotThrow(() => validateSourceUrl(url), url);
  for (const url of ['https://acme.recruitee.com/admin', 'https://acme.recruitee.com.evil.test/api/offers/', 'https://a.b.recruitee.com/api/offers/', 'https://acme.jobs.personio.de/job/1', 'https://apply.workable.com/acme/j/123', 'https://jobs.ashbyhq.com/acme/admin/x', 'https://www.gov.uk/search', 'https://assets.publishing.service.gov.uk/media/abc/file.exe']) assert.throws(() => validateSourceUrl(url), url);
});
test('discovery recognises Workable, Recruitee and Personio boards', () => {
  assert.deepEqual(boardFromUrl({ url: 'https://apply.workable.com/acme/j/ABC123/', company: 'Acme' }), { board: 'acme', company: 'Acme', provider: 'workable', discoveryUrl: 'https://apply.workable.com/acme/j/ABC123/' });
  assert.equal(boardFromUrl({ url: 'https://acme.recruitee.com/o/backend-engineer', company: 'Acme' })?.provider, 'recruitee');
  assert.equal(boardFromUrl({ url: 'https://acme.jobs.personio.com/job/1', company: 'Acme' })?.region, 'com');
  assert.equal(boardFromUrl({ url: 'https://www.recruitee.com/blog', company: 'Acme' }), null);
});
test('Common Crawl URLs yield board identifiers, never reserved paths', () => {
  const ashby = TARGETS.find(t => t.provider === 'ashby')!, recruitee = TARGETS.find(t => t.provider === 'recruitee')!;
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/Tracebit/2de3cc9e-4c4c', ashby), 'tracebit');
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/api/non-user-graphql', ashby), null);
  assert.equal(slugFromUrl('https://bunq.recruitee.com/o/head-of-product', recruitee), 'bunq');
  assert.equal(slugFromUrl('https://www.recruitee.com/', recruitee), null);
});
test('founding roles are judged from the title, without "AI First" or "Foundations" false positives', () => {
  for (const title of ['Founding Engineer', 'First Engineering Hire', 'Engineer #3', 'Founding Product Designer', 'Early Engineer']) assert.equal(isFoundingRole(title), true, title);
  for (const title of ['Technical Support Specialist (AI First)', 'First Line Support Engineer', 'Software Engineer - Tech Foundations', 'Early Career Software Engineer']) assert.equal(isFoundingRole(title), false, title);
});
test('early-stage evidence needs explicit funding-stage or founding-team wording', () => {
  assert.equal(companyStage('Backend Engineer', 'We are a seed-stage startup backed by Index.').stage, 'early');
  assert.equal(companyStage('Backend Engineer', 'Join our founding team in London.').stage, 'early');
  assert.equal(companyStage('Backend Engineer', 'We have raised our Series A from Sequoia.').stage, 'early');
  assert.equal(companyStage('Backend Engineer', 'We work with companies from Series A, B and C onwards.').stage, undefined);
  assert.equal(companyStage('Backend Engineer', 'A global leader with 10,000 employees.').stage, undefined);
});
test('grouped collection limits parallel requests per provider and preserves order', async () => {
  let active = 0, peak = 0;
  const units = Array.from({ length: 12 }, (_, i) => ({ key: `ashby-${i}`, group: 'ashby', name: String(i), url: '', collect: async () => [] }));
  const results = await runGrouped(units, async unit => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return unit.name; });
  assert.deepEqual(results, units.map(u => u.name));
  assert.ok(peak <= 6 && peak > 1, `peak ${peak}`);
});
test('Personio group boards name each position by its own employer and never by a place', () => {
  const position = (id: number, sub: string) => `<position><id>${id}</id><subcompany>${sub}</subcompany><office>Berlin</office><name>Backend Engineer</name><jobDescriptions><jobDescription><name>Role</name><value><![CDATA[x]]></value></jobDescription></jobDescriptions></position>`;
  const xml = `<workzag-jobs>${position(1, 'Sungrow Deutschland GmbH')}${position(2, 'Greece')}${position(3, 'ARCTIK SRL')}</workzag-jobs>`;
  const rows = parsePersonio(xml, { board: 'sungrow-emea', company: 'Sungrow', provider: 'personio', region: 'com' }, now);
  assert.deepEqual(rows.map(r => r.company), ['Sungrow', 'Sungrow', 'ARCTIK']);
  assert.equal(personioName(`<workzag-jobs>${position(1, 'Sungrow Deutschland GmbH')}${position(2, 'Greece')}</workzag-jobs>`), 'Sungrow Deutschland');
  assert.equal(personioName(`<workzag-jobs>${position(1, 'Alpha GmbH')}${position(2, 'Beta GmbH')}</workzag-jobs>`), undefined);
  assert.equal(isPlaceName('FRANCE'), true);
  assert.equal(isPlaceName('Fairphone'), false);
});
