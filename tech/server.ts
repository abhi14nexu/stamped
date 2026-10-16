import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readSnapshot, refresh, runState, SNAPSHOT_FILE } from './pipeline';
import type { Job, Snapshot } from './types';
import { ROOT } from './sources';

export function scheduleHours(): number | null {
  const hours = Number(process.env.REFRESH_INTERVAL_HOURS || 0);
  return Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours : null;
}

// The snapshot can hold tens of thousands of descriptions. Parse it once per file change, send the browser a
// list without descriptions, and serve descriptions and full-text search on demand.
interface Loaded { stamp: string; snapshot: Snapshot; list: string; listGzip: Buffer; byId: Map<string, Job>; text: Map<string, string>; evidenceGzip?: Buffer }
let loaded: Loaded | null = null;
export function currentSnapshot(): Loaded {
  let stamp = 'empty';
  try { const stat = fs.statSync(SNAPSHOT_FILE); stamp = `${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}`; } catch {}
  if (loaded?.stamp === stamp) return loaded;
  const snapshot = readSnapshot();
  // Quoted evidence and descriptions load with the detail view; the list keeps what filters and cards need.
  const list = JSON.stringify({ updatedAt: snapshot.updatedAt, jobs: snapshot.jobs.map(({ description, remoteEvidence, sponsorship: { evidence, textReason, ...sponsorship }, ...job }) => ({ ...job, sponsorship: { ...sponsorship, evidence: [] }, remoteEvidence: [] })) });
  loaded = { stamp, snapshot, list, listGzip: gzipSync(list), byId: new Map(snapshot.jobs.map(job => [job.id, job])),
    text: new Map(snapshot.jobs.map(job => [job.id, `${job.title} ${job.company} ${job.location} ${job.role} ${job.description}`.toLowerCase()])) };
  return loaded;
}
/** Every term must start a word: "rust" finds Rust, not "trust"; "kube" finds Kubernetes; "c++" and ".net" work. */
export function termMatchers(query: string): RegExp[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8).map(term => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}
export function searchJobs(data: Loaded, query: string): string[] {
  const terms = termMatchers(query);
  if (!terms.length) return [];
  return [...data.text.entries()].filter(([, text]) => terms.every(term => term.test(text))).map(([id]) => id);
}

export function createAppServer(port: number, refreshJobs: typeof refresh = refresh) {
  const token = randomBytes(32).toString('hex');
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  // Loopback names only: any other Host header (DNS rebinding) is refused.
  const hosts = new Set([host, `localhost:${port}`]);
  const origins = new Set([...hosts].map(h => `http://${h}`));
  const dist = path.join(ROOT, 'dashboard/dist');
  const json = (res: ServerResponse, code: number, body: unknown) => {
    const serialized = JSON.stringify(body);
    const compressed = serialized.length > 200000 && /\bgzip\b/.test(String(res.req.headers['accept-encoding'] || ''));
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(compressed ? gzipSync(serialized) : serialized);
  };
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (!hosts.has(String(req.headers.host)) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Local access only' });
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url || '/', origin).pathname); } catch { return json(res, 400, { error: 'Invalid URL' }); }
    try {
      if (req.method === 'GET' && pathname === '/api/meta') {
        const data = currentSnapshot();
        return json(res, 200, { updatedAt: data.snapshot.updatedAt, total: data.snapshot.jobs.length, sources: data.snapshot.sources, run: runState, csrf: token, scheduleHours: scheduleHours() });
      }
      if (req.method === 'GET' && pathname === '/api/jobs') {
        const data = currentSnapshot();
        const etag = `"${data.stamp}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
        const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
        return res.end(gzip ? data.listGzip : data.list);
      }
      if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
        const job = currentSnapshot().byId.get(pathname.slice('/api/jobs/'.length));
        return job ? json(res, 200, job) : json(res, 404, { error: 'This listing is no longer in the collection' });
      }
      if (req.method === 'GET' && pathname === '/api/evidence') {
        // Only requested by CSV export; built once per snapshot.
        const data = currentSnapshot();
        data.evidenceGzip ??= gzipSync(JSON.stringify(Object.fromEntries(data.snapshot.jobs.map(job => [job.id, job.sponsorship.evidence]))));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip' });
        return res.end(data.evidenceGzip);
      }
      if (req.method === 'GET' && pathname === '/api/search') {
        const q = (new URL(req.url || '/', origin).searchParams.get('q') || '').slice(0, 200);
        return json(res, 200, { q, ids: searchJobs(currentSnapshot(), q) });
      }
      if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, { ...runState, updatedAt: currentSnapshot().snapshot.updatedAt });
      if (req.method === 'POST' && pathname === '/api/refresh') {
        const supplied = String(req.headers['x-csrf-token'] || '');
        if (!origins.has(String(req.headers.origin)) || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(res, 403, { error: 'Refresh must be started from this dashboard' });
        if (Number(req.headers['content-length'] || 0) > 1024 || req.headers['transfer-encoding']) return json(res, 413, { error: 'Request body is not accepted' });
        if (runState.running) return json(res, 409, { error: 'Refresh already running' });
        void refreshJobs().catch(error => console.error(`Refresh: ${error.message}`));
        return json(res, 202, { message: 'Refresh started', run: runState });
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route' });
      if (!['GET', 'HEAD'].includes(req.method || '')) return json(res, 405, { error: 'Method not allowed' });
      const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'File not found. Run npm run build first.' });
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (error: any) { json(res, 500, { error: 'Local data could not be read. Check the server log.' }); console.error(error.message); }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
  const server = createAppServer(port);
  server.listen(port, '127.0.0.1', () => console.log(`Tech opportunities dashboard: http://127.0.0.1:${port}`));
  // Opt-in while this process is running; normal browsing never launches a scrape.
  const hours = scheduleHours();
  if (hours !== null) {
    setInterval(() => { if (!runState.running) void refresh().catch(error => console.error(error.message)); }, hours * 3600000).unref();
    console.log(`Automatic refresh enabled every ${hours} hours while server is running.`);
  }
}
