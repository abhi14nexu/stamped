import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'cheerio';
import { fetchPublic, ROOT } from './sources';
import type { Job, RegisterMatch } from './types';

// Government registers of employers licensed to sponsor work visas. Being listed means an employer *can*
// sponsor; it does not mean a specific vacancy is sponsored. Not being listed under the trading name is
// weaker evidence, because legal names differ from brand names.
export interface RegisterEntry { name: string; detail?: string }
export interface Register { key: 'uk' | 'nl'; label: string; sourceUrl: string; checkedAt: string; rows: RegisterEntry[] }
export type Registers = Partial<Record<'uk' | 'nl', Register>>;

const STORE = path.join(ROOT, '.local/registers');
const UK_PAGE = 'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers';
const NL_PAGE = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work';
const UK_ROUTES = /skilled worker|global business mobility|scale-up|graduate trainee|expansion worker/i;
export const REGISTER_COUNTRY = { uk: 'GB', nl: 'NL' } as const;
export const REGISTER_LABEL = { uk: 'UK Home Office register of licensed sponsors', nl: 'Dutch IND register of recognised sponsors' } as const;

// Legal forms are always dropped from the end of a name. Qualifiers and generic suffixes are only dropped to
// form a second, shorter key when what remains is still distinctive ("Monzo Bank Ltd" → "monzo").
const FORMS = new Set(['limited', 'ltd', 'plc', 'llp', 'lp', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'gmbh', 'mbh', 'ag', 'se', 'sa', 'sas', 'sasu', 'sarl', 'bv', 'nv', 'ab', 'as', 'asa', 'aps', 'oy', 'oyj', 'spa', 'srl', 'sl', 'slu', 'kg', 'ug', 'kft', 'sro', 'co', 'company', 'cic', 'cio']);
const QUALIFIERS = new Set(['uk', 'gb', 'europe', 'emea', 'eu', 'international', 'intl', 'global', 'group', 'holding', 'holdings', 'netherlands', 'nederland', 'benelux', 'branch', 'trading', 'and']);
// Suffixes a brand's registered legal entity commonly adds ("Granola Labs", "Ravio Technologies", "Capsa.AI").
const GENERIC = new Set(['technologies', 'technology', 'tech', 'labs', 'lab', 'software', 'solutions', 'systems', 'services', 'payments', 'bank', 'ai', 'io', 'hq', 'app', 'apps', 'platform', 'platforms', 'com']);
const dropTrailing = (tokens: string[], sets: Set<string>[], keys: string[] = []) => {
  const base = [...tokens];
  while (base.length > 1 && sets.some(set => set.has(base[base.length - 1]))) { base.pop(); if (base.join('').length >= 4) keys.push(base.join(' ')); }
  return keys;
};

/** Lower-case word tokens with trailing legal forms removed: "Monzo Bank Ltd" → ["monzo", "bank"]. */
export function orgTokens(name: string): string[] {
  const words = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/\b([a-z])\.([a-z])\.?(?=\s|$)/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && FORMS.has(words[words.length - 1])) words.pop();
  return words;
}
/** Register-side keys: the full name, then shorter forms without trailing qualifiers or entity suffixes. */
export function orgKeys(name: string): string[] {
  const tokens = orgTokens(name);
  return tokens.length ? [tokens.join(' '), ...dropTrailing(tokens, [FORMS, QUALIFIERS, GENERIC])] : [];
}
/** Company-side keys: only qualifiers are dropped ("Octopus Energy Group" → "octopus energy"); a brand is never
 * shortened, so "Cypress Labs" cannot match an unrelated "Cypress Ltd" and "Reactive Markets" stays distinct. */
export function companyKeys(name: string): string[] {
  // A trailing domain is not part of the legal name: "Checkout.com" is Checkout Ltd.
  const tokens = orgTokens(name.replace(/\.(?:com|io|ai|co|app|dev|tech)\s*$/i, ''));
  return tokens.length ? [tokens.join(' '), ...dropTrailing(tokens, [FORMS, QUALIFIERS])] : [];
}
export function buildRegister(key: 'uk' | 'nl', sourceUrl: string, rows: RegisterEntry[]): Register {
  return { key, label: REGISTER_LABEL[key], sourceUrl, checkedAt: new Date().toISOString(), rows };
}
const indexes = new WeakMap<Register, Map<string, RegisterEntry>>();
function registerIndex(register: Register): Map<string, RegisterEntry> {
  let index = indexes.get(register);
  if (index) return index;
  index = new Map();
  // Exact names win over shortened ones when two register entries share a key.
  const keyed = register.rows.map(row => [row, orgKeys(row.name)] as const);
  for (let depth = 0; depth < 6; depth++) for (const [row, keys] of keyed) { const k = keys[depth]; if (k && k.length >= 3 && !index.has(k)) index.set(k, row); }
  indexes.set(register, index);
  return index;
}
export function findSponsor(register: Register, company: string): RegisterEntry | undefined {
  const index = registerIndex(register);
  for (const k of companyKeys(company)) if (k.length >= 3 && index.has(k)) return index.get(k);
  return undefined;
}

/** Minimal RFC 4180 parser; the register quotes fields that contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export function parseUkRegister(csv: string): RegisterEntry[] {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const header = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
  const name = header.indexOf('organisation name'), town = header.indexOf('town/city'), route = header.indexOf('route');
  if (name < 0 || route < 0) throw new Error('UK sponsor register columns changed');
  const byName = new Map<string, RegisterEntry & { routes: Set<string> }>();
  for (const row of rows) {
    const org = row[name]?.replace(/\s+/g, ' ').trim(), r = row[route]?.trim();
    if (!org || !r || !UK_ROUTES.test(r)) continue;
    const entry = byName.get(org) || { name: org, routes: new Set<string>(), detail: row[town]?.replace(/\s+/g, ' ').trim() };
    entry.routes.add(r.replace(/^Global Business Mobility: /, 'GBM: '));
    byName.set(org, entry);
  }
  return [...byName.values()].map(({ name, detail, routes }) => ({ name, detail: [detail, [...routes].join(', ')].filter(Boolean).join(' · ') }));
}
export function parseNlRegister(html: string): RegisterEntry[] {
  const $ = load(html);
  const rows = $('table tr').toArray().slice(1).map(tr => $(tr).find('th,td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim()));
  const entries = rows.filter(cells => cells[0]).map(cells => ({ name: cells[0], detail: cells[1] ? `KvK ${cells[1]}` : undefined }));
  if (entries.length < 1000) throw new Error('IND register table changed');
  return entries;
}

function readStored(key: 'uk' | 'nl'): Register | undefined {
  try { const r = JSON.parse(fs.readFileSync(path.join(STORE, `${key}.json`), 'utf8')); return Array.isArray(r.rows) ? r : undefined; } catch { return undefined; }
}
function store(register: Register) {
  fs.mkdirSync(STORE, { recursive: true });
  const file = path.join(STORE, `${register.key}.json`), temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(register), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function loadRegisters(): Registers {
  return { uk: readStored('uk'), nl: readStored('nl') };
}
/** Refresh registers older than a day. Failures keep the previous copy; registers are optional evidence. */
export async function refreshRegisters(log: (message: string) => void = () => {}): Promise<Registers> {
  const current = loadRegisters();
  const stale = (r?: Register) => !r || Date.now() - Date.parse(r.checkedAt) > 86400000;
  if (stale(current.uk)) {
    try {
      const page = JSON.parse(await fetchPublic(UK_PAGE));
      const csv = (page.details?.attachments || []).find((a: any) => a.content_type === 'text/csv' && /worker/i.test(a.title || ''))?.url;
      if (typeof csv !== 'string') throw new Error('UK register CSV link missing');
      const entries = parseUkRegister(await fetchPublic(csv));
      current.uk = buildRegister('uk', csv, entries); store(current.uk);
      log(`UK sponsor register: ${entries.length.toLocaleString()} licensed worker sponsors`);
    } catch (error: any) { log(`UK sponsor register not refreshed: ${error.message}`); }
  }
  if (stale(current.nl)) {
    try {
      const entries = parseNlRegister(await fetchPublic(NL_PAGE));
      current.nl = buildRegister('nl', NL_PAGE, entries); store(current.nl);
      log(`IND register: ${entries.length.toLocaleString()} recognised sponsors`);
    } catch (error: any) { log(`IND register not refreshed: ${error.message}`); }
  }
  return current;
}

// Listing text decides yes/no. Registers only move the "Not sure" signal, from the text-only signal:
// none, existing-authorization 20, conflicting 50, relocation 55, conditional 65.
const LISTED: Record<string, number> = { none: 70, 20: 35, 50: 55, 55: 75, 65: 80 };
// Weaker, because a brand name can differ from the registered legal name (Deliveroo is Roofoods Ltd).
const UNLISTED: Record<string, number> = { none: 20, 20: 10, 50: 30, 55: 35, 65: 40 };

export function applySponsorRegisters(job: Job, registers: Registers): Job {
  const s = job.sponsorship;
  const textSignal = s.textSignal !== undefined ? s.textSignal : s.signal;
  const textReason = s.textReason || s.reason;
  const matches: RegisterMatch[] = [];
  for (const key of ['uk', 'nl'] as const) {
    const register = registers[key];
    if (!register || !job.countries.includes(REGISTER_COUNTRY[key])) continue;
    const entry = findSponsor(register, job.company);
    matches.push({ register: key, listed: !!entry, name: entry?.name, detail: entry?.detail, sourceUrl: register.sourceUrl, checkedAt: register.checkedAt });
  }
  const sponsorship = { ...s, textSignal, textReason, method: 'rules-v2' as const, registers: matches.length ? matches : undefined, signal: textSignal, reason: textReason };
  if (s.status !== 'unknown' || !matches.length) return { ...job, sponsorship };
  const level = textSignal === null || textSignal === undefined ? 'none' : String(textSignal);
  const listed = matches.filter(m => m.listed);
  // Registers only cover their own country; a role also offered elsewhere keeps its text-only floor.
  const uncovered = job.countries.some(c => !['GB', 'NL', 'IN', 'US'].includes(c));
  if (listed.length) {
    const m = listed[0];
    sponsorship.signal = LISTED[level] ?? Math.max(textSignal ?? 0, 70);
    sponsorship.reason = `Licensed sponsor: “${m.name}” is on the ${REGISTER_LABEL[m.register]}. The listing itself does not confirm sponsorship for this role. ${textSignal !== null && textSignal !== undefined ? textReason : ''}`.trim();
  } else if (!uncovered) {
    sponsorship.signal = UNLISTED[level] ?? 10;
    sponsorship.reason = `“${job.company}” was not found on the ${matches.map(m => REGISTER_LABEL[m.register]).join(' or ')}. Unlicensed employers cannot sponsor that visa route; the legal name may differ, so check the register.`;
  }
  return { ...job, sponsorship };
}
