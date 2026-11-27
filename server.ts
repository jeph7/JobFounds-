import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { GoogleGenAI, Type } from '@google/genai';
import {
  type AuthedRequest,
  attachFirebaseAuth,
  clampStr,
  createRateLimiter,
  extractDomainFromUrl,
  isSafePublicHttpUrl,
  registerAppTokenVerifier,
  requireFirebaseAuth,
  sanitizeHttpUrl,
} from './serverSecurity.ts';
import { createAuthRouter, verifyAppSessionToken } from './serverAuthEngine.ts';
import { fetchAggregatedLiveJobFeeds } from './serverJobFeeds.ts';
import {
  closeEngineDb,
  enqueueBackgroundJob,
  getDailyAiUsageSummary,
  getEngineDb,
  getEngineStorageInfo,
  isSourceEnabled,
  listCompanies,
  listEngineDbBackups,
  logAiUsage,
  recordSourceCall,
  upsertCompany,
} from './serverEngineDb.ts';
import { createIntelligenceRouter } from './serverIntelligenceRoutes.ts';
import {
  getWorkerMode,
  startBackgroundWorkerLoop,
  verifyCorporateDomainMx,
} from './serverWorkerEngine.ts';
import { attachLiveVoiceBridge } from './serverLiveVoice.ts';
import {
  resolveLocationsBatch,
  reverseNominatimPlace,
  searchNominatimPlaces,
} from './serverGeoService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL = 'gemini-4-hydrogen';

const LANGUAGE_MAP: Record<string, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
  ar: 'Arabic',
};

function getOutputLanguage(lang?: string): string {
  return LANGUAGE_MAP[lang || 'fr'] || 'French';
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGroundingSources(response: any): Array<{ title: string; uri: string }> {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const sources: Array<{ title: string; uri: string }> = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }
  return sources;
}

function parseJsonFromText<T>(rawText: string | undefined): T {
  const text = (rawText ?? '').trim();
  if (!text) {
    throw new Error('Empty response received from AI model.');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim()) as T;
    }
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = text.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = text.lastIndexOf(']');
    }
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new Error('Failed to parse structured JSON from AI response.');
  }
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: 'API key authorization failed. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Rate limit reached on the Gemini API. Please retry shortly.',
    };
  }
  return {
    status: 500,
    message: raw || 'Internal server error while querying intelligence engine.',
  };
}

const CV_PARSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fullName: { type: Type.STRING },
    headline: { type: Type.STRING },
    email: { type: Type.STRING },
    phone: { type: Type.STRING },
    location: { type: Type.STRING },
    linkedin: { type: Type.STRING },
    summary: { type: Type.STRING },
    experiences: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          role: { type: Type.STRING },
          company: { type: Type.STRING },
          location: { type: Type.STRING },
          period: { type: Type.STRING },
          highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['id', 'role', 'company', 'location', 'period', 'highlights'],
      },
    },
    education: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          degree: { type: Type.STRING },
          institution: { type: Type.STRING },
          year: { type: Type.STRING },
        },
        required: ['id', 'degree', 'institution', 'year'],
      },
    },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    languages: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'fullName',
    'headline',
    'email',
    'phone',
    'location',
    'summary',
    'experiences',
    'education',
    'skills',
    'languages',
  ],
};

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Production HTTPS & security headers (Hostinger reverse proxy safe)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(self), microphone=(self)');
    if (process.env.NODE_ENV === 'production' && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Isolate 16MB payload limit strictly to CV uploads and application document attachments; keep all other routes capped at 256KB
  app.use('/api/cv/import-file', express.json({ limit: '16mb' }));
  app.use('/api/applications/submit', express.json({ limit: '16mb' }));
  app.use(express.json({ limit: '256kb' }));

  // Verify optional Firebase ID tokens on all /api/* requests
  app.use('/api', attachFirebaseAuth);

  const feedsLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 90,
    maxGuest: 30,
    bucketPrefix: 'feeds',
  });
  const uploadLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 20,
    maxGuest: 6,
    bucketPrefix: 'upload',
  });
  const aiLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 45,
    maxGuest: 12,
    bucketPrefix: 'ai',
  });

  // Initialize persistent SQLite intelligence engine & autonomous background worker
  getEngineDb();

  // On a fresh production database (e.g. first deploy on Hostinger), register official ATS starter targets
  // and enqueue immediate career scans so live jobs populate automatically without manual CLI setup.
  if (listCompanies({ limit: 1 }).length === 0) {
    const starterTargets = [
      { officialName: 'Stripe', officialWebsite: 'https://stripe.com', careersUrl: 'https://boards.greenhouse.io/stripe', country: 'Ireland / United States / Global', location: 'Dublin · San Francisco · Paris · Singapore · Remote', sector: 'FinTech & Payments Infrastructure', estimatedSize: '5000+' },
      { officialName: 'Datadog', officialWebsite: 'https://www.datadoghq.com', careersUrl: 'https://boards.greenhouse.io/datadog', country: 'France / United States / Japan / Australia', location: 'Paris · New York · Tokyo · Sydney · Madrid', sector: 'Cloud Observability & Security SaaS', estimatedSize: '5000+' },
      { officialName: 'Celonis', officialWebsite: 'https://www.celonis.com', careersUrl: 'https://boards.greenhouse.io/celonis', country: 'Germany / United States / Japan', location: 'Munich · Madrid · London · New York · Tokyo', sector: 'Enterprise AI & Process Intelligence', estimatedSize: '1000-5000' },
      { officialName: 'Adyen', officialWebsite: 'https://www.adyen.com', careersUrl: 'https://boards.greenhouse.io/adyen', country: 'Netherlands / Brazil / Singapore / Australia', location: 'Amsterdam · São Paulo · Singapore · Sydney · Paris', sector: 'FinTech & Global Payments', estimatedSize: '1000-5000' },
      { officialName: 'Algolia', officialWebsite: 'https://www.algolia.com', careersUrl: 'https://boards.greenhouse.io/algolia', country: 'France / United States / United Kingdom', location: 'Paris · London · San Francisco · Remote', sector: 'AI Search & Developer SaaS', estimatedSize: '500-1000' },
      { officialName: 'Alan', officialWebsite: 'https://alan.com', careersUrl: 'https://jobs.ashbyhq.com/alan', country: 'France / Belgium / Spain / Canada', location: 'Paris · Brussels · Madrid · Montreal · Remote', sector: 'InsurTech & Digital Health', estimatedSize: '500-1000' },
      { officialName: 'Linear', officialWebsite: 'https://linear.app', careersUrl: 'https://jobs.ashbyhq.com/linear', country: 'United States / Europe', location: 'Remote (Europe & North America)', sector: 'Developer Tools & Productivity SaaS', estimatedSize: '50-200' },
      { officialName: 'Nubank', officialWebsite: 'https://nubank.com.br', careersUrl: 'https://boards.greenhouse.io/nubank', country: 'Brazil / Mexico / Colombia', location: 'São Paulo · Mexico City · Bogotá', sector: 'Digital Banking & FinTech (Latin America)', estimatedSize: '5000+' },
      { officialName: 'Visa', officialWebsite: 'https://www.visa.com', careersUrl: 'https://jobs.smartrecruiters.com/Visa', country: 'Global (Africa, Caribbean, LatAm, Europe, Asia, Oceania, North America)', location: 'Miami · Lagos · Nairobi · Dubai · Singapore · Sydney · London · São Paulo', sector: 'Global Financial Payments Network', estimatedSize: '10000+' },
      { officialName: 'Canva', officialWebsite: 'https://www.canva.com', careersUrl: 'https://jobs.smartrecruiters.com/Canva', country: 'Australia / Oceania / Asia / Europe / United States', location: 'Sydney · Melbourne · Manila · London · Austin', sector: 'Visual Communication & Design SaaS', estimatedSize: '1000-5000' },
      { officialName: 'Wise', officialWebsite: 'https://wise.com', careersUrl: 'https://boards.greenhouse.io/wise', country: 'United Kingdom / Singapore / Brazil / Australia / United States', location: 'London · Singapore · São Paulo · Sydney · Tallinn', sector: 'Cross-Border Payments & FinTech', estimatedSize: '5000+' },
      { officialName: 'GitLab', officialWebsite: 'https://about.gitlab.com', careersUrl: 'https://boards.greenhouse.io/gitlab', country: 'Global / Worldwide Remote', location: 'Worldwide Remote (Europe, Americas, Africa, APAC)', sector: 'DevSecOps & Cloud Platform', estimatedSize: '1000-5000' },
      { officialName: 'Deel', officialWebsite: 'https://www.deel.com', careersUrl: 'https://jobs.ashbyhq.com/deel', country: 'Global / Worldwide Remote (Africa, Caribbean, LatAm, Europe, Asia, Oceania)', location: 'Worldwide Remote', sector: 'Global HR, Payroll & Compliance SaaS', estimatedSize: '1000-5000' },
    ];
    const monitorIntervalMinutes = Number(process.env.ENGINE_DEFAULT_MONITOR_MINUTES) || 720;
    for (const target of starterTargets) {
      const { company } = upsertCompany({
        ...target,
        monitored: true,
        monitorIntervalMinutes,
        verificationStatus: 'Partially Verified',
        sourceName: 'Official Corporate ATS Portal',
      });
      enqueueBackgroundJob({
        jobType: 'monitor_career_page',
        dedupKey: `monitor:${company.id}`,
        payload: { companyId: company.id },
        createdBy: 'system_bootstrap',
      });
    }
  }

  startBackgroundWorkerLoop();

  // Register JOBFOUNDS email/password session token verifier & mount /api/auth/* endpoints
  registerAppTokenVerifier(verifyAppSessionToken);
  app.use('/api', createAuthRouter());

  // Mount Global Company Intelligence, Career Monitor, HR Verification, Matching, Notifications & Admin routes
  app.use('/api', createIntelligenceRouter());

  // AI Quota, Source Governance & Cost Usage Middleware
  function guardAiRoute(endpointName: string, usesSearch: boolean) {
    return (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
      if (usesSearch && !isSourceEnabled('gemini_google_search')) {
        res.status(503).json({
          error: 'La source Gemini Google Search est temporairement en pause ou a atteint sa limite horaire.',
          code: 'SOURCE_PAUSED',
        });
        return;
      }
      const budget = getDailyAiUsageSummary();
      if (!budget.withinBudget) {
        res.status(429).json({
          error: `Quota IA quotidien atteint (${budget.callsToday}/${budget.maxCallsPerDay} appels). Réessayez demain ou ajustez les limites administrateur.`,
          code: 'AI_QUOTA_EXCEEDED',
        });
        return;
      }
      const startedAt = Date.now();
      res.on('finish', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        const durationMs = Date.now() - startedAt;
        logAiUsage({
          uid: req.authUser?.uid || 'unknown',
          endpoint: endpointName,
          model: MODEL,
          promptTokens: usesSearch ? 1400 : 900,
          outputTokens: ok ? (usesSearch ? 900 : 600) : 120,
          status: ok ? 'ok' : 'error',
          latencyMs: durationMs,
        });
        if (usesSearch) {
          recordSourceCall('gemini_google_search', ok, ok ? '' : `HTTP ${res.statusCode}`);
        }
      });
      next();
    };
  }

  app.get('/api/health', (_req, res) => {
    const budget = getDailyAiUsageSummary();
    const storage = getEngineStorageInfo();
    const workerMode = getWorkerMode();
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    res.json({
      ok: true,
      status: 'ok',
      engine: {
        sqliteReady: storage.dbExists,
        persistentExternalStorage: storage.usesExternalPersistentDir,
        workerMode,
        backgroundWorkerActive: workerMode === 'loop' || Boolean(process.env.CRON_SECRET?.trim()),
        cronEndpointConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        aiWithinBudget: budget.withinBudget,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        emailConfigured: Boolean(
          process.env.RESEND_API_KEY?.trim() &&
            (process.env.RESEND_FROM_EMAIL?.trim() || process.env.NOTIFICATION_FROM_EMAIL?.trim())
        ),
        backupsCount: listEngineDbBackups().length,
        nodeVersion: process.version,
        memoryRssMb: rssMb,
      },
    });
  });

  // REAL-TIME PUBLIC JOB BOARD CONNECTORS (Arbeitnow, Remotive, The Muse)
  app.post('/api/jobs/feeds', feedsLimiter, async (req, res) => {
    try {
      const { query = '', country = '', city = '', workMode = '', contractType = '' } =
        req.body ?? {};
      const result = await fetchAggregatedLiveJobFeeds({
        query: clampStr(query, 120),
        country: clampStr(country, 80),
        city: clampStr(city, 80),
        workMode: clampStr(workMode, 30),
        contractType: clampStr(contractType, 30),
      });
      res.json({
        jobs: result.jobs,
        activeProviders: result.activeProviders,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // COMPANY INTELLIGENCE BRIEF (with Google Search grounding — requires verified Firebase auth)
  app.post('/api/company/intel', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/company/intel', true), async (req, res) => {
    try {
      const companyName = clampStr(req.body?.companyName, 140);
      const country = clampStr(req.body?.country, 80);
      const lang = clampStr(req.body?.lang, 10) || 'fr';

      if (!companyName) {
        res.status(400).json({ error: 'Company name is required.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const prompt = `You are the JOBFOUNDS Company Intelligence Engine.
Research this employer using Google Search: "${companyName}"${country ? ` (focus region: ${country})` : ''}.

Provide factual, verifiable employer intelligence without inventing unverified metrics.
Return ONLY a valid JSON object in ${outputLang}:
{
  "companyName": "${companyName}",
  "officialWebsite": "Official HTTPS corporate website URL or empty string",
  "headquarters": "City, Country",
  "sector": "Industry / Sector",
  "estimatedSize": "Factual headcount range (e.g. 500–1,000 employees) or 'Not publicly disclosed'",
  "overview": "2-3 concise factual sentences describing the company's business and international footprint in ${outputLang}",
  "hiringVelocity": "High" | "Moderate" | "Selective",
  "growthSignals": ["Up to 4 concrete verifiable growth, expansion, funding, or hiring signals in ${outputLang}"],
  "typicalRolesHired": ["Up to 6 typical job families hired by this employer"],
  "careersPortalUrl": "Official HTTPS careers page URL or empty string",
  "verificationNote": "1 concise note in ${outputLang} on official domain authenticity and how candidates should apply safely."
}`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const parsed = parseJsonFromText<any>(response.text);
      const sources = extractGroundingSources(response);
      res.json({
        ...parsed,
        officialWebsite: sanitizeHttpUrl(parsed.officialWebsite),
        careersPortalUrl: sanitizeHttpUrl(parsed.careersPortalUrl),
        groundingSources: sources,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Apply mandatory Firebase authentication, rate limits & AI quota tracking to all sensitive AI routes
  app.use('/api/cv/import-file', requireFirebaseAuth, uploadLimiter, guardAiRoute('/api/cv/import-file', false));
  app.use('/api/jobs/search', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/jobs/search', true));
  app.use('/api/opportunities/discover', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/opportunities/discover', true));
  app.use('/api/jobs/verify', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/jobs/verify', true));
  app.use('/api/cv/optimize', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/cv/optimize', false));
  app.use('/api/ats/analyze', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/ats/analyze', false));
  app.use('/api/match/evaluate', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/match/evaluate', false));
  app.use('/api/recruiters/find', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/recruiters/find', true));
  app.use('/api/interview/simulate', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/interview/simulate', false));
  app.use('/api/watchlist/check', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/watchlist/check', true));
  app.use('/api/career/assist', requireFirebaseAuth, aiLimiter, guardAiRoute('/api/career/assist', true));

  // MODULE 1 — GLOBAL JOB SEARCH (with live Google Search grounding)
  app.post('/api/jobs/search', async (req, res) => {
    try {
      const {
        query = '',
        country = '',
        city = '',
        workMode = '',
        contractType = '',
        experienceLevel = '',
        degree = '',
        skills = '',
        languages = '',
        minSalary = '',
        company = '',
        datePosted = '',
        lang = 'fr',
      } = req.body ?? {};

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const prompt = `You are the JOBFOUNDS Global Job Search Intelligence Engine.
Search the web right now for real, current, active, verifiable job openings matching these user criteria across ALL regions of the world (Europe, North America, Latin America, Caribbean, Africa, Asia, Oceania):
- Role / Keywords: ${query || 'Software Engineering, Product, Finance, Operations, Healthcare, or Data roles'}
- Target Country / Continent: ${country || 'Worldwide (Europe, North America, Latin America, Caribbean, Africa, Asia, Oceania)'}
- City: ${city || 'Any'}
- Work Mode: ${workMode || 'Any (Remote / Hybrid / On-site)'}
- Contract Type: ${contractType || 'Any (Full-time / Part-time / Contract / Internship / Freelance)'}
- Experience Level: ${experienceLevel || 'Any'}
- Degree Required: ${degree || 'Any'}
- Skills: ${skills || 'Any'}
- Languages: ${languages || 'Any'}
- Minimum Salary: ${minSalary || 'Any'}
- Company: ${company || 'Any'}
- Recency: ${datePosted || 'Recent (active openings only)'}

Return ONLY a valid JSON object (no markdown commentary outside the JSON):
{
  "searchSummary": "Short factual summary in ${outputLang}",
  "jobs": [
    {
      "id": "unique-slug",
      "title": "Exact job title",
      "company": "Real company name",
      "country": "Exact country name matching the requested geography",
      "city": "City name or Remote",
      "workMode": "Remote" | "Hybrid" | "On-site",
      "contractType": "Full-time" | "Part-time" | "Contract" | "Internship" | "Freelance",
      "experienceLevel": "Junior" | "Mid-level" | "Senior" | "Lead / Executive",
      "degreeRequired": "e.g. Master's / Bachelor's / Not specified",
      "salaryRange": "e.g. 68,000 - 85,000 EUR or Non communiqué",
      "salaryMinAnnualUsd": 75000,
      "languages": ["French", "English"],
      "skills": ["Skill 1", "Skill 2", "Skill 3", "Skill 4"],
      "publishedDate": "YYYY-MM-DD",
      "applicationDeadline": "YYYY-MM-DD or empty string",
      "sourceName": "Exact job board or company careers site name",
      "sourceUrl": "Real verifiable HTTPS URL from search results",
      "verificationStatus": "Verified" | "Partially Verified" | "Unverified" | "Suspicious" | "Expired",
      "verificationSummary": "One factual sentence explaining why this status was assigned in ${outputLang}",
      "description": "Concise 2-3 sentence summary of actual responsibilities and requirements in ${outputLang}",
      "recruiterHint": "Identified hiring department or careers contact channel",
      "visaSponsorship": "Available" | "Case-by-case" | "Not specified"
    }
  ]
}

STRICT RULES:
1. Return between 5 and 10 real, currently active job opportunities grounded in your Google Search results.
2. STRICT GEOGRAPHIC HONESTY: If the user specifies a country or region (e.g. Haïti, Sénégal, Brésil, Maroc, Canada, Japon, Australie, Caraïbes, Afrique, Amérique latine), prioritize real active listings located in or explicitly open to that exact country/region. Never restrict results artificially to Europe/US when another country was requested.
3. NEVER return expired listings, fake companies, or jobs without a real verifiable HTTPS sourceUrl.
4. Never guarantee authenticity if evidence is incomplete — use "Partially Verified" or "Unverified" honestly when official corporate career pages cannot be directly corroborated.
5. Write all summaries, descriptions, and verificationSummary in ${outputLang}.`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const parsed = parseJsonFromText<{ searchSummary: string; jobs: any[] }>(response.text);
      const sources = extractGroundingSources(response);
      const seen = new Set<string>();
      const validJobs = (Array.isArray(parsed.jobs) ? parsed.jobs : []).filter((j: any) => {
        const cleanUrl = sanitizeHttpUrl(j?.sourceUrl);
        if (!cleanUrl || !j?.title || !j?.company) return false;
        if (String(j.verificationStatus || '').toLowerCase() === 'expired') return false;
        if (j.applicationDeadline) {
          const dl = Date.parse(String(j.applicationDeadline));
          if (!Number.isNaN(dl) && dl < Date.now() - 86_400_000) return false;
        }
        const key = `${String(j.company).toLowerCase().trim()}::${String(j.title).toLowerCase().trim()}::${String(j.city || '').toLowerCase().trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        j.sourceUrl = cleanUrl;
        return true;
      });

      res.json({
        searchSummary: parsed.searchSummary || '',
        jobs: validJobs,
        groundingSources: sources,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 2 — HIDDEN JOB OPPORTUNITY DISCOVERY (with live Google Search grounding)
  app.post('/api/opportunities/discover', async (req, res) => {
    try {
      const {
        sector = '',
        country = '',
        city = '',
        roleFocus = '',
        companyQuery = '',
        lang = 'fr',
      } = req.body ?? {};

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const prompt = `You are the JOBFOUNDS Hidden Job Opportunity Discovery Engine.
Search the web for REAL recent corporate expansion signals, fundraising rounds, new office openings, major public contracts, M&A activity, or hiring campaigns that reveal hidden or upcoming recruitment needs.

User criteria:
- Sector: ${sector || 'Technology, FinTech, Clean Energy, Healthcare, Consulting, Industrial'}
- Country: ${country || 'Global (Europe, North America, Asia-Pacific)'}
- City: ${city || 'Any'}
- Target Roles / Professions: ${roleFocus || 'Product, Engineering, Operations, Sales, Finance, Data'}
- Specific Company (optional): ${companyQuery || 'Any growing companies'}

CRITICAL CLASSIFICATION RULE (MANDATORY — NEVER VIOLATE):
1. "Confirmed Job": An official public job listing currently exists for this specific need.
2. "Active Hiring Signal": Verifiable recent public evidence shows the company is actively recruiting, even if the specific role is not yet posted.
3. "Potential Hiring Opportunity": Public growth signals suggest a probable upcoming staffing need, WITHOUT confirmed active recruitment.
NEVER present a hypothesis or growth signal as a "Confirmed Job".

Return ONLY a valid JSON object:
{
  "radarSummary": "Brief factual intelligence overview in ${outputLang}",
  "opportunities": [
    {
      "id": "opp-slug",
      "company": "Real company name",
      "country": "Country",
      "location": "City, Country",
      "sector": "Industry sector",
      "classification": "Confirmed Job" | "Active Hiring Signal" | "Potential Hiring Opportunity",
      "potentialRoles": ["Role 1", "Role 2", "Role 3"],
      "detectionReason": "Specific verifiable trigger in ${outputLang}",
      "signalEvidence": "2 sentences citing the concrete public announcement or hiring signal in ${outputLang}",
      "sourceName": "Publication or official company newsroom name",
      "sourceUrl": "Real URL from search results",
      "detectedDate": "YYYY-MM-DD",
      "confidenceScore": 78,
      "confidenceJustification": "Clear explanation of confidence level in ${outputLang}",
      "professionalContact": {
        "nameOrDepartment": "Talent Acquisition / VP Engineering / Careers Desk",
        "channel": "Official Careers Portal / LinkedIn Talent Team / Press Contact",
        "url": "Official company website or careers URL"
      },
      "spontaneousOutreachAngle": "Concrete angle for a spontaneous application in ${outputLang}"
    }
  ]
}

Return 6 diverse, factual, verifiable opportunities. Write all narrative text in ${outputLang}.`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const parsed = parseJsonFromText<{ radarSummary: string; opportunities: any[] }>(response.text);
      const sources = extractGroundingSources(response);

      res.json({
        radarSummary: parsed.radarSummary || '',
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
        groundingSources: sources,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 3 — JOB AUTHENTICITY & VERIFICATION ENGINE (Google Search + Direct Live URL Context Inspection)
  app.post('/api/jobs/verify', async (req, res) => {
    try {
      const companyName = clampStr(req.body?.companyName, 160);
      const jobTitle = clampStr(req.body?.jobTitle, 180);
      const rawJobUrl = clampStr(req.body?.jobUrl, 1000);
      const contactEmail = clampStr(req.body?.contactEmail, 200);
      const salaryOffered = clampStr(req.body?.salaryOffered, 120);
      const jobText = clampStr(req.body?.jobText, 12000);
      const lang = clampStr(req.body?.lang, 10) || 'fr';

      if (!companyName && !rawJobUrl && !jobText) {
        res.status(400).json({ error: 'Please provide at least a company name, job URL, or offer text.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);
      const hasValidHttpUrl = isSafePublicHttpUrl(rawJobUrl);
      const jobUrl = hasValidHttpUrl ? rawJobUrl : '';

      const prompt = `You are the JOBFOUNDS Job Authenticity & Verification Engine.
Investigate this job offer thoroughly using Google Search${hasValidHttpUrl ? ' AND by directly inspecting the live webpage at the provided Offer URL using URL Context' : ''} to assess its authenticity, expiration status, domain spoofing, and fraud risk.

Offer details submitted by user:
- Company Name: ${companyName || 'Not provided'}
- Job Title: ${jobTitle || 'Not provided'}
- Offer URL: ${jobUrl || 'Not provided'}
- Recruiter / Contact Email: ${contactEmail || 'Not provided'}
- Offered Salary: ${salaryOffered || 'Not provided'}
- Job Offer Text: ${jobText || 'Not provided'}

Evaluate ALL 10 criteria:
1. Existence de l'entreprise (Company legal/public existence)
2. Site officiel (Official corporate website match)
3. Domaine professionnel (Corporate email/URL domain authenticity vs free webmail/spoofed domain)
4. Cohérence de l'annonce (Role, salary, and requirements coherence)
5. Coordonnées officielles (Presence of verifiable official contact info)
6. Réputation de l'entreprise (Public employer reputation)
7. Signalements éventuels (Known scam alerts or complaints)
8. Duplications (Signs of mass-duplicated or scraped reposts)
9. Expiration (Check live page content if URL provided — whether the posting appears active or expired/404/closed)
10. Signes d'escroquerie (Advance-fee, Telegram/WhatsApp-only interviews, unrealistic pay, identity harvesting)

STRICT EPISTEMIC RULE:
NEVER guarantee authenticity ("Verified") when proof is insufficient!

Return ONLY a valid JSON object:
{
  "status": "Verified" | "Partially Verified" | "Unverified" | "Suspicious" | "Expired",
  "trustScore": 0-100,
  "verdictHeadline": "Clear concise verdict in ${outputLang}",
  "verdictExplanation": "Detailed objective reasoning in ${outputLang}, explicitly noting what was observed on the live URL (if inspected) and any missing evidence",
  "officialWebsite": "Verified official website URL or 'Non vérifié'",
  "officialDomain": "e.g. company.com or 'Inconnu'",
  "liveUrlFindings": "Summary of what direct URL inspection revealed (page active/expired/unreachable/domain mismatch) in ${outputLang}",
  "checks": [
    {
      "criterion": "Criterion label in ${outputLang}",
      "result": "Pass" | "Warning" | "Fail" | "Insufficient Data",
      "detail": "Factual finding in ${outputLang}"
    }
  ],
  "greenFlags": ["Factual positive signals in ${outputLang}"],
  "redFlags": ["Specific risk or missing-evidence warnings in ${outputLang}"],
  "recommendedNextSteps": ["Concrete protective actions for the candidate in ${outputLang}"]
}`;

      const tools: any[] = [{ googleSearch: {} }];
      if (hasValidHttpUrl) {
        tools.push({ urlContext: {} });
      }

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { tools },
      });

      const parsed = parseJsonFromText<any>(response.text);
      const sources = extractGroundingSources(response);

      res.json({
        ...parsed,
        urlInspected: hasValidHttpUrl,
        groundingSources: sources,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 4 — NATIVE PDF / DOCX / TXT CV IMPORT
  app.post('/api/cv/import-file', async (req, res) => {
    try {
      const { fileName = '', mimeType = '', base64Data = '', lang = 'fr' } = req.body ?? {};
      if (!base64Data) {
        res.status(400).json({ error: 'No file data provided.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);
      const lowerName = fileName.toLowerCase();
      const integrityRule = `ABSOLUTE INTEGRITY RULE: Extract ONLY real information explicitly present in the uploaded CV document. NEVER invent, fabricate, or guess degrees, employers, dates, or skills. Preserve exact factual history.`;

      const fileBuffer = Buffer.from(base64Data, 'base64');

      // Native PDF multimodal extraction directly via Gemini
      if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: base64Data,
                },
              },
              {
                text: `Extract structured CV data faithfully from this PDF resume. Keep all facts truthful and exact. Use the resume's language or ${outputLang} for labels if needed. Assign clean alphanumeric IDs to experiences and education items.`,
              },
            ],
          },
          config: {
            systemInstruction: integrityRule,
            responseMimeType: 'application/json',
            responseSchema: CV_PARSE_SCHEMA,
          },
        });
        res.json(parseJsonFromText(response.text));
        return;
      }

      // Native DOCX extraction via mammoth
      let extractedText = '';
      if (
        lowerName.endsWith('.docx') ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const mammothRes = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = mammothRes.value || '';
      } else {
        extractedText = fileBuffer.toString('utf8');
      }

      if (!extractedText.trim()) {
        res.status(400).json({ error: 'Could not extract readable text from the uploaded file.' });
        return;
      }

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: `Extract structured CV data faithfully from this extracted document text. Preserve every real fact without inventing anything missing.\n\nDOCUMENT TEXT:\n${extractedText.slice(0, 30000)}`,
        config: {
          systemInstruction: integrityRule,
          responseMimeType: 'application/json',
          responseSchema: CV_PARSE_SCHEMA,
        },
      });
      res.json(parseJsonFromText(response.text));
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 4 — AI CV BUILDER (Grammar, Optimization, Tailoring, Cover Letter, Text Parsing)
  app.post('/api/cv/optimize', async (req, res) => {
    try {
      const { action, cvData, rawText = '', targetJob = '', lang = 'fr' } = req.body ?? {};
      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const integrityRule = `ABSOLUTE INTEGRITY RULE: You MUST NEVER invent, fabricate, or hallucinate any degree, diploma, employer, job title, date, certification, or skill that is not already explicitly present in the candidate's provided data. Only improve clarity, grammar, structure, action verbs, and alignment using truthful facts provided by the user. If the target job requires skills missing from the CV, report them honestly in "honestGapNotes" instead of fabricating them.`;

      if (action === 'cover_letter') {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: `Draft a crisp, executive, authentic cover letter in ${outputLang} based strictly on the candidate's CV and the target job.\n\nCandidate CV:\n${JSON.stringify(cvData)}\n\nTarget Role / Company:\n${targetJob}`,
          config: {
            systemInstruction: integrityRule,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subject: { type: Type.STRING },
                letter: { type: Type.STRING },
                honestGapNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['subject', 'letter', 'honestGapNotes'],
            },
          },
        });
        res.json(parseJsonFromText(response.text));
        return;
      }

      if (action === 'import_parse') {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: `Extract structured CV data from this raw resume text. Preserve every fact faithfully without inventing anything missing. Output text in the original resume's language or ${outputLang}.\n\nRAW CV TEXT:\n${rawText}`,
          config: {
            systemInstruction: integrityRule,
            responseMimeType: 'application/json',
            responseSchema: CV_PARSE_SCHEMA,
          },
        });
        res.json(parseJsonFromText(response.text));
        return;
      }

      const modeInstructions: Record<string, string> = {
        correct: `Correct grammar, spelling, punctuation, and awkward phrasing across the CV in ${outputLang}. Keep facts 100% identical.`,
        optimize: `Refine wording, action verbs, and executive clarity across the summary and experience highlights in ${outputLang} for strong recruiter readability. Keep all employers, dates, degrees, and skills strictly truthful.`,
        tailor: `Adapt and prioritize the candidate's existing truthful summary, highlights, and skill ordering in ${outputLang} to match this target job description:\n${targetJob}\nNever add skills or degrees the candidate does not possess; list genuine gaps in honestGapNotes.`,
      };

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: `${modeInstructions[action] || modeInstructions.optimize}\n\nCURRENT CV JSON:\n${JSON.stringify(cvData)}`,
        config: {
          systemInstruction: integrityRule,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              summary: { type: Type.STRING },
              experiences: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    role: { type: Type.STRING },
                    company: { type: Type.STRING },
                    location: { type: Type.STRING },
                    period: { type: Type.STRING },
                    highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['id', 'role', 'company', 'location', 'period', 'highlights'],
                },
              },
              skills: { type: Type.ARRAY, items: { type: Type.STRING } },
              changeLog: { type: Type.ARRAY, items: { type: Type.STRING } },
              honestGapNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['headline', 'summary', 'experiences', 'skills', 'changeLog', 'honestGapNotes'],
          },
        },
      });

      res.json(parseJsonFromText(response.text));
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 5 — ATS RESUME ANALYZER
  app.post('/api/ats/analyze', async (req, res) => {
    try {
      const { cvText = '', jobDescription = '', lang = 'fr' } = req.body ?? {};
      if (!cvText.trim() || !jobDescription.trim()) {
        res.status(400).json({ error: 'Both CV content and job description are required.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: `Perform a rigorous ATS (Applicant Tracking System) audit comparing the candidate's CV against the target job description. Respond entirely in ${outputLang}.

CANDIDATE CV:
${cvText}

TARGET JOB DESCRIPTION:
${jobDescription}`,
        config: {
          systemInstruction:
            'You are an enterprise ATS Resume Analyzer. Be concrete, objective, and explain every score clearly. Never suggest fabricating qualifications; recommend truthful phrasing and structural improvements.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallScore: { type: Type.INTEGER },
              keywordMatchScore: { type: Type.INTEGER },
              skillsScore: { type: Type.INTEGER },
              structureScore: { type: Type.INTEGER },
              experienceAlignmentScore: { type: Type.INTEGER },
              matchedKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              matchedSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
              structureAudit: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    section: { type: Type.STRING },
                    status: { type: Type.STRING },
                    feedback: { type: Type.STRING },
                  },
                  required: ['section', 'status', 'feedback'],
                },
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    priority: { type: Type.STRING },
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                  },
                  required: ['priority', 'title', 'detail'],
                },
              },
              detailedReport: { type: Type.STRING },
            },
            required: [
              'overallScore',
              'keywordMatchScore',
              'skillsScore',
              'structureScore',
              'experienceAlignmentScore',
              'matchedKeywords',
              'missingKeywords',
              'matchedSkills',
              'missingSkills',
              'missingInformation',
              'structureAudit',
              'recommendations',
              'detailedReport',
            ],
          },
        },
      });

      res.json(parseJsonFromText(response.text));
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // MODULE 6 — SMART JOB MATCHING (Explainable 9-dimension analysis aligned with Central Engine)
  app.post('/api/match/evaluate', async (req, res) => {
    try {
      const { profile, job, lang = 'fr' } = req.body ?? {};
      if (!profile || !job) {
        res.status(400).json({ error: 'Candidate profile and job details are required.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: `Evaluate explainable compatibility between this candidate profile and job across ALL 9 mandatory dimensions (return EXACTLY 9 items in "dimensions" in this exact order):
1. Compétences (Skills)
2. Expérience professionnelle (Professional Experience)
3. Formation et diplômes (Education & Degrees)
4. Langues (Languages)
5. Localisation et mobilité (Location, Mobility & Work Mode)
6. Autorisation de travail et visa (Work Authorization & Visa)
7. Disponibilité (Availability)
8. Prétentions salariales (Salary Expectations)
9. Fiabilité de la source de l'offre (Offer Source Reliability & Verification Status)

Respond entirely in ${outputLang}. Remind clearly that this score is an explainable decision-support insight, never an automated hiring decision.

CANDIDATE PROFILE:
${JSON.stringify(profile)}

JOB:
${JSON.stringify(job)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallScore: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              advisoryNotice: { type: Type.STRING },
              dimensions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    score: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                  },
                  required: ['name', 'score', 'explanation'],
                },
              },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              gapsToAddress: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['overallScore', 'summary', 'advisoryNotice', 'dimensions', 'strengths', 'gapsToAddress'],
          },
        },
      });

      const parsed = parseJsonFromText<any>(response.text);
      const defaultNineNames =
        lang === 'fr'
          ? [
              'Compétences',
              'Expérience professionnelle',
              'Formation et diplômes',
              'Langues',
              'Localisation et mobilité',
              'Autorisation de travail et visa',
              'Disponibilité',
              'Prétentions salariales',
              'Fiabilité de la source de l’offre',
            ]
          : [
              'Skills',
              'Professional Experience',
              'Education & Degrees',
              'Languages',
              'Location & Mobility',
              'Work Authorization & Visa',
              'Availability',
              'Salary Expectations',
              'Offer Source Reliability',
            ];
      const rawDims = Array.isArray(parsed?.dimensions) ? parsed.dimensions : [];
      const sourceRelFallback =
        job.verificationStatus === 'Verified'
          ? 94
          : job.verificationStatus === 'Partially Verified'
            ? 74
            : 45;
      const normalizedDims = defaultNineNames.map((label, idx) => {
        const existing = rawDims[idx];
        if (existing && typeof existing.score === 'number') {
          return {
            name: String(existing.name || label),
            score: Math.max(0, Math.min(100, Math.round(existing.score))),
            explanation: String(existing.explanation || ''),
          };
        }
        return {
          name: label,
          score: idx === 8 ? sourceRelFallback : 65,
          explanation:
            idx === 8
              ? lang === 'fr'
                ? `Statut de vérification de la source : ${job.verificationStatus || 'Non vérifié'} (${job.sourceName || 'Source externe'}).`
                : `Source verification status: ${job.verificationStatus || 'Unverified'} (${job.sourceName || 'External source'}).`
              : lang === 'fr'
                ? 'Information partiellement renseignée dans le profil ou l’annonce.'
                : 'Partially specified in candidate profile or job listing.',
        };
      });

      res.json({
        ...parsed,
        dimensions: normalizedDims,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // RECRUITER & HR DECISION-MAKER DIRECTORY FINDER (Google Search Grounding + Live DNS MX Verification)
  app.post('/api/recruiters/find', async (req, res) => {
    try {
      const { company = '', country = '', department = '', lang = 'fr' } = req.body ?? {};
      if (!company.trim()) {
        res.status(400).json({ error: 'Company name is required.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const prompt = `You are the JOBFOUNDS Verified Recruiter & HR Decision-Maker Finder.
Use Google Search to identify ONLY real, publicly verifiable HR leaders, Talent Acquisition contacts, hiring departments, official career portals, and officially published corporate recruiting channels for:
- Company: ${company}
- Country / Region: ${country || 'Global / HQ'}
- Department / Role Focus: ${department || 'Talent Acquisition & Hiring Leadership'}

ZERO-FABRICATION RULE:
- NEVER invent a person's name, personal email address, or profile URL.
- If no named public HR contact is verifiably indexed, return an empty contacts array or ONLY the official careers portal/desk found verbatim in search results.
- Only include a corporateEmail if it is an officially published generic recruiting email found verbatim on the company's official domain (e.g. careers@company.com).

Return ONLY a valid JSON object in ${outputLang}:
{
  "companyOverview": "Short factual summary of the real company and its hiring structure in ${outputLang}",
  "officialDomain": "e.g. company.com (or empty string if unverified)",
  "careersPortalUrl": "Official HTTPS careers page URL from search results (or empty string)",
  "emailDomainStatus": "Verified" | "Partially Verified" | "Unverified",
  "contacts": [
    {
      "nameOrTitle": "Publicly verified HR leader name or official hiring desk title",
      "role": "Exact role (e.g. VP People / Talent Acquisition Lead)",
      "location": "City, Country",
      "channel": "Official Careers Portal / LinkedIn Public Profile / Official Recruiting Email",
      "corporateEmail": "Officially published generic recruiting email on the official domain only, else empty string",
      "publicUrl": "Real verifiable HTTPS URL from search results (never fabricated)",
      "confidenceLevel": "confirmed" | "probable" | "unverified",
      "verificationNote": "Transparent note stating the public source verified in ${outputLang}",
      "outreachTip": "Specific advice for approaching this stakeholder in ${outputLang}"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const parsed = parseJsonFromText<any>(response.text);
      const sources = extractGroundingSources(response);

      const safeCareersUrl = sanitizeHttpUrl(parsed?.careersPortalUrl);
      const rawDomain = clampStr(parsed?.officialDomain, 160)
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
        .trim()
        .toLowerCase();
      const officialDomain =
        rawDomain || (safeCareersUrl ? extractDomainFromUrl(safeCareersUrl) : '');

      // Live DNS MX check on the official corporate domain
      const mxCheck = officialDomain
        ? await verifyCorporateDomainMx(officialDomain)
        : { verified: false, mxHosts: [] as string[] };

      const verifiedEmailDomainStatus: 'Verified' | 'Partially Verified' | 'Unverified' =
        officialDomain && mxCheck.verified && (safeCareersUrl || sources.length > 0)
          ? 'Verified'
          : officialDomain && (mxCheck.verified || safeCareersUrl)
            ? 'Partially Verified'
            : 'Unverified';

      const sanitizedContacts = (Array.isArray(parsed?.contacts) ? parsed.contacts : [])
        .map((c: any) => {
          const publicUrl = sanitizeHttpUrl(c?.publicUrl);
          const rawEmail = String(c?.corporateEmail || '').trim().toLowerCase();
          const safeCorporateEmail =
            rawEmail &&
            mxCheck.verified &&
            officialDomain &&
            rawEmail.endsWith(`@${officialDomain}`) &&
            /^(careers|jobs|recruiting|recruitment|recrutement|talent|hr|rh|people|hiring|apply|contact)@/i.test(
              rawEmail
            )
              ? rawEmail
              : '';

          let confidenceLevel: 'confirmed' | 'probable' | 'unverified' =
            c?.confidenceLevel === 'confirmed' || c?.confidenceLevel === 'probable'
              ? c.confidenceLevel
              : 'unverified';
          if (confidenceLevel === 'confirmed' && !publicUrl && !safeCorporateEmail) {
            confidenceLevel = 'unverified';
          }

          return {
            nameOrTitle: clampStr(c?.nameOrTitle, 140),
            role: clampStr(c?.role, 140),
            location: clampStr(c?.location, 120),
            channel: clampStr(c?.channel, 120) || 'Canal public',
            corporateEmail: safeCorporateEmail || undefined,
            publicUrl,
            confidenceLevel,
            domainMxVerified: mxCheck.verified,
            verificationNote: clampStr(
              `${c?.verificationNote || ''}${
                mxCheck.verified
                  ? ` [DNS MX vérifié : ${mxCheck.mxHosts[0] || officialDomain}]`
                  : officialDomain
                    ? ' [DNS MX non confirmé]'
                    : ''
              }`,
              400
            ),
            outreachTip: clampStr(c?.outreachTip, 300),
          };
        })
        .filter((c: any) => Boolean(c.nameOrTitle && c.role));

      res.json({
        companyOverview: clampStr(parsed?.companyOverview, 800),
        officialDomain,
        careersPortalUrl: safeCareersUrl,
        emailDomainStatus: verifiedEmailDomainStatus,
        domainMxVerified: mxCheck.verified,
        mxHosts: mxCheck.mxHosts.slice(0, 3),
        contacts: sanitizedContacts,
        groundingSources: sources,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // INTERACTIVE LIVE INTERVIEW SIMULATOR
  app.post('/api/interview/simulate', async (req, res) => {
    try {
      const {
        role = '',
        company = '',
        details = '',
        profile = {},
        history = [],
        userAnswer = '',
        lang = 'fr',
      } = req.body ?? {};

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);
      const isOpening = !Array.isArray(history) || history.length === 0;
      const questionCount = Array.isArray(history)
        ? history.filter((m: any) => m.speaker === 'interviewer').length
        : 0;

      const prompt = isOpening
        ? `You are a senior hiring manager at ${company || 'an international enterprise'} interviewing a candidate for "${role}".
Context: ${details || 'Standard structured interview'}
Candidate profile: ${JSON.stringify(profile)}
Respond in ${outputLang}. Start the interactive interview with a concise, welcoming opening and Question 1 tailored to the role. Leave feedback null since the candidate has not answered yet.`
        : `You are a senior hiring manager at ${company || 'an international enterprise'} conducting a structured live interview for "${role}".
Respond entirely in ${outputLang}.
Candidate profile: ${JSON.stringify(profile)}
Interview transcript so far: ${JSON.stringify(history)}
Candidate's latest answer: "${userAnswer}"

Evaluate the candidate's latest answer objectively on Clarity (0-100), STAR Structure (0-100), and Role Relevance (0-100), give concrete strengths and one specific improvement tip.
${questionCount >= 5 ? 'This was the final question. Mark isComplete = true, leave nextQuestion empty, and provide a concise finalSummary of the full mock interview.' : 'Then ask the next progressive follow-up or behavioral/technical question (mark isComplete = false).'}`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              feedback: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                  overallScore: { type: Type.INTEGER },
                  clarity: { type: Type.INTEGER },
                  starStructure: { type: Type.INTEGER },
                  relevance: { type: Type.INTEGER },
                  strength: { type: Type.STRING },
                  improvement: { type: Type.STRING },
                },
                required: ['overallScore', 'clarity', 'starStructure', 'relevance', 'strength', 'improvement'],
              },
              nextQuestion: { type: Type.STRING },
              questionCategory: { type: Type.STRING },
              isComplete: { type: Type.BOOLEAN },
              finalSummary: { type: Type.STRING },
            },
            required: ['nextQuestion', 'questionCategory', 'isComplete', 'finalSummary'],
          },
        },
      });

      res.json(parseJsonFromText(response.text));
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // WATCHLIST LIVE SIGNAL CHECK (Google Search Grounding)
  app.post('/api/watchlist/check', async (req, res) => {
    try {
      const { kind = 'company', label = '', country = '', sector = '', lang = 'fr' } = req.body ?? {};
      if (!label.trim()) {
        res.status(400).json({ error: 'Watchlist label is required.' });
        return;
      }

      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      const prompt = `Search the web for the latest hiring signals, newly opened roles, funding, or expansion news for this watchlist target:
- Type: ${kind}
- Target: ${label}
- Country: ${country || 'Global'}
- Sector: ${sector || 'Any'}

Return ONLY a valid JSON object in ${outputLang}:
{
  "newSignalsCount": 0,
  "classification": "Confirmed Job" | "Active Hiring Signal" | "Potential Hiring Opportunity",
  "summary": "2 concise factual sentences summarizing the latest verified findings in ${outputLang}",
  "highlights": ["Short bullet 1", "Short bullet 2"]
}`;

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const parsed = parseJsonFromText<any>(response.text);
      const sources = extractGroundingSources(response);
      res.json({
        ...parsed,
        checkedAt: new Date().toISOString().slice(0, 10),
        groundingSources: sources,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // CAREER ASSIST — Spontaneous Outreach, Interview Prep, Global Salary & Visa Intelligence
  app.post('/api/career/assist', async (req, res) => {
    try {
      const { mode, payload = {}, lang = 'fr' } = req.body ?? {};
      const ai = getAiClient();
      const outputLang = getOutputLanguage(lang);

      if (mode === 'outreach') {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: `Write an authentic, concise spontaneous application / recruiter outreach kit in ${outputLang}.
NEVER invent credentials not present in the candidate profile.

Candidate Profile: ${JSON.stringify(payload.profile)}
Target Opportunity / Company: ${JSON.stringify(payload.opportunity)}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                emailSubject: { type: Type.STRING },
                emailBody: { type: Type.STRING },
                linkedinNote: { type: Type.STRING },
                followUpTip: { type: Type.STRING },
              },
              required: ['emailSubject', 'emailBody', 'linkedinNote', 'followUpTip'],
            },
          },
        });
        res.json(parseJsonFromText(response.text));
        return;
      }

      if (mode === 'interview') {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: `Create a targeted interview preparation brief in ${outputLang} for this candidate and target role. Ground suggested talking points strictly in the candidate's real background.

Role: ${payload.role}
Company: ${payload.company}
Job Details: ${payload.details || 'Not specified'}
Candidate Profile: ${JSON.stringify(payload.profile)}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                roleBrief: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING },
                      question: { type: Type.STRING },
                      whyAsked: { type: Type.STRING },
                      starGuidance: { type: Type.STRING },
                    },
                    required: ['category', 'question', 'whyAsked', 'starGuidance'],
                  },
                },
                questionsForRecruiter: { type: Type.ARRAY, items: { type: Type.STRING } },
                preparationChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['roleBrief', 'questions', 'questionsForRecruiter', 'preparationChecklist'],
            },
          },
        });
        res.json(parseJsonFromText(response.text));
        return;
      }

      if (mode === 'salary_visa') {
        const prompt = `You are the JOBFOUNDS Global Compensation, Visa & Work Permit Intelligence Engine.
Use Google Search to gather accurate, up-to-date salary benchmarks and official work permit/visa regulations for:
- Target Role: ${payload.role}
- Experience Level: ${payload.experienceLevel || 'Mid-Senior'}
- Destination Country & City: ${payload.destinationCountry} ${payload.destinationCity ? `(${payload.destinationCity})` : ''}
- Candidate Origin / Nationality / Residency: ${payload.originCountry || 'International applicant'}

Return ONLY a valid JSON object in ${outputLang}:
{
  "currency": "EUR / USD / CHF / GBP / CAD / etc.",
  "salaryBands": {
    "p25": "e.g. 58,000 EUR",
    "median": "e.g. 72,000 EUR",
    "p75": "e.g. 90,000 EUR",
    "executive": "e.g. 115,000+ EUR"
  },
  "marketContext": "2-3 factual sentences on demand, tax/net estimate, and cost of living in ${outputLang}",
  "visaPathways": [
    {
      "name": "Official visa / work permit name",
      "eligibility": "Key salary threshold, degree, or employer sponsorship requirements in ${outputLang}",
      "typicalTimeline": "Estimated processing window",
      "employerSponsorshipRequired": true
    }
  ],
  "practicalAdvice": ["Actionable relocation & negotiation tips in ${outputLang}"],
  "disclaimer": "Short reminder in ${outputLang} to verify legal eligibility with official immigration authorities."
}`;

        const response = await ai.models.generateContent({
          model: MODEL,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
        const parsed = parseJsonFromText<any>(response.text);
        const sources = extractGroundingSources(response);
        res.json({ ...parsed, groundingSources: sources });
        return;
      }

      res.status(400).json({ error: 'Unsupported assist mode.' });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // OPENSTREETMAP / NOMINATIM FREE GEOCODING & REVERSE GEOCODING (Rate-limited + Cached + Fallback)
  app.get('/api/geo/search', feedsLimiter, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const city = typeof req.query.city === 'string' ? req.query.city : '';
      const country = typeof req.query.country === 'string' ? req.query.country : '';
      const lang = typeof req.query.lang === 'string' ? req.query.lang : 'fr';
      const limit = Number(req.query.limit) || 6;

      if (!q.trim() && !city.trim() && !country.trim()) {
        res.status(400).json({ error: 'Please specify a city, country, or address query.' });
        return;
      }

      const result = await searchNominatimPlaces({ q, city, country, lang, limit });
      res.json(result);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/geo/reverse', feedsLimiter, async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const lang = typeof req.query.lang === 'string' ? req.query.lang : 'fr';

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: 'Valid lat and lon query parameters are required.' });
        return;
      }

      const result = await reverseNominatimPlace({ lat, lon, lang });
      res.json(result);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/geo/resolve-batch', feedsLimiter, async (req, res) => {
    try {
      const labels = Array.isArray(req.body?.labels)
        ? req.body.labels.filter((item: unknown): item is string => typeof item === 'string')
        : [];
      const lang = typeof req.body?.lang === 'string' ? req.body.lang : 'fr';
      const resolved = await resolveLocationsBatch(labels, lang);
      res.json({ resolved });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);
  attachLiveVoiceBridge(httpServer, getAiClient);

  // Vite dev middleware or static production build
  const projectRoot =
    process.env.JOBFOUNDS_PROJECT_ROOT ||
    (fs.existsSync(path.join(__dirname, 'package.json'))
      ? __dirname
      : path.resolve(__dirname, '..'));
  const distPath = path.resolve(projectRoot, 'dist');
  const isCompiledServerJs =
    __filename.endsWith('.js') ||
    __filename.endsWith('.mjs') ||
    process.env.JOBFOUNDS_COMPILED_ENTRY === '1';
  const isProd =
    process.env.NODE_ENV === 'production' ||
    ((isCompiledServerJs || process.env.npm_lifecycle_event === 'start') &&
      fs.existsSync(path.join(distPath, 'index.html')));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: hmrDisabled ? false : { server: httpServer },
        hmr: hmrDisabled ? false : true,
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript; charset=utf-8').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
      });
    }

    app.use(vite.middlewares);
  } else {
    const indexHtmlPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtmlPath);
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `JOBFOUNDS server listening on http://0.0.0.0:${PORT} (mode=${isProd ? 'production' : 'development'}, worker=${getWorkerMode()})`
    );
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`[JOBFOUNDS] Received ${signal}, shutting down cleanly...`);
    httpServer.close(() => {
      closeEngineDb();
      process.exit(0);
    });
    setTimeout(() => {
      closeEngineDb();
      process.exit(0);
    }, 8000).unref();
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start JOBFOUNDS server:', err);
  process.exit(1);
});
