import * as fs from 'node:fs';
import * as path from 'node:path';
import { boardUnit, cachedPage, MAX_BOARDS, ROOT, type Board } from './sources';
import { classifyJob } from './classify';
import { boardKey, discoveryCandidates, type DiscoverySeed } from './discovery';
import { harvestBoards, recentCrawls } from './commoncrawl';
import { isPlaceName, nameFromBoardPage, personioName, recruiteeName, workableName } from './ats';

// Finds employer job boards and keeps those with at least one matching role (UK/EU tech, or US remote open
// worldwide/India). Sources: reviewed search-result seeds (--input) and Common Crawl's URL index (--common-crawl).
//   npm run discover:tech -- --common-crawl --crawls 2 --write
const LIMITS: Record<string, number> = { greenhouse: 8, ashby: 8, lever: 4, workable: 3, recruitee: 6, personio: 6, smartrecruiters: 2 };
const RECHECK_DAYS = 7;
const titleCase = (slug: string) => slug.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();

async function companyName(board: Board): Promise<string | undefined> {
  try {
    switch (board.provider) {
      case 'greenhouse': { const page = await cachedPage(`https://boards-api.greenhouse.io/v1/boards/${board.board}`, 604800); const name = JSON.parse(page.body)?.name; return typeof name === 'string' && name.trim() ? name.trim() : undefined; }
      case 'ashby': return nameFromBoardPage((await cachedPage(`https://jobs.ashbyhq.com/${encodeURIComponent(board.board)}`, 604800)).body);
      case 'lever': return nameFromBoardPage((await cachedPage(`https://${board.region === 'eu' ? 'jobs.eu.lever.co' : 'jobs.lever.co'}/${board.board}`, 604800)).body);
      case 'workable': return workableName(JSON.parse((await cachedPage(`https://apply.workable.com/api/v1/widget/accounts/${board.board}?details=true`, 3600)).body));
      case 'recruitee': return recruiteeName(JSON.parse((await cachedPage(`https://${board.board}.recruitee.com/api/offers/`, 3600)).body));
      case 'personio': return personioName((await cachedPage(`https://${board.board}.jobs.personio.${board.region === 'com' ? 'com' : 'de'}/xml?language=en`, 3600)).body);
      default: return undefined;
    }
  } catch { return undefined; }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const configFile = path.join(ROOT, 'config/tech-sources.json');
  const original = fs.readFileSync(configFile, 'utf8');
  const config = JSON.parse(original);
  const store = path.join(ROOT, '.local'); fs.mkdirSync(store, { recursive: true });
  const auditFile = path.join(store, 'discovery-audit.json');

  let candidates: Board[] = [];
  const input = option('--input') || (flag('--common-crawl') ? undefined : 'config/discovery-seeds.json');
  if (input) {
    const file = path.resolve(ROOT, input);
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Discovery input exceeds 5 MB');
    const seeds: DiscoverySeed[] = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(seeds) || seeds.length > 5000) throw new Error('Expected up to 5,000 reviewed URL/company seeds');
    candidates.push(...discoveryCandidates(seeds, config.boards));
  }
  if (flag('--common-crawl')) {
    const crawls = await recentCrawls(Number(option('--crawls') || 1));
    console.log(`Reading Common Crawl index: ${crawls.join(', ')}`);
    const harvested = await harvestBoards(crawls, message => console.log(message));
    const known = new Set([...config.boards, ...candidates].map(boardKey));
    candidates.push(...harvested.filter(board => !known.has(boardKey(board))));
  }
  // Skip boards rejected recently; a board with no matching roles today is re-checked after a week.
  let previousAudit: any[] = [];
  try { previousAudit = JSON.parse(fs.readFileSync(auditFile, 'utf8')).candidates || []; } catch {}
  const recentlyRejected = new Set(previousAudit.filter(a => a.status !== 'verified' && a.checkedAt && Date.now() - Date.parse(a.checkedAt) < RECHECK_DAYS * 86400000).map(a => boardKey(a)));
  candidates = candidates.filter(board => !recentlyRejected.has(boardKey(board)));
  const room = Math.max(0, MAX_BOARDS - config.boards.length);
  const limit = Math.min(room, Number(option('--limit') || room));
  console.log(`${candidates.length} new boards to verify (${recentlyRejected.size} skipped as recently checked); room for ${room}.`);

  const verified: Board[] = [], audit: any[] = [];
  const byProvider = new Map<string, Board[]>();
  for (const board of candidates) byProvider.set(board.provider || 'greenhouse', [...(byProvider.get(board.provider || 'greenhouse') || []), board]);
  // Progress is saved every 200 boards and on Ctrl-C, so a long or interrupted run keeps what it verified.
  let lastWritten = original;
  const save = () => {
    const keep = previousAudit.filter(a => !audit.some(b => boardKey(b) === boardKey(a)));
    fs.writeFileSync(auditFile, JSON.stringify({ checkedAt: new Date().toISOString(), verified: verified.length, candidates: [...keep, ...audit] }, null, 2), { mode: 0o600 });
    if (!flag('--write') || !verified.length) return;
    if (fs.readFileSync(configFile, 'utf8') !== lastWritten) throw new Error('Source config changed during discovery; rerun before writing');
    const temp = `${configFile}.${process.pid}.tmp`;
    lastWritten = JSON.stringify({ ...config, boards: [...config.boards, ...verified] }, null, 2) + '\n';
    fs.writeFileSync(temp, lastWritten, { mode: 0o600 });
    fs.renameSync(temp, configFile);
  };
  process.once('SIGINT', () => { save(); console.log(`Interrupted: saved ${verified.length} verified feeds.`); process.exit(130); });
  let done = 0;
  const verify = async (board: Board) => {
    const named = { ...board, company: board.company || titleCase(board.board) };
    const unit = boardUnit(named);
    const checkedAt = new Date().toISOString();
    try {
      const rows = await unit.collect();
      const eligible = rows.filter(job => classifyJob(job, checkedAt));
      const status = eligible.length ? 'verified' : rows.length ? 'no-matching-roles' : 'empty';
      if (status === 'verified' && verified.length < limit) {
        const resolved = board.company || await companyName(board);
        const company = resolved && !isPlaceName(resolved) ? resolved : named.company;
        verified.push({ ...named, company, verifiedAt: checkedAt });
      }
      audit.push({ ...named, status, postings: rows.length, eligible: eligible.length, checkedAt, error: unit.partialError });
    } catch (error: any) {
      audit.push({ ...named, status: 'unavailable', checkedAt, error: String(error.message || error).slice(0, 160) });
    }
    if (++done % 50 === 0 || done === candidates.length) console.log(`[${done}/${candidates.length}] ${verified.length} verified`);
    if (done % 200 === 0) save();
  };
  await Promise.all([...byProvider.entries()].map(async ([provider, boards]) => {
    let next = 0;
    const lane = async () => { while (next < boards.length) { await verify(boards[next++]); await new Promise(r => setTimeout(r, provider === 'workable' ? 700 : 150)); } };
    await Promise.all(Array.from({ length: Math.min(LIMITS[provider] || 2, boards.length) }, lane));
  }));

  save();
  const summary = audit.reduce((m: Record<string, number>, a) => { m[`${a.provider || 'greenhouse'}:${a.status}`] = (m[`${a.provider || 'greenhouse'}:${a.status}`] || 0) + 1; return m; }, {});
  console.log(summary);
  console.log(`${verified.length} verified employer feeds ${flag('--write') ? 'added' : 'ready; use --write to add them'}. Report: .local/discovery-audit.json`);
}
// Exit explicitly: thousands of idle keep-alive connections would otherwise hold the process open.
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => process.exit());
