# Stamped — tech opportunities

**Stamped** (named for the passport stamp; the logo is a perforated postage stamp with an up-right arrow) is a local dashboard of tech jobs with visa evidence.

A local scraper and dashboard for technical jobs across three markets:

- **US international remote:** US employers with jobs explicitly open worldwide or in India.
- **United Kingdom:** technical jobs with sponsorship labels and supporting evidence.
- **European Union:** technical jobs in the EU-27, with the same sponsorship categories.

Built on [DevelopIQ-ai/jobs_db](https://github.com/DevelopIQ-ai/jobs_db). The original pipeline is preserved; its documentation is in [UPSTREAM.md](UPSTREAM.md).

## Run locally

Use Node.js 22.12+ and npm. No API keys, AI model, browser installation, or cloud database are required for the default employer feeds.

```sh
npm ci
npm run scrape:tech
npm run build
npm start
```

Open **http://127.0.0.1:4317/** (or http://localhost:4317/). The first scrape populates real listings; there are no demo jobs. You can also build and start first, then use **Refresh jobs**. The server binds only to 127.0.0.1 and refuses any other Host header.

The dashboard groups roles by company. Company cards start **collapsed**: name, countries, chips (visa sponsorship count, **Licensed sponsor**, founding/early-stage, remote) and a one-line peek at the top role titles. Click a card to open its roles, or use **Expand all / Collapse all**. Switch to the flat Roles view anytime. Results are **paginated** (20 companies or 30 roles per page, pager above and below the list, `[`/`]` keys) and a **Top** button appears once you scroll.

**Filters combine.** Quick-filter chips are toggles: choices in the same group are OR'd (*Sponsors visa* + *Likely 60%+* shows either), different groups are AND'd (+ *Founding roles* narrows to founding roles that sponsor or likely sponsor). *Likely 60%+* means a 60%+ signal without an explicit offer, so it never overlaps *Sponsors visa*. **Filters** opens multi-select dropdowns for role family, country (searchable), sponsorship, workplace and source, each with live counts, plus a type-ahead company field; selections appear as removable pills. The default sort is *Visa-friendly first* (explicit offers, then the strongest "Not sure" signals); *Most recent*, *Most roles first* and *Company A–Z* are also available. Search matches word starts across titles, companies, places and full descriptions (`rust kube` finds Rust + Kubernetes roles). Filters and page live in the URL, so a search can be bookmarked or shared. With no role selected, the right panel offers shortcuts; selecting a role opens its sponsorship verdict, signal meter, register match, quoted evidence, company stage, description and application link (a slide-over panel below 1,080 px, full screen on phones). Keyboard: `/` search, `J`/`K` next/previous role, `S` save, `[`/`]` page, `Esc` close. Light, dark or system theme; bookmarks and theme are saved in this browser. The page checks for a new snapshot every minute, so a refresh run from the CLI or schedule appears without reloading. Use Sources to inspect provider coverage, per-feed health (filterable) and the methodology.

**Company stage.** *Founding / first-hire roles* are judged from the title ("Founding Engineer", "First Engineering Hire", "Engineer #3"; not "AI First", "First Line Support" or "Tech Foundations"). *Early-stage startups* also includes every role at a company whose listings explicitly mention a seed, pre-seed or Series A round, Y Combinator backing, a founding team, or "first N engineers"; the triggering sentence is shown in the detail panel.

## Sponsorship labels

| Label | Meaning |
| --- | --- |
| Definitely sponsors | The job description explicitly offers visa sponsorship. Personal eligibility and country-specific conditions still apply. |
| Don’t sponsor | The description explicitly excludes sponsorship or requires applicants not to need it. |
| Not sure | Missing, conditional, or conflicting evidence. |

Uncertain jobs show a **heuristic sponsorship signal** when relevant evidence exists: conditional sponsorship 65%, relocation assistance alone 55%, conflicting statements 50%, existing work authorization 20%. These fixed rule scores **are not calibrated probabilities**. Each assessment includes the original wording and listing link.

**Government sponsor registers** add employer-level evidence for UK and Dutch roles. Each refresh downloads (at most daily) the [UK Home Office register of licensed sponsors](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers) (Skilled Worker, Global Business Mobility and Scale-up routes) and the [IND register of recognised sponsors](https://ind.nl/en/public-register-recognised-sponsors/public-register-work), stored in `.local/registers/`. Company names are matched to registered legal names after removing legal forms and qualifiers ("Monzo" → *Monzo Bank Ltd*, "Wise" → *Wise Payments Limited*, "Adyen" → *Adyen N.V.*). Only the register side may drop entity suffixes such as *Labs* or *Technologies*, so "Cypress Labs" never matches an unrelated "Cypress Ltd". The matched legal name and town are shown so you can verify the entity.

| Listing text says | On the register | Not found under this name |
| --- | --- | --- |
| Nothing about sponsorship | Not sure · 70% | Not sure · 20% |
| Conditional sponsorship | Not sure · 80% | Not sure · 40% |
| Relocation support only | Not sure · 75% | Not sure · 35% |
| Conflicting statements | Not sure · 55% | Not sure · 30% |
| Existing right to work requested | Not sure · 35% | Not sure · 10% |
| Explicit offer / explicit refusal | Definitely sponsors / Don’t sponsor (text always wins) | same |

A licence shows an employer *can* sponsor, not that this role is sponsored, so a register match alone never produces "Definitely sponsors". "Not found" is weaker evidence because brand and legal names differ (Deliveroo's UK entity is Roofoods Ltd). Roles that are also offered in an EU country without a register keep their text-only signal. Combine the **Sponsors visa**, **Likely 60%+** and **Licensed sponsor** chips to shortlist.

Roles are classified by job title across industries: software, AI/ML, data, QA, cloud/DevOps/SRE, security, hardware/embedded, IT/networks, product/design, and solutions engineering. Rules intentionally favor precision and can miss ambiguous titles or unlisted city aliases. UK/EU views include all sponsorship categories, so use the sponsorship filter to narrow them.

## Sources and coverage

`config/tech-sources.json` combines fourteen source families:

The 16 October 2026 development collection contains 17,716 matching roles from 3,476 employers: 5,705 UK, 12,691 EU and 388 US international-remote roles. 305 roles at 52 employers explicitly offer sponsorship, 3,532 roles at 671 employers are at a licensed UK/Dutch sponsor, and 171 founding roles at 101 employers (332 employers with early-stage signals). The registry has 2,536 verified employer feeds (716 Greenhouse, 722 Ashby, 454 Personio, 407 Workable, 140 Recruitee, 84 Lever, 13 SmartRecruiters), 2,356 of them added by Common Crawl discovery from 14,624 candidate boards. A full refresh of 2,565 sources took about seven minutes with warm caches. These are observations after deduplication, not coverage guarantees; an empty or unavailable board does not mean the company has no vacancies on its current careers site.

- **Direct employer feeds:** Greenhouse, Ashby, Lever (global and EU), SmartRecruiters, Workable, Recruitee and Personio (`.de` and `.com`). The employer registry supports up to 8,000 boards. Ashby excludes unlisted jobs; Lever paginates published jobs; Recruitee keeps published offers only; SmartRecruiters scans up to 2,000 summaries and collects up to 120 relevant full descriptions per employer. Employer responses are cached for one hour.
- **Arbeitnow UK and Europe:** paginated, automatically discovering many employers, including a separate sponsorship-discovery profile. Up to 20 pages per feed; public page responses are cached for one hour.
- **Himalayas:** country-filtered searches across the UK and all 27 EU countries, plus targeted engineer/developer searches for India and worldwide eligibility. Up to 10–20 pages per profile, cached for 24 hours. Apply links and visible attribution are preserved as required by the provider.

**Relocate.me:** public UK/EU technical listing details, including original sponsorship wording. Paid newsletter advertisements are excluded.

**Remotive and Jobicy:** independent remote-job discovery feeds with canonical source links and visible credit. Both use six-hour caches. Remotive delays its public feed by 24 hours; Jobicy provides a seven-day discovery window with cursor pagination, bounded to 10 pages of 200 listings. An empty recent window is not proof that an older job closed.

**Jack & Jill:** follows the public `jobs/sitemap.xml` and reads up to 650 engineering/data/product/design vacancy pages per run. Only structured `JobPosting` fields are used; site marketing and other jobs are excluded. Named customer employers, actual locations, expiry dates and original descriptions are preserved. Six-hour cache, one-second pause after uncached detail requests. Its category URLs currently redirect, so the published sitemap is the discovery entry point. Apply opens the vacancy's introduction flow.

**LinkedIn:** unauthenticated public guest search and detail pages, bounded to two pages per configured keyword/location query and 220 detail requests. Queries include founding engineers, sponsorship and Jack & Jill customer roles. Each search page is followed by its descriptions so completed results survive later failures. Six-hour cache, two-second request pauses; stops on access blocks or rate limits. Sign-in may be required to apply. This is a bounded public sample, not LinkedIn's complete inventory. Search keywords and application-form questions are never sponsorship evidence.

**Dex:** its own public Ashby careers feed is included, along with independently verified feeds for employers featured on its public pages. Its private matching network is not a public vacancy feed and is not scraped. No Dex account or AI service is invoked.

The dashboard is not restricted to the configured employer list. Employer feeds supplement discovery feeds. Source diagnostics show the number of listing observations (which can overlap), employers encountered, recognized tech roles, accepted roles, and pagination coverage. A rate limit after some pages produces a partial source, with the collected rows preserved. The feed's reported total is not treated as the number actually imported.

Only employers with source-backed US identity qualify for the US remote category. Evidence can come from explicit headquarters or US-based company wording, a verified employer fact in the registry, or a bounded read-only lookup in the original repository’s public company-country dataset. The published read key is read from `UPSTREAM.md`, stays on the server, and is never included in dashboard data. A cached unknown country stays unknown; missing identity is not guessed from salary currency or job location.

Matching jobs deduplicate by canonical application URL (ignoring tracking parameters and ATS application-form suffixes). Cross-provider copies also merge when company and title match, locations are compatible, and their full descriptions match or substantially contain one another. Distinct employer posting IDs are preserved when URLs differ. Different descriptions or cities remain separate. Source names can still contain brand/legal-name variations. This is broader discovery with bounded coverage, not a claim to include every employer or every open role.
Add a public employer board using its board slug, company name, and `provider` (`greenhouse`, `ashby`, `lever`, `smartrecruiters`, `workable`, `recruitee` or `personio`; omitted means Greenhouse). Personio boards on `jobs.personio.com` also use `region: "com"`. Lever EU boards also use `region: "eu"`. A board must be verified against the employer’s public careers feed before activation. For US employer eligibility also add `employerCountry: "US"` and an official `employerCountrySource` URL. Never add a country based solely on where a role is posted.

The optional Hiring.cafe adapter is disabled: a direct request returned HTTP 403 from this machine. It supports bounded country/role search profiles when public SSR pages are accessible, with explicit failure reporting. It does not bypass challenges or provide complete pagination. The original Playwright scraper remains separate.

Every run checks the configured source profiles. Successful complete employer feeds replace their prior listings; failed or partially collected feeds retain prior rows with their older check times. Recent discovery feeds retain earlier observations for up to 45 days, since a bounded recent page sample cannot establish closure. If all feeds fail, the completed snapshot remains intact. No role-specific visa guarantee is implied by a register match. Exhaustive global coverage is not claimed. Membership in a provider’s sponsorship category never makes a role definite without role-level evidence.

## Discover additional employer feeds

The source registry grows in two ways, and every candidate board is verified against its own live public feed before it is added.

**Bulk: Common Crawl.** Common Crawl's public URL index lists the ATS board URLs its crawler has seen — the bulk equivalent of `site:jobs.ashbyhq.com …` searches, without a search engine. The CLI reads it for `job-boards.greenhouse.io`, `boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `jobs.ashbyhq.com`, `jobs.lever.co`, `jobs.eu.lever.co`, `apply.workable.com`, `*.recruitee.com` and `*.jobs.personio.de/.com`, extracts board identifiers only, then fetches each board's public feed (several in parallel per provider) and keeps those with at least one matching role. Display names come from the board's own API or page title (Greenhouse board API, Ashby/Lever page title, Workable/Recruitee/Personio feeds), falling back to the board identifier. Harvested identifiers are cached in `.local/cc-harvest/`; boards without matching roles are re-checked after seven days. The index is slow and sometimes returns 502/504, which the CLI retries.

**Reviewed search results.** `config/discovery-seeds.json` records public job URLs, employer names from those pages, and the searches that found them. The dashboard's Sources page includes reusable site searches for founding engineers and visa sponsorship on Ashby, Greenhouse, Lever and LinkedIn.

```sh
npm run discover:tech -- --common-crawl --crawls 2 --write   # bulk discovery from the two newest crawls
npm run discover:tech                                        # verify reviewed seeds; report only
npm run discover:tech -- --write                             # add verified seed feeds with matching roles
npm run discover:tech -- --input my-seeds.json --write
npm run scrape:tech
```

A seed is `{ "url": "https://jobs.ashbyhq.com/example", "company": "Example", "query": "optional discovery context" }`. The CLI extracts only allowlisted ATS identifiers and constructs fixed public API requests; it never fetches arbitrary input URLs. It deduplicates registry entries case-insensitively and excludes unavailable, empty, partial and nonmatching feeds. Findings are recorded in `.local/discovery-audit.json`; added feeds retain the discovery URL and verification date. Existing registry entries remain intact. Search engines are used for discovery during development or by clicking the supplied search links; scheduled scraping does not invoke a search engine or an LLM. Company names and US headquarters evidence must be source-backed, not inferred from the board slug.

## Runtime and storage

Collection runs feeds in parallel per provider (Greenhouse and Ashby 6 at a time, Lever 4, Workable and SmartRecruiters 2, Recruitee and Personio 6; single-feed sources such as LinkedIn and Jack & Jill keep their own pauses). Large uncached runs can still take tens of minutes, particularly for Workable, LinkedIn, Jack & Jill and SmartRecruiters detail pages; runtime varies with network latency, new vacancies and cache expiry. Cached feed bodies older than three days are pruned at the start of each refresh. Cached runs reuse source pages according to the provider cadence. Partial page failures and rate limits are visible. It avoids the original scraper’s 1,453 browser-page sweep. Browsing and filtering never launch a scrape. **No external or local AI inference runs.** Internet requests go to public sources; data and bookmarks stay local. Apply links open the employer’s website.

- `data_in_progress/jobs/tech_opportunities/output/leads.jsonl`: factual records from the current completed run, following the original contract.
- `output/run.json`, `output/review_sample.json`, `output/process_documentation.txt`: validation and review evidence.
- `output/archive/`: previous source snapshots.
- `.local/jobs.json`: derived dashboard snapshot, including retained rows from failed feeds. The server parses it once per change and sends the browser a list without descriptions; descriptions (`/api/jobs/:id`) and full-text search (`/api/search`) are served on demand.
- `.local/registers/`: UK and Dutch sponsor registers (refreshed at most daily).
- `.local/cc-harvest/`, `.local/discovery-audit.json`: Common Crawl board identifiers and verification results.
- `.local/refresh.lock`: process lock shared by CLI and dashboard refreshes.

Generated files are gitignored. Back up `.local/` and the source output directory if needed. The original Supabase loader is never called by this app. The new source remains in `data_in_progress` for human review, as required by the upstream repository.

## Optional automatic refresh

Manual refresh is the default. To refresh every 24 hours while the server is running:

```sh
REFRESH_INTERVAL_HOURS=24 npm start
```

The first automatic refresh occurs after the interval; use the button for an immediate run. The server must remain running and the computer awake. Alternatively schedule `npm run scrape:tech` with your own process scheduler. No system-wide schedule is installed by setup.

## Development and checks

```sh
npm run typecheck
npm test
npm run validate:tech
npm run build
```

`npm run validate:tech` requires a completed scrape. `npm run reclassify:tech` rebuilds derived decisions from the factual JSONL snapshot without HTTP requests. Tests cover sponsorship negation and uncertainty, sponsor-register matching and signal combination, remote eligibility, technical role families, founding/early-stage detection, geography, Workable/Recruitee/Personio parsing, discovery identifiers, parallel collection limits, unsafe links, stale-feed preservation, search matching, and local HTTP origin/token protections. After code edits, rebuild the dashboard and restart the server. Use `PORT=4318 npm start` if the default port is occupied.

Core implementation: `tech/classify.ts`, `tech/sources.ts`, `tech/pipeline.ts`, `tech/server.ts`, and `dashboard/src/`.
