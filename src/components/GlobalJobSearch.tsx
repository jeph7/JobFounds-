import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookmarkCheck,
  BookmarkPlus,
  Building2,
  FileCheck2,
  FileText,
  Filter,
  Loader2,
  MapPin,
  Rss,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CandidateProfile,
  GroundingSource,
  JobFeedSource,
  JobListing,
  Lang,
} from '../types';
import { L, t } from '../i18n';
import { computeBaselineMatch, GLOBAL_BANNER_URL } from '../data/initialData';
import { fetchLiveJobFeeds, searchGlobalJobs } from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import { VerificationStatusText } from './StatusText';
import { CareerLocationMapHub } from './CareerLocationMapHub';
import type { ApplicationModalTarget } from './ApplicationSubmissionModal';

interface GlobalJobSearchProps {
  lang: Lang;
  jobs: JobListing[];
  onJobsUpdate: (jobs: JobListing[]) => void;
  profile: CandidateProfile;
  trackedKeys: Set<string>;
  onTrackJob: (job: JobListing) => void;
  onVerifyJob: (job: JobListing) => void;
  onTailorCvForJob: (job: JobListing) => void;
  onAnalyzeAtsForJob: (job: JobListing) => void;
  onOpenMatchForJob: (job: JobListing) => void;
  onOpenCompanyIntel: (companyName: string, country?: string) => void;
  onOpenApplyModal?: (target: ApplicationModalTarget) => void;
  initialQuery?: string;
  initialCountry?: string;
  externalSearchTrigger: number;
}

const GLOBAL_REGIONS: Array<{ id: string; queryValue: string; labelFr: string; labelEn: string }> = [
  { id: 'world', queryValue: '', labelFr: 'Monde', labelEn: 'Worldwide' },
  { id: 'europe', queryValue: 'Europe', labelFr: 'Europe', labelEn: 'Europe' },
  { id: 'north_america', queryValue: 'Amérique du Nord', labelFr: 'Amérique du Nord', labelEn: 'North America' },
  { id: 'latam', queryValue: 'Amérique latine', labelFr: 'Amérique latine', labelEn: 'Latin America' },
  { id: 'caribbean', queryValue: 'Caraïbes', labelFr: 'Caraïbes', labelEn: 'Caribbean' },
  { id: 'africa', queryValue: 'Afrique', labelFr: 'Afrique', labelEn: 'Africa' },
  { id: 'asia', queryValue: 'Asie', labelFr: 'Asie', labelEn: 'Asia' },
  { id: 'oceania', queryValue: 'Océanie', labelFr: 'Océanie', labelEn: 'Oceania' },
];

type ClientRegionId =
  | 'europe'
  | 'north_america'
  | 'latin_america'
  | 'caribbean'
  | 'africa'
  | 'asia'
  | 'oceania';

const CLIENT_REGION_DEFS: Record<ClientRegionId, { triggers: string[]; broadLabels: string[]; countries: string[] }> = {
  europe: {
    triggers: ['europe', 'eu', 'european union', 'union europeenne', 'emea'],
    broadLabels: ['europe', 'eu', 'european union', 'eea', 'emea'],
    countries: [
      'france', 'paris', 'lyon', 'marseille', 'germany', 'allemagne', 'deutschland', 'berlin', 'munich',
      'switzerland', 'suisse', 'zurich', 'geneva', 'geneve', 'uk', 'united kingdom', 'royaume-uni', 'london', 'londres',
      'spain', 'espagne', 'madrid', 'barcelona', 'italy', 'italie', 'milan', 'rome', 'netherlands', 'pays-bas', 'amsterdam',
      'belgium', 'belgique', 'brussels', 'bruxelles', 'portugal', 'lisbon', 'ireland', 'irlande', 'dublin',
      'sweden', 'suede', 'stockholm', 'poland', 'pologne', 'warsaw', 'austria', 'autriche', 'vienna', 'luxembourg',
      'denmark', 'norway', 'finland', 'czech', 'romania', 'greece',
    ],
  },
  north_america: {
    triggers: ['north america', 'amerique du nord', 'americas', 'ameriques'],
    broadLabels: ['north america', 'amerique du nord', 'americas', 'ameriques', 'noram'],
    countries: [
      'united states', 'etats-unis', 'usa', 'us', 'new york', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'miami', 'california',
      'canada', 'toronto', 'montreal', 'vancouver', 'ottawa', 'quebec', 'calgary',
    ],
  },
  latin_america: {
    triggers: ['latin america', 'amerique latine', 'latam', 'south america', 'amerique du sud', 'central america'],
    broadLabels: ['latin america', 'amerique latine', 'latam', 'south america', 'amerique du sud', 'central america', 'americas'],
    countries: [
      'mexico', 'mexique', 'mexico city', 'brazil', 'bresil', 'brasil', 'sao paulo', 'rio de janeiro',
      'colombia', 'colombie', 'bogota', 'medellin', 'argentina', 'argentine', 'buenos aires',
      'chile', 'chili', 'santiago', 'peru', 'perou', 'lima', 'uruguay', 'costa rica', 'panama', 'ecuador', 'equateur',
    ],
  },
  caribbean: {
    triggers: ['caribbean', 'caraibes', 'antilles', 'west indies'],
    broadLabels: ['caribbean', 'caraibes', 'antilles', 'west indies', 'americas', 'latam'],
    countries: [
      'haiti', 'ayiti', 'port-au-prince', 'cap-haitien', 'dominican republic', 'republique dominicaine', 'santo domingo',
      'jamaica', 'jamaique', 'kingston', 'trinidad', 'barbados', 'barbade', 'bahamas', 'puerto rico', 'porto rico',
      'cuba', 'guadeloupe', 'martinique', 'saint lucia', 'curacao', 'aruba',
    ],
  },
  africa: {
    triggers: ['africa', 'afrique'],
    broadLabels: ['africa', 'afrique', 'emea'],
    countries: [
      'senegal', 'dakar', 'ivory coast', 'cote d ivoire', 'abidjan', 'morocco', 'maroc', 'casablanca', 'rabat',
      'tunisia', 'tunisie', 'tunis', 'algeria', 'algerie', 'nigeria', 'lagos', 'kenya', 'nairobi',
      'south africa', 'afrique du sud', 'cape town', 'johannesburg', 'egypt', 'egypte', 'cairo',
      'ghana', 'accra', 'cameroon', 'cameroun', 'rwanda', 'kigali', 'ethiopia', 'benin', 'togo', 'mauritius', 'madagascar',
    ],
  },
  asia: {
    triggers: ['asia', 'asie', 'apac', 'asia-pacific', 'middle east', 'moyen-orient'],
    broadLabels: ['asia', 'asie', 'apac', 'asia-pacific', 'middle east', 'mena'],
    countries: [
      'japan', 'japon', 'tokyo', 'osaka', 'singapore', 'singapour', 'india', 'inde', 'bengaluru', 'bangalore', 'mumbai',
      'south korea', 'coree du sud', 'seoul', 'vietnam', 'philippines', 'manila', 'indonesia', 'indonesie', 'jakarta',
      'malaysia', 'malaisie', 'thailand', 'thailande', 'uae', 'united arab emirates', 'dubai', 'saudi arabia', 'qatar',
      'taiwan', 'hong kong', 'china', 'israel',
    ],
  },
  oceania: {
    triggers: ['oceania', 'oceanie', 'anz'],
    broadLabels: ['oceania', 'oceanie', 'apac', 'asia-pacific', 'anz'],
    countries: [
      'australia', 'australie', 'sydney', 'melbourne', 'brisbane', 'perth',
      'new zealand', 'nouvelle-zelande', 'auckland', 'wellington', 'fiji',
    ],
  },
};

const CLIENT_COUNTRY_ALIASES: Array<{ region: ClientRegionId; aliases: string[] }> = [
  { region: 'europe', aliases: ['france', 'paris', 'lyon', 'marseille', 'bordeaux', 'toulouse'] },
  { region: 'europe', aliases: ['germany', 'allemagne', 'deutschland', 'berlin', 'munich', 'frankfurt', 'hamburg'] },
  { region: 'europe', aliases: ['switzerland', 'suisse', 'zurich', 'geneva', 'geneve', 'basel', 'lausanne'] },
  { region: 'europe', aliases: ['united kingdom', 'royaume-uni', 'uk', 'london', 'londres', 'manchester', 'england', 'scotland'] },
  { region: 'europe', aliases: ['netherlands', 'pays-bas', 'holland', 'amsterdam', 'rotterdam'] },
  { region: 'europe', aliases: ['spain', 'espagne', 'madrid', 'barcelona'] },
  { region: 'europe', aliases: ['italy', 'italie', 'milan', 'rome'] },
  { region: 'europe', aliases: ['belgium', 'belgique', 'brussels', 'bruxelles'] },
  { region: 'europe', aliases: ['ireland', 'irlande', 'dublin'] },
  { region: 'europe', aliases: ['portugal', 'lisbon', 'lisbonne', 'porto'] },
  { region: 'north_america', aliases: ['united states', 'etats-unis', 'usa', 'us', 'new york', 'san francisco', 'austin', 'seattle', 'california'] },
  { region: 'north_america', aliases: ['canada', 'toronto', 'montreal', 'vancouver', 'ottawa', 'quebec'] },
  { region: 'caribbean', aliases: ['haiti', 'ayiti', 'port-au-prince', 'cap-haitien'] },
  { region: 'caribbean', aliases: ['dominican republic', 'republique dominicaine', 'santo domingo'] },
  { region: 'caribbean', aliases: ['jamaica', 'jamaique', 'kingston'] },
  { region: 'caribbean', aliases: ['trinidad', 'trinidad and tobago', 'barbados', 'barbade', 'bahamas', 'puerto rico', 'porto rico', 'guadeloupe', 'martinique', 'cuba'] },
  { region: 'latin_america', aliases: ['brazil', 'bresil', 'brasil', 'sao paulo', 'rio de janeiro'] },
  { region: 'latin_america', aliases: ['mexico', 'mexique', 'mexico city'] },
  { region: 'latin_america', aliases: ['colombia', 'colombie', 'bogota', 'medellin'] },
  { region: 'latin_america', aliases: ['argentina', 'argentine', 'buenos aires'] },
  { region: 'latin_america', aliases: ['chile', 'chili', 'santiago'] },
  { region: 'latin_america', aliases: ['peru', 'perou', 'lima'] },
  { region: 'latin_america', aliases: ['uruguay', 'costa rica', 'panama', 'ecuador', 'equateur', 'guatemala', 'paraguay', 'bolivia', 'bolivie'] },
  { region: 'africa', aliases: ['senegal', 'dakar'] },
  { region: 'africa', aliases: ['morocco', 'maroc', 'casablanca', 'rabat'] },
  { region: 'africa', aliases: ['tunisia', 'tunisie', 'tunis'] },
  { region: 'africa', aliases: ['algeria', 'algerie', 'algiers', 'alger'] },
  { region: 'africa', aliases: ['ivory coast', 'cote d ivoire', 'cote divoire', 'abidjan'] },
  { region: 'africa', aliases: ['south africa', 'afrique du sud', 'cape town', 'johannesburg'] },
  { region: 'africa', aliases: ['nigeria', 'lagos', 'abuja'] },
  { region: 'africa', aliases: ['kenya', 'nairobi'] },
  { region: 'africa', aliases: ['egypt', 'egypte', 'cairo', 'le caire'] },
  { region: 'africa', aliases: ['ghana', 'accra', 'cameroon', 'cameroun', 'rwanda', 'kigali', 'benin', 'togo', 'mauritius', 'madagascar', 'ethiopia'] },
  { region: 'asia', aliases: ['japan', 'japon', 'tokyo', 'osaka'] },
  { region: 'asia', aliases: ['singapore', 'singapour'] },
  { region: 'asia', aliases: ['india', 'inde', 'bengaluru', 'bangalore', 'mumbai', 'delhi'] },
  { region: 'asia', aliases: ['south korea', 'coree du sud', 'seoul'] },
  { region: 'asia', aliases: ['vietnam', 'philippines', 'manila', 'indonesia', 'indonesie', 'jakarta', 'malaysia', 'malaisie', 'thailand', 'thailande'] },
  { region: 'asia', aliases: ['uae', 'united arab emirates', 'emirats arabes unis', 'dubai', 'abu dhabi', 'qatar', 'saudi arabia', 'arabie saoudite', 'taiwan', 'hong kong'] },
  { region: 'oceania', aliases: ['australia', 'australie', 'sydney', 'melbourne', 'brisbane', 'perth'] },
  { region: 'oceania', aliases: ['new zealand', 'nouvelle-zelande', 'auckland', 'wellington', 'fiji'] },
];

function normGeo(v: string): string {
  return (v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function hasGeoBoundaryTerm(haystack: string, rawTerm: string): boolean {
  const term = normGeo(rawTerm);
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(haystack);
}

function isClientWorldwideRemote(job: JobListing): boolean {
  if (job.workMode !== 'Remote') return false;
  const norm = normGeo(job.country).replace(/[,/|()_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    !norm ||
    ['anywhere', 'worldwide', 'global', 'international', 'everywhere', 'remote', 'remote worldwide', 'global remote', 'anywhere in the world', 'work from anywhere'].includes(norm)
  ) {
    return true;
  }
  return (
    /\b(worldwide|anywhere|everywhere|work from anywhere)\b/.test(norm) &&
    !/\b(only|except|excluding|us|usa|uk|eu|europe|emea|latam|apac|canada|germany|france)\b/.test(norm)
  );
}

function hasClientBroadRegionLabel(locHay: string, regionId: ClientRegionId, rawLabel: string): boolean {
  const lbl = normGeo(rawLabel);
  if (!hasGeoBoundaryTerm(locHay, lbl)) return false;
  if (lbl === 'africa') {
    const withoutSouthAfrica = locHay.replace(/\bsouth\s+africa\b/g, ' ');
    if (!hasGeoBoundaryTerm(withoutSouthAfrica, 'africa')) return false;
  }
  if (
    lbl === 'emea' &&
    regionId === 'africa' &&
    /\b(european timezones|eu only|germany|uk|united kingdom|ireland|france|spain|poland|netherlands|switzerland|italy)\b/.test(
      locHay
    )
  ) {
    return false;
  }
  return true;
}

function matchesClientGeography(job: JobListing, countryInput: string): boolean {
  const raw = normGeo(countryInput);
  if (!raw || raw === 'monde' || raw === 'worldwide' || raw === 'global') return true;
  const locHay = normGeo(`${job.country} ${job.city}`);

  for (const [regionId, def] of Object.entries(CLIENT_REGION_DEFS) as Array<
    [ClientRegionId, { triggers: string[]; broadLabels: string[]; countries: string[] }]
  >) {
    if (def.triggers.includes(raw)) {
      if (def.countries.some((c) => hasGeoBoundaryTerm(locHay, c))) return true;
      if (def.broadLabels.some((lbl) => hasClientBroadRegionLabel(locHay, regionId, lbl))) return true;
      return isClientWorldwideRemote(job);
    }
  }

  const matchedCountry = CLIENT_COUNTRY_ALIASES.find((entry) => entry.aliases.includes(raw));
  if (matchedCountry) {
    if (matchedCountry.aliases.some((alias) => hasGeoBoundaryTerm(locHay, alias))) return true;
    const regionDef = CLIENT_REGION_DEFS[matchedCountry.region];
    if (regionDef.broadLabels.some((lbl) => hasClientBroadRegionLabel(locHay, matchedCountry.region, lbl))) {
      return true;
    }
    return isClientWorldwideRemote(job);
  }

  if (hasGeoBoundaryTerm(locHay, raw)) return true;
  return isClientWorldwideRemote(job);
}

function isLiveApiFeedJob(job: JobListing): boolean {
  return (
    job.id.startsWith('ats_') ||
    job.id.startsWith('arbeitnow-') ||
    job.id.startsWith('remotive-') ||
    job.id.startsWith('themuse-') ||
    job.id.startsWith('feed_jobicy_') ||
    job.id.startsWith('feed_himalayas_') ||
    /arbeitnow|remotive|the muse|jobicy|himalayas|greenhouse|lever|ashby|workday|smartrecruiters|official ats/i.test(job.sourceName)
  );
}

export function GlobalJobSearch({
  lang,
  jobs,
  onJobsUpdate,
  profile,
  trackedKeys,
  onTrackJob,
  onVerifyJob,
  onTailorCvForJob,
  onAnalyzeAtsForJob,
  onOpenMatchForJob,
  onOpenCompanyIntel,
  onOpenApplyModal,
  initialQuery = '',
  initialCountry = '',
  externalSearchTrigger,
}: GlobalJobSearchProps) {
  const tr = t(lang);
  const [bannerError, setBannerError] = useState(false);

  // All 16 required filter dimensions + source filter
  const [query, setQuery] = useState(initialQuery);
  const [country, setCountry] = useState(initialCountry);
  const [city, setCity] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [contractType, setContractType] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [degree, setDegree] = useState('');
  const [skills, setSkills] = useState('');
  const [languages, setLanguages] = useState('');
  const [minSalary, setMinSalary] = useState('');
  const [company, setCompany] = useState('');
  const [datePosted, setDatePosted] = useState('');
  const [sourceFilter, setSourceFilter] = useState<JobFeedSource>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMap, setShowMap] = useState(true);

  const [selectedId, setSelectedId] = useState<string>(jobs[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const [feedProviders, setFeedProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchSummary, setSearchSummary] = useState<string | null>(null);
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);

  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    if (externalSearchTrigger > 0) {
      setQuery(initialQuery);
      setCountry(initialCountry);
    }
  }, [externalSearchTrigger, initialQuery, initialCountry]);

  // Automatically fetch real live job feeds + verified ATS jobs when no jobs are loaded yet
  useEffect(() => {
    if (autoLoaded || jobs.length > 0) return;
    setAutoLoaded(true);
    let active = true;
    setFeedsLoading(true);
    fetchLiveJobFeeds({ query: initialQuery, country: initialCountry })
      .then((res) => {
        if (!active) return;
        setFeedProviders(res.activeProviders || []);
        if (res.jobs.length > 0) {
          onJobsUpdate(res.jobs);
          setSelectedId(res.jobs[0].id);
        }
      })
      .catch(() => {
        // non-blocking; user can retry via button
      })
      .finally(() => {
        if (active) setFeedsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [autoLoaded, jobs.length, initialQuery, initialCountry, onJobsUpdate]);

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ctry = country.trim().toLowerCase();
    const cty = city.trim().toLowerCase();
    const comp = company.trim().toLowerCase();
    const deg = degree.trim().toLowerCase();
    const skl = skills.trim().toLowerCase();
    const lng = languages.trim().toLowerCase();
    const minSalNum = Number(minSalary.replace(/[^0-9]/g, '')) || 0;

    return jobs.filter((job) => {
      if (sourceFilter === 'employer_portal' && !job.isEmployerDirect) return false;
      if (sourceFilter === 'live_feeds' && !isLiveApiFeedJob(job)) return false;
      if (sourceFilter === 'ai_search' && (job.isEmployerDirect || isLiveApiFeedJob(job))) {
        return false;
      }
      if (
        q &&
        !`${job.title} ${job.company} ${job.description} ${job.skills.join(' ')}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (ctry && !matchesClientGeography(job, country)) return false;
      if (cty && !normGeo(job.city).includes(normGeo(city))) return false;
      if (workMode && job.workMode !== workMode) return false;
      if (contractType && job.contractType !== contractType) return false;
      if (
        experienceLevel &&
        !job.experienceLevel.toLowerCase().includes(experienceLevel.toLowerCase())
      ) {
        return false;
      }
      if (deg && !job.degreeRequired.toLowerCase().includes(deg)) return false;
      if (skl && !job.skills.some((s) => s.toLowerCase().includes(skl))) return false;
      if (lng && !job.languages.some((l) => l.toLowerCase().includes(lng))) return false;
      if (comp && !job.company.toLowerCase().includes(comp)) return false;
      if (minSalNum > 0 && job.salaryMinAnnualUsd && job.salaryMinAnnualUsd < minSalNum) {
        return false;
      }
      if (datePosted) {
        const diffDays =
          (Date.now() - new Date(job.publishedDate).getTime()) / (1000 * 60 * 60 * 24);
        if (datePosted === '24h' && diffDays > 2) return false;
        if (datePosted === '7d' && diffDays > 7) return false;
        if (datePosted === '30d' && diffDays > 30) return false;
      }
      return true;
    });
  }, [
    jobs,
    query,
    country,
    city,
    workMode,
    contractType,
    experienceLevel,
    degree,
    skills,
    languages,
    minSalary,
    company,
    datePosted,
    sourceFilter,
  ]);

  const selectedJob =
    filteredJobs.find((j) => j.id === selectedId) ?? filteredJobs[0] ?? null;

  const handleResetFilters = () => {
    setQuery('');
    setCountry('');
    setCity('');
    setWorkMode('');
    setContractType('');
    setExperienceLevel('');
    setDegree('');
    setSkills('');
    setLanguages('');
    setMinSalary('');
    setCompany('');
    setDatePosted('');
    setSourceFilter('all');
  };

  const handleLiveAiSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await searchGlobalJobs({
        query: query || profile.currentTitle,
        country,
        city,
        workMode,
        contractType,
        experienceLevel,
        degree,
        skills,
        languages,
        minSalary,
        company,
        datePosted,
        lang,
      });
      if (result.jobs.length > 0) {
        const existingFeedIds = new Set(result.jobs.map((j) => j.id));
        const keptLiveFeeds = jobs.filter((j) => isLiveApiFeedJob(j) && !existingFeedIds.has(j.id));
        onJobsUpdate([...result.jobs, ...keptLiveFeeds]);
        setSelectedId(result.jobs[0].id);
      }
      setSearchSummary(result.searchSummary || null);
      setGroundingSources(result.groundingSources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error running global job search.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadLiveFeeds = async (overrideCountry?: string) => {
    const targetCountry = overrideCountry !== undefined ? overrideCountry : country;
    setFeedsLoading(true);
    setError(null);
    try {
      const res = await fetchLiveJobFeeds({
        query,
        country: targetCountry,
        city,
        workMode,
        contractType,
      });
      setFeedProviders(res.activeProviders || []);
      if (res.jobs.length > 0) {
        const incomingIds = new Set(res.jobs.map((j) => j.id));
        const retained = jobs.filter((j) => !incomingIds.has(j.id));
        onJobsUpdate([...res.jobs, ...retained]);
        setSelectedId(res.jobs[0].id);
        setSourceFilter('all');
      } else {
        setError(
          L(
            lang,
            'Aucune offre directe retournée pour ces filtres. Essayez une requête plus large ou lancez la Recherche IA.',
            'No live API feed listings returned for these filters. Try broadening your query or run Live AI Search.'
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching live public job feeds.');
    } finally {
      setFeedsLoading(false);
    }
  };

  const handleSelectRegion = (regionQuery: string) => {
    setCountry(regionQuery);
    setCity('');
    void handleLoadLiveFeeds(regionQuery);
  };

  const handleSearchByGeoLocation = async (loc: { country: string; city: string }) => {
    setCountry(loc.country);
    setCity(loc.city);
    setLoading(true);
    setError(null);
    try {
      const result = await searchGlobalJobs({
        query: query || profile.currentTitle,
        country: loc.country,
        city: loc.city,
        workMode,
        contractType,
        experienceLevel,
        degree,
        skills,
        languages,
        minSalary,
        company,
        datePosted,
        lang,
      });
      if (result.jobs.length > 0) {
        const existingFeedIds = new Set(result.jobs.map((j) => j.id));
        const keptLiveFeeds = jobs.filter((j) => isLiveApiFeedJob(j) && !existingFeedIds.has(j.id));
        onJobsUpdate([...result.jobs, ...keptLiveFeeds]);
        setSelectedId(result.jobs[0].id);
      }
      setSearchSummary(result.searchSummary || null);
      setGroundingSources(result.groundingSources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error running geographic job search.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Editorial Global Search Banner — Deep Navy #06132F */}
      <section className="relative rounded-xl overflow-hidden border border-jf-dark bg-jf-navy">
        {!bannerError ? (
          <img
            src={GLOBAL_BANNER_URL}
            alt="International business district"
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-luminosity"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-jf-navy via-jf-dark to-jf-navy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#06132F]/95 via-[#06132F]/88 to-[#102B52]/80" />

        <div className="relative p-6 sm:p-8 space-y-5">
          <div className="max-w-3xl space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {L(
                lang,
                'Moteur mondial de recherche et de vérification d’emplois',
                'Global Job Search & Offer Intelligence Engine'
              )}
            </h1>
            <p className="text-sm text-jf-sky leading-relaxed">
              {tr.slogan}
            </p>
          </div>

          <form
            onSubmit={handleLiveAiSearch}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-white p-2 rounded-lg border border-jf-border"
          >
            <div className="md:col-span-5 flex items-center gap-2 px-3 py-1.5">
              <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L(
                  lang,
                  'Poste, compétence ou mot-clé (ex. Product Manager, IA, Finance)',
                  'Role, skill, or keyword (e.g. Product Manager, AI, Finance)'
                )}
                className="w-full text-sm text-jf-navy placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            <div className="md:col-span-3 flex items-center gap-2 px-3 py-1.5 md:border-l border-jf-border">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder={L(
                  lang,
                  'Pays ou région (Haïti, Canada, France, Brésil, Japon, Australie…)',
                  'Country or region (Haiti, Canada, France, Brazil, Japan, Australia…)'
                )}
                className="w-full text-sm text-jf-navy placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2 flex items-center px-3 py-1.5 md:border-l border-jf-border">
              <select
                value={workMode}
                onChange={(e) => setWorkMode(e.target.value)}
                aria-label="Work mode"
                className="w-full text-sm text-jf-dark bg-transparent focus:outline-none"
              >
                <option value="">{L(lang, 'Tous modes', 'Any mode')}</option>
                <option value="Remote">{L(lang, 'À distance', 'Remote')}</option>
                <option value="Hybrid">{L(lang, 'Hybride', 'Hybrid')}</option>
                <option value="On-site">{L(lang, 'Sur site', 'On-site')}</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-full min-h-10 px-4 py-2 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-60 rounded-md transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{L(lang, 'Recherche IA', 'Live AI Search')}</span>
              </button>
            </div>
          </form>

          {/* Compact Filter & Live API Feeds Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-jf-soft">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1.5 text-white font-medium hover:text-jf-sky transition-colors whitespace-nowrap"
              >
                <Filter className="w-3.5 h-3.5 text-jf-sky" aria-hidden="true" />
                <span>
                  {showAdvanced
                    ? L(lang, 'Masquer les 16 filtres avancés', 'Hide 16 advanced filters')
                    : L(
                        lang,
                        'Afficher les 16 filtres avancés (contrat, diplôme, salaire, langues…)',
                        'Show all 16 advanced filters (contract, degree, salary, languages…)'
                      )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleLoadLiveFeeds()}
                disabled={feedsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-jf-dark hover:bg-jf-blue border border-jf-sky/30 text-white font-medium transition-colors whitespace-nowrap disabled:opacity-60"
              >
                {feedsLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-jf-sky" />
                ) : (
                  <Rss className="w-3.5 h-3.5 text-jf-sky" />
                )}
                <span>{tr.common.liveFeeds} (ATS · Jobicy · Himalayas · Remotive · Arbeitnow · Muse)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowMap((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md border font-medium transition-colors whitespace-nowrap ${
                  showMap
                    ? 'bg-jf-blue border-jf-sky/50 text-white'
                    : 'bg-jf-dark hover:bg-jf-blue border-jf-sky/30 text-white'
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-jf-sky" />
                <span>
                  {showMap
                    ? L(lang, 'Masquer la carte (OSM)', 'Hide Map (OSM)')
                    : L(lang, 'Carte des opportunités (OSM)', 'Opportunities Map (OSM)')}
                </span>
              </button>

              <button
                type="button"
                onClick={handleResetFilters}
                className="text-jf-sky/80 hover:text-white transition-colors whitespace-nowrap"
              >
                {tr.common.reset}
              </button>
            </div>
            <span className="font-mono tabular-nums text-jf-sky">
              {filteredJobs.length} {L(lang, 'résultats affichés', 'results shown')}
            </span>
          </div>

          {/* 7-Continent International Quick Filter Strip */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10">
            <span className="text-[11px] font-medium text-jf-sky/80 mr-1">
              {L(lang, 'Zones internationales :', 'Global regions:')}
            </span>
            {GLOBAL_REGIONS.map((reg) => {
              const isActive =
                (reg.queryValue === '' && !country.trim()) ||
                normGeo(country) === normGeo(reg.queryValue);
              return (
                <button
                  key={reg.id}
                  type="button"
                  onClick={() => handleSelectRegion(reg.queryValue)}
                  disabled={feedsLoading}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-jf-sky text-jf-navy border-jf-sky font-semibold'
                      : 'bg-jf-dark/70 text-jf-soft border-jf-sky/25 hover:bg-jf-blue hover:text-white'
                  }`}
                >
                  {lang === 'fr' ? reg.labelFr : reg.labelEn}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Source Segmentation Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-jf-border rounded-lg">
          {(
            [
              { id: 'all', label: tr.common.all },
              { id: 'live_feeds', label: tr.common.liveFeeds },
              { id: 'ai_search', label: tr.common.aiWebSearch },
              { id: 'employer_portal', label: tr.common.employerPortal },
            ] as Array<{ id: JobFeedSource; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSourceFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sourceFilter === tab.id
                  ? 'bg-jf-navy text-white'
                  : 'text-jf-dark hover:bg-jf-ice'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {feedProviders.length > 0 && (
          <div className="text-xs text-slate-600 font-mono">
            {tr.common.liveFeeds}: {feedProviders.join(' · ')}
          </div>
        )}
      </div>

      {/* Interactive Free OpenStreetMap + Leaflet Opportunities Map */}
      {showMap && (
        <CareerLocationMapHub
          lang={lang}
          defaultCountry={country}
          defaultCity={city}
          jobs={filteredJobs}
          compact
          onSelectLocation={({ country: selectedCtry, city: selectedCty }) => {
            if (selectedCtry) setCountry(selectedCtry);
            if (selectedCty) setCity(selectedCty);
          }}
          onSearchOpportunities={(loc) => void handleSearchByGeoLocation(loc)}
          onSelectJob={(jobId) => setSelectedId(jobId)}
        />
      )}

      {/* Complete 16-Filter Matrix */}
      {showAdvanced && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Ville' : 'City'}
              </span>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Paris, Zurich, Berlin…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Type de contrat' : 'Contract Type'}
              </span>
              <select
                value={contractType}
                onChange={(e) => setContractType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="">{tr.common.all}</option>
                <option value="Full-time">{lang === 'fr' ? 'Temps plein' : 'Full-time'}</option>
                <option value="Part-time">{lang === 'fr' ? 'Temps partiel' : 'Part-time'}</option>
                <option value="Contract">{lang === 'fr' ? 'Contrat / Mission' : 'Contract'}</option>
                <option value="Internship">{lang === 'fr' ? 'Stage' : 'Internship'}</option>
                <option value="Freelance">Freelance</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Niveau d’expérience' : 'Experience Level'}
              </span>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="">{tr.common.all}</option>
                <option value="Junior">Junior</option>
                <option value="Mid-level">{lang === 'fr' ? 'Intermédiaire' : 'Mid-level'}</option>
                <option value="Senior">Senior</option>
                <option value="Lead">Lead / Executive</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Diplôme requis' : 'Degree Required'}
              </span>
              <input
                type="text"
                value={degree}
                onChange={(e) => setDegree(e.target.value)}
                placeholder="Master, Bachelor, PhD…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Compétences' : 'Skills'}
              </span>
              <input
                type="text"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="SQL, Python, API, SaaS…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Langues' : 'Languages'}
              </span>
              <input
                type="text"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                placeholder="Français, Anglais, Allemand…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Salaire minimum (USD/an équiv.)' : 'Minimum Salary (Annual USD eq.)'}
              </span>
              <input
                type="number"
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
                placeholder="70000"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Entreprise' : 'Company'}
              </span>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Qonto, ABB, Celonis…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Date de publication' : 'Date Posted'}
              </span>
              <select
                value={datePosted}
                onChange={(e) => setDatePosted(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="">{lang === 'fr' ? 'Toutes dates' : 'Any time'}</option>
                <option value="24h">{lang === 'fr' ? 'Dernières 48h' : 'Last 48h'}</option>
                <option value="7d">{lang === 'fr' ? '7 derniers jours' : 'Last 7 days'}</option>
                <option value="30d">{lang === 'fr' ? '30 derniers jours' : 'Last 30 days'}</option>
              </select>
            </label>
          </div>
        </section>
      )}

      {error && (
        <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
          {error}
        </div>
      )}

      {searchSummary && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
          <p className="text-sm text-slate-700">{searchSummary}</p>
          {groundingSources.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1">
              <span className="font-medium text-jf-navy">{tr.common.groundingSources}:</span>
              {groundingSources.slice(0, 6).map((src) => {
                const safeHref = safeExternalUrl(src.uri);
                if (!safeHref) return null;
                return (
                  <a
                    key={src.uri}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-jf-blue hover:underline inline-flex items-center gap-1"
                  >
                    <span className="truncate max-w-xs">{src.title}</span>
                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Results Split View */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left List */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {loading ? (
            <div className="p-6 space-y-5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2.5 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-3 bg-slate-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-800">
                {lang === 'fr'
                  ? 'Aucune offre locale ne correspond à ces critères.'
                  : 'No cached listings match these filters.'}
              </p>
              <p className="text-xs text-slate-500">
                {lang === 'fr'
                  ? 'Lancez une recherche IA en direct pour explorer les offres mondiales actuelles sur le web.'
                  : 'Run a live AI search to retrieve current global job openings from the web.'}
              </p>
              <button
                type="button"
                onClick={() => handleLiveAiSearch()}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
              >
                {lang === 'fr' ? 'Lancer une recherche IA en direct' : 'Run Live Global AI Search'}
              </button>
            </div>
          ) : (
            filteredJobs.map((job) => {
              const isSelected = selectedJob?.id === job.id;
              const match = computeBaselineMatch(profile, job);
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                  className={`w-full text-left p-5 transition-colors block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 ${
                    isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                        {job.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
                        <span className="font-medium text-slate-800">{job.company}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {job.city}, {job.country}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-xs font-semibold tabular-nums text-blue-700">
                        {match.score}% {lang === 'fr' ? 'fit' : 'fit'}
                      </div>
                    </div>
                  </div>

                  {/* Unboxed typographic metadata */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{job.workMode}</span>
                    <span aria-hidden="true">·</span>
                    <span>{job.contractType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-700">{job.salaryRange}</span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <VerificationStatusText status={job.verificationStatus} lang={lang} />
                    <span className="font-mono tabular-nums">
                      {job.sourceName} · {job.publishedDate}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right Detail Panel */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {selectedJob ? (
            (() => {
              const baseline = computeBaselineMatch(profile, selectedJob);
              const isTracked = trackedKeys.has(
                `${selectedJob.company.toLowerCase()}::${selectedJob.title.toLowerCase()}`
              );
              return (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-slate-200">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <VerificationStatusText
                          status={selectedJob.verificationStatus}
                          lang={lang}
                        />
                        <span aria-hidden="true">·</span>
                        <span>
                          {tr.common.source}: {selectedJob.sourceName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {tr.common.published} {selectedJob.publishedDate}
                        </span>
                      </div>
                      <h2 className="font-display text-2xl font-semibold text-slate-900">
                        {selectedJob.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-600">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCompanyIntel(selectedJob.company, selectedJob.country)
                          }
                          className="inline-flex items-center gap-1.5 font-semibold text-jf-navy hover:text-jf-blue transition-colors underline decoration-jf-sky underline-offset-4"
                        >
                          <Building2 className="w-4 h-4 text-jf-blue" aria-hidden="true" />
                          <span>{selectedJob.company}</span>
                        </button>
                        <span aria-hidden="true">·</span>
                        <span>
                          {selectedJob.city}, {selectedJob.country}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedJob.workMode}</span>
                        <span aria-hidden="true">·</span>
                        <span>{selectedJob.contractType}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onTrackJob(selectedJob)}
                        className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                          isTracked
                            ? 'bg-jf-soft border-jf-sky text-jf-navy font-semibold'
                            : 'bg-white border-jf-border text-jf-dark hover:bg-jf-ice'
                        }`}
                      >
                        {isTracked ? (
                          <BookmarkCheck className="w-4 h-4" />
                        ) : (
                          <BookmarkPlus className="w-4 h-4" />
                        )}
                        <span>{isTracked ? tr.common.savedInTracker : tr.common.saveToTracker}</span>
                      </button>
                      {onOpenApplyModal && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenApplyModal({
                              companyId: selectedJob.companyId,
                              companyName: selectedJob.company,
                              roleTitle: selectedJob.title,
                              location: [selectedJob.city, selectedJob.country]
                                .filter(Boolean)
                                .join(', '),
                              opportunityType: 'published_job',
                              classification: 'confirmed_job',
                              officialUrl: selectedJob.sourceUrl,
                              sourceName: selectedJob.sourceName,
                              publishedDate: selectedJob.publishedDate,
                              applicationDeadline: selectedJob.applicationDeadline,
                              salaryRange: selectedJob.salaryRange,
                              description: selectedJob.description,
                              inferredSkills: selectedJob.skills,
                              isEmployerDirect: selectedJob.isEmployerDirect,
                              recruiterId: selectedJob.recruiterId,
                            })
                          }
                          className="px-4 py-2 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{lang === 'fr' ? 'Postuler' : 'Apply Now'}</span>
                        </button>
                      )}
                      {(() => {
                        const safeSourceHref = safeExternalUrl(selectedJob.sourceUrl);
                        if (!safeSourceHref) return null;
                        return (
                          <a
                            href={safeSourceHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3.5 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <span>{tr.common.openSource}</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Structured Facts Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-slate-200 text-sm">
                    <div>
                      <div className="text-xs text-slate-500">
                        {lang === 'fr' ? 'Rémunération' : 'Compensation'}
                      </div>
                      <div className="mt-1 font-mono font-medium tabular-nums text-slate-900">
                        {selectedJob.salaryRange}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        {lang === 'fr' ? 'Expérience' : 'Experience'}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedJob.experienceLevel}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        {lang === 'fr' ? 'Diplôme' : 'Education'}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedJob.degreeRequired}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        {selectedJob.applicationDeadline
                          ? lang === 'fr'
                            ? 'Date limite / Visa'
                            : 'Deadline / Visa'
                          : lang === 'fr'
                            ? 'Sponsoring Visa'
                            : 'Visa Sponsorship'}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedJob.applicationDeadline ? (
                          <span className="font-mono text-xs text-jf-blue mr-1.5">
                            {selectedJob.applicationDeadline.slice(0, 10)} ·
                          </span>
                        ) : null}
                        {selectedJob.visaSponsorship || 'Not specified'}
                      </div>
                    </div>
                  </div>

                  {/* Description & Verification Summary */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
                        {lang === 'fr' ? 'Synthèse du poste' : 'Role Overview'}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {selectedJob.description}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">
                          {lang === 'fr' ? 'Compétences clés' : 'Key Skills'}
                        </div>
                        <p className="text-sm text-slate-800">
                          {selectedJob.skills.join(' · ')}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">
                          {lang === 'fr' ? 'Langues & Recrutement' : 'Languages & Hiring Team'}
                        </div>
                        <p className="text-sm text-slate-800">
                          {selectedJob.languages.join(' · ')}
                          {selectedJob.recruiterHint ? ` — ${selectedJob.recruiterHint}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 space-y-1.5">
                      <div className="text-xs font-semibold text-slate-700">
                        {lang === 'fr' ? 'Note de vérification d’authenticité' : 'Authenticity Assessment'}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {selectedJob.verificationSummary}
                      </p>
                    </div>

                    {/* Explainable 9-Criteria Compatibility Preview */}
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-slate-700">
                            {lang === 'fr'
                              ? 'Compatibilité indicative sur 9 critères officiels'
                              : 'Indicative 9-Criteria Profile Compatibility'}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                            <span className="font-mono font-semibold tabular-nums text-blue-700">
                              {baseline.score} / 100
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {lang === 'fr' ? 'Compétences' : 'Skills'}:{' '}
                              <span className="font-mono tabular-nums">{baseline.skillsRatio}</span>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {baseline.locationAligned
                                ? lang === 'fr'
                                  ? 'Zone géographique alignée'
                                  : 'Location aligned'
                                : lang === 'fr'
                                  ? 'Mobilité internationale requise'
                                  : 'Relocation required'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenMatchForJob(selectedJob)}
                          className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span>
                            {lang === 'fr' ? 'Audit IA 9 critères' : '9-Criteria AI Audit'}
                          </span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] font-mono tabular-nums">
                        {[
                          [lang === 'fr' ? '1. Compétences' : '1. Skills', baseline.breakdown.skills],
                          [lang === 'fr' ? '2. Expérience' : '2. Experience', baseline.breakdown.experience],
                          [lang === 'fr' ? '3. Formation' : '3. Education', baseline.breakdown.education],
                          [lang === 'fr' ? '4. Langues' : '4. Languages', baseline.breakdown.languages],
                          [lang === 'fr' ? '5. Localisation' : '5. Location', baseline.breakdown.locationAndMobility],
                          [lang === 'fr' ? '6. Autorisation / Visa' : '6. Work Auth', baseline.breakdown.workAuthorization],
                          [lang === 'fr' ? '7. Disponibilité' : '7. Availability', baseline.breakdown.availability],
                          [lang === 'fr' ? '8. Salaire' : '8. Salary', baseline.breakdown.salary],
                          [lang === 'fr' ? '9. Fiabilité source' : '9. Source Rel.', baseline.breakdown.sourceReliability],
                        ].map(([lbl, val]) => (
                          <div
                            key={String(lbl)}
                            className="px-2 py-1 rounded bg-jf-ice border border-jf-border flex items-center justify-between gap-1"
                          >
                            <span className="font-sans text-slate-600 truncate">{lbl}</span>
                            <span className="font-semibold text-jf-navy">{val}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Cross-module Action Strip */}
                  <div className="pt-6 border-t border-jf-border flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCompanyIntel(selectedJob.company, selectedJob.country)
                      }
                      className="px-3.5 py-2 text-xs font-medium text-jf-navy bg-jf-soft hover:bg-jf-sky/40 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Building2 className="w-3.5 h-3.5 text-jf-blue" />
                      <span>{tr.common.companyIntel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onVerifyJob(selectedJob)}
                      className="px-3.5 py-2 text-xs font-medium text-jf-dark bg-jf-ice hover:bg-jf-soft rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-jf-blue" />
                      <span>{tr.common.verifyOffer}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onTailorCvForJob(selectedJob)}
                      className="px-3.5 py-2 text-xs font-medium text-jf-dark bg-jf-ice hover:bg-jf-soft rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <FileText className="w-3.5 h-3.5 text-jf-blue" />
                      <span>{tr.common.tailorCv}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAnalyzeAtsForJob(selectedJob)}
                      className="px-3.5 py-2 text-xs font-medium text-jf-dark bg-jf-ice hover:bg-jf-soft rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <FileCheck2 className="w-3.5 h-3.5 text-jf-blue" />
                      <span>{tr.common.runAts}</span>
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="py-16 text-center text-sm text-slate-500">
              {lang === 'fr'
                ? 'Sélectionnez une offre pour afficher son analyse complète.'
                : 'Select an opportunity to view its complete intelligence brief.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
