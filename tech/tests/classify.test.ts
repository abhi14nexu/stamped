import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sponsorshipFromText, classifyJob, classifyRole, countriesFromLocation, safePublicUrl } from '../classify';
import { htmlToText } from '../sources';
import { mergeSourceJobs } from '../pipeline';
import type { RawJob, SourceResult } from '../types';

const raw: RawJob = { externalId: '123', title: 'Senior Backend Engineer', company: 'Test Employer', location: 'London', description: '', applyUrl: 'https://example.com/jobs/123', sourceUrl: 'https://example.com/jobs/123', source: 'Greenhouse', sourceKey: 'test' };
const now = '2026-10-15T00:00:00.000Z';

test('explicit affirmative sponsorship has evidence and no invented percentage', () => {
  const s = sponsorshipFromText('Benefits\n✅ We can sponsor visas.');
  assert.equal(s.status, 'yes'); assert.equal(s.signal, null); assert.match(s.evidence[0], /can sponsor/);
});
test('combined visa and relocation availability is affirmative', () => {
  assert.equal(sponsorshipFromText('Visa sponsorship & relocation available').status, 'yes');
});
for (const statement of ['We do not offer visa sponsorship.', 'No visa sponsorship is available.', 'You must not require visa sponsorship.', 'We are unable to sponsor visas.', 'You must work without sponsorship.']) {
  test(`negative sponsorship: ${statement}`, () => assert.equal(sponsorshipFromText(statement).status, 'no'));
}
test('conflicting affirmative and negative statements remain uncertain', () => {
  const s = sponsorshipFromText('We can sponsor visas.\nWe do not offer visa sponsorship for this opening.');
  assert.equal(s.status, 'unknown'); assert.equal(s.signal, 50);
});
test('conditional sponsorship remains uncertain', () => {
  assert.equal(sponsorshipFromText('We may offer visa sponsorship on a case-by-case basis.').signal, 65);
  assert.equal(sponsorshipFromText('We can sponsor visas only for transfers.').status, 'unknown');
  assert.equal(sponsorshipFromText('We cannot guarantee visa sponsorship.').status, 'unknown');
});
test('relocation is not proof of visa sponsorship', () => {
  const s = sponsorshipFromText('We offer relocation assistance.');
  assert.equal(s.status, 'unknown'); assert.equal(s.signal, 55);
});
test('missing evidence never becomes a 50% probability', () => {
  const s = sponsorshipFromText('Flexible hours and a great engineering team.');
  assert.equal(s.status, 'unknown'); assert.equal(s.signal, null);
});
test('generic visa question is not an offer', () => assert.equal(sponsorshipFromText('Do you require visa sponsorship?').status, 'unknown'));
test('mentorship sponsorship is not visa evidence', () => {
  const s = sponsorshipFromText('Provide mentorship and horizontal sponsorship across the organization.');
  assert.equal(s.signal, null); assert.deepEqual(s.evidence, []);
});
test('location parsing handles EU cities and Northern Ireland correctly', () => {
  assert.deepEqual(countriesFromLocation('Belfast, Northern Ireland'), ['GB']);
  assert.deepEqual(countriesFromLocation('Berlin; Amsterdam'), ['DE', 'NL']);
});
test('UK engineering roles are retained even when sponsorship is unavailable', () => {
  const j = classifyJob({ ...raw, description: 'We do not offer visa sponsorship.' }, now)!;
  assert.deepEqual(j.markets, ['uk']); assert.equal(j.sponsorship.status, 'no');
});
test('non-technical role at tech employer is excluded', () => {
  assert.equal(classifyJob({ ...raw, title: 'Software Engineering Recruiter' }, now), null);
  assert.equal(classifyRole('Account Executive, Cloud'), null);
});
test('technical role families include hardware, QA, support and product', () => {
  for (const title of ['Embedded Firmware Engineer', 'QA Engineer', 'IT Support Specialist', 'Product Designer', 'Senior Golang Engineer', 'Data Engineer']) assert.ok(classifyRole(title), title);
});
test('explicit India remote role from US employer qualifies', () => {
  const j = classifyJob({ ...raw, location: 'India (Remote)', employerCountry: 'US' }, now)!;
  assert.deepEqual(j.markets, ['us_remote']); assert.equal(j.remoteEligibility, 'india');
});
test('remote US-only listing mentioning an India team is excluded', () => {
  assert.equal(classifyJob({ ...raw, employerCountry: 'US', location: 'Remote, Canada; Remote, United States', description: "It's split into a US group (this role) and an India-based group working the same charter." }, now), null);
});
test('remote Poland does not make separate Bangalore location remote', () => {
  const j = classifyJob({ ...raw, employerCountry: 'US', location: 'Bangalore, India; Remote, Poland' }, now)!;
  assert.ok(!j.markets.includes('us_remote')); assert.deepEqual(j.markets, ['eu']);
});
test('remote customer collaboration alone is not permission to work remotely', () => {
  assert.equal(classifyJob({ ...raw, employerCountry: 'US', location: 'India', description: 'You will collaborate with our remote teams and worldwide customers.' }, now), null);
});
test('worldwide remote needs explicit location permission', () => {
  assert.equal(classifyJob({ ...raw, employerCountry: 'US', location: 'Worldwide (Remote)' }, now)?.remoteEligibility, 'worldwide');
  assert.equal(classifyJob({ ...raw, employerCountry: 'US', location: 'Remote', description: 'Our customers are worldwide.' }, now), null);
});
test('US employer alone does not make a UK remote job globally eligible', () => {
  const j = classifyJob({ ...raw, employerCountry: 'US', location: 'Remote, United Kingdom' }, now)!;
  assert.deepEqual(j.markets, ['uk']);
});
test('EU filter does not silently include Switzerland or all EMEA', () => {
  assert.equal(classifyJob({ ...raw, location: 'Zurich, Switzerland' }, now), null);
  assert.equal(classifyJob({ ...raw, location: 'EMEA' }, now), null);
});
test('unsafe application links are rejected', () => {
  for (const link of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'http://127.0.0.1/x', 'http://192.168.0.1/x', 'https://user:secret@example.com/x', 'http://[::1]/']) assert.equal(safePublicUrl(link), null, link);
  assert.equal(safePublicUrl('https://example.com/jobs/123'), 'https://example.com/jobs/123');
});
test('HTML is decoded to plain evidence with paragraph boundaries', () => {
  const text = htmlToText('&lt;p&gt;We can sponsor visas.&lt;/p&gt;&lt;p&gt;Apply today.&lt;/p&gt;');
  assert.match(text, /visas\.\n/); assert.ok(!text.includes('<p>'));
  assert.ok(!htmlToText('<script>alert(1)</script><p>Hello</p>').includes('alert'));
});
test('failed feeds retain previous rows; successful feeds replace closed jobs', () => {
  const old = classifyJob(raw, now)!;
  const result: SourceResult = { key: 'test', name: 'Test', url: 'https://example.com', status: 'error', fetched: 0, accepted: 0, checkedAt: now };
  assert.deepEqual(mergeSourceJobs([old], [], [result]), [old]);
  assert.deepEqual(mergeSourceJobs([old], [], [{ ...result, status: 'ok' }]), []);
  const newJob = { ...old, title: 'Updated role' };
  assert.deepEqual(mergeSourceJobs([old], [newJob], [{ ...result, status: 'ok' }]), [newJob]);
});
