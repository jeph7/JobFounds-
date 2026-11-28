import { isSourceEnabled, listAllActiveCareerJobs, recordSourceCall } from './serverEngineDb.ts';
import { detectScamRedFlags } from './serverApplicationEngine.ts';
import { clampStr, sanitizeHttpUrl } from './serverSecurity.ts';

export interface NormalizedFeedJob {
  id: string;
  companyId?: string;
  title: string;
  company: string;
  country: string;
  city: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  contractType: 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Freelance';
  experienceLevel: string;
  degreeRequired: string;
  salaryRange: string;
  salaryMinAnnualUsd?: number;
  languages: string[];
  skills: string[];
  publishedDate: string;
  applicationDeadline?: string;
  sourceName: string;
  sourceUrl: string;
  verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  verificationSummary: string;
  description: string;
  recruiterHint?: string;
  visaSponsorship?: string;
}

// -----------------------------------------------------------------------------
// International Geography & Multilingual Country/Region Normalization
// Strictly respects real-world geography across all 7 global regions:
// Europe, North America, Latin America, Caribbean, Africa, Asia, Oceania
// -----------------------------------------------------------------------------
type GlobalRegionId =
  | 'europe'
  | 'north_america'
  | 'latin_america'
  | 'caribbean'
  | 'africa'
  | 'asia'
  | 'oceania';

interface RegionDefinition {
  id: GlobalRegionId;
  /** Exact names used when a user searches for this region */
  triggers: string[];
  /** Umbrella labels employers use in job locations that include this region */
  broadLabels: string[];
}

interface CountryDefinition {
  region: GlobalRegionId;
  /** Exact multilingual names and major cities belonging strictly to this country */
  aliases: string[];
}

const REGION_DEFINITIONS: Record<GlobalRegionId, RegionDefinition> = {
  europe: {
    id: 'europe',
    triggers: ['europe', 'eu', 'european union', 'union europeenne', 'emea'],
    broadLabels: ['europe', 'eu', 'european union', 'european economic area', 'eea', 'emea'],
  },
  north_america: {
    id: 'north_america',
    triggers: ['north america', 'amerique du nord', 'americas', 'ameriques'],
    broadLabels: ['north america', 'amerique du nord', 'americas', 'ameriques', 'noram', 'na'],
  },
  latin_america: {
    id: 'latin_america',
    triggers: [
      'latin america',
      'amerique latine',
      'latam',
      'south america',
      'amerique du sud',
      'central america',
      'amerique centrale',
    ],
    broadLabels: [
      'latin america',
      'amerique latine',
      'latam',
      'south america',
      'amerique du sud',
      'central america',
      'amerique centrale',
      'americas',
      'ameriques',
    ],
  },
  caribbean: {
    id: 'caribbean',
    triggers: ['caribbean', 'caraibes', 'antilles', 'west indies'],
    broadLabels: ['caribbean', 'caraibes', 'antilles', 'west indies', 'americas', 'ameriques', 'latam'],
  },
  africa: {
    id: 'africa',
    triggers: ['africa', 'afrique'],
    broadLabels: ['africa', 'afrique', 'emea'],
  },
  asia: {
    id: 'asia',
    triggers: ['asia', 'asie', 'apac', 'asia-pacific', 'middle east', 'moyen-orient'],
    broadLabels: ['asia', 'asie', 'apac', 'asia-pacific', 'middle east', 'moyen-orient', 'mena'],
  },
  oceania: {
    id: 'oceania',
    triggers: ['oceania', 'oceanie', 'anz'],
    broadLabels: ['oceania', 'oceanie', 'apac', 'asia-pacific', 'anz'],
  },
};

const COUNTRY_DEFINITIONS: Record<string, CountryDefinition> = {
  // Europe
  france: {
    region: 'europe',
    aliases: ['france', 'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'lille', 'nantes', 'strasbourg', 'nice'],
  },
  germany: {
    region: 'europe',
    aliases: ['germany', 'allemagne', 'deutschland', 'berlin', 'munich', 'munchen', 'hamburg', 'frankfurt', 'cologne'],
  },
  switzerland: {
    region: 'europe',
    aliases: ['switzerland', 'suisse', 'schweiz', 'zurich', 'geneva', 'geneve', 'basel', 'lausanne', 'bern'],
  },
  'united kingdom': {
    region: 'europe',
    aliases: ['united kingdom', 'royaume-uni', 'uk', 'england', 'angleterre', 'scotland', 'london', 'londres', 'manchester', 'edinburgh', 'bristol'],
  },
  spain: {
    region: 'europe',
    aliases: ['spain', 'espagne', 'espana', 'madrid', 'barcelona', 'barcelone', 'valencia', 'seville'],
  },
  italy: {
    region: 'europe',
    aliases: ['italy', 'italie', 'italia', 'milan', 'milano', 'rome', 'roma', 'turin', 'florence'],
  },
  belgium: {
    region: 'europe',
    aliases: ['belgium', 'belgique', 'belgie', 'brussels', 'bruxelles', 'antwerp', 'ghent'],
  },
  netherlands: {
    region: 'europe',
    aliases: ['netherlands', 'pays-bas', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven'],
  },
  ireland: {
    region: 'europe',
    aliases: ['ireland', 'irlande', 'dublin', 'cork', 'galway'],
  },
  portugal: {
    region: 'europe',
    aliases: ['portugal', 'lisbon', 'lisbonne', 'lisboa', 'porto'],
  },
  sweden: {
    region: 'europe',
    aliases: ['sweden', 'suede', 'stockholm', 'gothenburg', 'malmo'],
  },
  poland: {
    region: 'europe',
    aliases: ['poland', 'pologne', 'warsaw', 'varsovie', 'krakow', 'wroclaw'],
  },
  austria: {
    region: 'europe',
    aliases: ['austria', 'autriche', 'vienna', 'vienne', 'wien'],
  },
  denmark: {
    region: 'europe',
    aliases: ['denmark', 'danemark', 'copenhagen', 'copenhague'],
  },
  norway: {
    region: 'europe',
    aliases: ['norway', 'norvege', 'oslo'],
  },
  finland: {
    region: 'europe',
    aliases: ['finland', 'finlande', 'helsinki'],
  },
  luxembourg: {
    region: 'europe',
    aliases: ['luxembourg'],
  },
  'czech republic': {
    region: 'europe',
    aliases: ['czech republic', 'czechia', 'republique tcheque', 'prague', 'praha'],
  },
  romania: {
    region: 'europe',
    aliases: ['romania', 'roumanie', 'bucharest', 'bucarest'],
  },
  greece: {
    region: 'europe',
    aliases: ['greece', 'grece', 'athens', 'athenes'],
  },

  // North America
  'united states': {
    region: 'north_america',
    aliases: [
      'united states',
      'etats-unis',
      'usa',
      'us',
      'u.s.',
      'new york',
      'san francisco',
      'seattle',
      'austin',
      'boston',
      'chicago',
      'miami',
      'los angeles',
      'california',
      'texas',
      'florida',
      'washington dc',
    ],
  },
  canada: {
    region: 'north_america',
    aliases: ['canada', 'toronto', 'montreal', 'vancouver', 'ottawa', 'calgary', 'quebec', 'edmonton'],
  },

  // Caribbean (Americas — strictly distinct from Africa)
  haiti: {
    region: 'caribbean',
    aliases: ['haiti', 'ayiti', 'port-au-prince', 'cap-haitien', 'petion-ville', 'jacmel', 'les cayes', 'gonaives'],
  },
  'dominican republic': {
    region: 'caribbean',
    aliases: ['dominican republic', 'republique dominicaine', 'santo domingo', 'saint-domingue', 'santiago de los caballeros', 'punta cana'],
  },
  jamaica: {
    region: 'caribbean',
    aliases: ['jamaica', 'jamaique', 'kingston', 'montego bay'],
  },
  'trinidad and tobago': {
    region: 'caribbean',
    aliases: ['trinidad and tobago', 'trinidad', 'trinite-et-tobago', 'port of spain'],
  },
  barbados: {
    region: 'caribbean',
    aliases: ['barbados', 'barbade', 'bridgetown'],
  },
  bahamas: {
    region: 'caribbean',
    aliases: ['bahamas', 'nassau'],
  },
  'puerto rico': {
    region: 'caribbean',
    aliases: ['puerto rico', 'porto rico', 'san juan'],
  },
  cuba: {
    region: 'caribbean',
    aliases: ['cuba', 'havana', 'la havane'],
  },
  guadeloupe: {
    region: 'caribbean',
    aliases: ['guadeloupe', 'pointe-a-pitre'],
  },
  martinique: {
    region: 'caribbean',
    aliases: ['martinique', 'fort-de-france'],
  },
  'saint lucia': {
    region: 'caribbean',
    aliases: ['saint lucia', 'sainte-lucie', 'castries'],
  },
  curacao: {
    region: 'caribbean',
    aliases: ['curacao', 'willemstad'],
  },
  aruba: {
    region: 'caribbean',
    aliases: ['aruba', 'oranjestad'],
  },

  // Latin America
  mexico: {
    region: 'latin_america',
    aliases: ['mexico', 'mexique', 'mexico city', 'cdmx', 'guadalajara', 'monterrey'],
  },
  brazil: {
    region: 'latin_america',
    aliases: ['brazil', 'bresil', 'brasil', 'sao paulo', 'rio de janeiro', 'belo horizonte', 'curitiba'],
  },
  colombia: {
    region: 'latin_america',
    aliases: ['colombia', 'colombie', 'bogota', 'medellin', 'cali', 'barranquilla'],
  },
  argentina: {
    region: 'latin_america',
    aliases: ['argentina', 'argentine', 'buenos aires', 'cordoba', 'rosario'],
  },
  chile: {
    region: 'latin_america',
    aliases: ['chile', 'chili', 'santiago', 'valparaiso'],
  },
  peru: {
    region: 'latin_america',
    aliases: ['peru', 'perou', 'lima'],
  },
  'costa rica': {
    region: 'latin_america',
    aliases: ['costa rica', 'san jose'],
  },
  uruguay: {
    region: 'latin_america',
    aliases: ['uruguay', 'montevideo'],
  },
  ecuador: {
    region: 'latin_america',
    aliases: ['ecuador', 'equateur', 'quito', 'guayaquil'],
  },
  panama: {
    region: 'latin_america',
    aliases: ['panama', 'panama city'],
  },
  paraguay: {
    region: 'latin_america',
    aliases: ['paraguay', 'asuncion'],
  },
  bolivia: {
    region: 'latin_america',
    aliases: ['bolivia', 'bolivie', 'la paz', 'santa cruz'],
  },
  guatemala: {
    region: 'latin_america',
    aliases: ['guatemala'],
  },

  // Africa
  senegal: {
    region: 'africa',
    aliases: ['senegal', 'dakar', 'thies'],
  },
  'ivory coast': {
    region: 'africa',
    aliases: ['ivory coast', "cote d'ivoire", 'cote d ivoire', 'cote divoire', 'abidjan'],
  },
  morocco: {
    region: 'africa',
    aliases: ['morocco', 'maroc', 'casablanca', 'rabat', 'marrakech', 'tangier', 'tanger'],
  },
  tunisia: {
    region: 'africa',
    aliases: ['tunisia', 'tunisie', 'tunis'],
  },
  algeria: {
    region: 'africa',
    aliases: ['algeria', 'algerie', 'algiers', 'alger'],
  },
  nigeria: {
    region: 'africa',
    aliases: ['nigeria', 'lagos', 'abuja'],
  },
  kenya: {
    region: 'africa',
    aliases: ['kenya', 'nairobi', 'mombasa'],
  },
  'south africa': {
    region: 'africa',
    aliases: ['south africa', 'afrique du sud', 'cape town', 'le cap', 'johannesburg', 'pretoria'],
  },
  cameroon: {
    region: 'africa',
    aliases: ['cameroon', 'cameroun', 'douala', 'yaounde'],
  },
  ghana: {
    region: 'africa',
    aliases: ['ghana', 'accra'],
  },
  egypt: {
    region: 'africa',
    aliases: ['egypt', 'egypte', 'cairo', 'le caire', 'alexandria'],
  },
  rwanda: {
    region: 'africa',
    aliases: ['rwanda', 'kigali'],
  },
  ethiopia: {
    region: 'africa',
    aliases: ['ethiopia', 'ethiopie', 'addis ababa'],
  },
  benin: {
    region: 'africa',
    aliases: ['benin', 'cotonou'],
  },
  togo: {
    region: 'africa',
    aliases: ['togo', 'lome'],
  },
  mauritius: {
    region: 'africa',
    aliases: ['mauritius', 'maurice', 'ile maurice', 'port louis'],
  },
  madagascar: {
    region: 'africa',
    aliases: ['madagascar', 'antananarivo'],
  },
  tanzania: {
    region: 'africa',
    aliases: ['tanzania', 'tanzanie', 'dar es salaam'],
  },
  uganda: {
    region: 'africa',
    aliases: ['uganda', 'ouganda', 'kampala'],
  },

  // Asia
  japan: {
    region: 'asia',
    aliases: ['japan', 'japon', 'tokyo', 'osaka', 'kyoto'],
  },
  singapore: {
    region: 'asia',
    aliases: ['singapore', 'singapour'],
  },
  india: {
    region: 'asia',
    aliases: ['india', 'inde', 'bengaluru', 'bangalore', 'mumbai', 'hyderabad', 'pune', 'delhi', 'chennai'],
  },
  'south korea': {
    region: 'asia',
    aliases: ['south korea', 'coree du sud', 'korea', 'seoul', 'busan'],
  },
  uae: {
    region: 'asia',
    aliases: ['uae', 'united arab emirates', 'emirats arabes unis', 'dubai', 'abu dhabi'],
  },
  'saudi arabia': {
    region: 'asia',
    aliases: ['saudi arabia', 'arabie saoudite', 'riyadh', 'riyad', 'jeddah'],
  },
  qatar: {
    region: 'asia',
    aliases: ['qatar', 'doha'],
  },
  philippines: {
    region: 'asia',
    aliases: ['philippines', 'manila', 'manille', 'cebu'],
  },
  vietnam: {
    region: 'asia',
    aliases: ['vietnam', 'hanoi', 'ho chi minh'],
  },
  indonesia: {
    region: 'asia',
    aliases: ['indonesia', 'indonesie', 'jakarta', 'bali'],
  },
  thailand: {
    region: 'asia',
    aliases: ['thailand', 'thailande', 'bangkok'],
  },
  malaysia: {
    region: 'asia',
    aliases: ['malaysia', 'malaisie', 'kuala lumpur'],
  },
  taiwan: {
    region: 'asia',
    aliases: ['taiwan', 'taipei'],
  },
  'hong kong': {
    region: 'asia',
    aliases: ['hong kong'],
  },
  china: {
    region: 'asia',
    aliases: ['china', 'chine', 'beijing', 'shanghai', 'shenzhen'],
  },
  israel: {
    region: 'asia',
    aliases: ['israel', 'tel aviv', 'jerusalem'],
  },

  // Oceania
  australia: {
    region: 'oceania',
    aliases: ['australia', 'australie', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'],
  },
  'new zealand': {
    region: 'oceania',
    aliases: ['new zealand', 'nouvelle-zelande', 'auckland', 'wellington', 'christchurch'],
  },
  fiji: {
    region: 'oceania',
    aliases: ['fiji', 'fidji', 'suva'],
  },
};

const GLOBAL_WORLDWIDE_LABELS = new Set([
  '',
  'anywhere',
  'worldwide',
  'global',
  'international',
  'everywhere',
  'remote',
  'remote worldwide',
  'remote global',
  'remote anywhere',
  'anywhere in the world',
  'work from anywhere',
  'all regions',
  'global remote',
]);

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasGeoTerm(haystack: string, rawTerm: string): boolean {
  const term = stripAccents(rawTerm);
  if (!term) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(term)}(?:$|[^a-z0-9])`, 'i');
  return re.test(haystack);
}

function hasBroadRegionLabel(locHay: string, regionId: GlobalRegionId, rawLabel: string): boolean {
  const lbl = stripAccents(rawLabel);
  if (!hasGeoTerm(locHay, lbl)) return false;

  // "South Africa" is a specific country, not the continent-wide "Africa" umbrella
  if (lbl === 'africa' && /\bsouth\s+africa\b/.test(locHay.replace(/\bafrica\b/g, (m) => m))) {
    const withoutSouthAfrica = locHay.replace(/\bsouth\s+africa\b/g, ' ');
    if (!hasGeoTerm(withoutSouthAfrica, 'africa')) return false;
  }

  // "EMEA" listings that explicitly restrict to European countries/timezones should not leak into African country searches
  if (
    lbl === 'emea' &&
    regionId === 'africa' &&
    /\b(european timezones|eu only|germany|uk|united kingdom|ireland|france|spain|poland|netherlands|switzerland|italy)\b/.test(
      locHay
    )
  ) {
    return false;
  }

  // "Americas" / "LATAM" listings that say "US only" or "USA only" should not match outside the US
  if (
    (lbl === 'americas' || lbl === 'latam') &&
    /\b(us only|usa only|united states only)\b/.test(locHay)
  ) {
    return false;
  }

  return true;
}

function findMatchedRegionTrigger(normToken: string): GlobalRegionId | null {
  for (const def of Object.values(REGION_DEFINITIONS)) {
    if (def.triggers.includes(normToken)) {
      return def.id;
    }
  }
  return null;
}

function findMatchedCountryDef(normToken: string): { key: string; def: CountryDefinition } | null {
  for (const [key, def] of Object.entries(COUNTRY_DEFINITIONS)) {
    if (stripAccents(key) === normToken || def.aliases.some((a) => stripAccents(a) === normToken)) {
      return { key, def };
    }
  }
  return null;
}

function isWorldwideRemote(countryField: string, workMode: string): boolean {
  if (workMode !== 'Remote') return false;
  const norm = stripAccents(countryField).replace(/[,/|()_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (GLOBAL_WORLDWIDE_LABELS.has(norm)) return true;
  if (
    /\b(worldwide|anywhere|everywhere|work from anywhere)\b/.test(norm) &&
    !/\b(only|except|excluding|us|usa|uk|eu|europe|emea|latam|apac|canada|germany|france)\b/.test(norm)
  ) {
    return true;
  }
  return false;
}

/**
 * 4-tier strict geography scoring (matches ONLY job.country & job.city, never job.title):
 *   3 = Exact requested country/city match (or country belonging to the requested region)
 *   2 = Explicit regional umbrella match (e.g. "Americas" / "Caribbean" for Haiti; "EMEA" / "Europe" for France)
 *   1 = Truly unrestricted Worldwide / Anywhere Remote role
 *   0 = Different country or unrelated region (strictly excluded)
 */
export function matchJobGeographyScore(job: NormalizedFeedJob, countryTokens: string[]): number {
  if (countryTokens.length === 0) return 1;
  const locHay = stripAccents(`${job.country} ${job.city}`);
  let bestScore = 0;

  for (const rawTok of countryTokens) {
    const norm = stripAccents(rawTok);
    if (!norm || norm === 'monde' || norm === 'worldwide' || norm === 'global') {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    // 1. User searched a continent / region (e.g., "Caraïbes", "Europe", "Amérique latine", "Afrique")
    const regionId = findMatchedRegionTrigger(norm);
    if (regionId) {
      const regionDef = REGION_DEFINITIONS[regionId];
      // Direct region member country match -> tier 3
      for (const countryDef of Object.values(COUNTRY_DEFINITIONS)) {
        if (countryDef.region !== regionId) continue;
        if (countryDef.aliases.some((alias) => hasGeoTerm(locHay, alias))) {
          bestScore = Math.max(bestScore, 3);
          break;
        }
      }
      // Explicit regional umbrella label match (e.g. "Caribbean", "Americas", "EMEA", "APAC") -> tier 2
      if (bestScore < 3 && regionDef.broadLabels.some((lbl) => hasBroadRegionLabel(locHay, regionId, lbl))) {
        bestScore = Math.max(bestScore, 2);
      }
      continue;
    }

    // 2. User searched a specific country or city (e.g., "Haïti", "Sénégal", "France", "Brésil", "Japon")
    const countryMatch = findMatchedCountryDef(norm);
    if (countryMatch) {
      // Exact country or city match -> tier 3
      if (countryMatch.def.aliases.some((alias) => hasGeoTerm(locHay, alias))) {
        bestScore = Math.max(bestScore, 3);
        continue;
      }
      // Explicit regional umbrella eligible for that country (ONLY broad region names, NEVER another country!) -> tier 2
      const regionDef = REGION_DEFINITIONS[countryMatch.def.region];
      if (regionDef.broadLabels.some((lbl) => hasBroadRegionLabel(locHay, countryMatch.def.region, lbl))) {
        bestScore = Math.max(bestScore, 2);
      }
      continue;
    }

    // 3. Any other country/city name typed by the user -> strict word-boundary match
    if (hasGeoTerm(locHay, norm)) {
      bestScore = Math.max(bestScore, 3);
    }
  }

  if (bestScore > 0) return bestScore;

  // 4. Genuine Worldwide / Anywhere remote jobs are eligible everywhere, ranked strictly below exact & regional matches
  if (isWorldwideRemote(job.country, job.workMode)) {
    return 1;
  }
  return 0;
}

function mapCountryToJobicyGeo(countryTokens: string[]): string | null {
  if (countryTokens.length === 0) return null;
  const joined = stripAccents(countryTokens.join(' '));
  // Only pass a Jobicy geo slug when Jobicy natively supports that exact country or when the user explicitly searched that region.
  // Never force geo=emea for an individual African country or geo=latam for a single Caribbean country (Jobicy returns unrelated countries).
  const geoMap: Array<[RegExp, string]> = [
    [/\b(france|paris)\b/, 'france'],
    [/\b(germany|allemagne|berlin|munich)\b/, 'germany'],
    [/\b(united kingdom|royaume-uni|uk|london)\b/, 'uk'],
    [/\b(spain|espagne|madrid|barcelona)\b/, 'spain'],
    [/\b(italy|italie|milan|rome)\b/, 'italy'],
    [/\b(netherlands|pays-bas|amsterdam)\b/, 'netherlands'],
    [/\b(switzerland|suisse|zurich|geneva)\b/, 'switzerland'],
    [/\b(canada|toronto|montreal|vancouver)\b/, 'canada'],
    [/\b(united states|etats-unis|usa|us)\b/, 'usa'],
    [/\b(mexico|mexique)\b/, 'mexico'],
    [/\b(brazil|bresil)\b/, 'brazil'],
    [/\b(argentina|argentine)\b/, 'argentina'],
    [/\b(australia|australie|sydney|melbourne)\b/, 'australia'],
    [/\b(new zealand|nouvelle-zelande)\b/, 'new-zealand'],
    [/\b(japan|japon|tokyo)\b/, 'japan'],
    [/\b(singapore|singapour)\b/, 'singapore'],
    [/\b(india|inde)\b/, 'india'],
    [/^(europe|eu|european union|union europeenne)$/, 'europe'],
    [/^(latin america|amerique latine|latam|south america|amerique du sud)$/, 'latam'],
    [/^(asia|asie|apac|asia-pacific|oceania|oceanie)$/, 'apac'],
    [/^(emea)$/, 'emea'],
  ];
  for (const [re, geo] of geoMap) {
    if (re.test(joined)) return geo;
  }
  return null;
}

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDeadlineExpired(deadline?: string): boolean {
  if (!deadline) return false;
  const ts = Date.parse(deadline);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now() - 86_400_000;
}

function isStaleListing(publishedDate?: string): boolean {
  if (!publishedDate) return false;
  const ts = Date.parse(publishedDate);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > 120 * 86_400_000;
}

function loadVerifiedAtsJobsFromDb(): NormalizedFeedJob[] {
  try {
    const active = listAllActiveCareerJobs(250);
    return active.map((cj) => {
      const locParts = (cj.location || '').split(',').map((s) => s.trim()).filter(Boolean);
      const city = cj.workMode === 'Remote' ? 'Remote' : locParts[0] || cj.location || 'International';
      const rawContract = (cj.contractType || '').toLowerCase();
      const contractType: NormalizedFeedJob['contractType'] = rawContract.includes('intern')
        ? 'Internship'
        : rawContract.includes('part')
          ? 'Part-time'
          : rawContract.includes('freelance')
            ? 'Freelance'
            : rawContract.includes('contract')
              ? 'Contract'
              : 'Full-time';
      return {
        id: `ats_${cj.id}`,
        companyId: cj.companyId,
        title: cj.title,
        company: cj.companyName,
        country: cj.country || 'International',
        city,
        workMode: cj.workMode,
        contractType,
        experienceLevel: /senior|staff|lead|principal|director/i.test(cj.title)
          ? 'Senior'
          : /junior|entry|intern|graduate/i.test(cj.title)
            ? 'Junior'
            : 'Mid-level',
        degreeRequired: 'Not specified',
        salaryRange: 'Disclosed on official portal',
        languages: /france|paris|bruxelles|montr[eé]al|gen[eè]ve|ha[iï]ti|s[eé]n[eé]gal|abidjan|maroc/i.test(
          `${cj.country} ${cj.location}`
        )
          ? ['French', 'English']
          : /brazil|br[eé]sil|s[aã]o paulo/i.test(`${cj.country} ${cj.location}`)
            ? ['Portuguese', 'English']
            : /spain|mexico|colombia|argentina|chile|peru|dominican/i.test(`${cj.country} ${cj.location}`)
              ? ['Spanish', 'English']
              : ['English'],
        skills: cj.skills.length ? cj.skills.slice(0, 8) : [cj.department || cj.companySector || 'Corporate'],
        publishedDate: (cj.firstSeenAt || new Date().toISOString()).slice(0, 10),
        applicationDeadline: cj.applicationDeadline || undefined,
        sourceName: cj.atsSource || 'Official Employer ATS',
        sourceUrl: sanitizeHttpUrl(cj.url),
        verificationStatus: 'Verified',
        verificationSummary: `Offre officielle vérifiée directement sur le portail ATS de ${cj.companyName} (${cj.atsSource}). Dernier contrôle actif le ${(cj.lastSeenAt || '').slice(0, 10)}.`,
        description: `Poste officiel ${cj.title}${cj.department ? ` au sein du département ${cj.department}` : ''} chez ${cj.companyName} (${cj.location}, ${cj.workMode}). Secteur : ${cj.companySector || 'Entreprise vérifiée'}.`,
        recruiterHint: `Portail officiel ${cj.atsSource} · ${cj.companyName}`,
        visaSponsorship: 'Voir conditions sur le portail officiel',
      };
    });
  } catch {
    return [];
  }
}

interface FeedCacheEntry {
  jobs: NormalizedFeedJob[];
  fetchedAt: number;
}

const FEED_CACHE_TTL_MS = 5 * 60_000;
const FEED_CACHE_STALE_MAX_MS = 30 * 60_000;
const providerFeedCache = new Map<string, FeedCacheEntry>();

async function withProviderFeedCache(
  cacheKey: string,
  fetcher: () => Promise<NormalizedFeedJob[]>
): Promise<NormalizedFeedJob[]> {
  const now = Date.now();
  const cached = providerFeedCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < FEED_CACHE_TTL_MS) {
    return cached.jobs;
  }
  const fresh = await fetcher();
  if (fresh.length > 0) {
    if (providerFeedCache.size > 80) {
      const oldestKey = providerFeedCache.keys().next().value;
      if (oldestKey) providerFeedCache.delete(oldestKey);
    }
    providerFeedCache.set(cacheKey, { jobs: fresh, fetchedAt: now });
    return fresh;
  }
  // If external API temporarily rate-limited (429) or timed out, reuse recent cached listings up to 30 min
  if (cached && now - cached.fetchedAt < FEED_CACHE_STALE_MAX_MS) {
    return cached.jobs;
  }
  return [];
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JOBFOUNDS-Platform/1.0',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchArbeitnowJobs(): Promise<NormalizedFeedJob[]> {
  if (!isSourceEnabled('arbeitnow_api')) return [];
  const data = await fetchJsonWithTimeout('https://www.arbeitnow.com/api/job-board-api');
  if (!Array.isArray(data?.data)) {
    recordSourceCall('arbeitnow_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('arbeitnow_api', true);
  return data.data.slice(0, 35).map((item: any, idx: number) => {
    const location = String(item.location || 'Germany');
    const parts = location.split(',').map((s: string) => s.trim()).filter(Boolean);
    const city = parts[0] || 'Berlin';
    const country = parts.length > 1 ? parts[parts.length - 1] : 'Germany / Europe';
    const createdDate =
      typeof item.created_at === 'number'
        ? new Date(item.created_at * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const tags = Array.isArray(item.tags) ? item.tags.map(String).slice(0, 8) : [];
    const jobTypes = Array.isArray(item.job_types) ? item.job_types.map(String).join(' ').toLowerCase() : '';
    const contractType: NormalizedFeedJob['contractType'] = jobTypes.includes('intern')
      ? 'Internship'
      : jobTypes.includes('part')
        ? 'Part-time'
        : jobTypes.includes('freelance')
          ? 'Freelance'
          : jobTypes.includes('contract')
            ? 'Contract'
            : 'Full-time';

    return {
      id: `feed_arbeitnow_${item.slug || idx}`,
      title: clampStr(item.title, 160) || 'Role',
      company: clampStr(item.company_name, 120) || 'Employer',
      country,
      city,
      workMode: item.remote ? 'Remote' : 'On-site',
      contractType,
      experienceLevel: 'Mid-level',
      degreeRequired: 'Not specified',
      salaryRange: 'Disclosed on application',
      languages: ['English', 'German'],
      skills: tags.length ? tags : ['International Role'],
      publishedDate: createdDate,
      applicationDeadline: typeof item.deadline === 'string' ? item.deadline.slice(0, 10) : undefined,
      sourceName: 'Arbeitnow Live Feed',
      sourceUrl: sanitizeHttpUrl(item.url),
      verificationStatus: 'Partially Verified',
      verificationSummary:
        'Direct public feed listing from Arbeitnow job board API. Verify employer domain prior to submitting personal documents.',
      description: stripHtml(item.description).slice(0, 600) || 'View full job description on the official source.',
      recruiterHint: `Direct Job Board Feed · ${item.company_name || 'Employer'}`,
      visaSponsorship: tags.some((t: string) => /visa/i.test(t))
        ? 'Mentioned in listing'
        : 'Not specified',
    };
  });
}

async function fetchRemotiveJobs(queryText: string): Promise<NormalizedFeedJob[]> {
  if (!isSourceEnabled('remotive_api')) return [];
  const params = new URLSearchParams({ limit: '40' });
  if (queryText) params.set('search', queryText);
  const data = await fetchJsonWithTimeout(`https://remotive.com/api/remote-jobs?${params.toString()}`);
  if (!Array.isArray(data?.jobs)) {
    recordSourceCall('remotive_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('remotive_api', true);
  return data.jobs.slice(0, 40).map((item: any, idx: number) => {
    const loc = clampStr(item.candidate_required_location, 100) || 'Worldwide';
    const rawType = String(item.job_type || '').toLowerCase();
    const contractType: NormalizedFeedJob['contractType'] = rawType.includes('contract')
      ? 'Contract'
      : rawType.includes('freelance')
        ? 'Freelance'
        : rawType.includes('part')
          ? 'Part-time'
          : rawType.includes('intern')
            ? 'Internship'
            : 'Full-time';

    return {
      id: `feed_remotive_${item.id || idx}`,
      title: clampStr(item.title, 160) || 'Remote Position',
      company: clampStr(item.company_name, 120) || 'Employer',
      country: loc,
      city: 'Remote',
      workMode: 'Remote',
      contractType,
      experienceLevel: /senior|staff|lead|principal/i.test(String(item.title || ''))
        ? 'Senior'
        : /junior|entry/i.test(String(item.title || ''))
          ? 'Junior'
          : 'Mid-level',
      degreeRequired: 'Not specified',
      salaryRange: clampStr(item.salary, 100) || 'Disclosed on application',
      languages: ['English'],
      skills: Array.isArray(item.tags) && item.tags.length
        ? item.tags.map(String).slice(0, 8)
        : [clampStr(item.category, 60) || 'Remote'],
      publishedDate: String(item.publication_date || new Date().toISOString()).slice(0, 10),
      applicationDeadline: typeof item.expiration_date === 'string' ? item.expiration_date.slice(0, 10) : undefined,
      sourceName: 'Remotive Live Feed',
      sourceUrl: sanitizeHttpUrl(item.url),
      verificationStatus: 'Partially Verified',
      verificationSummary:
        'Direct public remote listing from Remotive API. Official listing URL provided for direct application.',
      description: stripHtml(item.description).slice(0, 600) || 'View full remote role details on source.',
      recruiterHint: `Remote Hiring Team · ${item.company_name || 'Employer'}`,
      visaSponsorship: 'Remote / Location-flexible',
    };
  });
}

async function fetchMuseJobs(): Promise<NormalizedFeedJob[]> {
  if (!isSourceEnabled('themuse_api')) return [];
  const data = await fetchJsonWithTimeout('https://www.themuse.com/api/public/jobs?page=1');
  if (!Array.isArray(data?.results)) {
    recordSourceCall('themuse_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('themuse_api', true);
  return data.results.slice(0, 35).map((item: any, idx: number) => {
    const locList: string[] = Array.isArray(item.locations)
      ? item.locations.map((l: any) => String(l?.name || '').trim()).filter(Boolean)
      : [];
    const locName = locList[0] || 'Worldwide';
    const isRemote = /remote|flexible/i.test(locName);
    const parts = locName.split(',').map((s: string) => s.trim()).filter(Boolean);
    const usStateAbbrev = /^[A-Z]{2}$/;
    let city = isRemote ? 'Remote' : parts[0] || 'International';
    let country = 'Worldwide';
    if (isRemote) {
      if (/\b(us|usa|united states)\b/i.test(locName)) country = 'United States';
      else if (/\b(uk|united kingdom)\b/i.test(locName)) country = 'United Kingdom';
      else if (/\b(canada)\b/i.test(locName)) country = 'Canada';
      else if (/\b(europe|emea)\b/i.test(locName)) country = 'Europe';
      else country = 'Worldwide';
    } else if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      country = usStateAbbrev.test(lastPart) ? 'United States' : lastPart;
    } else if (parts.length === 1) {
      country = parts[0];
      city = parts[0];
    }
    const level = String(item.levels?.[0]?.name || 'Mid-level');
    const cats = Array.isArray(item.categories)
      ? item.categories.map((c: any) => String(c?.name || '')).filter(Boolean)
      : [];

    return {
      id: `feed_muse_${item.id || idx}`,
      title: clampStr(item.name, 160) || 'Position',
      company: clampStr(item.company?.name, 120) || 'Enterprise Employer',
      country,
      city,
      workMode: isRemote ? 'Remote' : 'Hybrid',
      contractType: 'Full-time',
      experienceLevel: level,
      degreeRequired: 'Not specified',
      salaryRange: 'Disclosed on application',
      languages: ['English'],
      skills: cats.length ? cats.slice(0, 6) : ['Corporate'],
      publishedDate: String(item.publication_date || new Date().toISOString()).slice(0, 10),
      sourceName: 'The Muse Live Feed',
      sourceUrl: sanitizeHttpUrl(item.refs?.landing_page),
      verificationStatus: 'Partially Verified',
      verificationSummary:
        'Public listing from The Muse API. Independent verification on the official employer career portal is recommended.',
      description: stripHtml(item.contents).slice(0, 600) || 'View full role specifications on official employer portal.',
      recruiterHint: `Direct Corporate Feed · ${item.company?.name || 'Employer'}`,
      visaSponsorship: 'Check official listing',
    };
  });
}

async function fetchJobicyJobs(queryText: string, countryTokens: string[]): Promise<NormalizedFeedJob[]> {
  if (!isSourceEnabled('jobicy_api')) return [];
  const params = new URLSearchParams({ count: '40' });
  const geo = mapCountryToJobicyGeo(countryTokens);
  if (geo) params.set('geo', geo);
  if (queryText && queryText.length >= 2) params.set('tag', queryText.split(/\s+/)[0]);
  const data = await fetchJsonWithTimeout(`https://jobicy.com/api/v2/remote-jobs?${params.toString()}`);
  if (!Array.isArray(data?.jobs)) {
    recordSourceCall('jobicy_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('jobicy_api', true);
  return data.jobs.slice(0, 40).map((item: any, idx: number) => {
    const geoStr = clampStr(item.jobGeo, 100) || 'Anywhere';
    const rawTypes = Array.isArray(item.jobType) ? item.jobType.join(' ').toLowerCase() : String(item.jobType || '').toLowerCase();
    const contractType: NormalizedFeedJob['contractType'] = rawTypes.includes('contract')
      ? 'Contract'
      : rawTypes.includes('part')
        ? 'Part-time'
        : rawTypes.includes('intern')
          ? 'Internship'
          : rawTypes.includes('freelance')
            ? 'Freelance'
            : 'Full-time';
    const minSal = Number(item.salaryMin) || 0;
    const maxSal = Number(item.salaryMax) || 0;
    const currency = clampStr(item.salaryCurrency, 12) || 'USD';
    const salaryRange =
      minSal > 0 && maxSal > 0
        ? `${minSal.toLocaleString()} - ${maxSal.toLocaleString()} ${currency}`
        : minSal > 0
          ? `${minSal.toLocaleString()}+ ${currency}`
          : 'Disclosed on application';
    const industries = Array.isArray(item.jobIndustry) ? item.jobIndustry.map(String).filter(Boolean) : [];
    const pubIso = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    return {
      id: `feed_jobicy_${item.id || idx}`,
      title: clampStr(item.jobTitle, 160) || 'International Position',
      company: clampStr(item.companyName, 120) || 'Employer',
      country: geoStr,
      city: /anywhere|worldwide|europe|latam|apac|emea/i.test(geoStr) ? 'Remote' : geoStr,
      workMode: 'Remote',
      contractType,
      experienceLevel: clampStr(item.jobLevel, 50) || 'Mid-level',
      degreeRequired: 'Not specified',
      salaryRange,
      salaryMinAnnualUsd: minSal > 0 && currency === 'USD' ? minSal : undefined,
      languages: ['English'],
      skills: industries.length ? industries.slice(0, 6) : ['International Remote'],
      publishedDate: pubIso,
      sourceName: 'Jobicy International Feed',
      sourceUrl: sanitizeHttpUrl(item.url),
      verificationStatus: 'Partially Verified',
      verificationSummary:
        'Direct public international listing from Jobicy API with direct redirect to the original offer URL.',
      description: stripHtml(item.jobExcerpt || item.jobDescription).slice(0, 600) || 'View full job details on source.',
      recruiterHint: `International Recruiting Team · ${item.companyName || 'Employer'}`,
      visaSponsorship: 'Remote / Regional eligibility',
    };
  });
}

async function fetchHimalayasJobs(): Promise<NormalizedFeedJob[]> {
  if (!isSourceEnabled('himalayas_api')) return [];
  const data = await fetchJsonWithTimeout('https://himalayas.app/jobs/api?limit=50');
  if (!Array.isArray(data?.jobs)) {
    recordSourceCall('himalayas_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('himalayas_api', true);
  return data.jobs.slice(0, 50).map((item: any, idx: number) => {
    const locs = Array.isArray(item.locationRestrictions)
      ? item.locationRestrictions.map(String).filter(Boolean)
      : [];
    const country = locs.length > 0 ? locs.slice(0, 4).join(', ') : 'Worldwide';
    const rawType = String(item.employmentType || '').toLowerCase();
    const contractType: NormalizedFeedJob['contractType'] = rawType.includes('contract')
      ? 'Contract'
      : rawType.includes('part')
        ? 'Part-time'
        : rawType.includes('intern')
          ? 'Internship'
          : rawType.includes('freelance')
            ? 'Freelance'
            : 'Full-time';
    const minSal = Number(item.minSalary) || 0;
    const maxSal = Number(item.maxSalary) || 0;
    const currency = clampStr(item.currency, 12) || 'USD';
    const salaryRange =
      minSal > 0 && maxSal > 0
        ? `${minSal.toLocaleString()} - ${maxSal.toLocaleString()} ${currency}`
        : minSal > 0
          ? `${minSal.toLocaleString()}+ ${currency}`
          : 'Disclosed on application';
    const cats = Array.isArray(item.categories) ? item.categories.map(String).filter(Boolean) : [];
    const pubDate =
      typeof item.pubDate === 'number'
        ? new Date(item.pubDate * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const expiryDate =
      typeof item.expiryDate === 'number'
        ? new Date(item.expiryDate * 1000).toISOString().slice(0, 10)
        : undefined;
    const seniority = Array.isArray(item.seniority) && item.seniority[0] ? String(item.seniority[0]) : 'Mid-level';

    return {
      id: `feed_himalayas_${idx}_${String(item.guid || '').slice(-16).replace(/[^a-zA-Z0-9_-]/g, '')}`,
      title: clampStr(item.title, 160) || 'Global Position',
      company: clampStr(item.companyName, 120) || 'Employer',
      country,
      city: locs.length === 1 ? locs[0] : 'Remote',
      workMode: 'Remote',
      contractType,
      experienceLevel: seniority,
      degreeRequired: 'Not specified',
      salaryRange,
      salaryMinAnnualUsd: minSal > 0 && currency === 'USD' ? minSal : undefined,
      languages: /france|belgium|switzerland|canada|senegal|haiti|morocco/i.test(country)
        ? ['French', 'English']
        : ['English'],
      skills: cats.length ? cats.slice(0, 8) : ['Global Remote'],
      publishedDate: pubDate,
      applicationDeadline: expiryDate,
      sourceName: 'Himalayas Global Feed',
      sourceUrl: sanitizeHttpUrl(item.applicationLink || item.guid),
      verificationStatus: 'Partially Verified',
      verificationSummary:
        'Public global job listing from Himalayas API with verified official application URL and explicit geographic eligibility.',
      description: stripHtml(item.excerpt || item.description).slice(0, 600) || 'View full job specifications on source.',
      recruiterHint: `Global Talent Team · ${item.companyName || 'Employer'}`,
      visaSponsorship: locs.length === 0 ? 'Worldwide Remote' : `Eligible: ${country}`,
    };
  });
}

export async function fetchAggregatedLiveJobFeeds(filters: {
  query?: string;
  country?: string;
  city?: string;
  workMode?: string;
  contractType?: string;
}): Promise<{ jobs: NormalizedFeedJob[]; activeProviders: string[]; filteredOutCount: number }> {
  const q = clampStr(filters.query, 120).toLowerCase();
  const ctryTokens = clampStr(filters.country, 120)
    .toLowerCase()
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cty = clampStr(filters.city, 80).toLowerCase();
  const mode = clampStr(filters.workMode, 30);
  const contract = clampStr(filters.contractType, 30);

  const verifiedAts = loadVerifiedAtsJobsFromDb();
  const jobicyGeoKey = mapCountryToJobicyGeo(ctryTokens) || 'global';
  const [arbeitnow, remotive, muse, jobicy, himalayas] = await Promise.all([
    withProviderFeedCache('arbeitnow::all', () => fetchArbeitnowJobs()),
    withProviderFeedCache(`remotive::${q || 'all'}`, () => fetchRemotiveJobs(q)),
    withProviderFeedCache('themuse::page1', () => fetchMuseJobs()),
    withProviderFeedCache(`jobicy::${jobicyGeoKey}::${q || 'all'}`, () => fetchJobicyJobs(q, ctryTokens)),
    withProviderFeedCache('himalayas::all', () => fetchHimalayasJobs()),
  ]);

  const activeProviders: string[] = [];
  if (verifiedAts.length) activeProviders.push('Official ATS (Greenhouse/Lever/Ashby/Workday/SmartRecruiters)');
  if (himalayas.length) activeProviders.push('Himalayas Global');
  if (jobicy.length) activeProviders.push('Jobicy International');
  if (remotive.length) activeProviders.push('Remotive');
  if (arbeitnow.length) activeProviders.push('Arbeitnow');
  if (muse.length) activeProviders.push('The Muse');

  // Official ATS jobs come first so verified corporate listings take priority over duplicate aggregator entries
  const combined = [...verifiedAts, ...himalayas, ...jobicy, ...remotive, ...arbeitnow, ...muse];
  const seenSemantic = new Set<string>();
  let filteredOutCount = 0;

  const scored: Array<{ job: NormalizedFeedJob; geoScore: number }> = [];

  for (const job of combined) {
    if (!job.sourceUrl) {
      filteredOutCount++;
      continue;
    }
    if (isDeadlineExpired(job.applicationDeadline) || isStaleListing(job.publishedDate)) {
      filteredOutCount++;
      continue;
    }
    if (detectScamRedFlags(`${job.title} ${job.description}`).length > 0) {
      filteredOutCount++;
      continue;
    }

    const semKey = `${job.company.toLowerCase().trim()}::${job.title.toLowerCase().trim()}::${job.city.toLowerCase().trim()}`;
    if (seenSemantic.has(semKey)) {
      filteredOutCount++;
      continue;
    }
    seenSemantic.add(semKey);

    if (
      q &&
      !stripAccents(`${job.title} ${job.company} ${job.description} ${job.skills.join(' ')}`).includes(
        stripAccents(q)
      )
    ) {
      continue;
    }

    const geoScore = matchJobGeographyScore(job, ctryTokens);
    if (ctryTokens.length > 0 && geoScore === 0) {
      continue;
    }
    if (cty && !stripAccents(`${job.city} ${job.country}`).includes(stripAccents(cty))) {
      continue;
    }
    if (mode && job.workMode !== mode) continue;
    if (contract && job.contractType !== contract) continue;

    scored.push({ job, geoScore });
  }

  // Rank exact-country matches first, then Verified official ATS jobs, then newest date
  scored.sort((a, b) => {
    if (b.geoScore !== a.geoScore) return b.geoScore - a.geoScore;
    if (a.job.verificationStatus === 'Verified' && b.job.verificationStatus !== 'Verified') return -1;
    if (b.job.verificationStatus === 'Verified' && a.job.verificationStatus !== 'Verified') return 1;
    return (b.job.publishedDate || '').localeCompare(a.job.publishedDate || '');
  });

  return {
    jobs: scored.slice(0, 160).map((s) => s.job),
    activeProviders,
    filteredOutCount,
  };
}
