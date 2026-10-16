import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySponsorRegisters, buildRegister, findSponsor, parseNlRegister, parseUkRegister, type Registers } from '../registers';
import { classifyJob } from '../classify';
import type { RawJob } from '../types';

const uk = buildRegister('uk', 'https://assets.publishing.service.gov.uk/media/abc/register.csv', [
  'Monzo Bank Ltd', 'UK Wise Group Ltd', 'Wise Payments Limited', 'Reactive Technologies Limited', 'CYPRESS LTD', 'CHECKOUT LTD', 'Granola Labs', 'Octopus Energy Limited', 'DEX INTERNATIONAL LIMITED',
].map(name => ({ name, detail: 'London · Skilled Worker' })));
const nl = buildRegister('nl', 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work', [{ name: 'Adyen N.V.' }, { name: 'Booking.com B.V.' }, { name: 'bunq B.V.' }]);
const registers: Registers = { uk, nl };

test('register names match brand names through legal forms and entity suffixes', () => {
  assert.equal(findSponsor(uk, 'Monzo')?.name, 'Monzo Bank Ltd');
  assert.equal(findSponsor(uk, 'Granola')?.name, 'Granola Labs');
  assert.equal(findSponsor(uk, 'Wise')?.name, 'Wise Payments Limited');
  assert.equal(findSponsor(uk, 'Checkout.com')?.name, 'CHECKOUT LTD');
  assert.equal(findSponsor(uk, 'Octopus Energy Group')?.name, 'Octopus Energy Limited');
  assert.equal(findSponsor(nl, 'Adyen')?.name, 'Adyen N.V.');
  assert.equal(findSponsor(nl, 'Booking.com')?.name, 'Booking.com B.V.');
});
test('distinct brands and short names never match by shortening', () => {
  assert.equal(findSponsor(uk, 'Reactive Markets'), undefined);
  assert.equal(findSponsor(uk, 'Cypress Labs'), undefined);
  assert.equal(findSponsor(uk, 'Dex'), undefined);
});
test('UK register CSV keeps work routes, handles quoted commas, and drops religious/charity-only sponsors', () => {
  const csv = '﻿Organisation Name,Town/City,County,Type & Rating,Route\n"Acme, Labs Ltd",London,,Worker (A rating),Skilled Worker\nAcme Labs Ltd,London ,,Worker (A rating),Global Business Mobility: Senior or Specialist Worker\nHoly Trust,"Temple Campus, Road",Bristol,Temporary Worker (A rating),Religious Worker\n';
  const rows = parseUkRegister(csv);
  assert.deepEqual(rows.map(r => r.name), ['Acme, Labs Ltd', 'Acme Labs Ltd']);
  assert.match(rows[1].detail || '', /GBM: Senior or Specialist Worker/);
});
test('IND register reads organisation names from header cells', () => {
  const rows = Array.from({ length: 1200 }, (_, i) => `<tr><th>Company ${i} B.V.</th><td>${10000000 + i}</td></tr>`).join('');
  const parsed = parseNlRegister(`<table><tr><th>Organisation</th><th>KvK</th></tr>${rows}</table>`);
  assert.equal(parsed[0].name, 'Company 0 B.V.');
  assert.equal(parsed[0].detail, 'KvK 10000000');
});

const raw = (over: Partial<RawJob>): RawJob => ({ externalId: '1', title: 'Software Engineer', company: 'Monzo', location: 'London, UK', description: 'Build things.', applyUrl: 'https://example.com/apply', sourceUrl: 'https://example.com/job', source: 'Greenhouse', sourceKey: 'greenhouse-x', ...over });
const job = (over: Partial<RawJob>) => classifyJob(raw(over), new Date().toISOString())!;

test('licensed UK sponsor raises an unconfirmed listing to 70% without claiming certainty', () => {
  const result = applySponsorRegisters(job({}), registers);
  assert.equal(result.sponsorship.status, 'unknown');
  assert.equal(result.sponsorship.signal, 70);
  assert.match(result.sponsorship.reason, /Monzo Bank Ltd/);
  assert.equal(result.sponsorship.registers?.[0].listed, true);
});
test('explicit listing text outranks the register', () => {
  const result = applySponsorRegisters(job({ description: 'We are unable to offer visa sponsorship for this role.' }), registers);
  assert.equal(result.sponsorship.status, 'no');
  assert.equal(result.sponsorship.signal, null);
});
test('unlisted employers fall to a low signal only when every country has a register', () => {
  assert.equal(applySponsorRegisters(job({ company: 'Tiny Startup' }), registers).sponsorship.signal, 20);
  const mixed = applySponsorRegisters(job({ company: 'Tiny Startup', location: 'London, UK; Berlin, Germany' }), registers);
  assert.equal(mixed.sponsorship.signal, null);
  assert.equal(mixed.sponsorship.registers?.[0].listed, false);
});
test('register application is idempotent', () => {
  const once = applySponsorRegisters(job({ description: 'Relocation support is provided.' }), registers);
  const twice = applySponsorRegisters(once, registers);
  assert.equal(once.sponsorship.signal, 75);
  assert.deepEqual(twice.sponsorship, once.sponsorship);
});
test('Dutch roles use the IND register; other EU countries are untouched', () => {
  assert.equal(applySponsorRegisters(job({ company: 'Adyen', location: 'Amsterdam, Netherlands' }), registers).sponsorship.signal, 70);
  assert.equal(applySponsorRegisters(job({ company: 'Adyen', location: 'Madrid, Spain' }), registers).sponsorship.registers, undefined);
});
