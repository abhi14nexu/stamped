import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardFromUrl, discoveryCandidates } from '../discovery';
import { jackAndJillLinks, parseJackAndJill, parseLinkedinCards, parseLinkedinJob } from '../public-sources';
import { classifyJob, classifyRole, isEarlyEngineer, sponsorshipFromText } from '../classify';
import { validateSourceUrl, stopAfterSourceError } from '../sources';

const now = new Date().toISOString();
const id = '11111111-2222-3333-4444-555555555555';
const jackUrl = `https://www.jackandjill.ai/jobs/engineer/founding-engineer-at-acme-${id}`;
const posting = { '@type': 'JobPosting', title: 'Founding Engineer', identifier: { value: id }, description: '<p>We offer visa sponsorship.</p>', hiringOrganization: { name: 'Acme', address: { addressCountry: 'US' } }, jobLocation: { address: { addressLocality: 'London', addressCountry: 'GB' } } };
const ld = (job: object) => `<script type="application/ld+json">${JSON.stringify(job)}</script>`;

test('public sources stop on access blocks or three consecutive failures', () => {
  assert.equal(stopAfterSourceError('HTTP 429', 1), true);
  assert.equal(stopAfterSourceError('HTTP 403', 1), true);
  assert.equal(stopAfterSourceError('Timeout', 3), true);
  assert.equal(stopAfterSourceError('Timeout', 1), false);
});

test('discovery pins public ATS identities and deduplicates casing; never follows supplied URLs', () => {
  assert.equal(boardFromUrl({ url: `https://jobs.ashbyhq.com/Acme/${id}/application?ref=test`, company: 'Acme' })?.board, 'acme');
  assert.equal(boardFromUrl({ url: `https://jobs.eu.lever.co/acme.com/${id}`, company: 'Acme' })?.region, 'eu');
  assert.equal(discoveryCandidates([{ url: 'https://jobs.ashbyhq.com/ACME', company: 'Acme' }], [{ provider: 'ashby', board: 'acme', company: 'Acme' }]).length, 0);
  for (const url of ['https://jobs.ashbyhq.com.evil.test/acme', 'http://jobs.ashbyhq.com/acme', 'https://user:pass@jobs.ashbyhq.com/acme', 'https://jobs.ashbyhq.com:8443/acme', 'https://localhost/acme', 'https://jobs.ashbyhq.com/acme/admin', 'https://boards.greenhouse.io/acme/other/1']) assert.equal(boardFromUrl({ url, company: 'Acme' }), null, url);
});
test('Jack sitemap ignores foreign hosts and nontechnical categories', () => {
  const xml = `<urlset><url><loc>${jackUrl}</loc></url><url><loc>https://evil.test/jobs/engineer/test-${id}</loc></url><url><loc>${jackUrl.replace('/engineer/', '/sales/')}</loc></url></urlset>`;
  assert.deepEqual(jackAndJillLinks(xml), [jackUrl]);
});
test('Jack JobPosting uses actual employer, ignores generic site sponsorship and headquarters location', () => {
  const raw = parseJackAndJill(ld({ '@graph': [{ '@type': 'Organization', name: 'Jack & Jill' }, posting] }) + '<aside>We do not offer visa sponsorship.</aside>', jackUrl, now)!;
  const job = classifyJob(raw, now)!;
  assert.equal(job.company, 'Acme'); assert.equal(job.sponsorship.status, 'yes');
  assert.deepEqual(job.countries, ['GB']); assert.equal(job.employerCountry, undefined);
  assert.equal(job.applyUrl, jackUrl); assert.equal(job.source, 'Jack & Jill');
  assert.equal(parseJackAndJill(ld({ ...posting, validThrough: '2020-01-01' }), jackUrl, now), null);
  assert.throws(() => parseJackAndJill(ld({ ...posting, identifier: { value: 'different' } }), jackUrl, now));
  assert.throws(() => parseJackAndJill('<h1>Sign in</h1>', jackUrl, now));
});
test('LinkedIn card IDs, title, employer and location are explicit', () => {
  const html = '<div data-entity-urn="urn:li:jobPosting:12345678"><h3 class="base-search-card__title">Backend Engineer</h3><h4 class="base-search-card__subtitle">Acme</h4><span class="job-search-card__location">Berlin, Germany</span><time datetime="2026-10-15"></time></div>';
  assert.deepEqual(parseLinkedinCards(html), [{ id: '12345678', title: 'Backend Engineer', company: 'Acme', location: 'Berlin, Germany', datePosted: '2026-10-15' }]);
  assert.throws(() => parseLinkedinCards('<h1>Sign in</h1>'));
});
test('LinkedIn uses description evidence only, identifies named Jack clients, rejects closed and login pages', () => {
  const card = { id: '12345678', title: 'Founding Engineer at Acme', company: 'Jack & Jill', location: 'London' };
  const html = '<h1 class="top-card-layout__title">Founding Engineer at Acme</h1><a class="topcard__org-name-link">Jack &amp; Jill</a><span class="topcard__flavor--bullet">London, United Kingdom</span><div class="show-more-less-html__markup"><p>Build our platform with a small product team. We offer visa sponsorship for this position.</p></div><aside>Do you need visa sponsorship? We cannot offer visa sponsorship.</aside>';
  const raw = parseLinkedinJob(html, card, now)!;
  assert.equal(raw.company, 'Acme'); assert.equal(raw.title, 'Founding Engineer');
  assert.equal(classifyJob(raw, now)?.sponsorship.status, 'yes');
  assert.equal(parseLinkedinJob(html + '<div class="closed-job">No longer accepting applications</div>', card, now), null);
  assert.throws(() => parseLinkedinJob('<h1>Join LinkedIn</h1>', card, now));
});
test('new public sources restrict request paths and permit dotted Lever board identifiers', () => {
  for (const url of [jackUrl, 'https://www.jackandjill.ai/jobs/sitemap.xml', 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/12345678', 'https://api.lever.co/v0/postings/aqemia.com']) assert.doesNotThrow(() => validateSourceUrl(url));
  for (const url of ['https://www.linkedin.com/uas/login-submit', 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/not-an-id', 'https://www.jackandjill.ai/api/jobs', 'https://www.jackandjill.ai/account']) assert.throws(() => validateSourceUrl(url));
});
test('founding and first engineers survive filtering; generic startup operators do not', () => {
  for (const title of ['Founding Engineer', 'First Engineer', 'Founding Software Engineer', 'Early Engineer', 'Member of Technical Staff (SWE/Product)']) assert.ok(classifyRole(title), title);
  for (const title of ['Founder Associate', 'Founding Account Executive', 'First Sales Hire']) assert.equal(classifyRole(title), null);
  assert.equal(isEarlyEngineer('Founding AI Engineer'), true); assert.equal(isEarlyEngineer('Senior Backend Engineer'), false);
  assert.equal(classifyRole('ML Research Engineer - Member of Technical Staff'), 'AI & machine learning');
});
test('working-visa offers differ from questions and support limited to existing residents', () => {
  assert.equal(sponsorshipFromText('We can support various types of working visas in the UK, including Skilled Worker Visa.').status, 'yes');
  assert.equal(sponsorshipFromText('We cannot support work visas.').status, 'no');
  assert.equal(sponsorshipFromText('Can you sponsor visas?').status, 'unknown');
  assert.equal(sponsorshipFromText('We do provide visa support for applicants already working in the country.').status, 'unknown');
});
