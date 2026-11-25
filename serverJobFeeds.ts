import { isSourceEnabled, recordSourceCall } from './serverEngineDb.ts';
import { clampStr, sanitizeHttpUrl } from './serverSecurity.ts';

export interface NormalizedFeedJob {
  id: string;
  title: string;
  company: string;
  country: string;
  city: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  contractType: 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Freelance';
  experienceLevel: string;
  degreeRequired: string;
  salaryRange: string;
  languages: string[];
  skills: string[];
  publishedDate: string;
  sourceName: string;
  sourceUrl: string;
  verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  verificationSummary: string;
  description: string;
  recruiterHint?: string;
  visaSponsorship?: string;
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

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JOB-FONDS-Platform/1.0',
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
  const params = new URLSearchParams({ limit: '30' });
  if (queryText) params.set('search', queryText);
  const data = await fetchJsonWithTimeout(`https://remotive.com/api/remote-jobs?${params.toString()}`);
  if (!Array.isArray(data?.jobs)) {
    recordSourceCall('remotive_api', false, 'Empty or unreachable response');
    return [];
  }
  recordSourceCall('remotive_api', true);
  return data.jobs.slice(0, 30).map((item: any, idx: number) => {
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
  return data.results.slice(0, 20).map((item: any, idx: number) => {
    const locName = String(item.locations?.[0]?.name || 'International');
    const isRemote = /remote|flexible/i.test(locName);
    const parts = locName.split(',').map((s: string) => s.trim()).filter(Boolean);
    const city = isRemote ? 'Remote' : parts[0] || 'Global';
    const country = isRemote
      ? 'Global / US & Europe'
      : parts.length > 1
        ? parts[parts.length - 1]
        : 'United States / International';
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

export async function fetchAggregatedLiveJobFeeds(filters: {
  query?: string;
  country?: string;
  city?: string;
  workMode?: string;
  contractType?: string;
}): Promise<{ jobs: NormalizedFeedJob[]; activeProviders: string[] }> {
  const q = clampStr(filters.query, 120).toLowerCase();
  const ctryTokens = clampStr(filters.country, 120)
    .toLowerCase()
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cty = clampStr(filters.city, 80).toLowerCase();
  const mode = clampStr(filters.workMode, 30);
  const contract = clampStr(filters.contractType, 30);

  const [arbeitnow, remotive, muse] = await Promise.all([
    fetchArbeitnowJobs(),
    fetchRemotiveJobs(q),
    fetchMuseJobs(),
  ]);

  const activeProviders: string[] = [];
  if (arbeitnow.length) activeProviders.push('Arbeitnow');
  if (remotive.length) activeProviders.push('Remotive');
  if (muse.length) activeProviders.push('The Muse');

  const combined = [...remotive, ...arbeitnow, ...muse];
  const seenSemantic = new Set<string>();
  const filtered = combined.filter((job) => {
    const semKey = `${job.company.toLowerCase().trim()}::${job.title.toLowerCase().trim()}::${job.city.toLowerCase().trim()}`;
    if (seenSemantic.has(semKey)) return false;
    seenSemantic.add(semKey);

    if (
      q &&
      !`${job.title} ${job.company} ${job.description} ${job.skills.join(' ')}`
        .toLowerCase()
        .includes(q)
    ) {
      return false;
    }
    if (
      ctryTokens.length > 0 &&
      !ctryTokens.some((tok) => `${job.country} ${job.city}`.toLowerCase().includes(tok))
    ) {
      return false;
    }
    if (cty && !`${job.city} ${job.country}`.toLowerCase().includes(cty)) return false;
    if (mode && job.workMode !== mode) return false;
    if (contract && job.contractType !== contract) return false;
    return true;
  });

  filtered.sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
  return {
    jobs: filtered.slice(0, 40),
    activeProviders,
  };
}

