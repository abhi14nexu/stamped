import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle, ArrowUp, ArrowUpRight, Bookmark, BriefcaseBusiness, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  CircleHelp, Clock3, Database, Download, ExternalLink, Globe2, Keyboard, Landmark, LayoutGrid, List, MapPin, Monitor, Moon, RefreshCw, Rocket, Search,
  ShieldCheck, SlidersHorizontal, Sprout, Sun, TrendingUp, X,
} from 'lucide-react';
import { COUNTRIES } from '../../tech/classify';
import type { Job, Market, RunState, Snapshot, SourceResult } from '../../tech/types';
import './styles.css';

// The list omits descriptions and quoted evidence; the detail panel loads the full listing on demand.
type ListJob = Omit<Job, 'description'>;
type Meta = Pick<Snapshot, 'updatedAt' | 'sources'> & { total: number; csrf: string; run: RunState; scheduleHours: number | null };
type View = 'discover' | 'saved' | 'sources';
type Sponsor = 'yes' | 'likely' | 'licensed' | 'unknown' | 'no';
type Stage = 'founding' | 'early';
type Workplace = 'Remote' | 'Hybrid' | 'Onsite';
type Sort = 'visa' | 'recent' | 'roles' | 'company';
/** Values inside one filter combine with OR ("Sponsors visa" or "Likely"); different filters combine with AND. */
interface Filters { market: Market | 'all'; q: string; company: string; sponsor: Sponsor[]; stage: Stage[]; workplace: Workplace[]; role: string[]; country: string[]; provider: string[]; sort: Sort }
type Dim = 'market' | 'sponsor' | 'stage' | 'workplace' | 'role' | 'country' | 'provider';

const BRAND = 'Stamped';
const DEFAULTS: Filters = { market: 'all', q: '', company: '', sponsor: [], stage: [], workplace: [], role: [], country: [], provider: [], sort: 'visa' };
const DIMS: Dim[] = ['market', 'sponsor', 'stage', 'workplace', 'role', 'country', 'provider'];
const SPONSORS: Sponsor[] = ['yes', 'likely', 'licensed', 'unknown', 'no'];
const STAGES: Stage[] = ['founding', 'early'];
const WORKPLACES: Workplace[] = ['Remote', 'Hybrid', 'Onsite'];
const MARKETS: Market[] = ['uk', 'eu', 'remote_global', 'india'];
const PAGE_SIZE = { companies: 20, roles: 30 };
const ROLES_WHEN_OPEN = 10;
const regionNames: Record<Market, string> = { uk: 'United Kingdom', eu: 'European Union', remote_global: 'Remote · anywhere', india: 'India · US companies' };
const sponsorNames = { yes: 'Definitely sponsors', no: 'Don’t sponsor', unknown: 'Not sure' };
const sponsorFilterNames: Record<Sponsor, string> = { yes: 'Definitely sponsors', likely: 'Likely (60%+, unconfirmed)', licensed: 'Licensed sponsor (register)', unknown: 'Not sure', no: 'Don’t sponsor' };
const stageNames: Record<Stage, string> = { founding: 'Founding roles', early: 'Early-stage startups' };
const registerNames = { uk: 'UK Home Office sponsor register', nl: 'Dutch IND recognised sponsors' };
const EMPLOYER_FEEDS = ['Greenhouse', 'Ashby', 'Lever', 'SmartRecruiters', 'Workable', 'Recruitee', 'Personio'];
const initialRun: RunState = { running: false, startedAt: null, finishedAt: null, completed: 0, total: 0, message: 'Ready to refresh', error: null };

const visaRelevant = (job: ListJob) => job.markets.includes('uk') || job.markets.includes('eu');
const licensed = (job: ListJob) => !!job.sponsorship.registers?.some(r => r.listed);
function sponsorMatches(job: ListJob, value: Sponsor) {
  if (!visaRelevant(job)) return false;
  const s = job.sponsorship;
  if (value === 'licensed') return licensed(job);
  // "Likely" excludes explicit offers, so it can be combined with "Definitely sponsors".
  if (value === 'likely') return s.status === 'unknown' && (s.signal ?? 0) >= 60;
  return s.status === value;
}
const recency = (job: ListJob) => job.sourceUpdatedAt || job.fetchedAt;
/** Ordering for visa seekers: explicit offers, then the strongest "Not sure" signals, then the rest. */
const visaScore = (job: ListJob) => !visaRelevant(job) ? 60 : job.sponsorship.status === 'yes' ? 100 : job.sponsorship.status === 'no' ? 0 : job.sponsorship.signal ?? 15;
const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];

function storage<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : parse(raw); } catch { return fallback; }
}
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled; this tab still works. */ } }
function dateTime(value?: string | null) { return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No completed refresh'; }
function ago(value?: string) {
  const days = value ? (Date.now() - Date.parse(value)) / 86400000 : NaN;
  if (!Number.isFinite(days)) return '';
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return `${Math.floor(days)}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function shortLocation(job: ListJob) {
  const parts = job.location.replace(/ · [^\n]+ \(source region\)$/, '').split(/;|\n/).map(p => p.replace(/\s*\(remote\)\s*/i, '').trim()).filter(Boolean);
  if (!parts.length) return job.countries.map(c => COUNTRIES[c] || c).join(', ') || 'Location not specified';
  const first = parts[0].length > 48 ? parts[0].slice(0, 46) + '…' : parts[0];
  return parts.length > 1 ? `${first} +${parts.length - 1}` : first;
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?'; }
function hue(name: string) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 6; return h; }
function termMatchers(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean).map(term => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}
function recentCount(list: ListJob[], since: number) { return list.filter(j => Date.parse(recency(j)) >= since).length; }

// Filters live in the URL hash (repeated keys for multiple values), so a search can be bookmarked or shared.
function readHash(): { filters: Filters; view: View; page: number } {
  const p = new URLSearchParams(location.hash.slice(1));
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T) => (allowed as readonly string[]).includes(p.get(key) || '') ? p.get(key) as T : fallback;
  const many = <T extends string>(key: string, allowed?: readonly T[]) => [...new Set(p.getAll(key))].filter(v => v && (!allowed || (allowed as readonly string[]).includes(v))) as T[];
  return {
    view: pick<View>('view', ['discover', 'saved', 'sources'], 'discover'),
    page: Math.max(1, Math.min(10000, Number(p.get('page')) || 1)),
    filters: {
      market: pick('market', ['all', ...MARKETS] as const, 'all'), q: p.get('q') || '', company: p.get('company') || '',
      sponsor: many('sponsor', SPONSORS), stage: many('stage', STAGES), workplace: many('workplace', WORKPLACES),
      role: many('role'), country: many('country'), provider: many('source'), sort: pick('sort', ['visa', 'recent', 'roles', 'company'] as const, 'visa'),
    },
  };
}
function writeHash(filters: Filters, view: View, page: number) {
  const p = new URLSearchParams();
  if (view !== 'discover') p.set('view', view);
  if (filters.market !== 'all') p.set('market', filters.market);
  if (filters.q) p.set('q', filters.q);
  if (filters.company) p.set('company', filters.company);
  for (const [key, values] of [['sponsor', filters.sponsor], ['stage', filters.stage], ['workplace', filters.workplace], ['role', filters.role], ['country', filters.country], ['source', filters.provider]] as const) for (const v of values) p.append(key, v);
  if (filters.sort !== 'visa') p.set('sort', filters.sort);
  if (page > 1) p.set('page', String(page));
  const hash = p.toString();
  if (hash !== location.hash.slice(1)) history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}

type Theme = 'system' | 'light' | 'dark';
const savedTheme = () => storage<Theme>('tech-opportunities-theme', 'system', raw => (['light', 'dark'].includes(raw) ? raw : 'system') as Theme);
function applyTheme(theme: Theme) { if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme); }
applyTheme(savedTheme());

function csvValue(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
async function exportJobs(jobs: ListJob[]) {
  let evidence: Record<string, string[]> = {};
  try { const response = await fetch('/api/evidence'); if (response.ok) evidence = await response.json(); } catch { /* Export without quotes. */ }
  const headings = ['Title', 'Company', 'Location', 'Role', 'Markets', 'Workplace', 'Remote eligibility', 'Sponsorship', 'Heuristic signal % (not probability)', 'Reason', 'Evidence', 'Sponsor register', 'Company stage', 'Apply URL', 'Source URL', 'Employer updated', 'Last checked'];
  const rows = jobs.map(j => [j.title, j.company, j.location, j.role, j.markets.map(m => regionNames[m]).join('; '), j.workplace, j.remoteEligibility,
    visaRelevant(j) ? sponsorNames[j.sponsorship.status] : 'Not applicable', visaRelevant(j) ? j.sponsorship.signal : '', j.sponsorship.reason, (evidence[j.id] || []).join(' | '),
    (j.sponsorship.registers || []).map(r => `${registerNames[r.register]}: ${r.listed ? `listed as ${r.name}` : 'not found'}`).join('; '),
    j.stage === 'founding' ? 'Founding role' : j.stage === 'early' ? 'Early-stage signal' : '', j.applyUrl, j.sourceUrl, j.sourceUpdatedAt || '', j.fetchedAt]);
  const blob = new Blob(['﻿', [headings, ...rows].map(row => row.map(csvValue).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = href; a.download = 'tech-opportunities.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function CompanyMark({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return <span className={`mark mark-${size} hue-${hue(name)}`} aria-hidden="true">{initials(name)}</span>;
}

function SponsorBadge({ job, long = false }: { job: ListJob; long?: boolean }) {
  if (!visaRelevant(job)) return <span className="badge remote"><Globe2 size={12} />{job.remoteEligibility === 'worldwide' ? 'Remote · anywhere' : job.remoteEligibility === 'india' ? 'Remote · open to India' : job.countries.includes('IN') ? 'India office · US company' : 'Remote'}</span>;
  const s = job.sponsorship;
  const label = s.status === 'yes' ? (long ? 'Definitely sponsors' : 'Sponsors visa') : s.status === 'no' ? 'Don’t sponsor' : 'Not sure';
  return <span className={`badge ${s.status}`} title={s.reason}>
    {s.status === 'yes' ? <Check size={12} /> : s.status === 'no' ? <X size={12} /> : <CircleHelp size={12} />}{label}
    {s.status === 'unknown' && s.signal !== null && <span className="badge-signal">{s.signal}%</span>}
  </span>;
}

function RoleRow({ job, showCompany, selected, saved, onSelect, onToggleSave }: {
  job: ListJob; showCompany?: boolean; selected: boolean; saved: boolean; onSelect: () => void; onToggleSave: () => void;
}) {
  const updated = ago(recency(job));
  return <article className={`role ${selected ? 'selected' : ''}`} data-role-id={job.id}>
    {showCompany && <CompanyMark name={job.company} />}
    <div className="role-main">
      {showCompany && <span className="role-company">{job.company}{licensed(job) && <span className="chip licensed" title="On a government sponsor register"><Landmark size={11} />Licensed</span>}</span>}
      <button className="role-title" onClick={onSelect} aria-label={`View ${job.title} at ${job.company}`}>{job.title}</button>
      <div className="role-meta">
        <span><MapPin size={12} />{shortLocation(job)}</span>
        {job.workplace !== 'Unspecified' && <span>{job.workplace}</span>}
        <span>{job.role}</span>
        {updated && <span><Clock3 size={12} />{updated}</span>}
      </div>
      <div className="role-tags">
        <SponsorBadge job={job} />
        {job.stage === 'founding' && <span className="chip early"><Rocket size={11} />Founding</span>}
        {showCompany && job.stage === 'early' && <span className="chip early"><Sprout size={11} />Early-stage</span>}
      </div>
    </div>
    <div className="role-actions">
      <button className={`icon-button ${saved ? 'is-saved' : ''}`} aria-pressed={saved} aria-label={`${saved ? 'Unsave' : 'Save'} ${job.title}`} title={saved ? 'Saved' : 'Save'} onClick={onToggleSave}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button>
      <a className="icon-button" href={job.applyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Apply for ${job.title} at ${job.company}`} title="Apply"><ArrowUpRight size={16} /></a>
    </div>
  </article>;
}

/** Stamped's mark: a perforated postage stamp (the visa stamp) with an arrow for the move. */
function Logo({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const edge = [6, 13, 20, 27, 34];
  return <svg className="logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <defs><mask id={`perf-${id}`}>
      <rect width="40" height="40" fill="#fff" />
      {edge.map(v => <React.Fragment key={v}><circle cx={v} cy="2" r="2.3" fill="#000" /><circle cx={v} cy="38" r="2.3" fill="#000" /><circle cx="2" cy={v} r="2.3" fill="#000" /><circle cx="38" cy={v} r="2.3" fill="#000" /></React.Fragment>)}
    </mask></defs>
    <rect x="2" y="2" width="36" height="36" rx="2" className="logo-stamp" mask={`url(#perf-${id})`} />
    <rect x="8.5" y="8.5" width="23" height="23" rx="2.5" className="logo-frame" />
    <path d="M15 25 25 15M17.5 15H25v7.5" className="logo-arrow" />
  </svg>;
}

function CompanyCard({ company, jobs, early, shown, onShow, selectedId, saved, onSelect, onToggleSave }: {
  company: string; jobs: ListJob[]; early: boolean; shown: number; onShow: (n: number) => void; selectedId?: string;
  saved: Set<string>; onSelect: (id: string) => void; onToggleSave: (id: string) => void;
}) {
  const listId = useId();
  const open = shown > 0;
  const countries = [...new Set(jobs.flatMap(j => j.countries))].map(c => COUNTRIES[c] || c);
  const sponsors = jobs.filter(j => visaRelevant(j) && j.sponsorship.status === 'yes').length;
  const register = jobs.flatMap(j => j.sponsorship.registers || []).find(r => r.listed);
  const remote = jobs.filter(j => j.workplace === 'Remote').length;
  const founding = jobs.filter(j => j.stage === 'founding').length;
  const titles = [...new Set(jobs.map(j => j.title))];
  return <section className={`company ${open ? 'open' : ''} ${jobs.some(j => j.id === selectedId) ? 'has-selected' : ''}`}>
    <h2 className="company-heading">
      <button className="company-head" aria-expanded={open} aria-controls={listId} onClick={() => onShow(open ? 0 : Math.min(jobs.length, ROLES_WHEN_OPEN))}>
        <CompanyMark name={company} />
        <span className="company-title">
          <span className="company-name">{company}</span>
          <span className="company-sub">{countries.slice(0, 3).join(' · ')}{countries.length > 3 ? ` +${countries.length - 3}` : ''}</span>
          {(register || early || sponsors > 0 || remote > 0 || founding > 0) && <span className="company-chips">
            {sponsors > 0 && <span className="chip yes"><ShieldCheck size={11} />{sponsors} with visa sponsorship</span>}
            {register && <span className="chip licensed" title={`${registerNames[register.register]}: ${register.name}`}><Landmark size={11} />Licensed sponsor</span>}
            {founding > 0 && <span className="chip early"><Rocket size={11} />{founding} founding</span>}
            {early && !founding && <span className="chip early" title="Early-stage wording in a listing"><Sprout size={11} />Early-stage</span>}
            {remote > 0 && <span className="chip"><Globe2 size={11} />{remote} remote</span>}
          </span>}
          {!open && <span className="company-peek">{titles.slice(0, 2).join(' · ')}{titles.length > 2 ? ` · +${jobs.length - 2} more` : ''}</span>}
        </span>
        <span className="company-count">{jobs.length} {jobs.length === 1 ? 'role' : 'roles'}<ChevronDown size={15} className="chev" /></span>
      </button>
    </h2>
    {open && <div className="company-roles" id={listId}>
      {jobs.slice(0, shown).map(job => <RoleRow key={job.id} job={job} selected={selectedId === job.id} saved={saved.has(job.id)} onSelect={() => onSelect(job.id)} onToggleSave={() => onToggleSave(job.id)} />)}
    </div>}
    {open && <div className="company-foot">
      {shown < jobs.length && <button aria-controls={listId} onClick={() => onShow(Math.min(jobs.length, shown + 25))}>Show {Math.min(25, jobs.length - shown)} more of {jobs.length}<ChevronDown size={14} /></button>}
      <button aria-controls={listId} onClick={() => onShow(0)}>Collapse<ChevronDown size={14} className="flip" /></button>
    </div>}
  </section>;
}

interface Option { value: string; label: string; count: number }
/** A dropdown of checkboxes. Choices inside it combine with OR. */
function MultiSelect({ label, options, selected, onChange, searchable = false }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; searchable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const name = (value: string) => options.find(o => o.value === value)?.label ?? value;
  const summary = !selected.length ? 'Any' : selected.length === 1 ? name(selected[0]) : `${name(selected[0])} +${selected.length - 1}`;
  const shown = options.filter(o => selected.includes(o.value) || !query || o.label.toLowerCase().includes(query.toLowerCase()));
  return <div className="multi" ref={ref}>
    <span className="multi-label" id={`${id}-label`}>{label}</span>
    <button className={`multi-button ${selected.length ? 'has' : ''}`} aria-haspopup="true" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`} onClick={() => setOpen(v => !v)}>
      <span id={`${id}-value`}>{summary}</span><ChevronDown size={14} />
    </button>
    {open && <div className="multi-pop" role="group" aria-labelledby={`${id}-label`}>
      {searchable && <input className="multi-search" autoFocus placeholder={`Find ${label.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} />}
      <div className="multi-list">
        {shown.map(o => <label key={o.value} className={`multi-option ${!o.count && !selected.includes(o.value) ? 'empty' : ''}`}>
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onChange(toggle(selected, o.value))} />
          <span>{o.label}</span><em>{o.count.toLocaleString()}</em>
        </label>)}
        {!shown.length && <p className="muted small">No matches</p>}
      </div>
      <div className="multi-foot"><button className="text-button" disabled={!selected.length} onClick={() => onChange([])}>Clear</button><button className="text-button" onClick={() => setOpen(false)}>Done</button></div>
    </div>}
  </div>;
}

function pageNumbers(page: number, pages: number): (number | '…')[] {
  const wanted = [...new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return wanted.flatMap((n, i) => i && n - wanted[i - 1] > 1 ? ['…' as const, n] : [n]);
}
function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (n: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav className="pager" aria-label={label}>
    <button disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /><span>Prev</span></button>
    {pageNumbers(page, pages).map((n, i) => n === '…' ? <span key={`gap-${i}`} className="pager-gap">…</span>
      : <button key={n} className={n === page ? 'active' : ''} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>)}
    <button disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page"><span>Next</span><ChevronRight size={16} /></button>
  </nav>;
}

function SignalMeter({ value, registers }: { value: number; registers: boolean }) {
  const tone = value >= 60 ? 'high' : value >= 30 ? 'mid' : 'low';
  return <div className={`meter ${tone}`}>
    <div className="meter-head"><strong>{value}%</strong><span>{registers ? 'Listing text + sponsor register' : 'Listing text signal'}</span></div>
    <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Heuristic sponsorship signal"><span style={{ width: `${value}%` }} /></div>
    <small>A fixed heuristic score, not a measured probability.</small>
  </div>;
}

function DetailPanel({ job, full, saved, onToggleSave, onClose, sourceFailed }: {
  job: ListJob; full: Job | null | undefined; saved: boolean; onToggleSave: () => void; onClose: () => void; sourceFailed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { setExpanded(false); ref.current?.scrollTo({ top: 0 }); }, [job.id]);
  const s = job.sponsorship;
  const evidence = full?.sponsorship.evidence ?? [];
  // Feeds often pad sections with blank lines; keep paragraph breaks, drop the gaps.
  const description = (full?.description || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const long = description.length > 1600;
  return <aside className="detail" aria-label="Job details" ref={ref}>
    <button className="detail-back" onClick={onClose}><ChevronLeft size={18} />Back to results</button>
    <div className="detail-head">
      <CompanyMark name={job.company} size="lg" />
      <div>
        <span className="detail-company">{job.company}</span>
        <h2 className="detail-title">{job.title}</h2>
      </div>
      <button className="icon-button detail-close" aria-label="Close details" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="detail-meta">
      <span><MapPin size={13} />{job.location || 'Location not specified'}</span>
      <span><BriefcaseBusiness size={13} />{job.role}{job.workplace !== 'Unspecified' ? ` · ${job.workplace}` : ''}</span>
      {job.salary && <span>{job.salary}</span>}
    </div>
    <div className="detail-actions">
      <a className="button primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">{EMPLOYER_FEEDS.includes(job.source) ? 'Apply on employer site' : `Apply via ${job.source}`}<ArrowUpRight size={16} /></a>
      <button className={`button ${saved ? 'is-saved' : ''}`} aria-pressed={saved} onClick={onToggleSave}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button>
    </div>

    {visaRelevant(job) ? <section className={`panel visa ${s.status}`}>
      <div className="panel-label"><ShieldCheck size={14} />Visa sponsorship</div>
      <div className="visa-status"><SponsorBadge job={job} long /></div>
      <p className="panel-text">{s.reason}</p>
      {s.status === 'unknown' && s.signal !== null && <SignalMeter value={s.signal} registers={!!s.registers?.length} />}
      {s.registers?.map(r => <div key={r.register} className={`register ${r.listed ? 'listed' : 'unlisted'}`}>
        <Landmark size={15} />
        <div>
          <strong>{r.listed ? 'Licensed visa sponsor' : 'Not found on the sponsor register'}</strong>
          <span>{registerNames[r.register]}{r.listed ? ` · “${r.name}”${r.detail ? ` · ${r.detail}` : ''}` : ` · searched for “${job.company}”; the legal name may differ`}</span>
          <a href={r.register === 'uk' ? 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers' : r.sourceUrl} target="_blank" rel="noopener noreferrer">Check the register<ExternalLink size={11} /></a>
        </div>
      </div>)}
      <div className="panel-label sub">From the listing</div>
      {full === undefined ? <p className="muted small">Loading the listing’s wording…</p>
        : evidence.length ? evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)
        : <p className="muted small">The listing doesn’t mention visas or sponsorship.</p>}
    </section> : <section className="panel remote">
      <div className="panel-label"><Globe2 size={14} />{job.markets.includes('india') && job.remoteEligibility === 'unknown' ? 'Work in India' : 'Remote eligibility'}</div>
      <div className="visa-status"><SponsorBadge job={job} long /></div>
      {(full?.remoteEvidence ?? []).map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}
      <p className="panel-text">Check the full listing for timezone, employment-type and location conditions.</p>
      {job.employerCountry === 'US' && <p className="panel-text"><strong>US employer:</strong> {job.employerCountryReason || 'the listing or a company dataset names a US headquarters.'}</p>}
      {job.employerCountrySource && <a className="text-link" href={job.employerCountrySource} target="_blank" rel="noopener noreferrer">Evidence the employer is US-based<ExternalLink size={11} /></a>}
    </section>}

    {job.stage && <section className="panel stage">
      <div className="panel-label">{job.stage === 'founding' ? <Rocket size={14} /> : <Sprout size={14} />}{job.stage === 'founding' ? 'Founding role' : 'Early-stage company'}</div>
      {job.stageEvidence && job.stage === 'early' ? <blockquote>{job.stageEvidence}</blockquote> : <p className="panel-text">The title describes a founding or first-hire position.</p>}
    </section>}

    <section className="description">
      <h3>About the role</h3>
      <div className={`description-text ${long && !expanded ? 'clamped' : ''}`}>{full === undefined ? 'Loading description…' : description || 'Description unavailable. Open the original listing.'}</div>
      {long && <button className="text-button" onClick={() => setExpanded(v => !v)}>{expanded ? 'Show less' : 'Show full description'}<ChevronDown size={14} className={expanded ? 'flip' : ''} /></button>}
    </section>
    <footer className="provenance">
      <span>Source: {job.attributionUrl ? <a href={job.attributionUrl} target="_blank" rel="noopener noreferrer">{job.source}</a> : job.source} · <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">original listing</a></span>
      <span>Checked {dateTime(job.fetchedAt)}{job.sourceUpdatedAt ? ` · employer updated ${dateTime(job.sourceUpdatedAt)}` : ''}</span>
      {sourceFailed && <strong className="stale">This source failed on the last refresh; the listing is from an earlier check.</strong>}
      <span>Availability and sponsorship can change. Verify on the application page.</span>
    </footer>
  </aside>;
}

function Highlights({ counts, onPick }: { counts: { yes: number; likely: number; licensed: number; founding: number; early: number; remoteGlobal: number; india: number; week: number }; onPick: (patch: Partial<Filters>) => void }) {
  const items: [string, number, string, React.ReactNode, Partial<Filters>][] = [
    ['Sponsor visas or likely to', counts.yes + counts.likely, 'Explicit offers plus 60%+ signals', <ShieldCheck size={18} />, { sponsor: ['yes', 'likely'] }],
    ['At licensed sponsors', counts.licensed, 'Employer on the UK or Dutch register', <Landmark size={18} />, { sponsor: ['licensed'] }],
    ['Founding roles', counts.founding, 'Founding and first-hire titles', <Rocket size={18} />, { stage: ['founding'] }],
    ['Early-stage startups', counts.early, 'Seed, Series A, YC or founding team', <Sprout size={18} />, { stage: ['early'] }],
    ['Remote, work from anywhere', counts.remoteGlobal, 'Explicitly open worldwide', <Globe2 size={18} />, { market: 'remote_global' }],
    ['Work for a US company from India', counts.india, 'Remote or at an Indian office', <MapPin size={18} />, { market: 'india' }],
    ['Updated this week', counts.week, 'Newest listings first', <Clock3 size={18} />, { sort: 'recent' }],
  ];
  return <aside className="detail highlights" aria-label="Shortcuts">
    <h2>Where to start</h2>
    <p>Pick a shortcut, or open a company and choose a role to see its sponsorship evidence and application link.</p>
    <div className="highlight-list">
      {items.map(([title, n, hint, icon, patch]) => <button key={title} className="highlight" onClick={() => onPick(patch)} disabled={!n}>
        <span className="highlight-icon">{icon}</span>
        <span className="highlight-text"><strong>{title}</strong><span>{hint}</span></span>
        <span className="highlight-count">{n.toLocaleString()}</span>
      </button>)}
    </div>
    <p className="shortcut-hint"><Keyboard size={13} /><span><kbd>/</kbd> search · <kbd>J</kbd> <kbd>K</kbd> next / previous role · <kbd>S</kbd> save · <kbd>[</kbd> <kbd>]</kbd> previous / next page · <kbd>Esc</kbd> close</span></p>
  </aside>;
}

function SourcesView({ meta, onRefresh, running }: { meta: Meta | null; onRefresh: () => void; running: boolean }) {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'all' | 'problems'>('all');
  const [limit, setLimit] = useState(200);
  const sources = meta?.sources || [];
  const problems = sources.filter(s => s.status !== 'ok').length;
  const providers = useMemo(() => {
    const names: Record<string, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever', smartrecruiters: 'SmartRecruiters', workable: 'Workable', recruitee: 'Recruitee', personio: 'Personio', himalayas: 'Himalayas', arbeitnow: 'Arbeitnow' };
    const counts = new Map<string, { feeds: number; roles: number }>();
    for (const s of sources) { const k = names[s.group || s.key.split('-')[0]] || s.name.split(' · ')[0]; const c = counts.get(k) || { feeds: 0, roles: 0 }; c.feeds++; c.roles += s.accepted; counts.set(k, c); }
    return [...counts.entries()].sort((a, b) => b[1].roles - a[1].roles);
  }, [sources]);
  const maxRoles = Math.max(1, ...providers.map(([, c]) => c.roles));
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sources.filter(s => (status === 'all' || s.status !== 'ok') && (!q || s.name.toLowerCase().includes(q) || s.key.includes(q)))
      .sort((a, b) => Number(a.status === 'ok') - Number(b.status === 'ok') || b.accepted - a.accepted);
  }, [sources, filter, status]);
  return <div className="sources">
    <div className="stat-grid">
      <div className="stat"><span>Last completed refresh</span><strong>{dateTime(meta?.updatedAt)}</strong><button className="text-button" disabled={running} onClick={onRefresh}><RefreshCw size={13} className={running ? 'spin' : ''} />{running ? 'Refreshing…' : 'Refresh now'}</button></div>
      <div className="stat"><span>Sources</span><strong>{sources.length.toLocaleString()}</strong><small>{problems ? `${problems} failed or partial; their earlier listings are kept` : 'All refreshed successfully'}</small></div>
      <div className="stat"><span>Schedule</span><strong>{meta?.scheduleHours ? `Every ${meta.scheduleHours} hours` : 'On demand'}</strong><small>{meta?.scheduleHours ? 'While the local server keeps running.' : 'Set REFRESH_INTERVAL_HOURS to automate.'}</small></div>
    </div>

    <section className="card">
      <h2>Where the jobs come from</h2>
      <p className="card-text">Public employer feeds and job-board APIs. Employer boards are discovered from Common Crawl's public URL index and kept only when their live feed has a matching role. Sponsorship uses local text rules plus the UK and Dutch government sponsor registers; no AI service is called.</p>
      <div className="provider-bars">{providers.map(([name, c]) => <div key={name} className="provider">
        <span className="provider-name">{name}</span>
        <span className="provider-bar"><span style={{ width: `${Math.max(2, (c.roles / maxRoles) * 100)}%` }} /></span>
        <span className="provider-num">{c.roles.toLocaleString()} roles · {c.feeds.toLocaleString()} {c.feeds === 1 ? 'feed' : 'feeds'}</span>
      </div>)}</div>
    </section>

    <section className="card">
      <h2>How the sponsorship labels work</h2>
      <div className="method-grid">
        <div><span className="badge yes"><Check size={12} />Definitely sponsors</span><p>The listing explicitly offers visa sponsorship. It doesn't guarantee it for every applicant or every advertised country.</p></div>
        <div><span className="badge no"><X size={12} />Don’t sponsor</span><p>The listing explicitly rules out sponsorship or requires you not to need it. Listing text always outranks the registers.</p></div>
        <div><span className="badge unknown"><CircleHelp size={12} />Not sure<span className="badge-signal">70%</span></span><p>No definitive wording. The percentage combines conditional, relocation or right-to-work wording with the employer's licence status.</p></div>
      </div>
      <div className="table-wrap"><table className="signal-table"><thead><tr><th>Listing text</th><th>Licensed sponsor</th><th>Not found on register</th></tr></thead><tbody>
        <tr><td>Nothing about sponsorship</td><td>70%</td><td>20%</td></tr>
        <tr><td>Conditional sponsorship</td><td>80%</td><td>40%</td></tr>
        <tr><td>Relocation support only</td><td>75%</td><td>35%</td></tr>
        <tr><td>Conflicting statements</td><td>55%</td><td>30%</td></tr>
        <tr><td>Existing right to work requested</td><td>35%</td><td>10%</td></tr>
      </tbody></table></div>
      <p className="card-note">Registers: <a href="https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" target="_blank" rel="noopener noreferrer">UK Home Office</a> (Skilled Worker, Global Business Mobility, Scale-up) and <a href="https://ind.nl/en/public-register-recognised-sponsors/public-register-work" target="_blank" rel="noopener noreferrer">IND</a>. A licence means the employer can sponsor, not that this role is sponsored. "Not found" is weaker evidence because brand and legal names differ. Other EU countries have no comparable register, so their roles keep the text-only signal. Without wording or a register there is no percentage.</p>
    </section>

    <section className="card">
      <h2>Find more employers</h2>
      <p className="card-text">Bulk discovery reads every Greenhouse, Ashby, Lever, Workable, Recruitee and Personio board in recent Common Crawl snapshots and verifies each live feed: <code>npm run discover:tech -- --common-crawl --crawls 2 --write</code>. Or search manually; search hits are leads until verified.</p>
      <div className="link-row">{[
        ['Ashby · founding engineers', 'site:jobs.ashbyhq.com ("founding engineer" OR "first engineer" OR "founding software engineer") ("London" OR "Berlin" OR "Paris" OR "Amsterdam")'],
        ['Ashby · visa sponsorship', 'site:jobs.ashbyhq.com ("visa sponsorship" OR "visa support") ("UK" OR "Europe")'],
        ['Greenhouse · visa sponsorship', 'site:job-boards.greenhouse.io ("engineer" OR "developer" OR "data") ("visa sponsorship" OR "relocation")'],
        ['Lever · visa sponsorship', 'site:jobs.lever.co ("visa sponsorship" OR "work permit") ("London" OR "Berlin" OR "Amsterdam" OR "Paris")'],
        ['LinkedIn · founding & sponsorship', 'site:linkedin.com/jobs/view ("founding engineer" OR "software engineer") "visa sponsorship" ("UK" OR "Europe")'],
      ].map(([label, q]) => <a key={label} href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={13} /></a>)}</div>
    </section>

    <section className="card">
      <div className="card-head">
        <h2>Source health</h2>
        <div className="card-tools">
          <label className="mini-search"><Search size={14} /><input aria-label="Filter sources" placeholder="Filter sources" value={filter} onChange={e => setFilter(e.target.value)} /></label>
          <div className="segmented" role="group" aria-label="Source status">
            <button className={status === 'all' ? 'active' : ''} aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All</button>
            <button className={status === 'problems' ? 'active' : ''} aria-pressed={status === 'problems'} onClick={() => setStatus('problems')}>Problems{problems ? ` (${problems})` : ''}</button>
          </div>
        </div>
      </div>
      <div className="table-wrap"><table className="source-table">
        <thead><tr><th>Source</th><th>Status</th><th>Listings</th><th>Tech</th><th>Matching</th><th>Checked</th></tr></thead>
        <tbody>{rows.slice(0, limit).map(s => <tr key={s.key}>
          <td><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}<ArrowUpRight size={12} /></a>{s.error && <small className="warn">{s.error}{s.retainedPrevious ? ' · earlier listings kept' : ''}</small>}{s.coverage && <small>{s.coverage}</small>}</td>
          <td><span className={`badge ${s.status === 'ok' ? 'yes' : s.status === 'partial' ? 'unknown' : 'no'}`}>{s.status === 'ok' ? 'Refreshed' : s.status === 'partial' ? 'Partial' : 'Failed'}</span></td>
          <td>{s.fetched.toLocaleString()}</td><td>{s.techRecognized?.toLocaleString() ?? '—'}</td><td><strong>{s.accepted.toLocaleString()}</strong></td><td className="nowrap">{ago(s.checkedAt) || dateTime(s.checkedAt)}</td>
        </tr>)}</tbody>
      </table></div>
      {rows.length > limit && <button className="button wide" onClick={() => setLimit(n => n + 300)}>Show more sources ({(rows.length - limit).toLocaleString()} remaining)<ChevronDown size={15} /></button>}
      {!sources.length && <div className="empty"><Database size={30} /><h2>No collection yet</h2><p>Refresh to read the configured public feeds.</p></div>}
    </section>
  </div>;
}

function App() {
  const initial = useMemo(readHash, []);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [jobs, setJobs] = useState<ListJob[]>([]);
  const [run, setRun] = useState<RunState>(initialRun);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(initial.view);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [jobView, setJobView] = useState<'companies' | 'roles'>(() => storage('tech-opportunities-view', 'companies', raw => raw === 'roles' ? 'roles' : 'companies'));
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [open, setOpen] = useState<Record<string, number>>({});
  const [expandAll, setExpandAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [moreFilters, setMoreFilters] = useState(() => !!(initial.filters.role.length || initial.filters.country.length || initial.filters.provider.length || initial.filters.company));
  const [details, setDetails] = useState<Record<string, Job | null>>({});
  const [searchHits, setSearchHits] = useState<{ q: string; ids: Set<string> } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => storage('tech-opportunities-saved', new Set<string>(), raw => { const ids = JSON.parse(raw); return new Set(Array.isArray(ids) ? ids.filter((x: unknown): x is string => typeof x === 'string') : []); }));
  const loadedAt = useRef<string | null | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsTop = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const companyListId = useId();
  const set = useCallback((patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch })), []);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch('/api/meta');
      if (!response.ok) throw new Error('Could not load the local job collection.');
      const next: Meta = await response.json(); setMeta(next); setRun(next.run);
      // Reload the list only when a refresh (from here, the CLI or the schedule) has written a new snapshot.
      if (next.updatedAt !== loadedAt.current) {
        const list = await fetch('/api/jobs');
        if (!list.ok) throw new Error('Could not load the local job collection.');
        const body: { updatedAt: string | null; jobs: ListJob[] } = await list.json();
        setJobs(body.jobs); loadedAt.current = body.updatedAt;
      }
      setError('');
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    if (run.running) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadData(); }, 60000);
    return () => clearInterval(timer);
  }, [run.running, loadData]);
  useEffect(() => {
    if (!run.running) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error('Refresh status unavailable');
        const next = await response.json(); setRun(next);
        if (!next.running) void loadData();
      } catch { setError('Connection interrupted. Your previous collection is still available.'); }
    }, 1500);
    return () => clearInterval(timer);
  }, [run.running, loadData]);
  useEffect(() => {
    const q = filters.q.trim();
    if (!q) { setSearchHits(null); return; }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (response.ok) { const body: { ids: string[] } = await response.json(); setSearchHits({ q, ids: new Set(body.ids) }); }
      } catch { /* Title, company and location matching still works offline. */ }
    }, 250);
    return () => clearTimeout(timer);
  }, [filters.q, meta?.updatedAt]);
  // A new search starts on page 1; the first render keeps the page from the link.
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } setPage(1); }, [filters, view, jobView]);
  useEffect(() => { writeHash(filters, view, page); }, [filters, view, page]);
  useEffect(() => {
    const onHash = () => { const next = readHash(); setFilters(next.filters); setView(next.view); setPage(next.page); };
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 700);
    window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { store('tech-opportunities-view', jobView); }, [jobView]);
  useEffect(() => { store('tech-opportunities-saved', JSON.stringify([...saved])); }, [saved]);
  useEffect(() => { store('tech-opportunities-theme', theme); applyTheme(theme); }, [theme]);

  async function startRefresh() {
    if (!meta || run.running) return;
    setError('');
    try {
      const response = await fetch('/api/refresh', { method: 'POST', headers: { 'X-CSRF-Token': meta.csrf } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Refresh could not start');
      setRun(result.run);
    } catch (e) { setError((e as Error).message); }
  }
  const toggleSaved = useCallback((id: string) => setSaved(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const select = useCallback((id: string) => { setSelectedId(id); setMobileDetail(true); }, []);
  const reset = () => setFilters(f => ({ ...DEFAULTS, sort: f.sort }));
  const goToPage = useCallback((n: number) => { setPage(n); resultsTop.current?.scrollIntoView({ block: 'start' }); }, []);

  const localIndex = useMemo(() => new Map(jobs.map(job => [job.id, `${job.title} ${job.company} ${job.location} ${job.role}`.toLowerCase()])), [jobs]);
  const earlyCompanies = useMemo(() => new Set(jobs.filter(job => job.stage).map(job => job.company)), [jobs]);
  const companies = useMemo(() => [...new Set(jobs.map(j => j.company))].sort((a, b) => a.localeCompare(b)), [jobs]);
  const exactCompany = filters.company ? companies.find(name => name.toLowerCase() === filters.company.trim().toLowerCase()) : undefined;

  // Each filter is its own predicate. Counts for one filter's options apply every other filter, so they show what
  // selecting an option would add.
  const engine = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const terms = termMatchers(q);
    const companyQ = filters.company.trim().toLowerCase();
    const anyOf = <T,>(values: T[], test: (v: T) => boolean) => !values.length || values.some(test);
    const always = (j: ListJob) => (view !== 'saved' || saved.has(j.id))
      && (!companyQ || (exactCompany ? j.company === exactCompany : j.company.toLowerCase().includes(companyQ)))
      && (!q || (searchHits?.q.toLowerCase() === q ? searchHits.ids.has(j.id) : terms.every(term => term.test(localIndex.get(j.id) || ''))));
    const dims: Record<Dim, (j: ListJob) => boolean> = {
      market: j => filters.market === 'all' || j.markets.includes(filters.market),
      sponsor: j => anyOf(filters.sponsor, v => sponsorMatches(j, v)),
      stage: j => anyOf(filters.stage, v => v === 'founding' ? j.stage === 'founding' : earlyCompanies.has(j.company)),
      workplace: j => anyOf(filters.workplace, v => j.workplace === v),
      role: j => anyOf(filters.role, v => j.role === v),
      country: j => anyOf(filters.country, v => j.countries.includes(v)),
      provider: j => anyOf(filters.provider, v => j.source === v),
    };
    const base = jobs.filter(always);
    const pass = (j: ListJob, skip?: Dim) => DIMS.every(d => d === skip || dims[d](j));
    const pools = Object.fromEntries(DIMS.map(d => [d, base.filter(j => pass(j, d))])) as Record<Dim, ListJob[]>;
    return { filtered: base.filter(j => pass(j)), pools };
  }, [jobs, filters, view, saved, exactCompany, searchHits, localIndex, earlyCompanies]);
  const filtered = useMemo(() => {
    const byRecency = (a: ListJob, b: ListJob) => recency(b).localeCompare(recency(a));
    return [...engine.filtered].sort(filters.sort === 'company' ? (a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title)
      : filters.sort === 'recent' ? byRecency : (a, b) => visaScore(b) - visaScore(a) || byRecency(a, b));
  }, [engine, filters.sort]);
  const counts = useMemo(() => {
    const { pools } = engine;
    const tally = (list: ListJob[], keys: (j: ListJob) => string[]) => { const m = new Map<string, number>(); for (const j of list) for (const k of keys(j)) m.set(k, (m.get(k) || 0) + 1); return m; };
    const sponsor = Object.fromEntries(SPONSORS.map(v => [v, pools.sponsor.filter(j => sponsorMatches(j, v)).length])) as Record<Sponsor, number>;
    return {
      markets: Object.fromEntries([['all', pools.market.length], ...MARKETS.map(m => [m, pools.market.filter(j => j.markets.includes(m)).length])]) as Record<Market | 'all', number>,
      sponsor, yes: sponsor.yes, likely: sponsor.likely, licensed: sponsor.licensed,
      founding: pools.stage.filter(j => j.stage === 'founding').length, early: pools.stage.filter(j => earlyCompanies.has(j.company)).length,
      workplace: tally(pools.workplace, j => [j.workplace]), role: tally(pools.role, j => [j.role]), country: tally(pools.country, j => j.countries), provider: tally(pools.provider, j => [j.source]),
      remoteGlobal: pools.market.filter(j => j.markets.includes('remote_global')).length, india: pools.market.filter(j => j.markets.includes('india')).length, week: recentCount(filtered, Date.now() - 7 * 86400000),
    };
  }, [engine, earlyCompanies, filtered]);
  const options = useMemo(() => ({
    role: [...new Set(jobs.map(j => j.role))].sort().map(v => ({ value: v, label: v, count: counts.role.get(v) || 0 })),
    country: [...new Set(jobs.flatMap(j => j.countries))].sort((a, b) => (COUNTRIES[a] || a).localeCompare(COUNTRIES[b] || b)).map(v => ({ value: v, label: COUNTRIES[v] || v, count: counts.country.get(v) || 0 })),
    provider: [...new Set(jobs.map(j => j.source))].map(v => ({ value: v, label: v, count: counts.provider.get(v) || 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    sponsor: SPONSORS.map(v => ({ value: v, label: sponsorFilterNames[v], count: counts.sponsor[v] })),
    workplace: WORKPLACES.map(v => ({ value: v, label: v, count: counts.workplace.get(v) || 0 })),
  }), [jobs, counts]);
  const grouped = useMemo(() => {
    const groups = new Map<string, ListJob[]>();
    for (const job of filtered) { const group = groups.get(job.company); if (group) group.push(job); else groups.set(job.company, [job]); }
    const entries = [...groups.entries()];
    return filters.sort === 'roles' ? entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])) : entries;
  }, [filtered, filters.sort]);

  // Pagination: companies or roles, depending on the view.
  const pageSize = PAGE_SIZE[jobView];
  const total = jobView === 'companies' ? grouped.length : filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = (current - 1) * pageSize;
  const pageGroups = jobView === 'companies' ? grouped.slice(from, from + pageSize) : [];
  const pageRoles = jobView === 'roles' ? filtered.slice(from, from + pageSize) : [];
  // Company cards start collapsed; "Expand all" or an exact company search opens them.
  const shownFor = useCallback((company: string, count: number) => Math.min(count, open[company] ?? (expandAll || exactCompany === company ? ROLES_WHEN_OPEN : 0)), [open, expandAll, exactCompany]);
  const visibleIds = useMemo(() => jobView === 'roles' ? pageRoles.map(j => j.id)
    : pageGroups.flatMap(([name, list]) => list.slice(0, shownFor(name, list.length)).map(j => j.id)), [jobView, pageRoles, pageGroups, shownFor]);
  const allOpen = pageGroups.length > 0 && pageGroups.every(([name, list]) => shownFor(name, list.length) > 0);
  const toggleAll = () => { setOpen({}); setExpandAll(!allOpen); };

  const selected = selectedId ? filtered.find(j => j.id === selectedId) : undefined;
  const full = selected ? details[selected.id] : undefined;
  useEffect(() => {
    if (!selected || details[selected.id] !== undefined) return;
    const id = selected.id;
    let cancelled = false;
    fetch(`/api/jobs/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then((job: Job | null) => {
      if (!cancelled) setDetails(current => ({ ...current, [id]: job }));
    }).catch(() => { /* Leave unset so selecting the role again retries. */ });
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (event.key === 'Escape') { if (typing) target.blur(); else if (mobileDetail) setMobileDetail(false); else setSelectedId(null); return; }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || view === 'sources') return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key === '[' && current > 1) goToPage(current - 1);
      else if (event.key === ']' && current < pages) goToPage(current + 1);
      else if (event.key === 'j' || event.key === 'k') {
        // With every card collapsed, J opens the first company on the page.
        if (!visibleIds.length && pageGroups.length) { const [name, list] = pageGroups[0]; setOpen(o => ({ ...o, [name]: Math.min(list.length, ROLES_WHEN_OPEN) })); setSelectedId(list[0].id); return; }
        const index = selectedId ? visibleIds.indexOf(selectedId) : -1;
        const next = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, index + (event.key === 'j' ? 1 : -1)))];
        if (next) { setSelectedId(next); setMobileDetail(true); document.querySelector(`[data-role-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' }); }
      } else if (event.key === 's' && selectedId) toggleSaved(selectedId);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [visibleIds, pageGroups, selectedId, mobileDetail, view, toggleSaved, current, pages, goToPage]);

  const savedCount = useMemo(() => jobs.filter(j => saved.has(j.id)).length, [jobs, saved]);
  const sponsorsInView = useMemo(() => filtered.filter(j => visaRelevant(j) && j.sponsorship.status === 'yes').length, [filtered]);
  const licensedInView = useMemo(() => filtered.filter(licensed).length, [filtered]);
  const failed = meta?.sources.filter(s => s.status === 'error').length || 0;
  const quick: { label: string; count: number; on: boolean; tone: string; icon: React.ReactNode; toggle: () => void }[] = [
    { label: 'Sponsors visa', count: counts.yes, on: filters.sponsor.includes('yes'), tone: 'yes', icon: <ShieldCheck size={14} />, toggle: () => set({ sponsor: toggle(filters.sponsor, 'yes') }) },
    { label: 'Likely 60%+', count: counts.likely, on: filters.sponsor.includes('likely'), tone: 'maybe', icon: <TrendingUp size={14} />, toggle: () => set({ sponsor: toggle(filters.sponsor, 'likely') }) },
    { label: 'Licensed sponsor', count: counts.licensed, on: filters.sponsor.includes('licensed'), tone: 'licensed', icon: <Landmark size={14} />, toggle: () => set({ sponsor: toggle(filters.sponsor, 'licensed') }) },
    { label: 'Founding roles', count: counts.founding, on: filters.stage.includes('founding'), tone: 'early', icon: <Rocket size={14} />, toggle: () => set({ stage: toggle(filters.stage, 'founding') }) },
    { label: 'Early-stage', count: counts.early, on: filters.stage.includes('early'), tone: 'early', icon: <Sprout size={14} />, toggle: () => set({ stage: toggle(filters.stage, 'early') }) },
    { label: 'Remote', count: counts.workplace.get('Remote') || 0, on: filters.workplace.includes('Remote'), tone: 'remote', icon: <Globe2 size={14} />, toggle: () => set({ workplace: toggle(filters.workplace, 'Remote') }) },
  ];
  // Selections made in the Filters panel that the chips don't show, as removable pills.
  const pills: { key: string; label: string; remove: () => void }[] = [
    ...filters.role.map(v => ({ key: `role-${v}`, label: v, remove: () => set({ role: filters.role.filter(x => x !== v) }) })),
    ...filters.country.map(v => ({ key: `country-${v}`, label: COUNTRIES[v] || v, remove: () => set({ country: filters.country.filter(x => x !== v) }) })),
    ...filters.provider.map(v => ({ key: `source-${v}`, label: `Source: ${v}`, remove: () => set({ provider: filters.provider.filter(x => x !== v) }) })),
    ...filters.sponsor.filter(v => v === 'unknown' || v === 'no').map(v => ({ key: `sponsor-${v}`, label: sponsorFilterNames[v], remove: () => set({ sponsor: filters.sponsor.filter(x => x !== v) }) })),
    ...filters.workplace.filter(v => v !== 'Remote').map(v => ({ key: `workplace-${v}`, label: v, remove: () => set({ workplace: filters.workplace.filter(x => x !== v) }) })),
    ...(filters.company ? [{ key: 'company', label: `Company: ${filters.company}`, remove: () => set({ company: '' }) }] : []),
  ];
  const active = pills.length + filters.sponsor.filter(v => v !== 'unknown' && v !== 'no').length + filters.stage.length + (filters.workplace.includes('Remote') ? 1 : 0) + (filters.q ? 1 : 0) + (filters.market !== 'all' ? 1 : 0);
  const panelCount = filters.role.length + filters.country.length + filters.provider.length + (filters.company ? 1 : 0);
  const unit = jobView === 'companies' ? (total === 1 ? 'company' : 'companies') : (total === 1 ? 'role' : 'roles');

  return <div className={`app ${mobileDetail && selected ? 'detail-open' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label={`${BRAND} home`}><Logo /><span className="brand-text"><strong>{BRAND}</strong><span>Tech jobs with visa evidence</span></span></a>
      <nav aria-label="Main navigation">
        <button className={view === 'discover' ? 'nav active' : 'nav'} aria-current={view === 'discover' ? 'page' : undefined} onClick={() => setView('discover')}><LayoutGrid size={18} /><span>Discover</span><em>{jobs.length.toLocaleString()}</em></button>
        <button className={view === 'saved' ? 'nav active' : 'nav'} aria-current={view === 'saved' ? 'page' : undefined} onClick={() => setView('saved')}><Bookmark size={18} /><span>Saved</span><em>{savedCount}</em></button>
        <button className={view === 'sources' ? 'nav active' : 'nav'} aria-current={view === 'sources' ? 'page' : undefined} onClick={() => setView('sources')}><Database size={18} /><span>Sources</span>{failed > 0 && <em className="warn" title={`${failed} failed sources`}>{failed}</em>}</button>
      </nav>
      <div className="sidebar-foot">
        <p className="scope">UK and EU tech roles with sponsorship evidence, plus US-company remote roles open worldwide or to India.</p>
        <div className="segmented theme" role="group" aria-label="Colour theme">
          {([['system', <Monitor size={14} />], ['light', <Sun size={14} />], ['dark', <Moon size={14} />]] as [Theme, React.ReactNode][]).map(([value, icon]) =>
            <button key={value} className={theme === value ? 'active' : ''} aria-pressed={theme === value} aria-label={`${value} theme`} title={`${value[0].toUpperCase()}${value.slice(1)} theme`} onClick={() => setTheme(value)}>{icon}</button>)}
        </div>
      </div>
    </aside>

    <main className="main">
      <header className="header">
        <div>
          <h1>{view === 'saved' ? 'Saved roles' : view === 'sources' ? 'Sources & method' : 'Discover tech roles'}</h1>
          <p>{view === 'sources' ? 'Where listings come from, how sponsorship is judged, and how each feed did.'
            : loading ? 'Loading your collection…' : <>{jobs.length.toLocaleString()} roles from {companies.length.toLocaleString()} companies<span className="sep">·</span><span className={`status-dot ${run.running ? 'pulsing' : ''}`} />{run.running ? 'refreshing now' : meta?.updatedAt ? `updated ${ago(meta.updatedAt)} at ${new Date(meta.updatedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}` : 'not collected yet'}</>}</p>
        </div>
        <button className="button primary" disabled={run.running || !meta} onClick={() => void startRefresh()}><RefreshCw size={15} className={run.running ? 'spin' : ''} /><span>{run.running ? 'Refreshing…' : 'Refresh jobs'}</span></button>
      </header>
      {run.running && <div className="progress" role="status"><div><span>{run.message}</span><span>{run.completed.toLocaleString()} / {run.total.toLocaleString()} sources</span></div><progress value={run.completed} max={Math.max(1, run.total)} /></div>}
      {(error || run.error) && <div className="notice" role="alert"><AlertCircle size={16} /><span>{error || run.error}</span>{failed > 0 && view !== 'sources' && <button className="text-button" onClick={() => setView('sources')}>See sources</button>}</div>}

      {view === 'sources' ? <SourcesView meta={meta} running={run.running} onRefresh={() => void startRefresh()} /> : <>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Job market">
            {(['all', ...MARKETS] as (Market | 'all')[]).map(m => <button key={m} aria-pressed={filters.market === m} className={filters.market === m ? 'active' : ''} onClick={() => set({ market: m })}>
              {m === 'remote_global' && <Globe2 size={14} />}{m === 'india' && <MapPin size={14} />}{m === 'all' ? 'All regions' : regionNames[m]}<span>{(counts.markets[m] ?? 0).toLocaleString()}</span></button>)}
          </div>
          <div className="search-row">
            <label className="search"><Search size={18} /><input ref={searchRef} aria-label="Search jobs" placeholder="Search titles, companies, skills — e.g. rust kubernetes" value={filters.q} onChange={e => set({ q: e.target.value })} />{filters.q ? <button aria-label="Clear search" onClick={() => set({ q: '' })}><X size={15} /></button> : <kbd>/</kbd>}</label>
            <button className={`button ${moreFilters ? 'active' : ''}`} aria-expanded={moreFilters} onClick={() => setMoreFilters(v => !v)}><SlidersHorizontal size={15} /><span>Filters</span>{panelCount > 0 && <span className="count-dot">{panelCount}</span>}</button>
          </div>
          <div className="quick" role="group" aria-label="Quick filters (combine freely)">
            {quick.map(q => <button key={q.label} className={`quick-chip ${q.tone} ${q.on ? 'on' : ''}`} aria-pressed={q.on} onClick={q.toggle} disabled={!q.on && !q.count}>{q.on ? <Check size={14} /> : q.icon}{q.label}<span>{q.count.toLocaleString()}</span></button>)}
            {active > 0 && <button className="text-button reset" onClick={reset}>Clear all</button>}
          </div>
          {moreFilters && <div className="more-filters">
            <MultiSelect label="Role family" options={options.role} selected={filters.role} onChange={role => set({ role })} />
            <MultiSelect label="Country" options={options.country} selected={filters.country} onChange={country => set({ country })} searchable />
            <MultiSelect label="Sponsorship" options={options.sponsor} selected={filters.sponsor} onChange={sponsor => set({ sponsor: sponsor as Sponsor[] })} />
            <MultiSelect label="Workplace" options={options.workplace} selected={filters.workplace} onChange={workplace => set({ workplace: workplace as Workplace[] })} />
            <MultiSelect label="Source" options={options.provider} selected={filters.provider} onChange={provider => set({ provider })} />
            <label className="field"><span>Company</span><span className="combo"><input list={companyListId} placeholder={`Any of ${companies.length.toLocaleString()}`} value={filters.company} onChange={e => set({ company: e.target.value })} />{filters.company && <button aria-label="Clear company" onClick={() => set({ company: '' })}><X size={13} /></button>}</span><datalist id={companyListId}>{companies.map(name => <option key={name} value={name} />)}</datalist></label>
          </div>}
          {pills.length > 0 && <div className="pills" aria-label="Active filters">{pills.map(p => <button key={p.key} className="pill" onClick={p.remove} aria-label={`Remove ${p.label}`}>{p.label}<X size={12} /></button>)}</div>}
        </div>
        {filters.market === 'remote_global' && <p className="hint"><Globe2 size={14} />Remote roles explicitly open to applicants anywhere in the world, from any employer. Timezone and contract conditions still apply.</p>}
        {filters.market === 'india' && <p className="hint"><MapPin size={14} />US companies and startups hiring in India: remote roles open to India or worldwide, plus roles at their Indian offices.</p>}

        {!loading && <div className="results-bar" ref={resultsTop}>
          <p aria-live="polite"><strong>{filtered.length.toLocaleString()}</strong> {filtered.length === 1 ? 'role' : 'roles'} at {grouped.length.toLocaleString()} {grouped.length === 1 ? 'company' : 'companies'}{sponsorsInView > 0 && <span className="muted"> · {sponsorsInView.toLocaleString()} sponsor visas</span>}{licensedInView > 0 && <span className="muted"> · {licensedInView.toLocaleString()} at licensed sponsors</span>}</p>
          <div className="results-tools">
            <div className="segmented" role="group" aria-label="Results view">
              <button className={jobView === 'companies' ? 'active' : ''} aria-pressed={jobView === 'companies'} onClick={() => setJobView('companies')}><Building2 size={14} />Companies</button>
              <button className={jobView === 'roles' ? 'active' : ''} aria-pressed={jobView === 'roles'} onClick={() => setJobView('roles')}><List size={14} />Roles</button>
            </div>
            {jobView === 'companies' && pageGroups.length > 0 && <button className="button small" onClick={toggleAll}>{allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}{allOpen ? 'Collapse all' : 'Expand all'}</button>}
            <label className="sort"><span className="sr-only">Sort</span><select aria-label="Sort" value={filters.sort} onChange={e => set({ sort: e.target.value as Sort })}><option value="visa">Visa-friendly first</option><option value="recent">Most recent</option><option value="roles">Most roles first</option><option value="company">Company A–Z</option></select><ChevronDown size={13} /></label>
            <button className="icon-button bordered" aria-label="Export these roles to CSV" title="Export to CSV" onClick={() => void exportJobs(filtered)} disabled={!filtered.length}><Download size={16} /></button>
          </div>
        </div>}

        {loading ? <div className="empty"><RefreshCw className="spin" size={28} /><h2>Loading your collection…</h2></div>
          : !filtered.length ? <div className="empty"><BriefcaseBusiness size={34} />
            <h2>{!jobs.length ? 'No jobs collected yet.' : view === 'saved' && !savedCount ? 'Nothing saved yet.' : 'No roles match these filters.'}</h2>
            <p>{!jobs.length ? 'Refresh to build your first collection from live employer feeds.' : view === 'saved' && !savedCount ? 'Use the bookmark on any role (or press S) to keep it here.' : 'Try fewer filters or a broader search.'}</p>
            {active > 0 && <button className="button" onClick={reset}>Clear filters</button>}
            {!jobs.length && <button className="button primary" disabled={run.running || !meta} onClick={() => void startRefresh()}>Collect jobs</button>}
          </div>
          : <div className="layout">
            <section className="results" aria-label="Matching roles">
              {pages > 1 && <div className="page-info"><span>{(from + 1).toLocaleString()}–{Math.min(from + pageSize, total).toLocaleString()} of {total.toLocaleString()} {unit}</span><Pager page={current} pages={pages} onPage={goToPage} label="Pages (top)" /></div>}
              {jobView === 'companies'
                ? pageGroups.map(([name, list]) => <CompanyCard key={name} company={name} jobs={list} early={earlyCompanies.has(name)} shown={shownFor(name, list.length)}
                    onShow={n => setOpen(o => ({ ...o, [name]: n }))} selectedId={selected?.id} saved={saved} onSelect={select} onToggleSave={toggleSaved} />)
                : <div className="role-list">{pageRoles.map(job => <RoleRow key={job.id} job={job} showCompany selected={selected?.id === job.id} saved={saved.has(job.id)} onSelect={() => select(job.id)} onToggleSave={() => toggleSaved(job.id)} />)}</div>}
              {pages > 1 && <div className="page-info bottom"><span>Page {current} of {pages.toLocaleString()}</span><Pager page={current} pages={pages} onPage={goToPage} label="Pages" /></div>}
            </section>
            {selected ? <DetailPanel job={selected} full={full} saved={saved.has(selected.id)} onToggleSave={() => toggleSaved(selected.id)} onClose={() => { setMobileDetail(false); setSelectedId(null); }}
                sourceFailed={meta?.sources.find(s => s.key === selected.sourceKey)?.status === 'error'} />
              : <Highlights counts={counts} onPick={patch => set(patch)} />}
          </div>}
      </>}
      <footer className="footer">
        <strong>{BRAND}</strong> · Data from public employer feeds (Greenhouse, Ashby, Lever, SmartRecruiters, Workable, Recruitee, Personio), <a href="https://www.arbeitnow.com" target="_blank" rel="noopener noreferrer">Arbeitnow</a>, <a href="https://himalayas.app" target="_blank" rel="noopener noreferrer">Himalayas</a>, <a href="https://relocate.me" target="_blank" rel="noopener noreferrer">Relocate.me</a>, <a href="https://remotive.com" target="_blank" rel="noopener noreferrer">Remotive</a>, <a href="https://jobicy.com" target="_blank" rel="noopener noreferrer">Jobicy</a>, <a href="https://www.jackandjill.ai" target="_blank" rel="noopener noreferrer">Jack &amp; Jill</a> and <a href="https://www.linkedin.com/jobs" target="_blank" rel="noopener noreferrer">LinkedIn</a>. Sponsor registers: UK Home Office, IND. Saved roles stay in this browser.
      </footer>
    </main>
    {mobileDetail && selected && <button className="backdrop" aria-label="Close details" onClick={() => { setMobileDetail(false); setSelectedId(null); }} />}
    {scrolled && <button className="to-top" onClick={() => window.scrollTo({ top: 0 })} aria-label="Back to top"><ArrowUp size={16} /><span>Top</span></button>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
