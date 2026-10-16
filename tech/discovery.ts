import type { Board } from './sources';

export interface DiscoverySeed { url: string; company: string; query?: string }

/** Extract identifiers only. Never fetch a supplied URL or follow a search redirect. */
export function boardFromUrl(seed: DiscoverySeed): Board | null {
  try {
    const url = new URL(seed.url);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !seed.company?.trim() || seed.company.length > 150) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const subdomain = url.hostname.match(/^([a-z0-9][a-z0-9-]{0,62})\.(recruitee\.com|jobs\.personio\.(?:de|com))$/);
    if (subdomain) {
      if (['www', 'api', 'app'].includes(subdomain[1])) return null;
      const provider = subdomain[2] === 'recruitee.com' ? 'recruitee' as const : 'personio' as const;
      return { board: subdomain[1], company: seed.company.trim(), provider, ...(subdomain[2] === 'jobs.personio.com' ? { region: 'com' as const } : {}), discoveryUrl: seed.url };
    }
    if (url.hostname === 'apply.workable.com') {
      const account = parts[0]?.toLowerCase();
      if (!account || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(account) || ['j', 'api', 'jobs'].includes(account) || parts.length > 4 || (parts[1] && parts[1] !== 'j')) return null;
      return { board: account, company: seed.company.trim(), provider: 'workable', discoveryUrl: seed.url };
    }
    const board = parts[0]?.toLowerCase();
    if (!board || !/^[a-z0-9_.-]{1,80}$/.test(board) || ['embed', 'jobs', 'application'].includes(board)) return null;
    const provider = url.hostname === 'jobs.ashbyhq.com' ? 'ashby' : ['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname) ? 'lever' : ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(url.hostname) ? 'greenhouse' : null;
    if (!provider) return null;
    if (provider === 'greenhouse' && (!/^[a-z0-9_-]+$/.test(board) || (parts.length > 1 && (parts[1] !== 'jobs' || !/^\d+$/.test(parts[2] || ''))))) return null;
    if (provider !== 'greenhouse' && parts.length > 1 && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parts[1])) return null;
    if (parts.length > 3 || (provider !== 'greenhouse' && parts[2] && !['apply', 'application'].includes(parts[2]))) return null;
    return { board, company: seed.company.trim(), provider, ...(url.hostname === 'jobs.eu.lever.co' ? { region: 'eu' as const } : {}), discoveryUrl: seed.url };
  } catch { return null; }
}

export function boardKey(board: Board): string {
  return `${board.provider || 'greenhouse'}:${board.region || 'global'}:${board.board.toLowerCase()}`;
}

export function discoveryCandidates(seeds: DiscoverySeed[], existing: Board[]): Board[] {
  const seen = new Set(existing.map(boardKey));
  const boards: Board[] = [];
  for (const seed of seeds) {
    const board = boardFromUrl(seed);
    if (!board || seen.has(boardKey(board))) continue;
    seen.add(boardKey(board)); boards.push(board);
  }
  return boards;
}
