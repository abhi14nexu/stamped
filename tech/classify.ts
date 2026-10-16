import type { Job, RawJob, Sponsorship } from './types';

export const COUNTRIES: Record<string, string> = {
  GB: 'United Kingdom', AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia',
  CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
  DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LV: 'Latvia',
  LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
  IN: 'India', US: 'United States',
};
export const EU = Object.keys(COUNTRIES).filter(c => !['GB', 'IN', 'US'].includes(c));
const locationPatterns: Record<string, RegExp> = {
  GB: /\b(united kingdom|u\.?k\.?|great britain|england|scotland|wales|northern ireland|london|cardiff|edinburgh|manchester|bristol|belfast|cambridge)\b/i,
  IE: /\b(ireland|dublin|cork|galway)\b/i,
  DE: /\b(germany|deutschland\w*|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|düsseldorf|duesseldorf|dortmund|stuttgart|leipzig|dresden|bremen|hannover|hanover|karlsruhe|nürnberg|nuremberg|bonn|essen|münster|muenster|augsburg|mainz|freiburg|heidelberg|mannheim|darmstadt|potsdam|erfurt|wiesbaden|regensburg|bielefeld|bochum|duisburg|wuppertal|kassel|saarbrücken|rostock|würzburg|wuerzburg|lübeck|luebeck|oldenburg|passau|reutlingen|heilbronn|osnabrück|ulm|ingolstadt|kiel|magdeburg|chemnitz|göttingen|goettingen|schwerin|zwickau)\b/i,
  NL: /\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven)\b/i,
  FR: /\b(france|paris|lyon|toulouse|bordeaux|nantes|rennes|marseille|lille|nice|sophia.antipolis|grenoble|montpellier|strasbourg|angers|brest|annecy)\b/i,
  ES: /\b(spain|españa|barcelona|madrid|valencia|málaga|malaga)\b/i,
  PT: /\b(portugal|lisbon|lisboa|porto)\b/i,
  PL: /\b(poland|warsaw|krakow|kraków|wroclaw|wrocław|gdansk)\b/i,
  SE: /\b(sweden|stockholm|gothenburg|malmö)\b/i,
  IT: /\b(italy|milan|milano|rome|roma|turin)\b/i,
  AT: /\b(austria|vienna|wien|graz|linz|salzburg)\b/i,
  BE: /\b(belgium|brussels|brussel|bruxelles|antwerp|gent|ghent)\b/i,
  BG: /\b(bulgaria|sofia|plovdiv)\b/i,
  HR: /\b(croatia|zagreb|split)\b/i,
  CY: /\b(cyprus|limassol|nicosia|larnaca)\b/i,
  CZ: /\b(czechia|czech republic|prague|praha|brno)\b/i,
  DK: /\b(denmark|copenhagen|aarhus|odense)\b/i,
  EE: /\b(estonia|tallinn|tartu)\b/i,
  FI: /\b(finland|helsinki|espoo|tampere)\b/i,
  GR: /\b(greece|athens|thessaloniki)\b/i,
  HU: /\b(hungary|budapest|debrecen)\b/i,
  LV: /\b(latvia|riga)\b/i,
  LT: /\b(lithuania|vilnius|kaunas)\b/i,
  LU: /\b(luxembourg)\b/i,
  MT: /\b(malta|valletta)\b/i,
  RO: /\b(romania|bucharest|cluj|timisoara|timișoara)\b/i,
  SK: /\b(slovakia|bratislava|košice|kosice)\b/i,
  SI: /\b(slovenia|ljubljana|maribor)\b/i,
  IN: /\b(india|bengaluru|bangalore|hyderabad|mumbai|pune|delhi|gurugram|chennai)\b/i,
  US: /\b(united states|usa|us|u\.s\.|new york|san francisco|austin|seattle|boston|california)\b/i,
};
export function countriesFromLocation(location: string): string[] {
  return Object.entries(COUNTRIES).filter(([code, name]) => {
    if (code === 'IE' && /northern ireland/i.test(location) && !/\bdublin|\bcork|\bgalway/i.test(location)) return false;
    return (locationPatterns[code] ?? new RegExp(`\\b${name}\\b`, 'i')).test(location);
  }).map(([code]) => code);
}

const roles: [string, RegExp][] = [
  ['AI & machine learning', /\b(machine learning|deep learning|ml (?:research )?engineer|ai engineer|ai research|research scientist|llm|applied scientist|computer vision|nlp)\b/i],
  ['Data & analytics', /\b(data (engineer|scientist|analyst|architect|director|platform|science|analytics)|analytics (engineer|manager|lead)|(?:director|head|vp) (?:of )?(?:data|analytics)|business intelligence|database|db[ae]|data warehouse|datenanalyst|datenbank)\b/i],
  ['QA & testing', /\b(qa|sdet|quality assurance|test(ing)? (engineer|automation|architect)|software tester)\b/i],
  ['Cloud, DevOps & SRE', /\b(devops|devsecops|sre|site reliability|platform engineer|cloud (engineer|architect)|infrastructure engineer|systems reliability|production engineer)\b/i],
  ['Security', /\b(cyber|security (engineer|analyst|architect|researcher|operations|tech|lead)|application security|information security|penetration test|soc analyst|it.sicherheit)\b/i],
  ['Hardware & embedded', /\b(embedded|firmware|fpga|asic|hardware engineer|robotics|semiconductor|silicon engineer|electrical engineer)\b/i],
  ['IT & networks', /\b(it[ -](support|engineer|administrator|specialist|technician|consultant)|network (engineer|architect|administrator)|systems? (administrator|engineer)|technical support|support engineer|helpdesk|anaplan|salesforce (developer|administrator)|sap (consultant|developer|berater)|fachinformatiker|systemadministrator|it.system)\b/i],
  ['Product & design', /\b(product (manager|designer|owner)|ux|ui designer|user experience|design engineer|technical (program|product|project) manager)\b/i],
  ['Solutions engineering', /\b(solutions? (engineer|architect|architecture)|sales engineer|developer (advocate|relations)|technical consultant)\b/i],
  ['Software engineering', /\b(software\w*|backend|back.end|frontend|front.end|full.stack|fullstack|developer|entwickler\w*|forward.deployed engineer|product engineer|applications? engineer|mobile engineer|ios engineer|android engineer|web engineer|game engineer|engineering (manager|director|lead)|head of engineering|cto|chief technology|staff engineer|principal engineer|(?:java|python|golang|rust|ruby|react|linux|c\+\+) engineer)\b/i],
];
export function classifyRole(title: string): string | null {
  if (/\b(recruiter|recruitment|talent acquisition|account executive|sales development|marketing|business development|people partner)\b/i.test(title)) return null;
  if (/\b(?:clinical|chemistry|biology|molecular|oncology|pharma|protein)\b/i.test(title) && !/\b(?:software|data|ai|ml|machine learning|computational)\b/i.test(title)) return null;
  const specific = roles.find(([, pattern]) => pattern.test(title))?.[0];
  if (specific) return specific;
  if (/\b(?:founding|first|early) (?:software )?engineer\b|\bmember of (?:technical|product) staff.*\b(?:engineer|swe)\b|\bmember of technical staff\b|\bswe\b/i.test(title)) return 'Software engineering';
  return null;
}

/** Founding or first-hire roles, judged from the title. "AI First", "First Line Support" and "Foundations" teams are not. */
export function isFoundingRole(title: string): boolean {
  if (/\bfirst[- ]line\b/i.test(title)) return false;
  return /\bfounding\b/i.test(title) || /\bfirst\b.{0,30}\b(?:engineer|developer|hire|scientist|designer)\b/i.test(title)
    || /\b(?:engineer|employee|hire)\s*#\s*\d{1,2}\b/i.test(title) || /\bearly (?:stage )?engineer\b/i.test(title);
}
/** @deprecated kept for older callers; use isFoundingRole. */
export const isEarlyEngineer = (title: string) => isFoundingRole(title) && /\b(?:engineer|developer|cto|technical|scientist)\b/i.test(title);

const earlyStagePatterns = [
  /\b(?:pre-?seed|seed)(?:[- ]stage|[- ]funded| round| funding| startup| investment)\b/i,
  /\b(?:raised|closed|backed by)\b.{0,60}\b(?:pre-?seed|seed|series a)\b/i,
  /\bseries a\b(?!\s*(?:,|and|&|to|-)\s*(?:series\s+)?[b-z]\b)(?:[- ](?:funded|stage|startup|round|company))/i,
  /\b(?:y ?combinator|yc[- ](?:backed|funded))\b|\byc [sfwx]\d{2}\b|\((?:yc )?[sfw]\d{2}\)/i,
  /\bfounding (?:engineering |technical |product )?team\b/i,
  /\bfirst (?:\d{1,2}|few|five|ten|handful of) (?:engineers|employees|hires|team members)\b/i,
  /\bearly[- ]stage (?:start-?up|company|team|venture|business)\b/i,
];
/** Company stage from title and listing text. Evidence is the sentence that triggered it. */
export function companyStage(title: string, description: string): { stage?: 'founding' | 'early'; evidence?: string } {
  if (isFoundingRole(title)) return { stage: 'founding', evidence: title };
  const sentence = sentences(description.slice(0, 20000)).find(s => s.length < 600 && earlyStagePatterns.some(pattern => pattern.test(s)));
  return sentence ? { stage: 'early', evidence: sentence.slice(0, 300) } : {};
}

function sentences(text: string): string[] {
  return text.replace(/\r/g, '').split(/\n+|(?<=[.!?;])\s+/).map(s => s.trim()).filter(Boolean);
}
export function sponsorshipFromText(text: string): Sponsorship {
  const parts = sentences(text.replace(/[’‘]/g, "'"));
  const relevant = parts.filter(s => /\b(?:support|sponsor) (?:various types of )?(?:working |work )?visas?\b/i.test(s) || /\b(sponsor(?:ing)? (?:work )?visas?|visas? (?:sponsor|support|assistance|application)|immigration|work permit|right to work|work authori[sz]ation|relocat|(?:dutch|skilled worker) visa)/i.test(s) || (/\bsponsorship\b/i.test(s) && !/mentorship|horizontal|executive|event|conference|sport|clinical|sponsor.dedicated/i.test(s)));
  const qualified = relevant.filter(s => /\b(?:applicants|candidates)\b.{0,40}\balready\b.{0,30}\b(?:working|based|living|in|have)\b/i.test(s) || /\b(may|might|case.by.case|subject to|depending|consider|potentially|if|only|citizens)\b|(?:cannot|can't|not)\s+guarantee/i.test(s) && /\b(sponsor|sponsorship|visas?)\b/i.test(s));
  const negative = relevant.filter(s => !/\b(?:cannot|can't|not)\s+guarantee\b/i.test(s) && (
    /\b(?:cannot|can't|do not|don't|unable to|not able to)\s+(?:support|sponsor)\s+(?:working |work )?visas?\b/i.test(s) ||
    /\b(no|without)\s+(?:visa\s+|immigration\s+)?sponsorship\b/i.test(s) ||
    /\b(not|cannot|can't|unable|won't|will not|do not|does not|don't|doesn't|not able)\b.{0,65}\b(sponsor|sponsoring|sponsorship)\b/i.test(s) ||
    /\b(sponsorship|visa support)\b.{0,35}\b(not available|not offered|not provided|unavailable)\b/i.test(s) ||
    /\b(not require|must not require|mustn't require)\b.{0,25}\bsponsorship\b/i.test(s) ||
    /\bwithout\b.{0,35}\b(?:employer |visa )?sponsorship\b/i.test(s) ||
    /\b(?:not|cannot|unable|can't|no)\b.{0,40}\bvisa (?:assistance|support|applications?)\b/i.test(s) ||
    /\bvisas?\b.{0,25}\bnot supported\b/i.test(s)));
  const conditional = qualified.filter(s => !negative.includes(s));
  const positive = relevant.filter(s => !negative.includes(s) && !conditional.includes(s) && (
    /\bwe\s+(?:can|will|do|are able to)\s+support\s+(?:various types of )?(?:working |work )?visas?\b/i.test(s) ||
    /\bwe\s+(?:can|will|do|are able to)\s+sponsor\s+(?:work\s+)?visas?\b/i.test(s) ||
    /\b(?:provide|offer|provides|offers|offering|providing|support)\s+(?:\w+\s+){0,2}(?:visa|immigration)\s+sponsorship\b/i.test(s) ||
    /\bvisa sponsorship\s*(?:and|&)?\s*(?:relocation\s*)?(?:is\s+)?(?:available|provided|offered|supported)\b/i.test(s) ||
    /\bvisa\s+(?:and\s+relocation\s+)?support\s+(?:is\s+)?(?:available|provided|offered)\b/i.test(s)
    || /\b(?:visa|work permit|immigration) (?:and |& )?(?:relocation )?(?:support|assistance|sponsorship)\b.{0,40}\b(?:provided|available|offered|covered)\b/i.test(s)
    || /\bwe (?:provide|offer|cover|support)\b.{0,45}\b(?:work permits?|visa support|immigration support)\b/i.test(s)
    || /\b(?:includes?|provides?|offers?|with|support|comprehensive)\b.{0,65}\b(?:visa (?:support|assistance|sponsorship)|(?:dutch|skilled worker) visa sponsorship)\b/i.test(s)
    || /\bvisa sponsorship\b.{0,50}\b(?:relocation support|support for candidates)\b/i.test(s)
    || /\b(?:relocation (?:support|packages?)|benefits?)\b.{0,50}\bvisa sponsorship\b/i.test(s)
  ));
  const evidence = [...new Set([...negative, ...positive, ...conditional, ...relevant])].slice(0, 4).map(s => s.slice(0, 700));
  const result = (status: Sponsorship['status'], signal: number | null, reason: string): Sponsorship => ({ status, signal, reason, evidence, method: 'rules-v1' });
  if (positive.length && negative.length) return result('unknown', 50, 'Conflicting sponsorship statements. Check the employer’s exact conditions.');
  if (negative.length) return result('no', null, 'The listing explicitly excludes sponsorship or requires applicants not to need it.');
  if (positive.length) return result('yes', null, 'The listing explicitly offers visa sponsorship. Individual eligibility still applies.');
  if (conditional.length) return result('unknown', 65, 'Sponsorship is mentioned conditionally; it has not been confirmed for every applicant.');
  if (relevant.some(s => /relocat/i.test(s) && /support|assistance|package|provide|offer/i.test(s))) return result('unknown', 55, 'Relocation support is mentioned, but visa sponsorship is not confirmed.');
  if (relevant.some(s => /must|require|already|existing/i.test(s) && /right to work|work authori[sz]ation/i.test(s))) return result('unknown', 20, 'Existing work authorization is requested; sponsorship availability is unclear.');
  return result('unknown', null, 'No usable sponsorship evidence in the listing.');
}

// US locations as ATS boards write them. Two-letter state codes that are also common country codes
// (DE, IN, IL, CO, AR, ID, AL, GA) are left out so "Berlin, DE" or "Bengaluru, IN" never read as US.
const US_PLACE = /\b(?:united states|u\.s\.a?\.?|usa|us[ -]remote|remote[ ,(–-]+us\b|us[ -]based|new york|nyc|san francisco|bay area|silicon valley|los angeles|seattle|boston|austin|chicago|denver|atlanta|miami|washington,? d\.?c|philadelphia|dallas|houston|palo alto|mountain view|menlo park|redwood city|sunnyvale|san jose|san mateo|san diego|santa clara|portland|pittsburgh|raleigh|salt lake city|nashville|minneapolis|detroit|phoenix|brooklyn|california|texas|colorado|massachusetts|illinois|florida|virginia|north carolina|utah|arizona|oregon|new jersey|pennsylvania|ohio|michigan|minnesota|tennessee|maryland|wisconsin|connecticut)\b/i;
const US_STATE = /,\s*(?:CA|NY|WA|TX|MA|FL|NJ|PA|NC|VA|MI|MN|OR|UT|AZ|TN|OH|MD|MO|WI|CT|DC|NV|KY|SC|IA|KS|OK|NM|NE|NH|RI|VT|HI|AK|ME|MT|ND|SD|WV|WY|MS|LA)\b(?![a-z])/;
const NOT_US = /\b(?:canada|toronto|vancouver|montr[eé]al|ottawa|calgary|mexico|brazil|australia)\b/i;
export function looksUS(location: string): boolean {
  return !NOT_US.test(location) && (US_PLACE.test(location) || US_STATE.test(location));
}
/**
 * Most ATS boards don't state where the employer is based. When most of a board's own postings are in US
 * locations, treat the employer as US-based, and say so.
 */
export function inferUsEmployer(rows: RawJob[]): string | undefined {
  let us = 0, known = 0;
  for (const row of rows) {
    const isUs = looksUS(row.location);
    if (isUs) us++;
    if (isUs || countriesFromLocation(row.location).some(c => c !== 'US') || NOT_US.test(row.location)) known++;
  }
  return known >= 3 && us / known >= 0.5 ? `${us} of ${known} postings on this employer's own job board are in the US` : undefined;
}

export function safePublicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const h = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 4000) return null;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.includes(':') || !h.includes('.')) return null;
    if (/^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h)) return null;
    return url.href;
  } catch { return null; }
}

/** Display name without ATS suffixes some boards append ("Quantum Motion - Personio"). */
export function cleanCompany(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/\s*[-–|·]\s*(?:personio|workable|recruitee|greenhouse|lever|ashby|careers?|jobs)\s*$/i, '').trim() || name.trim();
}
export function classifyJob(raw: RawJob, fetchedAt: string): Job | null {
  raw = { ...raw, company: cleanCompany(raw.company) };
  const role = classifyRole(raw.title);
  const applyUrl = safePublicUrl(raw.applyUrl);
  const sourceUrl = safePublicUrl(raw.sourceUrl);
  if (!role || !applyUrl || !sourceUrl || !raw.company || !raw.externalId) return null;
  const locationCountries = countriesFromLocation(raw.location);
  const countries = locationCountries.length ? locationCountries : (raw.countryHints || []).filter(c => Boolean(COUNTRIES[c]));
  const parts = sentences(raw.description);
  const roleRemote = parts.filter(s => /\b(this (role|position)|you (can|may|will)|work from|based in|location:)\b/i.test(s) && /\b(remote|all.remote)\b/i.test(s) && !/collaborat.{0,50}remote|remote.{0,30}customers/i.test(s));
  const workText = `${raw.location} ${raw.workplace ?? ''} ${roleRemote.join(' ')}`;
  const workplace = /\bhybrid\b/i.test(workText) ? 'Hybrid' : /\bremote\b/i.test(workText) ? 'Remote' : /\bon.?site\b/i.test(workText) ? 'Onsite' : 'Unspecified';
  const eligibility = parts.filter(s => /\b(this (role|position) is (open|available)|you can (work|be based)|work from anywhere|candidates? (in|from)|hiring in|must be (based|located))\b/i.test(s));
  const world = [raw.location, ...eligibility].filter(s => /\b(worldwide|anywhere in the world|work from anywhere|globally remote)\b/i.test(s));
  const locationSegments = raw.location.split(/;|\||\n/);
  const indiaLocation = locationSegments.filter(s => countriesFromLocation(s).includes('IN'));
  const indiaRemote = indiaLocation.filter(s => /\bremote\b/i.test(s) || roleRemote.length > 0 || /^remote$/i.test(raw.workplace || ''));
  const indiaDescription = countries.length === 0 ? eligibility.filter(s => /\b(candidates? (in|from) india|(?:open|available) to.{0,20}india|(?:based|work|hiring) in india)\b/i.test(s)) : [];
  const india = [...indiaRemote, ...indiaDescription];
  const restricted = eligibility.filter(s => /\b(only|must be (based|located)|restricted to)\b/i.test(s));
  const remoteEligibility = workplace !== 'Remote' ? 'unknown' : india.length ? 'india' : world.length && !restricted.length && countries.length === 0 ? 'worldwide' : countries.length || restricted.length ? 'restricted' : 'unknown';
  const markets: Job['markets'] = [];
  if (countries.includes('GB')) markets.push('uk');
  if (countries.some(c => EU.includes(c))) markets.push('eu');
  if (remoteEligibility === 'worldwide') markets.push('remote_global');
  // Working for a US company from India: remote and open to India or worldwide, or based at an Indian office.
  if (raw.employerCountry === 'US' && (['worldwide', 'india'].includes(remoteEligibility) || countries.includes('IN'))) markets.push('india');
  if (!markets.length) return null;
  const sponsorship = sponsorshipFromText(raw.description);
  if (sponsorship.status === 'yes') {
    const countryScope = Object.entries(COUNTRIES).filter(([, name]) => new RegExp(`(?:sponsor.{0,25}visas?|visa sponsorship).{0,25}(?:in|to|for) ${name}\\b`, 'i').test(raw.description)).map(([code]) => code);
    if (countryScope.length && countries.some(code => !countryScope.includes(code))) {
      sponsorship.status = 'unknown'; sponsorship.signal = 65;
      sponsorship.reason = `The listing confirms sponsorship for ${countryScope.map(code => COUNTRIES[code]).join(', ')}, but not every country advertised for this role.`;
    }
  }
  sponsorship.textSignal = sponsorship.signal;
  sponsorship.textReason = sponsorship.reason;
  const { stage, evidence: stageEvidence } = companyStage(raw.title, raw.description);
  return {
    stage, stageEvidence,
    id: `${raw.sourceKey}:${raw.externalId}`, title: raw.title.trim(), company: raw.company,
    employerCountry: raw.employerCountry, employerCountrySource: raw.employerCountrySource, employerCountryReason: raw.employerCountryReason,
    location: !locationCountries.length && countries.length ? `${raw.location} · ${countries.map(code => COUNTRIES[code]).join(', ')} (source region)` : raw.location, countries, markets, role, workplace, remoteEligibility,
    remoteEvidence: [...new Set([...world, ...india, ...restricted, ...roleRemote])].slice(0, 4).map(s => s.slice(0, 700)),
    sponsorship, description: raw.description,
    applyUrl, sourceUrl, source: raw.source, sourceKey: raw.sourceKey,
    sourceUpdatedAt: raw.updatedAt, fetchedAt: raw.observedAt || fetchedAt, salary: raw.salary, attributionUrl: raw.attributionUrl,
  };
}
