import crypto from 'crypto';
import {
  type AtsProvider,
  type CompanyRecord,
  detectAtsFromCareersUrl,
  getCompanyById,
  getEngineDb,
  isSourceEnabled,
  recordCompanySignal,
  recordSourceCall,
  updateCompanyMonitored,
} from './serverEngineDb.ts';
import { clampStr, isSafePublicHttpUrl, sanitizeHttpUrl } from './serverSecurity.ts';

export interface NormalizedCareerJob {
  externalId: string;
  title: string;
  department: string;
  location: string;
  country: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  contractType: string;
  skills: string[];
  url: string;
  atsSource: string;
  contentHash: string;
  applicationDeadline?: string;
}

export interface CareerMonitorResult {
  companyId: string;
  companyName: string;
  atsProvider: AtsProvider;
  fetchedCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  activeCount: number;
  extractedSkills: string[];
  checkedAt: string;
  warning?: string;
}

const KNOWN_SKILLS = [
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift', 'C++', 'C#', 'Ruby', 'PHP', 'SQL',
  'React', 'Next.js', 'Vue', 'Angular', 'Node.js', 'GraphQL', 'REST', 'Docker', 'Kubernetes', 'Terraform',
  'AWS', 'GCP', 'Azure', 'PostgreSQL', 'MongoDB', 'Redis', 'Kafka', 'Spark', 'Snowflake', 'dbt', 'Airflow',
  'Machine Learning', 'Deep Learning', 'NLP', 'LLM', 'PyTorch', 'TensorFlow', 'Data Engineering', 'Analytics',
  'Product Management', 'Product Design', 'Figma', 'UX', 'UI', 'DevOps', 'SRE', 'Cybersecurity', 'ISO 27001',
  'SOC 2', 'Salesforce', 'HubSpot', 'B2B Sales', 'Enterprise Sales', 'Account Executive', 'Customer Success',
  'Finance', 'FP&A', 'Accounting', 'Compliance', 'Legal', 'GDPR', 'HR', 'Talent Acquisition', 'Recruiting',
  'Supply Chain', 'Operations', 'Marketing', 'SEO', 'Growth', 'SAP', 'ERP', 'Embedded', 'Robotics',
];

export function extractSkillsFromText(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i');
    if (regex.test(lower)) {
      found.push(skill);
    }
  }
  return found.slice(0, 15);
}

function inferWorkMode(location: string, title: string): 'Remote' | 'Hybrid' | 'On-site' {
  const combined = `${location} ${title}`.toLowerCase();
  if (/\b(remote|télétravail|teletravail|anywhere|distributed)\b/.test(combined)) return 'Remote';
  if (/\b(hybrid|hybride)\b/.test(combined)) return 'Hybrid';
  return 'On-site';
}

function inferCountryFromLocation(location: string, fallbackCountry: string): string {
  const loc = (location || '').trim();
  if (!loc) return fallbackCountry || 'International';
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return clampStr(parts[parts.length - 1], 80);
  }
  if (/remote/i.test(loc)) return fallbackCountry || 'Remote / Global';
  return clampStr(fallbackCountry || loc, 80);
}

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeJobHash(job: {
  title: string;
  department: string;
  location: string;
  workMode: string;
  url: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${job.title}|${job.department}|${job.location}|${job.workMode}|${job.url}`)
    .digest('hex')
    .slice(0, 24);
}

async function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<Response> {
  if (!isSafePublicHttpUrl(url)) {
    throw new Error(`Blocked unsafe URL: ${url}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'JOBFOUNDS-CareerMonitor/1.0 (+https://jobfounds.com; respectful-public-ats)',
        Accept: 'application/json, text/html;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGreenhouseJobs(
  token: string,
  fallbackCountry: string
): Promise<NormalizedCareerJob[]> {
  if (!isSourceEnabled('greenhouse_api')) {
    throw new Error('Source greenhouse_api is paused or rate-limited by administrator.');
  }
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      recordSourceCall('greenhouse_api', false, `HTTP ${res.status} for token ${token}`);
      throw new Error(`Greenhouse API returned HTTP ${res.status} for board "${token}"`);
    }
    const data = (await res.json()) as { jobs?: any[] };
    recordSourceCall('greenhouse_api', true);
    const items = Array.isArray(data.jobs) ? data.jobs.slice(0, 120) : [];
    return items.map((j) => {
      const title = clampStr(j.title || 'Open Role', 180);
      const location = clampStr(j.location?.name || fallbackCountry || 'Global', 120);
      const department = clampStr(j.departments?.[0]?.name || '', 100);
      const plainDesc = stripHtml(j.content || '').slice(0, 2500);
      const jobUrl = sanitizeHttpUrl(j.absolute_url);
      const workMode = inferWorkMode(location, title);
      return {
        externalId: `gh_${String(j.id)}`,
        title,
        department,
        location,
        country: inferCountryFromLocation(location, fallbackCountry),
        workMode,
        contractType: 'Full-time',
        skills: extractSkillsFromText(`${title} ${department} ${plainDesc}`),
        url: jobUrl,
        atsSource: 'Greenhouse Official API',
        contentHash: computeJobHash({ title, department, location, workMode, url: jobUrl }),
      };
    });
  } catch (err) {
    recordSourceCall('greenhouse_api', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function fetchLeverJobs(
  token: string,
  fallbackCountry: string
): Promise<NormalizedCareerJob[]> {
  if (!isSourceEnabled('lever_api')) {
    throw new Error('Source lever_api is paused or rate-limited by administrator.');
  }
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      recordSourceCall('lever_api', false, `HTTP ${res.status} for token ${token}`);
      throw new Error(`Lever API returned HTTP ${res.status} for board "${token}"`);
    }
    const items = (await res.json()) as any[];
    recordSourceCall('lever_api', true);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 120).map((j) => {
      const title = clampStr(j.text || 'Open Role', 180);
      const location = clampStr(j.categories?.location || fallbackCountry || 'Global', 120);
      const department = clampStr(j.categories?.department || j.categories?.team || '', 100);
      const contractType = clampStr(j.categories?.commitment || 'Full-time', 60);
      const plainDesc = `${j.descriptionPlain || ''} ${j.additionalPlain || ''}`.slice(0, 2500);
      const jobUrl = sanitizeHttpUrl(j.hostedUrl || j.applyUrl);
      const workMode = inferWorkMode(
        `${location} ${j.workplaceType || ''}`,
        title
      );
      return {
        externalId: `lv_${String(j.id)}`,
        title,
        department,
        location,
        country: inferCountryFromLocation(location, fallbackCountry),
        workMode,
        contractType,
        skills: extractSkillsFromText(`${title} ${department} ${plainDesc}`),
        url: jobUrl,
        atsSource: 'Lever Official API',
        contentHash: computeJobHash({ title, department, location, workMode, url: jobUrl }),
      };
    });
  } catch (err) {
    recordSourceCall('lever_api', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function fetchAshbyJobs(
  token: string,
  fallbackCountry: string
): Promise<NormalizedCareerJob[]> {
  if (!isSourceEnabled('ashby_api')) {
    throw new Error('Source ashby_api is paused or rate-limited by administrator.');
  }
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      recordSourceCall('ashby_api', false, `HTTP ${res.status} for token ${token}`);
      throw new Error(`Ashby API returned HTTP ${res.status} for board "${token}"`);
    }
    const data = (await res.json()) as { jobs?: any[] };
    recordSourceCall('ashby_api', true);
    const items = Array.isArray(data.jobs) ? data.jobs.slice(0, 120) : [];
    return items.map((j) => {
      const title = clampStr(j.title || 'Open Role', 180);
      const location = clampStr(j.location || fallbackCountry || 'Global', 120);
      const department = clampStr(j.department || j.team || '', 100);
      const plainDesc = stripHtml(j.descriptionPlain || j.descriptionHtml || '').slice(0, 2500);
      const jobUrl = sanitizeHttpUrl(j.jobUrl || j.applyUrl);
      const workMode: 'Remote' | 'Hybrid' | 'On-site' = j.isRemote
        ? 'Remote'
        : inferWorkMode(location, title);
      return {
        externalId: `ash_${String(j.id)}`,
        title,
        department,
        location,
        country: inferCountryFromLocation(location, fallbackCountry),
        workMode,
        contractType: clampStr(j.employmentType || 'Full-time', 60),
        skills: extractSkillsFromText(`${title} ${department} ${plainDesc}`),
        url: jobUrl,
        atsSource: 'Ashby Official API',
        contentHash: computeJobHash({ title, department, location, workMode, url: jobUrl }),
      };
    });
  } catch (err) {
    recordSourceCall('ashby_api', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function fetchWorkdayJobs(
  token: string,
  fallbackCountry: string
): Promise<NormalizedCareerJob[]> {
  if (!isSourceEnabled('workday_api')) {
    throw new Error('Source workday_api is paused or rate-limited by administrator.');
  }
  const [host, tenant, site] = token.split('|');
  if (!host || !tenant || !site) {
    throw new Error('Invalid Workday ATS token format (expected host|tenant|site).');
  }
  const apiUrl = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  if (!isSafePublicHttpUrl(apiUrl)) {
    throw new Error(`Blocked unsafe Workday URL: ${apiUrl}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'JOBFOUNDS-CareerMonitor/1.0 (+https://jobfounds.com; respectful-public-ats)',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    });
    if (!res.ok) {
      recordSourceCall('workday_api', false, `HTTP ${res.status} for ${host}`);
      throw new Error(`Workday CXS API returned HTTP ${res.status} for "${host}"`);
    }
    const data = (await res.json()) as { jobPostings?: any[] };
    recordSourceCall('workday_api', true);
    const items = Array.isArray(data.jobPostings) ? data.jobPostings.slice(0, 80) : [];
    return items.map((j, idx) => {
      const title = clampStr(j.title || 'Open Role', 180);
      const location = clampStr(j.locationsText || fallbackCountry || 'Global', 120);
      const externalPath = String(j.externalPath || '').replace(/^\/+/, '');
      const jobUrl = externalPath
        ? sanitizeHttpUrl(`https://${host}/${site}/${externalPath}`)
        : sanitizeHttpUrl(`https://${host}/${site}`);
      const workMode = inferWorkMode(location, title);
      const extKey = String(j.bulletFields?.[0] || externalPath || idx);
      return {
        externalId: `wd_${crypto.createHash('md5').update(extKey).digest('hex').slice(0, 14)}`,
        title,
        department: '',
        location,
        country: inferCountryFromLocation(location, fallbackCountry),
        workMode,
        contractType: 'Full-time',
        skills: extractSkillsFromText(`${title} ${location}`),
        url: jobUrl,
        atsSource: 'Workday Official CXS API',
        contentHash: computeJobHash({ title, department: '', location, workMode, url: jobUrl }),
      };
    });
  } catch (err) {
    recordSourceCall('workday_api', false, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSmartRecruitersJobs(
  token: string,
  fallbackCountry: string
): Promise<NormalizedCareerJob[]> {
  if (!isSourceEnabled('smartrecruiters_api')) {
    throw new Error('Source smartrecruiters_api is paused or rate-limited by administrator.');
  }
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      recordSourceCall('smartrecruiters_api', false, `HTTP ${res.status} for ${token}`);
      throw new Error(`SmartRecruiters API returned HTTP ${res.status} for "${token}"`);
    }
    const data = (await res.json()) as { content?: any[] };
    recordSourceCall('smartrecruiters_api', true);
    const items = Array.isArray(data.content) ? data.content.slice(0, 100) : [];
    return items.map((j) => {
      const title = clampStr(j.name || 'Open Role', 180);
      const city = j.location?.city || '';
      const country = j.location?.country?.toUpperCase() || fallbackCountry || 'Global';
      const location = clampStr([city, country].filter(Boolean).join(', ') || fallbackCountry || 'Global', 120);
      const department = clampStr(j.department?.label || j.function?.label || '', 100);
      const jobUrl = sanitizeHttpUrl(`https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(String(j.id || ''))}`);
      const workMode: 'Remote' | 'Hybrid' | 'On-site' = j.location?.remote
        ? 'Remote'
        : inferWorkMode(location, title);
      return {
        externalId: `sr_${String(j.id)}`,
        title,
        department,
        location,
        country: clampStr(country, 80),
        workMode,
        contractType: clampStr(j.typeOfEmployment?.label || 'Full-time', 60),
        skills: extractSkillsFromText(`${title} ${department}`),
        url: jobUrl,
        atsSource: 'SmartRecruiters Official API',
        contentHash: computeJobHash({ title, department, location, workMode, url: jobUrl }),
      };
    });
  } catch (err) {
    recordSourceCall('smartrecruiters_api', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function isRobotsAllowed(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    if (!isSafePublicHttpUrl(robotsUrl)) return false;
    const res = await fetchWithTimeout(robotsUrl, 5000);
    if (!res.ok) return true;
    const text = (await res.text()).slice(0, 16000);
    const lines = text.split(/\r?\n/);
    let inWildcard = false;
    for (const raw of lines) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      if (/^user-agent:\s*\*/i.test(line)) {
        inWildcard = true;
      } else if (/^user-agent:/i.test(line)) {
        inWildcard = false;
      } else if (inWildcard && /^disallow:\s*(.+)/i.test(line)) {
        const rule = line.replace(/^disallow:\s*/i, '').trim();
        if (rule === '/' || (rule && parsed.pathname.startsWith(rule))) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return true;
  }
}

async function fetchCustomCareerJsonLd(
  careersUrl: string,
  fallbackCountry: string
): Promise<{ jobs: NormalizedCareerJob[]; warning?: string }> {
  if (!isSourceEnabled('custom_career_jsonld')) {
    throw new Error('Source custom_career_jsonld is paused or rate-limited by administrator.');
  }
  const allowed = await isRobotsAllowed(careersUrl);
  if (!allowed) {
    recordSourceCall('custom_career_jsonld', false, 'Disallowed by robots.txt');
    return {
      jobs: [],
      warning: 'Official robots.txt disallows automated access to this career path. Respected without scraping.',
    };
  }
  try {
    const res = await fetchWithTimeout(careersUrl, 10000);
    if (!res.ok) {
      recordSourceCall('custom_career_jsonld', false, `HTTP ${res.status}`);
      throw new Error(`Career page returned HTTP ${res.status}`);
    }
    const html = (await res.text()).slice(0, 400_000);
    recordSourceCall('custom_career_jsonld', true);

    // Check if page embeds Greenhouse / Lever / Ashby board links we can transparently note
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    const jobs: NormalizedCareerJob[] = [];
    for (const m of jsonLdMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const entries = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed['@graph'])
            ? parsed['@graph']
            : [parsed];
        for (const item of entries) {
          if (item && (item['@type'] === 'JobPosting' || (Array.isArray(item['@type']) && item['@type'].includes('JobPosting')))) {
            const title = clampStr(item.title || item.name || '', 180);
            if (!title) continue;
            const locObj = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
            const city = locObj?.address?.addressLocality || '';
            const country = locObj?.address?.addressCountry || fallbackCountry || 'International';
            const location = clampStr([city, country].filter(Boolean).join(', ') || fallbackCountry || 'Global', 120);
            const url = sanitizeHttpUrl(item.url || careersUrl);
            const desc = stripHtml(item.description || '').slice(0, 2000);
            const workMode =
              String(item.jobLocationType || '').toUpperCase() === 'TELECOMMUTE'
                ? 'Remote'
                : inferWorkMode(location, title);
            const deadline =
              typeof item.validThrough === 'string' && item.validThrough.trim()
                ? item.validThrough.trim().slice(0, 10)
                : '';
            const extId = `ld_${crypto.createHash('md5').update(`${title}|${location}|${url}`).digest('hex').slice(0, 14)}`;
            jobs.push({
              externalId: extId,
              title,
              department: clampStr(item.occupationalCategory || item.industry || '', 100),
              location,
              country: clampStr(typeof country === 'string' ? country : country?.name || fallbackCountry, 80),
              workMode,
              contractType: clampStr(
                Array.isArray(item.employmentType) ? item.employmentType[0] : item.employmentType || 'Full-time',
                60
              ),
              skills: extractSkillsFromText(`${title} ${desc}`),
              url,
              atsSource: 'Official Career Page (Schema.org JSON-LD)',
              contentHash: computeJobHash({ title, department: '', location, workMode, url }),
              applicationDeadline: deadline,
            });
          }
        }
      } catch {
        // ignore malformed json-ld blocks
      }
    }
    return {
      jobs: jobs.slice(0, 100),
      warning:
        jobs.length === 0
          ? 'Page accessible (HTTP 200) mais aucun bloc structuré Schema.org JobPosting détecté. Utilisez l’URL ATS officielle (Greenhouse, Lever ou Ashby) pour une extraction complète.'
          : undefined,
    };
  } catch (err) {
    recordSourceCall('custom_career_jsonld', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Monitors a company's official career page or ATS board, diffs active jobs against SQLite,
 * logs added/modified/removed changes, updates frequent skills, and creates verified signals.
 */
export async function monitorCompanyCareerPage(companyId: string): Promise<CareerMonitorResult> {
  const company = getCompanyById(companyId);
  if (!company) {
    throw new Error(`Company ${companyId} not found.`);
  }

  let atsProvider: AtsProvider = company.atsProvider;
  let token = company.atsBoardToken;
  if ((atsProvider === 'none' || !token) && company.careersUrl) {
    const detected = detectAtsFromCareersUrl(company.careersUrl);
    atsProvider = detected.provider;
    token = detected.token;
  }

  let fetchedJobs: NormalizedCareerJob[] = [];
  let warning: string | undefined;

  if (atsProvider === 'greenhouse' && token) {
    fetchedJobs = await fetchGreenhouseJobs(token, company.country);
  } else if (atsProvider === 'lever' && token) {
    fetchedJobs = await fetchLeverJobs(token, company.country);
  } else if (atsProvider === 'ashby' && token) {
    fetchedJobs = await fetchAshbyJobs(token, company.country);
  } else if (atsProvider === 'workday' && token) {
    fetchedJobs = await fetchWorkdayJobs(token, company.country);
  } else if (atsProvider === 'smartrecruiters' && token) {
    fetchedJobs = await fetchSmartRecruitersJobs(token, company.country);
  } else if (company.careersUrl && isSafePublicHttpUrl(company.careersUrl)) {
    const custom = await fetchCustomCareerJsonLd(company.careersUrl, company.country);
    fetchedJobs = custom.jobs;
    warning = custom.warning;
  } else {
    throw new Error(
      `No valid official careers URL or ATS board configured for "${company.officialName}".`
    );
  }

  const db = getEngineDb();
  const now = new Date().toISOString();
  const existingRows = db
    .prepare('SELECT * FROM career_jobs WHERE company_id = ?')
    .all(companyId) as any[];
  const existingMap = new Map<string, any>(existingRows.map((r) => [r.external_id, r]));
  const seenExternalIds = new Set<string>();

  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  db.exec('BEGIN');
  try {
    for (const job of fetchedJobs) {
      seenExternalIds.add(job.externalId);
      const prev = existingMap.get(job.externalId);
      if (!prev) {
        const id = `cjob_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        db.prepare(`
          INSERT INTO career_jobs (
            id, company_id, external_id, title, department, location, country,
            work_mode, contract_type, skills_json, url, ats_source, content_hash,
            application_deadline, status, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          id,
          companyId,
          job.externalId,
          job.title,
          job.department,
          job.location,
          job.country,
          job.workMode,
          job.contractType,
          JSON.stringify(job.skills),
          job.url,
          job.atsSource,
          job.contentHash,
          clampStr(job.applicationDeadline || '', 30),
          now,
          now
        );
        db.prepare(`
          INSERT INTO career_changes (id, company_id, career_job_id, change_type, job_title, details_json, detected_at)
          VALUES (?, ?, ?, 'added', ?, ?, ?)
        `).run(
          `chg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          companyId,
          id,
          job.title,
          JSON.stringify({ location: job.location, department: job.department, url: job.url }),
          now
        );
        addedCount++;
      } else {
        const changed = prev.content_hash !== job.contentHash || prev.status !== 'active';
        db.prepare(`
          UPDATE career_jobs SET
            title = ?, department = ?, location = ?, country = ?,
            work_mode = ?, contract_type = ?, skills_json = ?, url = ?,
            content_hash = ?, application_deadline = ?, status = 'active', last_seen_at = ?, removed_at = NULL
          WHERE id = ?
        `).run(
          job.title,
          job.department,
          job.location,
          job.country,
          job.workMode,
          job.contractType,
          JSON.stringify(job.skills),
          job.url,
          job.contentHash,
          clampStr(job.applicationDeadline || '', 30),
          now,
          prev.id
        );
        if (changed) {
          db.prepare(`
            INSERT INTO career_changes (id, company_id, career_job_id, change_type, job_title, details_json, detected_at)
            VALUES (?, ?, ?, 'modified', ?, ?, ?)
          `).run(
            `chg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            companyId,
            prev.id,
            job.title,
            JSON.stringify({ prevTitle: prev.title, prevLocation: prev.location, newLocation: job.location }),
            now
          );
          modifiedCount++;
        }
      }
    }

    // Detect removed/expired postings (only when ATS returned an authoritative list or custom page had jobs)
    if (atsProvider !== 'custom_jsonld' || fetchedJobs.length > 0) {
      for (const prev of existingRows) {
        if (prev.status === 'active' && !seenExternalIds.has(prev.external_id)) {
          db.prepare(`
            UPDATE career_jobs SET status = 'removed', removed_at = ? WHERE id = ?
          `).run(now, prev.id);
          db.prepare(`
            INSERT INTO career_changes (id, company_id, career_job_id, change_type, job_title, details_json, detected_at)
            VALUES (?, ?, ?, 'removed', ?, ?, ?)
          `).run(
            `chg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            companyId,
            prev.id,
            prev.title,
            JSON.stringify({ lastSeenAt: prev.last_seen_at }),
            now
          );
          removedCount++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Recompute frequent skills & velocity
  const activeRows = db
    .prepare("SELECT skills_json, department FROM career_jobs WHERE company_id = ? AND status = 'active'")
    .all(companyId) as any[];
  const skillFreq = new Map<string, number>();
  for (const r of activeRows) {
    try {
      const arr = JSON.parse(r.skills_json || '[]') as string[];
      for (const s of arr) {
        skillFreq.set(s, (skillFreq.get(s) || 0) + 1);
      }
    } catch {
      // ignore
    }
  }
  const topSkills = Array.from(skillFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([s]) => s);

  const velocity: CompanyRecord['hiringVelocity'] =
    activeRows.length >= 20 ? 'High' : activeRows.length >= 5 ? 'Moderate' : activeRows.length > 0 ? 'Low' : 'Unknown';

  updateCompanyMonitored(companyId, {
    lastMonitoredAt: now,
    hiringVelocity: velocity,
    frequentSkills: topSkills.length ? topSkills : company.frequentSkills,
    verificationStatus: fetchedJobs.length > 0 ? 'Verified' : company.verificationStatus,
  });

  // Record verifiable signal when new official openings are discovered
  if (addedCount > 0) {
    const isSurge = addedCount >= 3;
    recordCompanySignal({
      companyId,
      signalType: isSurge ? 'career_page_surge' : 'frequent_hiring',
      classification: 'confirmed_job',
      title: isSurge
        ? `${addedCount} nouvelles offres détectées sur la page Carrières officielle (${atsProvider})`
        : `${addedCount} nouvelle(s) offre(s) publiée(s) officiellement`,
      summary: `Contrôle automatisé de ${company.careersUrl || atsProvider} : ${addedCount} ajout(s), ${modifiedCount} modification(s), ${removedCount} retrait(s). Total actif : ${activeRows.length}. Compétences clés : ${topSkills.slice(0, 6).join(', ') || 'Multi-métiers'}.`,
      evidenceQuote: fetchedJobs.slice(0, 3).map((j) => `${j.title} (${j.location})`).join(' · '),
      skillsInferred: topSkills.slice(0, 10),
      sourceName: fetchedJobs[0]?.atsSource || 'Official Career Monitor',
      sourceUrl: company.careersUrl || fetchedJobs[0]?.url || '',
      detectedAt: now,
      reliabilityScore: 96,
      relevanceScore: Math.min(95, 65 + Math.min(30, addedCount * 5)),
    });
  }

  return {
    companyId,
    companyName: company.officialName,
    atsProvider,
    fetchedCount: fetchedJobs.length,
    addedCount,
    modifiedCount,
    removedCount,
    activeCount: activeRows.length,
    extractedSkills: topSkills,
    checkedAt: now,
    warning,
  };
}
