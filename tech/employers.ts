import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT } from './sources';
import { classifyRole, countriesFromLocation } from './classify';
import type { RawJob } from './types';

const origin = 'https://snimonofzyrbsqovpnsq.supabase.co';
const proof = 'https://github.com/DevelopIQ-ai/jobs_db#public-read-api';
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
type Fact = { country?: string; checkedAt: string };
export function createEmployerEnricher() {
  const file = path.join(ROOT, '.local/employer-countries.json');
  let facts: Record<string, Fact> = {};
  try { facts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let budget = 40;
  let key: string | undefined;
  try { key = fs.readFileSync(path.join(ROOT, 'UPSTREAM.md'), 'utf8').match(/apikey: (sb_publishable_[A-Za-z0-9_-]+)/)?.[1]; } catch {}
  return async (rows: RawJob[]): Promise<RawJob[]> => {
    const candidates = [...new Set(rows.filter(job => !job.employerCountry && classifyRole(job.title) && ((job.workplace === 'Remote' && /\b(india|worldwide)\b/i.test(job.location)) || countriesFromLocation(job.location).includes('IN'))).map(job => job.company))];
    const names = candidates.filter(name => !facts[normalize(name)] || Date.now() - Date.parse(facts[normalize(name)].checkedAt) >= 86400000);
    while (key && names.length && budget > 0) {
      budget--;
      const batch = names.splice(0, 40).filter(name => name.length <= 160 && !/[\r\n\x00-\x1f]/.test(name));
      if (!batch.length) continue;
      const query = new URL('/rest/v1/ds_hiring_cafe', origin);
      query.searchParams.set('select', 'company_name,company_hq_country');
      query.searchParams.set('company_hq_country', 'in.(US,"United States")');
      query.searchParams.set('company_name', `in.(${batch.map(name => JSON.stringify(name)).join(',')})`);
      query.searchParams.set('limit', '1000');
      try {
        const response = await fetch(query, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { apikey: key } });
        if (!response.ok) { await response.body?.cancel(); break; }
        const text = await response.text();
        if (text.length > 2 * 1024 * 1024) break;
        const data = JSON.parse(text);
        if (!Array.isArray(data)) break;
        const checkedAt = new Date().toISOString();
        for (const name of batch) facts[normalize(name)] = { checkedAt };
        const wanted = new Set(batch.map(normalize));
        for (const row of data) {
          if (typeof row.company_name !== 'string' || !wanted.has(normalize(row.company_name)) || !['US', 'United States'].includes(row.company_hq_country)) continue;
          facts[normalize(row.company_name)] = { country: 'US', checkedAt };
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(facts), { mode: 0o600 }); fs.renameSync(temporary, file);
      } catch { break; }
    }
    return rows.map(job => job.employerCountry || facts[normalize(job.company)]?.country !== 'US' ? job : { ...job, employerCountry: 'US', employerCountrySource: proof, employerCountryReason: 'Listed with a US headquarters in the hiring.cafe company dataset' });
  };
}
