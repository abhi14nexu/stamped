export type Market = 'us_remote' | 'uk' | 'eu';
export type SponsorStatus = 'yes' | 'no' | 'unknown';
/** A name match against a government register of employers licensed to sponsor work visas. */
export interface RegisterMatch {
  register: 'uk' | 'nl';
  listed: boolean;
  name?: string;
  detail?: string;
  sourceUrl: string;
  checkedAt: string;
}
export interface Sponsorship {
  status: SponsorStatus;
  signal: number | null;
  reason: string;
  evidence: string[];
  method: 'rules-v1' | 'rules-v2';
  /** Signal from listing text alone, before register evidence is combined. */
  textSignal?: number | null;
  textReason?: string;
  registers?: RegisterMatch[];
}
export type CompanyStage = 'founding' | 'early';
export interface Job {
  id: string;
  title: string;
  company: string;
  employerCountry?: string;
  employerCountrySource?: string;
  location: string;
  countries: string[];
  markets: Market[];
  role: string;
  workplace: 'Remote' | 'Hybrid' | 'Onsite' | 'Unspecified';
  remoteEligibility: 'worldwide' | 'india' | 'restricted' | 'unknown';
  remoteEvidence: string[];
  sponsorship: Sponsorship;
  stage?: CompanyStage;
  stageEvidence?: string;
  description: string;
  applyUrl: string;
  sourceUrl: string;
  source: string;
  sourceKey: string;
  sourceUpdatedAt?: string;
  fetchedAt: string;
  salary?: string;
  attributionUrl?: string;
}
export interface RawJob {
  externalId: string;
  title: string;
  company: string;
  employerCountry?: string;
  employerCountrySource?: string;
  location: string;
  description: string;
  applyUrl: string;
  sourceUrl: string;
  source: string;
  sourceKey: string;
  updatedAt?: string;
  workplace?: string;
  salary?: string;
  countryHints?: string[];
  observedAt?: string;
  attributionUrl?: string;
}
export interface SourceResult {
  key: string;
  group?: string;
  name: string;
  url: string;
  status: 'ok' | 'partial' | 'error';
  fetched: number;
  accepted: number;
  checkedAt: string;
  error?: string;
  retainedPrevious?: boolean;
  coverage?: string;
  employers?: number;
  techRecognized?: number;
  excludedNonTech?: number;
  excludedEligibility?: number;
  dataAsOf?: string;
  exhaustive?: boolean;
  closedJobIds?: string[];
}
export interface Snapshot {
  version: 1;
  updatedAt: string | null;
  jobs: Job[];
  sources: SourceResult[];
}
export interface RunState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  completed: number;
  total: number;
  message: string;
  error: string | null;
}
export interface ContractRecord {
  core: { source_id: string; entity_type: 'company'; scraped_at: string; raw_url: string; primary_key: string };
  company: { company_name: string; location?: { country: string } };
  contact: Record<string, unknown>;
  context: Record<string, unknown>;
}
