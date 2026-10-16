import { refresh, runState } from '../../../tech/pipeline';

const progress = setInterval(() => {
  console.log(`[${runState.completed}/${runState.total}] ${runState.message}`);
}, 10000);
progress.unref();

refresh().then(snapshot => {
  console.log(`Saved ${snapshot.jobs.length} tech roles. Checked ${snapshot.sources.length} feeds.`);
  for (const source of snapshot.sources) console.log(`${source.status.toUpperCase()} ${source.name}: ${source.accepted} matches${source.error ? ` — ${source.error}` : ''}`);
  if (snapshot.sources.some(source => source.status !== 'ok')) process.exitCode = 2;
}).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { clearInterval(progress); process.exit(); });
