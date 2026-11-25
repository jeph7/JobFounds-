import dns from 'dns/promises';
import { GoogleGenAI } from '@google/genai';
import {
  type BackgroundJobRecord,
  type CandidateSubscriptionRecord,
  type CompanyRecord,
  type CompanySignalRecord,
  type ContactConfidenceLevel,
  type NeedClassification,
  type SignalType,
  claimNextDueJob,
  completeBackgroundJob,
  countQueuedBackgroundJobs,
  createNotification,
  enqueueBackgroundJob,
  failBackgroundJob,
  getCompanyById,
  getDailyAiUsageSummary,
  isSourceEnabled,
  listActiveCandidateSubscriptions,
  listAllActiveCareerJobs,
  listCompanies,
  listHrContacts,
  listSignals,
  logAiUsage,
  recordCompanySignal,
  recordCrmEmailSyncEvent,
  recordSourceCall,
  recoverStaleRunningJobs,
  updateCompanyMonitored,
  upsertCompany,
  upsertHrContact,
  writeAuditLog,
} from './serverEngineDb.ts';
import { monitorCompanyCareerPage } from './serverCareerMonitor.ts';
import { clampStr, sanitizeHttpUrl } from './serverSecurity.ts';

const MODEL = 'gemini-4-hydrogen';

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

function parseJsonFromText<T>(rawText: string | undefined): T {
  const text = (rawText ?? '').trim();
  if (!text) throw new Error('Empty AI response.');
  try {
    return JSON.parse(text) as T;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim()) as T;
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Could not parse JSON from AI output.');
  }
}

function extractGroundingSources(response: any): Array<{ title: string; uri: string }> {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const out: Array<{ title: string; uri: string }> = [];
  for (const ch of chunks) {
    const uri = sanitizeHttpUrl(ch?.web?.uri);
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push({ title: clampStr(ch?.web?.title || uri, 160), uri });
    }
  }
  return out;
}

/**
 * Real DNS MX verification to check whether an organization's corporate domain accepts email.
 */
export async function verifyCorporateDomainMx(domain: string): Promise<{
  verified: boolean;
  mxHosts: string[];
}> {
  if (!domain || !domain.includes('.')) return { verified: false, mxHosts: [] };
  if (!isSourceEnabled('dns_mx_verifier')) return { verified: false, mxHosts: [] };
  try {
    const records = await dns.resolveMx(domain);
    const hosts = (records || []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    recordSourceCall('dns_mx_verifier', true);
    return { verified: hosts.length > 0, mxHosts: hosts.slice(0, 5) };
  } catch (err) {
    recordSourceCall('dns_mx_verifier', false, err instanceof Error ? err.message : String(err));
    return { verified: false, mxHosts: [] };
  }
}

/**
 * Scans public verified web sources for company expansion, office openings, contracts,
 * new departments, and hiring demand signals. Never presents suppositions as confirmed needs.
 */
export async function scanCompanySignals(
  companyId: string,
  actorUid = 'scheduler'
): Promise<{ companyId: string; insertedSignals: number; signals: CompanySignalRecord[] }> {
  const company = getCompanyById(companyId);
  if (!company) throw new Error(`Company ${companyId} not found.`);
  if (!isSourceEnabled('gemini_google_search')) {
    throw new Error('Source gemini_google_search is paused or rate-limited.');
  }
  const budget = getDailyAiUsageSummary();
  if (!budget.withinBudget) {
    throw new Error(
      `Daily AI quota limit reached (${budget.callsToday}/${budget.maxCallsPerDay} calls, $${budget.estimatedCostUsdToday}/$${budget.maxCostUsdPerDay}).`
    );
  }

  const ai = getAiClient();
  const started = Date.now();
  const prompt = `You are a strict recruitment intelligence analyst for JOBFOUNDS.
Search public official news, press releases, funding announcements, contract wins, office openings, and department launches for:
- Company: ${company.officialName}
- Website/Domain: ${company.officialWebsite || company.domain || 'Unknown'}
- Country/Location: ${company.country} ${company.location}
- Sector: ${company.sector || 'Unknown'}

STRICT EPISTEMIC RULES:
1. Only return signals backed by real public search findings from the past 18 months. If nothing verifiable is found, return an empty array.
2. NEVER classify an unconfirmed supposition as "confirmed_job" or "confirmed_hiring_need".
   - Use "confirmed_hiring_need" ONLY when the company officially announced a hiring plan/headcount target.
   - Use "probable_hiring_signal" for verified funding, expansion, new office, major contract, or new department creation.
   - Use "potential_opportunity" for indirect or early growth indicators.
3. Include real source URLs found via Google Search. Never fabricate URLs.

Return ONLY valid JSON:
{
  "estimatedSize": "updated size estimate if found or empty string",
  "sector": "sector if clarified or empty string",
  "signals": [
    {
      "signalType": "expansion | new_office | contract_project | new_department | frequent_hiring | growth_announcement | skill_demand",
      "classification": "confirmed_hiring_need | probable_hiring_signal | potential_opportunity",
      "title": "Concise factual headline",
      "summary": "Factual explanation of the signal and why it may create hiring needs without exaggeration",
      "evidenceQuote": "Short factual excerpt or concrete figure/date from the public source",
      "skillsInferred": ["Skill 1", "Skill 2"],
      "sourceName": "Publisher or official source name",
      "sourceUrl": "https://...",
      "detectedDate": "YYYY-MM-DD",
      "relevanceScore": 75
    }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const usage = (response as any).usageMetadata;
    logAiUsage({
      uid: actorUid,
      endpoint: 'worker:scan_company_signals',
      model: MODEL,
      promptTokens: usage?.promptTokenCount || 800,
      outputTokens: usage?.candidatesTokenCount || 600,
      status: 'ok',
      latencyMs: Date.now() - started,
    });
    recordSourceCall('gemini_google_search', true);

    const parsed = parseJsonFromText<{
      estimatedSize?: string;
      sector?: string;
      signals?: Array<any>;
    }>(response.text);
    const groundingSources = extractGroundingSources(response);
    const validSignalTypes = new Set<SignalType>([
      'expansion',
      'new_office',
      'contract_project',
      'new_department',
      'frequent_hiring',
      'growth_announcement',
      'skill_demand',
      'career_page_surge',
    ]);
    const validClassifications = new Set<NeedClassification>([
      'confirmed_hiring_need',
      'probable_hiring_signal',
      'potential_opportunity',
    ]);

    const insertedList: CompanySignalRecord[] = [];
    let insertedCount = 0;

    for (const raw of Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6) : []) {
      const signalType: SignalType = validSignalTypes.has(raw.signalType)
        ? raw.signalType
        : 'growth_announcement';
      let classification: NeedClassification = validClassifications.has(raw.classification)
        ? raw.classification
        : 'potential_opportunity';

      const sourceUrl =
        sanitizeHttpUrl(raw.sourceUrl) || groundingSources[0]?.uri || '';

      // Deterministic epistemic guardrail: without any verifiable URL source, cap at potential_opportunity
      if (!sourceUrl && classification !== 'potential_opportunity') {
        classification = 'potential_opportunity';
      }

      const reliabilityScore =
        sourceUrl && groundingSources.length >= 2
          ? 85
          : sourceUrl
            ? 72
            : 42;

      const { signal, inserted } = recordCompanySignal({
        companyId,
        signalType,
        classification,
        title: clampStr(raw.title || 'Signal de croissance détecté', 220),
        summary: clampStr(raw.summary || '', 1400),
        evidenceQuote: clampStr(raw.evidenceQuote || '', 500),
        skillsInferred: Array.isArray(raw.skillsInferred) ? raw.skillsInferred : [],
        sourceName: clampStr(raw.sourceName || groundingSources[0]?.title || 'Public Web Source', 120),
        sourceUrl,
        detectedAt:
          typeof raw.detectedDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.detectedDate)
            ? new Date(raw.detectedDate).toISOString()
            : new Date().toISOString(),
        reliabilityScore,
        relevanceScore: Math.min(95, Math.max(25, Number(raw.relevanceScore || 65))),
      });
      insertedList.push(signal);
      if (inserted) insertedCount++;
    }

    updateCompanyMonitored(companyId, {
      estimatedSize: parsed.estimatedSize || company.estimatedSize,
      sector: parsed.sector || company.sector,
      lastMonitoredAt: new Date().toISOString(),
    });

    return { companyId, insertedSignals: insertedCount, signals: insertedList };
  } catch (err) {
    logAiUsage({
      uid: actorUid,
      endpoint: 'worker:scan_company_signals',
      model: MODEL,
      status: 'error',
      latencyMs: Date.now() - started,
    });
    recordSourceCall('gemini_google_search', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Discovers publicly verifiable HR, Talent Acquisition, and Hiring Managers for a company
 * + runs real DNS MX corporate domain verification. Never fabricates personal emails or names.
 */
export async function discoverVerifiedHrContacts(
  companyId: string,
  departmentFocus = '',
  actorUid = 'scheduler'
): Promise<{ companyId: string; mxVerified: boolean; insertedCount: number; contacts: any[] }> {
  const company = getCompanyById(companyId);
  if (!company) throw new Error(`Company ${companyId} not found.`);
  if (!isSourceEnabled('gemini_google_search')) {
    throw new Error('Source gemini_google_search is paused or rate-limited.');
  }
  const budget = getDailyAiUsageSummary();
  if (!budget.withinBudget) {
    throw new Error('Daily AI quota reached.');
  }

  const mxResult = await verifyCorporateDomainMx(company.domain);

  const ai = getAiClient();
  const started = Date.now();
  const prompt = `Identify publicly listed HR Managers, Talent Acquisition Managers, Recruitment Managers, Heads of Talent, or Hiring Managers/Department Directors at:
- Company: ${company.officialName}
- Domain: ${company.domain || company.officialWebsite || 'Unknown'}
- Country: ${company.country || 'International'}
- Department focus: ${departmentFocus || 'All recruiting / hiring departments'}

STRICT COMPLIANCE & ANTI-HALLUCINATION RULES:
1. NEVER invent a person's name, email address, or profile URL.
2. Only list individuals or official recruiting teams actually found in public search results (official company leadership/team/press page, public LinkedIn profile URL indexed by Google, or official careers page).
3. Do NOT guess personal emails. Only mention official public recruiting channels (e.g. official careers portal or publicly published recruiting email).
4. Set confidenceLevel honestly:
   - "confirmed": real public profile or official company page URL verified in search results.
   - "probable": publicly mentioned role at the company from a secondary public source.
   - "unverified": general official department/channel without named confirmed profile.

Return ONLY valid JSON:
{
  "contacts": [
    {
      "fullName": "Real publicly listed full name OR Official Department Name",
      "roleTitle": "Exact title (e.g. Head of Talent Acquisition)",
      "department": "People / Talent / Engineering / etc.",
      "roleCategory": "HR Manager | Talent Acquisition | Recruitment Manager | Hiring Manager | Department Director | Head of Talent | Other",
      "publicProfileUrl": "https://... (only if real and verified in search, else empty string)",
      "publicChannel": "LinkedIn Public Profile / Official Careers Team / Press Page",
      "sourceName": "Source name",
      "sourceUrl": "https://...",
      "confidenceLevel": "confirmed | probable | unverified",
      "verificationNote": "Short transparent note explaining what was publicly verified"
    }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const usage = (response as any).usageMetadata;
    logAiUsage({
      uid: actorUid,
      endpoint: 'worker:discover_hr_contacts',
      model: MODEL,
      promptTokens: usage?.promptTokenCount || 700,
      outputTokens: usage?.candidatesTokenCount || 550,
      status: 'ok',
      latencyMs: Date.now() - started,
    });
    recordSourceCall('gemini_google_search', true);

    const parsed = parseJsonFromText<{ contacts?: any[] }>(response.text);
    const groundingSources = extractGroundingSources(response);

    let insertedCount = 0;
    const savedContacts: any[] = [];
    for (const raw of Array.isArray(parsed.contacts) ? parsed.contacts.slice(0, 8) : []) {
      const fullName = clampStr(raw.fullName, 120);
      const roleTitle = clampStr(raw.roleTitle, 140);
      if (!fullName || !roleTitle) continue;

      const publicProfileUrl = sanitizeHttpUrl(raw.publicProfileUrl);
      const sourceUrl = sanitizeHttpUrl(raw.sourceUrl) || publicProfileUrl || groundingSources[0]?.uri || '';
      const hasVerifiableLink = Boolean(publicProfileUrl || sourceUrl);

      let confidenceLevel: ContactConfidenceLevel =
        raw.confidenceLevel === 'confirmed' || raw.confidenceLevel === 'probable'
          ? raw.confidenceLevel
          : 'unverified';

      // Guardrail: cannot be "confirmed" without an actual verifiable public URL
      if (confidenceLevel === 'confirmed' && !hasVerifiableLink) {
        confidenceLevel = 'unverified';
      }

      const confidenceScore =
        confidenceLevel === 'confirmed'
          ? mxResult.verified ? 90 : 80
          : confidenceLevel === 'probable'
            ? mxResult.verified ? 68 : 58
            : 38;

      const { contact, inserted } = upsertHrContact({
        companyId,
        fullName,
        roleTitle,
        department: clampStr(raw.department || '', 100),
        roleCategory: clampStr(raw.roleCategory || 'Other', 80),
        publicProfileUrl,
        publicChannel: clampStr(raw.publicChannel || 'Public Professional Source', 120),
        emailDomainVerified: Boolean(company.domain && mxResult.verified),
        mxVerified: mxResult.verified,
        sourceName: clampStr(raw.sourceName || groundingSources[0]?.title || 'Public Web Search', 120),
        sourceUrl,
        confidenceLevel,
        confidenceScore,
        verificationNote: clampStr(
          `${raw.verificationNote || ''}${mxResult.verified ? ` [DNS MX vérifié: ${mxResult.mxHosts[0]}]` : ''}`,
          400
        ),
      });
      savedContacts.push(contact);
      if (inserted) insertedCount++;
    }

    return {
      companyId,
      mxVerified: mxResult.verified,
      insertedCount,
      contacts: savedContacts,
    };
  } catch (err) {
    logAiUsage({
      uid: actorUid,
      endpoint: 'worker:discover_hr_contacts',
      model: MODEL,
      status: 'error',
      latencyMs: Date.now() - started,
    });
    recordSourceCall('gemini_google_search', false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Central Explainable Matching Engine (Published Jobs + Non-Published Needs)
// -----------------------------------------------------------------------------
export interface IntelligenceMatchItem {
  id: string;
  companyId: string;
  companyName: string;
  companyWebsite: string;
  companySector: string;
  companyCountry: string;
  companyLocation: string;
  classification: NeedClassification;
  title: string;
  score: number;
  breakdown: {
    skillsScore: number;
    locationMobilityScore: number;
    experienceRoleScore: number;
    signalReliabilityScore: number;
  };
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
  evidenceSummary: string;
  evidenceUrl: string;
  detectedAt: string;
  recommendedContact?: {
    fullName: string;
    roleTitle: string;
    confidenceLevel: ContactConfidenceLevel;
    publicProfileUrl: string;
  } | null;
}

function normalizeTokens(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

export function computeCandidateIntelligenceMatches(profile: {
  currentTitle?: string;
  yearsExperience?: number;
  highestDegree?: string;
  skills?: string[];
  languages?: string[];
  preferredCountries?: string[];
  preferredCities?: string[];
  preferredWorkModes?: string[];
  originCountry?: string;
  workAuthorization?: string;
  relocationReady?: boolean;
  availability?: string;
  minSalaryAnnualUsd?: number;
  targetSectors?: string[];
}): IntelligenceMatchItem[] {
  const companies = listCompanies({ limit: 150 });
  const companyMap = new Map<string, CompanyRecord>(companies.map((c) => [c.id, c]));
  const activeJobs = listAllActiveCareerJobs(200);
  const signals = listSignals({ limit: 150 });
  const contacts = listHrContacts({ limit: 200 });

  const contactsByCompany = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const arr = contactsByCompany.get(c.companyId) || [];
    arr.push(c);
    contactsByCompany.set(c.companyId, arr);
  }

  const candSkills = normalizeTokens(profile.skills);
  const candCountries = normalizeTokens(profile.preferredCountries);
  const candModes = normalizeTokens(profile.preferredWorkModes);
  const candSectors = normalizeTokens(profile.targetSectors);
  const titleWords = (profile.currentTitle || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 3);

  const results: IntelligenceMatchItem[] = [];

  const scoreItem = (params: {
    company: CompanyRecord;
    itemTitle: string;
    itemSkills: string[];
    itemCountry: string;
    itemWorkMode?: string;
    reliability: number;
  }) => {
    const reqSkills = Array.from(
      new Set([...normalizeTokens(params.itemSkills), ...normalizeTokens(params.company.frequentSkills)])
    );
    const matchedSkills = reqSkills.filter((rs) =>
      candSkills.some((cs) => cs === rs || cs.includes(rs) || rs.includes(cs))
    );
    const missingSkills = reqSkills.filter((rs) => !matchedSkills.includes(rs)).slice(0, 6);

    const skillsScore =
      reqSkills.length > 0
        ? Math.min(100, Math.round((matchedSkills.length / Math.min(reqSkills.length, 6)) * 100))
        : 55;

    // Location & international mobility
    let locationMobilityScore = 60;
    const itemCountryLow = (params.itemCountry || params.company.country || '').toLowerCase();
    const isRemote = (params.itemWorkMode || '').toLowerCase() === 'remote';
    if (isRemote && (candModes.length === 0 || candModes.includes('remote'))) {
      locationMobilityScore = 95;
    } else if (
      candCountries.length === 0 ||
      candCountries.some((c) => itemCountryLow.includes(c) || c.includes(itemCountryLow))
    ) {
      locationMobilityScore = 92;
    } else if (profile.relocationReady) {
      locationMobilityScore = 74;
    } else {
      locationMobilityScore = 40;
    }

    // Role / Sector alignment
    const combinedText = `${params.itemTitle} ${params.company.sector} ${params.company.officialName}`.toLowerCase();
    const titleHits = titleWords.filter((w) => combinedText.includes(w)).length;
    const sectorHit =
      candSectors.length > 0 &&
      candSectors.some((sec) => params.company.sector.toLowerCase().includes(sec));
    const experienceRoleScore = Math.min(
      100,
      45 + titleHits * 18 + (sectorHit ? 22 : 0) + (profile.yearsExperience && profile.yearsExperience >= 3 ? 8 : 0)
    );

    const signalReliabilityScore = Math.min(100, Math.max(20, Math.round(params.reliability)));

    const total = Math.round(
      skillsScore * 0.38 +
        locationMobilityScore * 0.24 +
        experienceRoleScore * 0.23 +
        signalReliabilityScore * 0.15
    );

    return {
      score: Math.min(99, Math.max(15, total)),
      breakdown: {
        skillsScore,
        locationMobilityScore,
        experienceRoleScore,
        signalReliabilityScore,
      },
      matchedSkills: matchedSkills.slice(0, 8),
      missingSkills,
    };
  };

  // 1. Officially published career jobs (Tier 1: confirmed_job)
  for (const job of activeJobs) {
    const company = companyMap.get(job.companyId);
    if (!company) continue;
    const scored = scoreItem({
      company,
      itemTitle: `${job.title} ${job.department}`,
      itemSkills: job.skills,
      itemCountry: job.country || company.country,
      itemWorkMode: job.workMode,
      reliability: 96,
    });
    const bestContact = (contactsByCompany.get(company.id) || [])[0] || null;
    results.push({
      id: `match_job_${job.id}`,
      companyId: company.id,
      companyName: company.officialName,
      companyWebsite: company.officialWebsite,
      companySector: company.sector,
      companyCountry: job.country || company.country,
      companyLocation: job.location || company.location,
      classification: 'confirmed_job',
      title: job.title,
      ...scored,
      explanation: `Offre officiellement publiée sur ${job.atsSource} (${job.workMode}, ${job.location}). ${
        scored.matchedSkills.length
          ? `Compétences alignées : ${scored.matchedSkills.join(', ')}.`
          : `Alignement sectoriel et rôle sur ${company.sector || company.officialName}.`
      }${profile.workAuthorization ? ` Autorisation déclarée : ${profile.workAuthorization}.` : ''}`,
      evidenceSummary: `Détectée via ${job.atsSource} le ${job.firstSeenAt.slice(0, 10)} (statut actif).`,
      evidenceUrl: job.url || company.careersUrl,
      detectedAt: job.firstSeenAt,
      recommendedContact: bestContact
        ? {
            fullName: bestContact.fullName,
            roleTitle: bestContact.roleTitle,
            confidenceLevel: bestContact.confidenceLevel,
            publicProfileUrl: bestContact.publicProfileUrl,
          }
        : null,
    });
  }

  // 2. Non-published hiring needs & growth signals (Tiers 2, 3, 4)
  for (const sig of signals) {
    if (sig.classification === 'confirmed_job') continue;
    const company = companyMap.get(sig.companyId);
    if (!company) continue;
    const scored = scoreItem({
      company,
      itemTitle: `${sig.title} ${sig.summary}`,
      itemSkills: sig.skillsInferred,
      itemCountry: company.country,
      reliability: sig.reliabilityScore,
    });
    const bestContact = (contactsByCompany.get(company.id) || [])[0] || null;
    const tierLabel =
      sig.classification === 'confirmed_hiring_need'
        ? 'Besoin de recrutement confirmé'
        : sig.classification === 'probable_hiring_signal'
          ? 'Signal de recrutement probable'
          : 'Opportunité potentielle non confirmée';

    results.push({
      id: `match_sig_${sig.id}`,
      companyId: company.id,
      companyName: company.officialName,
      companyWebsite: company.officialWebsite,
      companySector: company.sector,
      companyCountry: company.country,
      companyLocation: company.location,
      classification: sig.classification,
      title: sig.title,
      ...scored,
      explanation: `${tierLabel} chez ${company.officialName} (${sig.signalType}). ${
        scored.matchedSkills.length
          ? `Vos compétences (${scored.matchedSkills.join(', ')}) répondent aux besoins inférés.`
          : `Pertinent pour une approche spontanée ciblée dans le secteur ${company.sector || 'cible'}.`
      }`,
      evidenceSummary: `${sig.summary}${sig.evidenceQuote ? ` — « ${sig.evidenceQuote} »` : ''} (Source: ${sig.sourceName})`,
      evidenceUrl: sig.sourceUrl || company.careersUrl || company.officialWebsite,
      detectedAt: sig.detectedAt,
      recommendedContact: bestContact
        ? {
            fullName: bestContact.fullName,
            roleTitle: bestContact.roleTitle,
            confidenceLevel: bestContact.confidenceLevel,
            publicProfileUrl: bestContact.publicProfileUrl,
          }
        : null,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 60);
}

// -----------------------------------------------------------------------------
// Real Email Delivery (Optional via RESEND_API_KEY) + Notification Dispatcher
// -----------------------------------------------------------------------------
function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBrandedEmailHtml(params: { subject: string; text: string; actionUrl?: string }): string {
  const safeSubject = escapeHtml(params.subject);
  const safeBody = escapeHtml(params.text).replace(/\n/g, '<br />');
  const safeAction = params.actionUrl && /^https?:\/\//i.test(params.actionUrl) ? escapeHtml(params.actionUrl) : '';
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background-color:#F4F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#06132F;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #D5EBFA;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#06132F;padding:20px 24px;color:#FFFFFF;">
          <div style="font-size:18px;font-weight:700;letter-spacing:0.5px;">JOBFOUNDS</div>
          <div style="font-size:12px;color:#A9D8F5;margin-top:4px;">Global AI Career &amp; Recruitment Intelligence</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <h1 style="margin:0 0 12px 0;font-size:17px;color:#06132F;">${safeSubject}</h1>
          <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#102B52;">${safeBody}</p>
          ${
            safeAction
              ? `<a href="${safeAction}" style="display:inline-block;padding:10px 18px;background:#287BC7;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consulter la source officielle</a>`
              : ''
          }
        </td>
      </tr>
      <tr>
        <td style="padding:14px 24px;background:#F4F8FC;border-top:1px solid #D5EBFA;font-size:11px;color:#475569;">
          Notification réelle envoyée par JOBFOUNDS — Powered by VADIVAN. Vous pouvez ajuster vos préférences d’alertes dans l’espace Veille &amp; Alertes.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function getResendConfigStatus(): {
  resendKeyConfigured: boolean;
  fromEmailConfigured: boolean;
  fromEmail: string;
  ready: boolean;
} {
  const resendKeyConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL?.trim() || '';
  const fromEmailConfigured = Boolean(fromEmail);
  return {
    resendKeyConfigured,
    fromEmailConfigured,
    fromEmail,
    ready: resendKeyConfigured && fromEmailConfigured,
  };
}

async function sendTransactionalEmailIfConfigured(params: {
  to: string;
  subject: string;
  text: string;
  actionUrl?: string;
}): Promise<{ emailSent: boolean; emailReason: string; messageId?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFICATION_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return {
      emailSent: false,
      emailReason: 'Email relay not configured (set RESEND_API_KEY and NOTIFICATION_FROM_EMAIL)',
    };
  }
  if (!isSourceEnabled('resend_email')) {
    return { emailSent: false, emailReason: 'Email source paused by administrator' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: buildBrandedEmailHtml(params),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      recordSourceCall('resend_email', false, `HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return { emailSent: false, emailReason: `Resend API error (${res.status}): ${errText.slice(0, 140)}` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    recordSourceCall('resend_email', true);
    return { emailSent: true, emailReason: 'Delivered via Resend', messageId: body.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSourceCall('resend_email', false, msg);
    return { emailSent: false, emailReason: msg };
  }
}

export async function sendTestResendEmail(toEmail: string): Promise<{
  emailSent: boolean;
  emailReason: string;
  messageId?: string;
  config: ReturnType<typeof getResendConfigStatus>;
}> {
  const config = getResendConfigStatus();
  const res = await sendTransactionalEmailIfConfigured({
    to: toEmail,
    subject: '[JOBFOUNDS] Test de livraison e-mail Resend réussi',
    text: `Ce message confirme que le relais e-mail transactionnel Resend de JOBFOUNDS est correctement configuré et opérationnel.\n\nDate UTC : ${new Date().toISOString()}`,
    actionUrl: process.env.APP_URL || '',
  });
  return { ...res, config };
}

export async function dispatchNotificationsForCandidate(
  sub: CandidateSubscriptionRecord,
  minScore = 62
): Promise<{ uid: string; createdCount: number }> {
  const matches = computeCandidateIntelligenceMatches({
    ...sub.profile,
    preferredCountries: sub.preferredCountries.length
      ? sub.preferredCountries
      : sub.profile?.preferredCountries,
    targetSectors: sub.preferredSectors.length
      ? sub.preferredSectors
      : sub.profile?.targetSectors,
  });

  let createdCount = 0;
  for (const m of matches.filter((x) => x.score >= minScore).slice(0, 8)) {
    const notifType =
      m.classification === 'confirmed_job'
        ? 'new_job'
        : m.classification === 'confirmed_hiring_need'
          ? 'hiring_signal'
          : 'hidden_opportunity';

    let emailStatus = { emailSent: false, emailReason: 'User email alerts disabled' };
    if (sub.channels?.email && sub.email) {
      emailStatus = await sendTransactionalEmailIfConfigured({
        to: sub.email,
        subject: `[JOBFOUNDS] ${m.companyName} — ${m.title} (${m.score}%)`,
        text: `${m.explanation}\n\nPreuve : ${m.evidenceSummary}\nLien : ${m.evidenceUrl || 'Connectez-vous à JOBFOUNDS'}`,
        actionUrl: m.evidenceUrl,
      });
    }

    const { created } = createNotification({
      uid: sub.uid,
      type: notifType,
      title: `${m.companyName} · ${m.title}`,
      body: `${m.explanation} ${m.recommendedContact ? `Contact identifié : ${m.recommendedContact.fullName} (${m.recommendedContact.roleTitle}).` : ''}`,
      companyId: m.companyId,
      companyName: m.companyName,
      classification: m.classification,
      matchScore: m.score,
      evidenceUrl: m.evidenceUrl,
      channelStatus: {
        inApp: Boolean(sub.channels?.inApp ?? true),
        emailSent: emailStatus.emailSent,
        emailReason: emailStatus.emailReason,
        pushReady: Boolean(sub.channels?.push),
      },
      dedupKey: `ntf_${m.id}`,
    });
    if (created) createdCount++;
  }
  return { uid: sub.uid, createdCount };
}

export async function dispatchNotificationsForAllSubscribers(): Promise<{
  subscribersEvaluated: number;
  notificationsCreated: number;
}> {
  const subs = listActiveCandidateSubscriptions();
  let totalCreated = 0;
  for (const sub of subs) {
    const res = await dispatchNotificationsForCandidate(sub);
    totalCreated += res.createdCount;
  }
  return { subscribersEvaluated: subs.length, notificationsCreated: totalCreated };
}

// -----------------------------------------------------------------------------
// Background Queue Execution & Autonomous Scheduler Loop
// -----------------------------------------------------------------------------
async function executeJob(job: BackgroundJobRecord): Promise<Record<string, any>> {
  switch (job.jobType) {
    case 'monitor_career_page': {
      const companyId = String(job.payload.companyId || '');
      const result = await monitorCompanyCareerPage(companyId);
      if (result.addedCount > 0) {
        enqueueBackgroundJob({
          jobType: 'dispatch_notifications',
          dedupKey: `dispatch_after_career_${companyId}_${new Date().toISOString().slice(0, 13)}`,
          payload: { trigger: 'career_page_update', companyId },
          createdBy: 'worker',
        });
      }
      return result;
    }
    case 'scan_company_signals': {
      const companyId = String(job.payload.companyId || '');
      const result = await scanCompanySignals(companyId, job.createdBy);
      if (result.insertedSignals > 0) {
        enqueueBackgroundJob({
          jobType: 'dispatch_notifications',
          dedupKey: `dispatch_after_signal_${companyId}_${new Date().toISOString().slice(0, 13)}`,
          payload: { trigger: 'signal_detected', companyId },
          createdBy: 'worker',
        });
      }
      return { companyId, insertedSignals: result.insertedSignals };
    }
    case 'discover_hr_contacts': {
      const companyId = String(job.payload.companyId || '');
      const dept = String(job.payload.department || '');
      const result = await discoverVerifiedHrContacts(companyId, dept, job.createdBy);
      return { companyId, mxVerified: result.mxVerified, insertedCount: result.insertedCount };
    }
    case 'evaluate_candidate_matches':
    case 'dispatch_notifications': {
      return await dispatchNotificationsForAllSubscribers();
    }
    default:
      throw new Error(`Unsupported background job type: ${job.jobType}`);
  }
}

let workerBusy = false;
let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Enqueues recurring monitoring jobs for companies whose interval has elapsed,
 * then executes up to `maxJobs` due tasks from the persistent queue.
 */
export async function runWorkerTick(maxJobs = 3): Promise<{
  scheduledRecurring: number;
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (workerBusy) {
    return { scheduledRecurring: 0, processed: 0, succeeded: 0, failed: 0 };
  }
  workerBusy = true;
  let scheduledRecurring = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    // 1. Recurring scheduler: check monitored companies due for career page check
    const monitored = listCompanies({ monitoredOnly: true, limit: 100 });
    const nowMs = Date.now();
    for (const c of monitored) {
      if (!c.careersUrl && c.atsProvider === 'none') continue;
      const lastMs = c.lastMonitoredAt ? Date.parse(c.lastMonitoredAt) : 0;
      const intervalMs = Math.max(15, c.monitorIntervalMinutes) * 60_000;
      if (!lastMs || nowMs - lastMs >= intervalMs) {
        const { deduplicated } = enqueueBackgroundJob({
          jobType: 'monitor_career_page',
          dedupKey: `recurring_career_${c.id}`,
          payload: { companyId: c.id },
          createdBy: 'scheduler',
        });
        if (!deduplicated) scheduledRecurring++;
      }
    }

    // 2. Process queued tasks
    for (let i = 0; i < maxJobs; i++) {
      const job = claimNextDueJob();
      if (!job) break;
      processed++;
      try {
        const result = await executeJob(job);
        completeBackgroundJob(job.id, result);
        writeAuditLog({
          actorUid: job.createdBy || 'worker',
          actorRole: 'system',
          action: `job_completed:${job.jobType}`,
          targetType: 'background_job',
          targetId: job.id,
          details: result,
        });
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failBackgroundJob(job, msg);
        writeAuditLog({
          actorUid: job.createdBy || 'worker',
          actorRole: 'system',
          action: `job_failed:${job.jobType}`,
          targetType: 'background_job',
          targetId: job.id,
          details: { error: msg, attempt: job.attempts },
        });
        failed++;
      }
    }
  } finally {
    workerBusy = false;
  }

  return { scheduledRecurring, processed, succeeded, failed };
}

export function getWorkerMode(): 'cron' | 'loop' {
  const explicit = (process.env.WORKER_MODE || '').trim().toLowerCase();
  if (explicit === 'cron' || explicit === 'loop') return explicit;
  // On Hostinger Unlimited production, default to Cron-driven mode (no permanent background daemon)
  return process.env.NODE_ENV === 'production' ? 'cron' : 'loop';
}

export interface CronBatchSummary {
  mode: 'cron' | 'loop';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  recoveredStale: { requeued: number; failed: number };
  scheduledRecurring: number;
  processed: number;
  succeeded: number;
  failed: number;
  remainingQueued: number;
  stoppedReason: 'queue_empty' | 'max_jobs' | 'time_budget' | 'memory_guard' | 'busy';
  memoryRssMb: number;
}

/**
 * Hostinger Unlimited Cron-safe batch processor:
 * - Automatically recovers interrupted jobs from any previous run
 * - Schedules recurring monitored companies whose interval elapsed
 * - Executes queued tasks sequentially within a strict time budget (< 25 min, safe under Hostinger's 30-min cap)
 *   and RSS memory ceiling (< 1800 MB, safe under Hostinger Unlimited's 3 GB RAM)
 * - Leaves remaining jobs safely persisted in SQLite for the next Cron tick
 */
export async function runCronBatch(options?: {
  maxJobs?: number;
  maxDurationMs?: number;
  maxMemoryMb?: number;
  trigger?: string;
}): Promise<CronBatchSummary> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const mode = getWorkerMode();
  const rssMbNow = () => Math.round(process.memoryUsage().rss / (1024 * 1024));

  if (workerBusy) {
    return {
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      recoveredStale: { requeued: 0, failed: 0 },
      scheduledRecurring: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      remainingQueued: countQueuedBackgroundJobs(),
      stoppedReason: 'busy',
      memoryRssMb: rssMbNow(),
    };
  }

  // Strictly cap max duration at 25 minutes (1,500,000 ms) so Hostinger's 30-minute Cron kill limit is never hit
  const maxDurationMs = Math.min(
    25 * 60_000,
    Math.max(10_000, options?.maxDurationMs ?? (Number(process.env.CRON_MAX_DURATION_MS) || 20 * 60_000))
  );
  const maxJobs = Math.min(100, Math.max(1, options?.maxJobs ?? 25));
  const maxMemoryMb = Math.min(2400, Math.max(256, options?.maxMemoryMb ?? 1800));

  workerBusy = true;
  let recoveredStale = { requeued: 0, failed: 0 };
  let scheduledRecurring = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let stoppedReason: CronBatchSummary['stoppedReason'] = 'queue_empty';

  try {
    // 1. Recover any unfinished tasks interrupted by a previous Cron timeout or server restart
    recoveredStale = recoverStaleRunningJobs(25);

    // 2. Schedule monitored companies whose interval has elapsed
    const monitored = listCompanies({ monitoredOnly: true, limit: 100 });
    const nowMs = Date.now();
    for (const c of monitored) {
      if (!c.careersUrl && c.atsProvider === 'none') continue;
      const lastMs = c.lastMonitoredAt ? Date.parse(c.lastMonitoredAt) : 0;
      const intervalMs = Math.max(15, c.monitorIntervalMinutes) * 60_000;
      if (!lastMs || nowMs - lastMs >= intervalMs) {
        const { deduplicated } = enqueueBackgroundJob({
          jobType: 'monitor_career_page',
          dedupKey: `recurring_career_${c.id}`,
          payload: { companyId: c.id },
          createdBy: options?.trigger || 'hostinger_cron',
        });
        if (!deduplicated) scheduledRecurring++;
      }
    }

    // 3. Process queued jobs sequentially until empty, maxJobs, time budget, or memory guard
    for (let i = 0; i < maxJobs; i++) {
      if (Date.now() - startedMs >= maxDurationMs) {
        stoppedReason = 'time_budget';
        break;
      }
      if (rssMbNow() >= maxMemoryMb) {
        stoppedReason = 'memory_guard';
        break;
      }
      const job = claimNextDueJob();
      if (!job) {
        stoppedReason = 'queue_empty';
        break;
      }
      processed++;
      try {
        const result = await executeJob(job);
        completeBackgroundJob(job.id, result);
        writeAuditLog({
          actorUid: job.createdBy || options?.trigger || 'hostinger_cron',
          actorRole: 'system',
          action: `job_completed:${job.jobType}`,
          targetType: 'background_job',
          targetId: job.id,
          details: result,
        });
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failBackgroundJob(job, msg);
        writeAuditLog({
          actorUid: job.createdBy || options?.trigger || 'hostinger_cron',
          actorRole: 'system',
          action: `job_failed:${job.jobType}`,
          targetType: 'background_job',
          targetId: job.id,
          details: { error: msg, attempt: job.attempts },
        });
        failed++;
      }
      if (i + 1 >= maxJobs) {
        stoppedReason = 'max_jobs';
      }
    }
  } finally {
    workerBusy = false;
  }

  const finishedAt = new Date().toISOString();
  const summary: CronBatchSummary = {
    mode,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    recoveredStale,
    scheduledRecurring,
    processed,
    succeeded,
    failed,
    remainingQueued: countQueuedBackgroundJobs(),
    stoppedReason,
    memoryRssMb: rssMbNow(),
  };

  writeAuditLog({
    actorUid: options?.trigger || 'hostinger_cron',
    actorRole: 'system',
    action: 'cron_batch_completed',
    targetType: 'worker',
    targetId: options?.trigger || 'hostinger_cron',
    details: summary,
  });

  return summary;
}

export function startBackgroundWorkerLoop(): void {
  const mode = getWorkerMode();
  if (mode === 'cron') {
    // Still recover any stale running jobs on server boot, without spawning a permanent background interval
    const recovered = recoverStaleRunningJobs(25);
    console.log(
      `[JOBFOUNDS Worker] Running in Hostinger Unlimited CRON mode (no permanent daemon; recovered ${recovered.requeued} interrupted job(s)). Trigger via Hostinger Cron Job (npm run cron:tick or /api/cron/tick).`
    );
    return;
  }
  if (schedulerHandle) return;
  const intervalMs = Math.max(5000, Number(process.env.ENGINE_WORKER_INTERVAL_MS) || 15000);
  recoverStaleRunningJobs(25);
  schedulerHandle = setInterval(() => {
    runWorkerTick(2).catch((err) => {
      console.error('[JOBFOUNDS Worker] Tick error:', err);
    });
  }, intervalMs);
  schedulerHandle.unref?.();
  console.log(`[JOBFOUNDS Worker] Autonomous background loop started (tick every ${intervalMs}ms)`);
}

// -----------------------------------------------------------------------------
// MODULE 1 ENHANCEMENT: Multi-Country Automated Company Discovery
// -----------------------------------------------------------------------------
export interface MultiCountryDiscoveryResult {
  countries: string[];
  sector: string;
  companiesDiscovered: number;
  companiesCreated: number;
  signalsRecorded: number;
  backgroundJobsQueued: number;
  companies: Array<{
    company: CompanyRecord;
    created: boolean;
    signalSummary: string;
    sourceUrl: string;
  }>;
  discoveredAt: string;
}

export async function discoverCompaniesMultiCountry(params: {
  countries: string[];
  sector?: string;
  keywords?: string;
  lang?: string;
  actorUid?: string;
}): Promise<MultiCountryDiscoveryResult> {
  const cleanCountries = params.countries
    .map((c) => clampStr(c, 60))
    .filter(Boolean)
    .slice(0, 8);
  const cleanSector = clampStr(params.sector || '', 100);
  const cleanKeywords = clampStr(params.keywords || '', 140);
  const lang = clampStr(params.lang || 'fr', 10) || 'fr';

  if (cleanCountries.length === 0) {
    throw new Error('At least one country is required for multi-country company discovery.');
  }
  if (!isSourceEnabled('gemini_google_search')) {
    throw new Error('Gemini Google Search source is currently paused or rate-limited.');
  }
  const budget = getDailyAiUsageSummary();
  if (!budget.withinBudget) {
    throw new Error(`Daily AI budget reached (${budget.callsToday}/${budget.maxCallsPerDay} calls).`);
  }

  const ai = getAiClient();
  const startedAt = Date.now();
  const prompt = `You are the JOBFOUNDS Multi-Country Company Intelligence Discovery Engine.
Use Google Search to find 4 to 6 REAL, verifiable companies operating across these countries: ${cleanCountries.join(', ')}
Sector focus: ${cleanSector || 'Technology, FinTech, HealthTech, Energy, Industrial & Digital Services'}
Keywords / Hiring context: ${cleanKeywords || 'expansion, funding round, new office opening, new department, major contract'}

STRICT INTEGRITY RULES:
- Return ONLY real companies verified in live Google Search results. Never invent companies, websites, or news.
- Focus on companies showing genuine growth, expansion, new offices, new contracts, or new departments that indicate potential upcoming hiring needs (even if no job ad is currently published).
- NEVER classify an unconfirmed growth signal as a confirmed job offer.
- Include the official website URL, official careers page URL (if publicly found, otherwise empty string), and the real public source URL evidencing the growth/expansion signal.
- Write descriptions in ${lang === 'fr' ? 'French' : 'English'}.

Return ONLY valid JSON:
{
  "companies": [
    {
      "officialName": "Exact official company name",
      "officialWebsite": "https://...",
      "careersUrl": "https://... or empty string",
      "country": "Country from the target list",
      "location": "City, Country",
      "sector": "Exact industry sector",
      "estimatedSize": "e.g. 200-500 or 1000-5000",
      "signalType": "expansion | new_office | contract_project | new_department | growth_announcement | skill_demand",
      "classification": "probable_hiring_signal | potential_opportunity",
      "signalTitle": "Factual title of the public growth/expansion event",
      "signalSummary": "Clear explanation of why this creates potential hiring needs (without claiming a confirmed job ad)",
      "evidenceQuote": "Short factual quote or summary from the public source",
      "skillsInferred": ["Skill 1", "Skill 2"],
      "sourceName": "Publication / Official Press Release / Newsroom name",
      "sourceUrl": "Verifiable https URL",
      "reliabilityScore": 72,
      "relevanceScore": 78
    }
  ]
}`;

  let parsed: { companies?: any[] } = {};
  let groundingUrls: string[] = [];
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    groundingUrls = chunks
      .map((c: any) => sanitizeHttpUrl(c?.web?.uri || ''))
      .filter(Boolean);
    parsed = parseJsonFromText<{ companies?: any[] }>(response.text);
    recordSourceCall('gemini_google_search', true);
    logAiUsage({
      uid: params.actorUid || 'system',
      endpoint: '/api/intelligence/discover-companies',
      model: MODEL,
      promptTokens: 1500,
      outputTokens: 1100,
      status: 'ok',
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    recordSourceCall('gemini_google_search', false, err instanceof Error ? err.message : String(err));
    logAiUsage({
      uid: params.actorUid || 'system',
      endpoint: '/api/intelligence/discover-companies',
      model: MODEL,
      promptTokens: 1500,
      outputTokens: 0,
      status: 'error',
      latencyMs: Date.now() - startedAt,
    });
    throw err;
  }

  const rawItems = Array.isArray(parsed.companies) ? parsed.companies.slice(0, 8) : [];
  const monitorIntervalMinutes = Number(process.env.ENGINE_DEFAULT_MONITOR_MINUTES) || 720;
  let companiesCreated = 0;
  let signalsRecorded = 0;
  let backgroundJobsQueued = 0;
  const results: MultiCountryDiscoveryResult['companies'] = [];

  const allowedSignalTypes = new Set<SignalType>([
    'expansion',
    'new_office',
    'contract_project',
    'new_department',
    'frequent_hiring',
    'growth_announcement',
    'skill_demand',
  ]);

  for (const item of rawItems) {
    const officialName = clampStr(item?.officialName, 140);
    if (!officialName) continue;
    const officialWebsite = sanitizeHttpUrl(item?.officialWebsite || '');
    const careersUrl = sanitizeHttpUrl(item?.careersUrl || '');
    const sourceUrl = sanitizeHttpUrl(item?.sourceUrl || '') || groundingUrls[0] || officialWebsite;

    const { company, created } = upsertCompany({
      officialName,
      officialWebsite,
      careersUrl,
      country: clampStr(item?.country || cleanCountries[0], 80),
      location: clampStr(item?.location || item?.country || cleanCountries[0], 140),
      sector: clampStr(item?.sector || cleanSector || 'Technology & Services', 120),
      estimatedSize: clampStr(item?.estimatedSize || '', 60),
      monitored: true,
      monitorIntervalMinutes,
      verificationStatus: officialWebsite ? 'Partially Verified' : 'Unverified',
      sourceName: clampStr(item?.sourceName || 'Multi-Country Discovery Engine', 120),
    });
    if (created) companiesCreated++;

    const rawType = String(item?.signalType || 'expansion') as SignalType;
    const signalType: SignalType = allowedSignalTypes.has(rawType) ? rawType : 'expansion';
    // Integrity guard: discovered expansion signals NEVER claim a confirmed job ad
    const classification: NeedClassification =
      item?.classification === 'probable_hiring_signal'
        ? 'probable_hiring_signal'
        : 'potential_opportunity';

    const signalTitle = clampStr(item?.signalTitle || `${officialName} — ${signalType}`, 180);
    const signalSummary = clampStr(item?.signalSummary || '', 600);
    if (signalSummary) {
      const sigRes = recordCompanySignal({
        companyId: company.id,
        signalType,
        classification,
        title: signalTitle,
        summary: signalSummary,
        evidenceQuote: clampStr(item?.evidenceQuote || '', 400),
        skillsInferred: Array.isArray(item?.skillsInferred)
          ? item.skillsInferred.map((s: any) => clampStr(s, 50)).filter(Boolean).slice(0, 10)
          : [],
        sourceName: clampStr(item?.sourceName || 'Google Search Grounding', 120),
        sourceUrl,
        reliabilityScore: Math.min(85, Math.max(40, Number(item?.reliabilityScore) || 68)),
        relevanceScore: Math.min(90, Math.max(40, Number(item?.relevanceScore) || 72)),
      });
      if (sigRes.inserted) signalsRecorded++;
    }

    // Automatically wire into Modules 3, 4 & 6 via persistent background queue
    if (company.careersUrl || company.atsProvider !== 'none') {
      const q1 = enqueueBackgroundJob({
        jobType: 'monitor_career_page',
        dedupKey: `discover_career_${company.id}`,
        payload: { companyId: company.id },
        createdBy: params.actorUid || 'discovery_engine',
      });
      if (!q1.deduplicated) backgroundJobsQueued++;
    }
    const q2 = enqueueBackgroundJob({
      jobType: 'discover_hr_contacts',
      dedupKey: `discover_hr_${company.id}`,
      payload: { companyId: company.id, department: 'Talent Acquisition' },
      createdBy: params.actorUid || 'discovery_engine',
      delaySeconds: 15,
    });
    if (!q2.deduplicated) backgroundJobsQueued++;

    results.push({
      company,
      created,
      signalSummary,
      sourceUrl,
    });
  }

  return {
    countries: cleanCountries,
    sector: cleanSector,
    companiesDiscovered: results.length,
    companiesCreated,
    signalsRecorded,
    backgroundJobsQueued,
    companies: results,
    discoveredAt: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------------
// MODULE 7: Real Authorized Gmail Read-Only Recruiter Reply Synchronization
// -----------------------------------------------------------------------------
export interface RecruiterEmailClassification {
  detectedStage:
    | 'Offer Received'
    | 'Interview Scheduled'
    | 'Rejected'
    | 'Under Review'
    | 'Message Received';
  confidence: 'high' | 'medium';
  reason: string;
}

export function classifyRecruiterEmailReply(input: {
  subject: string;
  snippet: string;
  sender?: string;
}): RecruiterEmailClassification {
  const haystack = `${input.subject || ''} ${input.snippet || ''}`.toLowerCase();

  // 1. Offer Received
  if (
    /\b(job offer|formal offer|offer letter|pleased to offer|happy to offer|offre d'emploi|proposition d'embauche|proposition salariale|promesse d'embauche|contrat de travail)\b/i.test(
      haystack
    )
  ) {
    return {
      detectedStage: 'Offer Received',
      confidence: 'high',
      reason: 'Offer / employment proposal terminology detected in recruiter email.',
    };
  }

  // 2. Rejected
  if (
    /\b(unfortunately|not moving forward|will not be moving forward|regret to inform|decided not to proceed|position has been filled|other candidates|malheureusement|ne retenons pas|pas retenu|suite favorable|ne pouvons donner suite|poste pourvu)\b/i.test(
      haystack
    )
  ) {
    return {
      detectedStage: 'Rejected',
      confidence: 'high',
      reason: 'Rejection / non-selection phrasing detected in recruiter email.',
    };
  }

  // 3. Interview Scheduled
  if (
    /\b(interview|entretien|calendly|cal\.com|technical screen|hiring manager call|video call|google meet|zoom link|teams meeting|disponibilit[eé]s|cr[eé]neau|invite you to speak|schedule a call|planifier un [eé]change)\b/i.test(
      haystack
    )
  ) {
    return {
      detectedStage: 'Interview Scheduled',
      confidence: 'high',
      reason: 'Interview invitation or scheduling terminology detected in recruiter email.',
    };
  }

  // 4. Under Review / Application Received
  if (
    /\b(application received|received your application|thank you for applying|under review|reviewing your application|merci pour votre candidature|bien re[cç]u votre candidature|en cours d'[eé]tude|accus[eé] de r[eé]ception)\b/i.test(
      haystack
    )
  ) {
    return {
      detectedStage: 'Under Review',
      confidence: 'high',
      reason: 'Application acknowledgement / review status detected in recruiter email.',
    };
  }

  // 5. Generic Recruiter Message Received
  return {
    detectedStage: 'Message Received',
    confidence: 'medium',
    reason: 'Direct message matched to tracked company / recruiter.',
  };
}

export interface GmailSyncApplicationInput {
  id: string;
  company: string;
  role: string;
  stage?: string;
  contactName?: string;
  contactChannel?: string;
}

export interface GmailMatchedReply {
  applicationId: string;
  company: string;
  gmailMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  detectedStage: RecruiterEmailClassification['detectedStage'];
  confidence: 'high' | 'medium';
  reason: string;
  isNew: boolean;
}

export async function syncGmailRecruiterReplies(params: {
  uid: string;
  gmailAccessToken: string;
  applications: GmailSyncApplicationInput[];
}): Promise<{
  syncedAt: string;
  scannedMessages: number;
  matchedReplies: GmailMatchedReply[];
}> {
  if (!isSourceEnabled('gmail_api')) {
    throw new Error('Gmail synchronization source is currently paused by an administrator.');
  }

  const token = String(params.gmailAccessToken || '').trim();
  if (!token || token.length < 20) {
    throw new Error('Valid Gmail read-only access token is required.');
  }

  const apps = params.applications
    .filter((a) => a.id && a.company && a.company.trim().length >= 2)
    .slice(0, 40);

  if (apps.length === 0) {
    return {
      syncedAt: new Date().toISOString(),
      scannedMessages: 0,
      matchedReplies: [],
    };
  }

  // Build safe Gmail search query targeting tracked companies in the user's inbox (last 120 days)
  const uniqueCompanies = Array.from(
    new Set(
      apps
        .map((a) => a.company.replace(/["'()]/g, '').trim())
        .filter((c) => c.length >= 2)
    )
  ).slice(0, 15);

  const companyQuery = uniqueCompanies.map((c) => `"${c}"`).join(' OR ');
  const q = `in:inbox newer_than:120d (${companyQuery})`;

  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('maxResults', '25');
  listUrl.searchParams.set('q', q);

  const listResp = await fetch(listUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (listResp.status === 401 || listResp.status === 403) {
    recordSourceCall('gmail_api', false, `HTTP ${listResp.status}`);
    throw new Error(
      'Gmail authorization expired or missing read-only permission. Please reconnect Gmail.'
    );
  }
  if (!listResp.ok) {
    recordSourceCall('gmail_api', false, `HTTP ${listResp.status}`);
    throw new Error(`Gmail API returned HTTP ${listResp.status}`);
  }

  const listJson = (await listResp.json()) as { messages?: Array<{ id: string }> };
  const messageRefs = Array.isArray(listJson.messages) ? listJson.messages.slice(0, 20) : [];

  const matchedReplies: GmailMatchedReply[] = [];

  for (const ref of messageRefs) {
    if (!ref?.id) continue;
    const msgUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}`
    );
    msgUrl.searchParams.set('format', 'metadata');
    msgUrl.searchParams.append('metadataHeaders', 'From');
    msgUrl.searchParams.append('metadataHeaders', 'Subject');
    msgUrl.searchParams.append('metadataHeaders', 'Date');

    const msgResp = await fetch(msgUrl.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!msgResp.ok) continue;

    const msgData = (await msgResp.json()) as {
      id: string;
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const headers = msgData.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const sender = clampStr(getHeader('From'), 240);
    const subject = clampStr(getHeader('Subject'), 300);
    const snippet = clampStr(msgData.snippet || '', 500);
    const receivedIso = msgData.internalDate
      ? new Date(Number(msgData.internalDate)).toISOString()
      : new Date().toISOString();

    const searchSpace = `${sender} ${subject} ${snippet}`.toLowerCase();

    // Find best matching tracked application
    const matchedApp = apps.find((app) => {
      const compLower = app.company.trim().toLowerCase();
      const compSlug = compLower.replace(/[^a-z0-9]/g, '');
      const contactLower = (app.contactName || '').trim().toLowerCase();
      return (
        (compLower.length >= 3 && searchSpace.includes(compLower)) ||
        (compSlug.length >= 4 && sender.toLowerCase().includes(compSlug)) ||
        (contactLower.length >= 4 && searchSpace.includes(contactLower))
      );
    });

    if (!matchedApp) continue;

    const classification = classifyRecruiterEmailReply({ subject, snippet, sender });
    const persisted = recordCrmEmailSyncEvent({
      uid: params.uid,
      applicationId: matchedApp.id,
      company: matchedApp.company,
      gmailMessageId: msgData.id,
      sender,
      subject,
      snippet,
      detectedStage: classification.detectedStage,
      confidence: classification.confidence,
      reason: classification.reason,
      receivedAt: receivedIso,
    });

    matchedReplies.push({
      applicationId: matchedApp.id,
      company: matchedApp.company,
      gmailMessageId: msgData.id,
      sender,
      subject,
      snippet,
      receivedAt: receivedIso,
      detectedStage: classification.detectedStage,
      confidence: classification.confidence,
      reason: classification.reason,
      isNew: persisted.created,
    });
  }

  recordSourceCall('gmail_api', true);
  writeAuditLog({
    actorUid: params.uid,
    actorRole: 'user',
    action: 'crm_gmail_sync',
    targetType: 'crm_email_sync',
    targetId: params.uid,
    details: {
      scannedMessages: messageRefs.length,
      matchedReplies: matchedReplies.length,
    },
  });

  return {
    syncedAt: new Date().toISOString(),
    scannedMessages: messageRefs.length,
    matchedReplies,
  };
}
