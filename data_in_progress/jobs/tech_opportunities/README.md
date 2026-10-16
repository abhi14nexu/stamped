# Tech opportunities

Public employer and multi-employer job-board feeds for US companies hiring remotely worldwide or in India,
plus technical roles located in the UK or EU-27. All sponsorship categories are
retained for UK/EU roles. Source records are factual JSONL; the local dashboard
derives transparent, conservative eligibility assessments from those records.

Run `npm run scrape:tech` at the repository root. Configure employer boards and the
optional Hiring.cafe source in `config/tech-sources.json`. Hiring.cafe is disabled
by default because a direct request returned HTTP 403 in development. Its adapter
supports only first-page SSR results and does not imply exhaustive coverage.

The collector uses direct public HTTP feeds, sequential requests, bounded response
sizes, timeouts and transient-error retries. It requires no API keys or AI service.
No Supabase writes occur. A bounded read-only lookup of employer-country facts can
use the original repository's public Supabase database and published read key;
otherwise employer country stays unknown. An interrupted or wholly failed refresh keeps the prior
dashboard snapshot. Failed feeds retain their previous rows with stale
provenance. A successful complete employer feed replaces its previous listings.
Bounded recent feeds retain prior observed jobs for up to 45 days; a recent feed
cannot establish closure. Partial page failures are reported rather than hidden.

Arbeitnow UK/Europe uses up to 20 pages per profile and a one-hour local cache.
Himalayas searches the UK and all 27 EU countries, plus targeted engineering and
developer searches for India/worldwide, with up to 10–20 pages and a 24-hour cache.
Use the source view to inspect listings read, employers encountered, recognized
tech roles, accepted roles, pagination bounds, and partial errors. These sources
discover employers automatically. Sponsorship-search membership is discovery
context only, never definitive sponsorship evidence. Attribution links and the
Himalayas application URL are preserved.

Direct employer adapters support Greenhouse, Ashby, Lever (global/EU), and
SmartRecruiters, with a one-hour cache. SmartRecruiters reads up to 20 pages of
summaries and 120 target-country technical descriptions per employer. Ashby
unlisted postings and SmartRecruiters non-public/inactive postings are excluded.

Relocate.me reads public UK/EU technical job detail pages and ignores paid
newsletter ads. Remotive and Jobicy provide independent remote-job feeds with
canonical application links and visible source credits, cached for six hours.
Jobicy cursor pagination is bounded to 10 pages of 200 recent listings; its
seven-day publication window does not establish closure of older vacancies.
Remotive’s public feed is delayed by 24 hours. No commercial API is called.

Jack & Jill uses its published jobs sitemap and up to 650 public technical JobPosting
pages. Named hiring organizations, dates, locations and descriptions are read from
JSON-LD. Category membership is not evidence of sponsorship. LinkedIn uses bounded
public guest queries (two pages per query, up to 220 details) and description-only
evidence. It stops on access blocks, retains completed partial results, and may
require sign-in on the application page. Both cache responses for six hours.
Explicitly closed LinkedIn jobs are removed from retained results.

Dex's own public Ashby careers feed is included; its private matching network is
not an available public feed. `npm run discover:tech -- --write` verifies public
ATS URL/company seeds before extending the employer registry. See the repository
README and `.local/discovery-audit.json` for provenance and unavailable candidates.

Required outputs are in `output/`. `leads.jsonl` contains only records observed in
the current completed run; `run.json` records partial failures, and the dashboard
may additionally retain earlier records from failed feeds. A 20-record sample is
provided for review. This package remains in `data_in_progress` pending human
review; it is not promoted to production or loaded into the upstream database.

Validation: `npm run validate:tech`.
