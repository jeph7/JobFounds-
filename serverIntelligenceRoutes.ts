import express from 'express';
import { z } from 'zod';
import {
  type BackgroundJobRecord,
  type CareerChangeRecord,
  type CareerJobRecord,
  type CompanyRecord,
  type CompanySignalRecord,
  closeEmployerJobByOwner,
  confirmPortalSubmission,
  createEmployerJob,
  createEngineDbBackup,
  createNotification,
  enqueueBackgroundJob,
  getCandidateSubscription,
  getCompanyById,
  getEngineDb,
  getEngineOverviewMetrics,
  getSubmissionAttachmentForActor,
  type HrContactRecord,
  listAllActiveCareerJobs,
  listAuditLogs,
  listBackgroundJobs,
  listCompanies,
  listCompanyCareerChanges,
  listCompanyCareerJobs,
  listCrmEmailSyncEvents,
  listEmployerReceivedApplications,
  listEngineDbBackups,
  listHrContacts,
  listOpenEmployerJobs,
  listSignals,
  listUserApplicationSubmissions,
  listUserNotifications,
  markNotificationRead,
  mergeCompanies,
  type NotificationRecord,
  respondToEmployerApplication,
  retryFailedJob,
  reviewHrContactAdmin,
  reviewSignalAdmin,
  setSourceEnabled,
  type SourceConfigRecord,
  updateCompanyMonitored,
  upsertCandidateSubscription,
  upsertCompany,
  writeAuditLog,
} from './serverEngineDb.ts';
import {
  checkLiveJobAvailability,
  submitRealApplication,
  verifyResendDomainStatus,
} from './serverApplicationEngine.ts';
import { monitorCompanyCareerPage } from './serverCareerMonitor.ts';
import {
  computeCandidateIntelligenceMatches,
  discoverCompaniesMultiCountry,
  discoverVerifiedHrContacts,
  dispatchNotificationsForCandidate,
  getResendConfigStatus,
  type IntelligenceMatchItem,
  runCronBatch,
  runWorkerTick,
  scanCompanySignals,
  sendTestResendEmail,
  syncGmailRecruiterReplies,
} from './serverWorkerEngine.ts';
import crypto from 'node:crypto';
import {
  type AuthedRequest,
  createRateLimiter,
  extractClientIp,
  isAdminAuthUser,
  requireAdminAuth,
  requireFirebaseAuth,
} from './serverSecurity.ts';
import {
  checkLiveDomainHealth,
  getDeployDashboardState,
  getDeployRunById,
  getLatestBundlePath,
  saveDeployEnvVars,
  saveHostingerConfig,
  startHostingerDeployment,
  testHostingerConnection,
} from './serverDeployEngine.ts';
import fs from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------------------
// API Serializers (align SQLite / Worker records 1:1 with Frontend Contracts)
// -----------------------------------------------------------------------------
export function serializeCompany(c: CompanyRecord) {
  return {
    ...c,
    officialDomain: c.domain || '',
    lastVerifiedAt: c.verifiedAt || null,
    sourceNames: c.sourceName ? [c.sourceName] : [],
    activeJobsCount: c.activeJobsCount ?? 0,
    signalsCount: c.signalsCount ?? 0,
    contactsCount: c.contactsCount ?? 0,
  };
}

export function serializeSignal(s: CompanySignalRecord) {
  return {
    ...s,
    evidenceText: s.evidenceQuote || '',
    detectedDate: (s.detectedAt || '').slice(0, 10),
    inferredSkills: s.skillsInferred || [],
    inferredRoles: s.skillsInferred?.length
      ? [`${s.skillsInferred[0]} Specialist`, `${s.companySector || 'Core'} Lead`]
      : [],
    createdAt: s.detectedAt,
  };
}

export function serializeCareerJob(j: CareerJobRecord & { companyName?: string }) {
  return {
    ...j,
    externalJobId: j.externalId,
    applyUrl: j.url || '',
    salaryRange: '',
    status: j.status === 'active' ? 'active' : 'expired',
    expiredAt: j.removedAt || null,
  };
}

export function serializeCareerChange(ch: CareerChangeRecord) {
  let detailsText = '';
  if (typeof ch.details === 'string') {
    detailsText = ch.details;
  } else if (ch.details && typeof ch.details === 'object') {
    const parts: string[] = [];
    if (ch.details.location) parts.push(String(ch.details.location));
    if (ch.details.department) parts.push(String(ch.details.department));
    if (ch.details.workMode) parts.push(String(ch.details.workMode));
    if (ch.details.atsSource) parts.push(String(ch.details.atsSource));
    detailsText = parts.length > 0 ? parts.join(' · ') : JSON.stringify(ch.details);
  }
  return {
    id: ch.id,
    companyId: ch.companyId,
    jobId: ch.careerJobId,
    changeType: ch.changeType === 'expired' ? 'removed' : ch.changeType,
    jobTitle: ch.jobTitle,
    details: detailsText,
    detectedAt: ch.detectedAt,
  };
}

export function serializeHrContact(hc: HrContactRecord) {
  return {
    ...hc,
    location: hc.department || '',
    contactChannel: hc.publicChannel || hc.sourceName || '',
    publicUrl: hc.publicProfileUrl || hc.sourceUrl || '',
    corporateEmail: hc.publicEmail || '',
    domainMxVerified: Boolean(hc.mxVerified || hc.emailDomainVerified),
    createdAt: hc.verifiedAt || '',
  };
}

export function serializeMatchItem(m: IntelligenceMatchItem) {
  return {
    id: m.id,
    companyId: m.companyId,
    companyName: m.companyName,
    country: m.companyCountry || '',
    location: m.companyLocation || '',
    sector: m.companySector || '',
    classification: m.classification,
    title: m.title,
    summary: m.evidenceSummary || '',
    overallScore: m.score,
    breakdown: {
      skills: m.breakdown.skillsScore,
      experience: m.breakdown.experienceRoleScore,
      education: m.breakdown.educationScore,
      languages: m.breakdown.languagesScore,
      locationAndMobility: m.breakdown.locationMobilityScore,
      workAuthorization: m.breakdown.workAuthorizationScore,
      availability: m.breakdown.availabilityScore,
      salary: m.breakdown.salaryScore,
      sourceReliability: m.breakdown.signalReliabilityScore,
      sectorAndRole: m.breakdown.experienceRoleScore,
      signalReliability: m.breakdown.signalReliabilityScore,
    },
    matchedSkills: m.matchedSkills,
    missingSkills: m.missingSkills,
    proofs: [
      {
        label: m.evidenceSummary || 'Verified source',
        url: m.evidenceUrl || m.companyWebsite || '',
        date: (m.detectedAt || '').slice(0, 10),
      },
    ],
    explanation: m.explanation,
    recommendedContact: m.recommendedContact
      ? {
          fullName: m.recommendedContact.fullName,
          roleTitle: m.recommendedContact.roleTitle,
          channel: m.recommendedContact.publicEmail
            ? `Email officiel vérifié (${m.recommendedContact.publicEmail})`
            : m.recommendedContact.publicProfileUrl
              ? 'Official Portal / Public Profile'
              : 'Public Directory',
          publicUrl: m.recommendedContact.publicProfileUrl || '',
          corporateEmail: m.recommendedContact.publicEmail || '',
          confidenceLevel: m.recommendedContact.confidenceLevel,
        }
      : null,
    applyUrl: m.evidenceUrl || m.companyWebsite || '',
  };
}

export function serializeNotification(n: NotificationRecord) {
  const typeMap: Record<string, string> = {
    new_job: 'new_matching_job',
    hiring_signal: 'company_hiring_signal',
    hidden_opportunity: 'unpublished_opportunity',
    new_contact: 'new_hr_contact',
    profile_match: 'profile_match',
    spontaneous_invite: 'spontaneous_invite',
    application_update: 'application_update',
  };
  return {
    id: n.id,
    userId: n.uid,
    type: typeMap[n.type] || 'profile_match',
    title: n.title,
    body: n.body,
    companyId: n.companyId,
    companyName: n.companyName,
    classification: n.classification,
    actionUrl: n.evidenceUrl || '',
    channelInApp: Boolean(n.channelStatus?.inApp ?? true),
    channelEmailSent: Boolean(n.channelStatus?.emailSent ?? false),
    read: Boolean(n.read),
    createdAt: n.createdAt,
  };
}

export function serializeBackgroundJob(j: BackgroundJobRecord) {
  return {
    id: j.id,
    jobType: j.jobType,
    status: j.status === 'cancelled' ? 'failed' : j.status,
    dedupKey: j.dedupKey,
    payload: j.payload,
    resultSummary: j.result ? JSON.stringify(j.result).slice(0, 220) : '',
    errorMessage: j.errorMessage || '',
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    nextRunAt: j.nextRunAt,
    startedAt: j.startedAt,
    completedAt: j.finishedAt,
    createdBy: j.createdBy,
    createdAt: j.createdAt,
  };
}

export function serializeSourceConfig(s: SourceConfigRecord) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    enabled: s.enabled,
    rateLimitPerHour: s.rateLimitPerHour,
    callsCurrentHour: s.callsLastHour,
    lastSuccessAt: s.lastSuccessAt,
    lastErrorAt: s.lastError ? s.updatedAt : null,
    lastErrorMessage: s.lastError || '',
    updatedAt: s.updatedAt,
  };
}

export function serializeAdminOverviewMetrics() {
  const raw = getEngineOverviewMetrics();
  const db = getEngineDb();
  const scalar = (sql: string) => Number(((db.prepare(sql).get() as any)?.c) || 0);
  const signalsPending = scalar("SELECT COUNT(*) as c FROM company_signals WHERE admin_status = 'pending'");
  const publishedJobsExpired = scalar("SELECT COUNT(*) as c FROM career_jobs WHERE status != 'active'");

  return {
    companiesRegistered: raw.companiesRegistered,
    companiesMonitored: raw.companiesMonitored,
    signalsTotal: raw.signalsDetected,
    signalsPending,
    publishedJobsActive: raw.publishedCareerJobs,
    publishedJobsExpired,
    unpublishedOpportunities: raw.unpublishedOpportunities,
    contactsTotal: raw.contactsIdentified,
    contactsVerified: raw.contactsVerified,
    jobsQueued: raw.jobsQueued,
    jobsRunning: raw.jobsRunning,
    jobsFailed: raw.jobsFailed,
    jobsCompleted: raw.jobsCompleted,
    notificationsSent: raw.notificationsSent,
    candidateSubscribers: raw.subscribedCandidates,
    aiUsage: raw.aiUsage,
    sources: raw.sources.map(serializeSourceConfig),
  };
}

// -----------------------------------------------------------------------------
// Zod Validation Schemas
// -----------------------------------------------------------------------------
const CompanyUpsertSchema = z.object({
  officialName: z.string().trim().min(2).max(140),
  officialWebsite: z.string().trim().max(300).optional().default(''),
  country: z.string().trim().max(80).optional().default(''),
  location: z.string().trim().max(120).optional().default(''),
  sector: z.string().trim().max(120).optional().default(''),
  estimatedSize: z.string().trim().max(80).optional().default(''),
  careersUrl: z.string().trim().max(400).optional().default(''),
  monitored: z.boolean().optional().default(true),
  monitorIntervalMinutes: z.number().int().min(15).max(10080).optional().default(720),
  autoCheckNow: z.boolean().optional().default(false),
});

const CompanyPatchSchema = z.object({
  officialName: z.string().trim().min(2).max(140).optional(),
  officialWebsite: z.string().trim().max(300).optional(),
  careersUrl: z.string().trim().max(400).optional(),
  country: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  sector: z.string().trim().max(120).optional(),
  estimatedSize: z.string().trim().max(80).optional(),
  monitored: z.boolean().optional(),
  monitorIntervalMinutes: z.number().int().min(15).max(10080).optional(),
  verificationStatus: z.enum(['Verified', 'Partially Verified', 'Unverified']).optional(),
});

const MatchRequestSchema = z.object({
  profile: z.object({
    currentTitle: z.string().max(160).optional(),
    yearsExperience: z.number().min(0).max(60).optional(),
    highestDegree: z.string().max(160).optional(),
    skills: z.array(z.string().max(80)).max(40).optional(),
    languages: z.array(z.string().max(60)).max(15).optional(),
    preferredCountries: z.array(z.string().max(80)).max(20).optional(),
    preferredCities: z.array(z.string().max(80)).max(20).optional(),
    preferredWorkModes: z.array(z.string().max(30)).max(5).optional(),
    originCountry: z.string().max(80).optional(),
    workAuthorization: z.string().max(160).optional(),
    relocationReady: z.boolean().optional(),
    availability: z.string().max(120).optional(),
    minSalaryAnnualUsd: z.number().min(0).max(2_000_000).optional(),
    targetSectors: z.array(z.string().max(80)).max(20).optional(),
  }),
});

const NotificationPrefsSchema = z.object({
  profile: z.record(z.string(), z.any()).optional().default({}),
  preferredCountries: z.array(z.string().max(80)).max(20).optional().default([]),
  preferredSectors: z.array(z.string().max(80)).max(20).optional().default([]),
  frequency: z.enum(['instant', 'daily', 'weekly']).optional().default('instant'),
  channels: z
    .object({
      inApp: z.boolean().default(true),
      email: z.boolean().default(false),
      push: z.boolean().default(false),
    })
    .optional()
    .default({ inApp: true, email: false, push: false }),
  enabled: z.boolean().optional().default(true),
});

const SignalReviewSchema = z.object({
  adminStatus: z.enum(['pending', 'verified', 'rejected']),
  adminNote: z.string().max(500).optional().default(''),
  classification: z
    .enum(['confirmed_job', 'confirmed_hiring_need', 'probable_hiring_signal', 'potential_opportunity'])
    .optional(),
});

const ContactReviewSchema = z.object({
  adminStatus: z.enum(['pending', 'verified', 'rejected']),
  confidenceLevel: z.enum(['confirmed', 'probable', 'unverified']).optional(),
});

const MergeCompaniesSchema = z.object({
  sourceId: z.string().min(4).max(128),
  targetId: z.string().min(4).max(128),
});

const EnqueueJobSchema = z.object({
  jobType: z.enum([
    'monitor_career_page',
    'scan_company_signals',
    'discover_hr_contacts',
    'evaluate_candidate_matches',
    'dispatch_notifications',
  ]),
  companyId: z.string().max(128).optional(),
  department: z.string().max(100).optional(),
});

const TestEmailSchema = z.object({
  to: z.string().trim().email().max(200).optional(),
});

export function createIntelligenceRouter() {
  const router = express.Router();

  const standardLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 120,
    maxGuest: 20,
    bucketPrefix: 'intel_std',
  });

  const scanLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 30,
    maxGuest: 0,
    bucketPrefix: 'intel_scan',
  });

  // ---------------------------------------------------------------------------
  // 1. Company Intelligence Database (Protected by Firebase Auth)
  // ---------------------------------------------------------------------------
  router.get('/intelligence/companies', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const companies = listCompanies({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      country: typeof req.query.country === 'string' ? req.query.country : undefined,
      sector: typeof req.query.sector === 'string' ? req.query.sector : undefined,
      monitoredOnly: req.query.monitored === 'true',
      limit: Number(req.query.limit) || 100,
    }).map(serializeCompany);
    res.json({ companies });
  });

  router.post('/intelligence/companies', requireFirebaseAuth, standardLimiter, async (req: AuthedRequest, res) => {
    const parsed = CompanyUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid company payload.', details: parsed.error.flatten() });
      return;
    }
    try {
      const { autoCheckNow, ...input } = parsed.data;
      const result = upsertCompany({
        ...input,
        sourceName: `User Registration (${req.authUser!.email || req.authUser!.uid})`,
      });
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
        action: result.created ? 'company_created' : 'company_merged',
        targetType: 'company',
        targetId: result.company.id,
        details: { officialName: result.company.officialName, atsProvider: result.company.atsProvider },
        ipAddress: extractClientIp(req),
      });

      let monitorResult: any = null;
      if (autoCheckNow && (result.company.careersUrl || result.company.atsProvider !== 'none')) {
        try {
          monitorResult = await monitorCompanyCareerPage(result.company.id);
        } catch (err) {
          monitorResult = { error: err instanceof Error ? err.message : String(err) };
        }
      } else if (result.company.monitored && (result.company.careersUrl || result.company.atsProvider !== 'none')) {
        enqueueBackgroundJob({
          jobType: 'monitor_career_page',
          dedupKey: `initial_career_${result.company.id}`,
          payload: { companyId: result.company.id },
          createdBy: req.authUser!.uid,
        });
      }

      const fresh = getCompanyById(result.company.id) || result.company;
      res.status(result.created ? 201 : 200).json({
        company: serializeCompany(fresh),
        created: result.created,
        merged: result.merged,
        monitorResult,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to register company.' });
    }
  });

  router.get('/intelligence/companies/:id', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const company = getCompanyById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found.' });
      return;
    }
    res.json({
      company: serializeCompany(company),
      careerJobs: listCompanyCareerJobs(company.id, true).map(serializeCareerJob),
      careerChanges: listCompanyCareerChanges(company.id, 60).map(serializeCareerChange),
      signals: listSignals({ companyId: company.id, includeRejected: isAdminAuthUser(req.authUser), limit: 60 }).map(
        serializeSignal
      ),
      contacts: listHrContacts({
        companyId: company.id,
        includeRejected: isAdminAuthUser(req.authUser),
        limit: 60,
      }).map(serializeHrContact),
    });
  });

  router.patch('/intelligence/companies/:id', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = CompanyPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid update payload.', details: parsed.error.flatten() });
      return;
    }
    const data = { ...parsed.data };
    if (data.verificationStatus && !isAdminAuthUser(req.authUser)) {
      delete data.verificationStatus;
    }
    const updated = updateCompanyMonitored(req.params.id, data);
    if (!updated) {
      res.status(404).json({ error: 'Company not found.' });
      return;
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
      action: 'company_updated',
      targetType: 'company',
      targetId: updated.id,
      details: data,
      ipAddress: extractClientIp(req),
    });
    res.json({ company: serializeCompany(updated) });
  });

  // ---------------------------------------------------------------------------
  // 2. Career Page Check, Signal Scan & HR Contact Discovery Triggers
  // ---------------------------------------------------------------------------
  router.post(
    '/intelligence/companies/:id/monitor-career',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const company = getCompanyById(req.params.id);
      if (!company) {
        res.status(404).json({ error: 'Company not found.' });
        return;
      }
      const mode = req.body?.mode === 'queue' ? 'queue' : 'sync';
      if (mode === 'queue') {
        const queued = enqueueBackgroundJob({
          jobType: 'monitor_career_page',
          dedupKey: `manual_career_${company.id}`,
          payload: { companyId: company.id },
          createdBy: req.authUser!.uid,
        });
        res.json({ queued: true, job: serializeBackgroundJob(queued.job), deduplicated: queued.deduplicated });
        return;
      }
      try {
        const result = await monitorCompanyCareerPage(company.id);
        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail: req.authUser!.email,
          actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
          action: 'career_page_monitored',
          targetType: 'company',
          targetId: company.id,
          details: { fetchedCount: result.fetchedCount, addedCount: result.addedCount, removedCount: result.removedCount },
          ipAddress: extractClientIp(req),
        });
        res.json({ result });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Career page check failed.' });
      }
    }
  );

  router.post(
    '/intelligence/companies/:id/scan-signals',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const company = getCompanyById(req.params.id);
      if (!company) {
        res.status(404).json({ error: 'Company not found.' });
        return;
      }
      if (req.body?.mode === 'queue') {
        const queued = enqueueBackgroundJob({
          jobType: 'scan_company_signals',
          dedupKey: `manual_signals_${company.id}`,
          payload: { companyId: company.id },
          createdBy: req.authUser!.uid,
        });
        res.json({ queued: true, job: serializeBackgroundJob(queued.job), deduplicated: queued.deduplicated });
        return;
      }
      try {
        const result = await scanCompanySignals(company.id, req.authUser!.uid);
        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail: req.authUser!.email,
          actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
          action: 'signals_scanned',
          targetType: 'company',
          targetId: company.id,
          details: { insertedSignals: result.insertedSignals },
          ipAddress: extractClientIp(req),
        });
        res.json({ result });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Signal scan failed.' });
      }
    }
  );

  router.post(
    '/intelligence/companies/:id/discover-contacts',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const company = getCompanyById(req.params.id);
      if (!company) {
        res.status(404).json({ error: 'Company not found.' });
        return;
      }
      const department = typeof req.body?.department === 'string' ? req.body.department.slice(0, 100) : '';
      if (req.body?.mode === 'queue') {
        const queued = enqueueBackgroundJob({
          jobType: 'discover_hr_contacts',
          dedupKey: `manual_contacts_${company.id}`,
          payload: { companyId: company.id, department },
          createdBy: req.authUser!.uid,
        });
        res.json({ queued: true, job: serializeBackgroundJob(queued.job), deduplicated: queued.deduplicated });
        return;
      }
      try {
        const result = await discoverVerifiedHrContacts(company.id, department, req.authUser!.uid);
        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail: req.authUser!.email,
          actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
          action: 'hr_contacts_discovered',
          targetType: 'company',
          targetId: company.id,
          details: { mxVerified: result.mxVerified, insertedCount: result.insertedCount },
          ipAddress: extractClientIp(req),
        });
        res.json({ result });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Contact discovery failed.' });
      }
    }
  );

  router.get('/intelligence/signals', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const signals = listSignals({
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : undefined,
      includeRejected: isAdminAuthUser(req.authUser) && req.query.includeRejected === 'true',
      limit: Number(req.query.limit) || 80,
    }).map(serializeSignal);
    res.json({ signals });
  });

  router.get('/intelligence/contacts', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const contacts = listHrContacts({
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : undefined,
      includeRejected: isAdminAuthUser(req.authUser) && req.query.includeRejected === 'true',
      limit: Number(req.query.limit) || 80,
    }).map(serializeHrContact);
    res.json({ contacts });
  });

  router.get('/intelligence/career-jobs', requireFirebaseAuth, standardLimiter, (req, res) => {
    res.json({ jobs: listAllActiveCareerJobs(Number(req.query.limit) || 120).map(serializeCareerJob) });
  });

  // ---------------------------------------------------------------------------
  // 3. Central Explainable Matching (Published Jobs + Non-Published Needs)
  // ---------------------------------------------------------------------------
  router.post('/intelligence/match', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = MatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile matching payload.', details: parsed.error.flatten() });
      return;
    }
    const rawMatches = computeCandidateIntelligenceMatches(parsed.data.profile);
    const matches = rawMatches.map(serializeMatchItem);
    res.json({
      matches,
      counts: {
        total: matches.length,
        confirmedJobs: matches.filter((m) => m.classification === 'confirmed_job').length,
        confirmedNeeds: matches.filter((m) => m.classification === 'confirmed_hiring_need').length,
        probableSignals: matches.filter((m) => m.classification === 'probable_hiring_signal').length,
        potentialOpportunities: matches.filter((m) => m.classification === 'potential_opportunity').length,
      },
      evaluatedAt: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Candidate Notifications & Offline Alert Preferences
  // ---------------------------------------------------------------------------
  router.get('/notifications', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const uid = req.authUser!.uid;
    const notifications = listUserNotifications(uid, 60).map(serializeNotification);
    const subscription = getCandidateSubscription(uid);
    const emailConfig = getResendConfigStatus();
    res.json({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      subscription: subscription ? { ...subscription, lastMatchedAt: subscription.updatedAt } : null,
      emailDeliveryAvailable: emailConfig.ready,
    });
  });

  router.put('/notifications/preferences', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = NotificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notification preferences.', details: parsed.error.flatten() });
      return;
    }
    const sub = upsertCandidateSubscription({
      uid: req.authUser!.uid,
      email: req.authUser!.email || '',
      profile: parsed.data.profile,
      preferredCountries: parsed.data.preferredCountries,
      preferredSectors: parsed.data.preferredSectors,
      frequency: parsed.data.frequency,
      channels: parsed.data.channels,
      enabled: parsed.data.enabled,
    });
    res.json({ subscription: { ...sub, lastMatchedAt: sub.updatedAt } });
  });

  router.post('/notifications/read', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const notifId = typeof req.body?.id === 'string' ? req.body.id : undefined;
    const updated = markNotificationRead(req.authUser!.uid, notifId);
    res.json({ updated });
  });

  router.post('/notifications/run-match', requireFirebaseAuth, scanLimiter, async (req: AuthedRequest, res) => {
    const uid = req.authUser!.uid;
    let sub = getCandidateSubscription(uid);
    if (!sub) {
      sub = upsertCandidateSubscription({
        uid,
        email: req.authUser!.email || '',
        profile: req.body?.profile || {},
        preferredCountries: Array.isArray(req.body?.preferredCountries) ? req.body.preferredCountries : [],
        preferredSectors: Array.isArray(req.body?.preferredSectors) ? req.body.preferredSectors : [],
        frequency: 'instant',
        channels: { inApp: true, email: false, push: false },
        enabled: true,
      });
    }
    const result = await dispatchNotificationsForCandidate(sub, 55);
    const notifs = listUserNotifications(uid, 60).map(serializeNotification);
    res.json({
      created: result.createdCount,
      createdCount: result.createdCount,
      emailSent: notifs.some((n) => n.channelEmailSent),
      notifications: notifs,
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Admin Engine Control, Source Governance, Email Diagnostics & Audit Logs
  // ---------------------------------------------------------------------------
  router.get('/admin/overview', requireAdminAuth, standardLimiter, (_req, res) => {
    res.json({
      metrics: serializeAdminOverviewMetrics(),
      emailConfig: getResendConfigStatus(),
      companies: listCompanies({ limit: 100 }).map(serializeCompany),
      signals: listSignals({ includeRejected: true, limit: 80 }).map(serializeSignal),
      contacts: listHrContacts({ includeRejected: true, limit: 80 }).map(serializeHrContact),
      backgroundJobs: listBackgroundJobs(60).map(serializeBackgroundJob),
      auditLogs: listAuditLogs(50),
    });
  });

  router.post('/admin/email/test', requireAdminAuth, scanLimiter, async (req: AuthedRequest, res) => {
    const parsed = TestEmailSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid recipient email address.', details: parsed.error.flatten() });
      return;
    }
    const recipient = parsed.data.to || req.authUser?.email || '';
    if (!recipient) {
      res.status(400).json({ error: 'No recipient email available.' });
      return;
    }
    const result = await sendTestResendEmail(recipient);
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: result.emailSent ? 'admin_email_test_sent' : 'admin_email_test_failed',
      targetType: 'notification_email',
      targetId: recipient,
      details: { emailSent: result.emailSent, emailReason: result.emailReason, messageId: result.messageId || null },
      ipAddress: extractClientIp(req),
    });
    res.json({ recipient, ...result });
  });

  router.post('/admin/companies/scan-all-careers', requireAdminAuth, scanLimiter, async (req: AuthedRequest, res) => {
    const monitored = listCompanies({ monitoredOnly: true, limit: 20 });
    const results: Array<{
      companyId: string;
      companyName: string;
      atsProvider: string;
      activeCount: number;
      addedCount: number;
      removedCount: number;
      error?: string;
    }> = [];
    for (const c of monitored) {
      if (!c.careersUrl && c.atsProvider === 'none') continue;
      try {
        const r = await monitorCompanyCareerPage(c.id);
        results.push({
          companyId: c.id,
          companyName: c.officialName,
          atsProvider: r.atsProvider,
          activeCount: r.activeCount,
          addedCount: r.addedCount,
          removedCount: r.removedCount,
        });
      } catch (err) {
        results.push({
          companyId: c.id,
          companyName: c.officialName,
          atsProvider: c.atsProvider,
          activeCount: 0,
          addedCount: 0,
          removedCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: 'admin_batch_career_scan',
      targetType: 'company',
      targetId: 'all_monitored',
      details: { scannedCount: results.length, totalActive: results.reduce((s, r) => s + r.activeCount, 0) },
      ipAddress: extractClientIp(req),
    });
    res.json({ scannedCount: results.length, results });
  });

  router.post('/admin/sources/:sourceId/toggle', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const enabled = Boolean(req.body?.enabled);
    const updated = setSourceEnabled(req.params.sourceId, enabled);
    if (!updated) {
      res.status(404).json({ error: 'Source not found.' });
      return;
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: enabled ? 'source_resumed' : 'source_paused',
      targetType: 'source',
      targetId: updated.id,
      details: { enabled },
      ipAddress: extractClientIp(req),
    });
    res.json({ source: serializeSourceConfig(updated) });
  });

  router.post('/admin/signals/:signalId/review', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = SignalReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review payload.', details: parsed.error.flatten() });
      return;
    }
    const updated = reviewSignalAdmin(
      req.params.signalId,
      parsed.data.adminStatus,
      parsed.data.adminNote,
      parsed.data.classification
    );
    if (!updated) {
      res.status(404).json({ error: 'Signal not found.' });
      return;
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: `signal_reviewed:${parsed.data.adminStatus}`,
      targetType: 'company_signal',
      targetId: updated.id,
      details: parsed.data,
      ipAddress: extractClientIp(req),
    });
    res.json({ signal: serializeSignal(updated) });
  });

  router.post('/admin/contacts/:contactId/review', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = ContactReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid contact review payload.', details: parsed.error.flatten() });
      return;
    }
    const updated = reviewHrContactAdmin(
      req.params.contactId,
      parsed.data.adminStatus,
      parsed.data.confidenceLevel
    );
    if (!updated) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: `contact_reviewed:${parsed.data.adminStatus}`,
      targetType: 'hr_contact',
      targetId: updated.id,
      details: parsed.data,
      ipAddress: extractClientIp(req),
    });
    res.json({ contact: serializeHrContact(updated) });
  });

  router.post('/admin/companies/merge', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = MergeCompaniesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid merge payload.', details: parsed.error.flatten() });
      return;
    }
    try {
      const merged = mergeCompanies(parsed.data.sourceId, parsed.data.targetId);
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'companies_merged',
        targetType: 'company',
        targetId: merged.id,
        details: parsed.data,
        ipAddress: extractClientIp(req),
      });
      res.json({ company: serializeCompany(merged) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Merge failed.' });
    }
  });

  router.post('/admin/jobs/enqueue', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const parsed = EnqueueJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid background job payload.', details: parsed.error.flatten() });
      return;
    }
    const { jobType, companyId, department } = parsed.data;
    const result = enqueueBackgroundJob({
      jobType,
      dedupKey: `admin_${jobType}_${companyId || 'all'}`,
      payload: { companyId: companyId || '', department: department || '' },
      createdBy: req.authUser!.uid,
    });
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: `admin_job_enqueued:${jobType}`,
      targetType: 'background_job',
      targetId: result.job.id,
      details: parsed.data,
      ipAddress: extractClientIp(req),
    });
    res.json({ job: serializeBackgroundJob(result.job), deduplicated: result.deduplicated });
  });

  router.post('/admin/jobs/:jobId/retry', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const retried = retryFailedJob(req.params.jobId);
    if (!retried) {
      res.status(404).json({ error: 'Job not found or not retryable.' });
      return;
    }
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: 'admin_job_retried',
      targetType: 'background_job',
      targetId: retried.id,
      details: { jobType: retried.jobType },
      ipAddress: extractClientIp(req),
    });
    res.json({ job: serializeBackgroundJob(retried) });
  });

  router.post('/admin/worker/tick', requireAdminAuth, standardLimiter, async (req: AuthedRequest, res) => {
    const summary = await runWorkerTick(5);
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: 'admin_worker_tick',
      targetType: 'worker',
      targetId: 'manual',
      details: summary,
      ipAddress: extractClientIp(req),
    });
    res.json({ summary });
  });

  router.get('/admin/audit-logs', requireAdminAuth, standardLimiter, (req, res) => {
    res.json({ auditLogs: listAuditLogs(Number(req.query.limit) || 100) });
  });

  // ===========================================================================
  // MODULE 1: Multi-Country Automated Company Discovery
  // ===========================================================================
  const discoverCompaniesSchema = z.object({
    countries: z.array(z.string().min(2).max(60)).min(1).max(8),
    sector: z.string().max(100).optional(),
    keywords: z.string().max(140).optional(),
    lang: z.string().max(10).optional(),
  });

  router.post(
    '/intelligence/discover-companies',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const parsed = discoverCompaniesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid multi-country discovery payload.' });
        return;
      }
      try {
        const result = await discoverCompaniesMultiCountry({
          countries: parsed.data.countries,
          sector: parsed.data.sector,
          keywords: parsed.data.keywords,
          lang: parsed.data.lang || 'fr',
          actorUid: req.authUser!.uid,
        });
        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail: req.authUser!.email,
          actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
          action: 'discover_companies_multi_country',
          targetType: 'company_discovery',
          targetId: parsed.data.countries.join(','),
          details: {
            countries: result.countries,
            companiesDiscovered: result.companiesDiscovered,
            companiesCreated: result.companiesCreated,
            signalsRecorded: result.signalsRecorded,
            backgroundJobsQueued: result.backgroundJobsQueued,
          },
          ipAddress: extractClientIp(req),
        });
        res.json({
          ...result,
          companies: result.companies.map((c) => ({
            ...c,
            company: serializeCompany(c.company),
          })),
        });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Multi-country company discovery failed.',
        });
      }
    }
  );

  // ===========================================================================
  // MODULE 7: Real Authorized Gmail Read-Only Recruiter Reply Sync
  // ===========================================================================
  const gmailSyncSchema = z.object({
    applications: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          company: z.string().min(1).max(160),
          role: z.string().max(160).optional().default(''),
          stage: z.string().max(60).optional(),
          contactName: z.string().max(140).optional(),
          contactChannel: z.string().max(200).optional(),
        })
      )
      .max(50),
  });

  router.post(
    '/crm/gmail-sync',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const gmailToken = String(req.headers['x-gmail-access-token'] || '').trim();
      if (!gmailToken) {
        res.status(400).json({
          error: 'Gmail read-only authorization token is required in X-Gmail-Access-Token header.',
        });
        return;
      }
      const parsed = gmailSyncSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid applications list for Gmail sync.' });
        return;
      }
      try {
        const result = await syncGmailRecruiterReplies({
          uid: req.authUser!.uid,
          gmailAccessToken: gmailToken,
          applications: parsed.data.applications,
        });
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gmail synchronization failed.';
        const status = msg.includes('authorization expired') ? 401 : 502;
        res.status(status).json({ error: msg });
      }
    }
  );

  router.get('/crm/email-sync-history', requireFirebaseAuth, standardLimiter, (req: AuthedRequest, res) => {
    const events = listCrmEmailSyncEvents(req.authUser!.uid, Number(req.query.limit) || 40);
    res.json({ events });
  });

  // ===========================================================================
  // REAL LIVE JOB AVAILABILITY CHECK & APPLICATION SUBMISSION ENGINE
  // ===========================================================================
  const applicationSubmitLimiter = createRateLimiter({
    windowMs: 60 * 60_000,
    maxAuthenticated: 15,
    maxGuest: 0,
    bucketPrefix: 'app_submit',
  });

  const CheckAvailabilitySchema = z.object({
    url: z.string().trim().min(8).max(600),
  });

  const ApplicationAttachmentSchema = z.object({
    filename: z.string().trim().min(1).max(160),
    contentType: z.string().trim().min(3).max(120),
    base64Content: z.string().min(4).max(6_000_000),
  });

  const ApplicationSubmitSchema = z.object({
    applicationId: z.string().max(128).optional(),
    companyId: z.string().max(128).optional(),
    recruiterId: z.string().max(128).optional(),
    companyName: z.string().trim().min(1).max(160),
    roleTitle: z.string().trim().min(1).max(180),
    opportunityType: z.enum(['published_job', 'hidden_opportunity']).default('published_job'),
    classification: z
      .enum(['confirmed_job', 'confirmed_hiring_need', 'probable_hiring_signal', 'potential_opportunity', ''])
      .optional()
      .default(''),
    channel: z.enum(['resend_email', 'official_portal', 'jobfounds_direct']),
    recipientEmail: z.string().trim().max(200).optional(),
    recipientName: z.string().trim().max(140).optional(),
    officialUrl: z.string().trim().max(600).optional(),
    subject: z.string().trim().min(2).max(240),
    coverLetter: z.string().trim().min(20).max(10_000),
    cvVersionName: z.string().trim().max(160).optional(),
    candidateName: z.string().trim().min(1).max(140).optional(),
    attachments: z.array(ApplicationAttachmentSchema).max(3).optional(),
    explicitAuthorization: z.literal(true),
  });

  const ConfirmPortalSchema = z.object({
    portalReference: z.string().trim().max(140).optional().default(''),
  });

  const EmployerRespondSchema = z.object({
    status: z.enum([
      'received',
      'under_review',
      'interview_scheduled',
      'offer_received',
      'rejected',
      'message_received',
    ]),
    replyMessage: z.string().trim().min(2).max(4000),
  });

  router.post(
    '/jobs/check-availability',
    requireFirebaseAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const parsed = CheckAvailabilitySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'URL d’offre invalide.' });
        return;
      }
      const result = await checkLiveJobAvailability(parsed.data.url);
      res.json({ result });
    }
  );

  router.post(
    '/applications/submit',
    requireFirebaseAuth,
    applicationSubmitLimiter,
    async (req: AuthedRequest, res) => {
      const parsed = ApplicationSubmitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error:
            'Données de candidature incomplètes ou autorisation explicite manquante.',
          details: parsed.error.flatten(),
        });
        return;
      }
      try {
        const result = await submitRealApplication({
          userId: req.authUser!.uid,
          recruiterId: parsed.data.recruiterId,
          candidateName:
            parsed.data.candidateName ||
            req.authUser!.email ||
            'Candidat',
          candidateEmail: req.authUser!.email || '',
          applicationId: parsed.data.applicationId,
          companyId: parsed.data.companyId,
          companyName: parsed.data.companyName,
          roleTitle: parsed.data.roleTitle,
          opportunityType: parsed.data.opportunityType,
          classification: parsed.data.classification,
          channel: parsed.data.channel,
          recipientEmail: parsed.data.recipientEmail,
          recipientName: parsed.data.recipientName,
          officialUrl: parsed.data.officialUrl,
          subject: parsed.data.subject,
          coverLetter: parsed.data.coverLetter,
          cvVersionName: parsed.data.cvVersionName,
          attachments: parsed.data.attachments,
          explicitAuthorization: parsed.data.explicitAuthorization,
        });

        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail: req.authUser!.email,
          actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
          action: result.transmitted
            ? `application_transmitted:${parsed.data.channel}`
            : `application_prepared:${parsed.data.channel}`,
          targetType: 'application_submission',
          targetId: result.submission.id,
          details: {
            companyName: parsed.data.companyName,
            roleTitle: parsed.data.roleTitle,
            channel: parsed.data.channel,
            deliveryStatus: result.deliveryStatus,
            transmitted: result.transmitted,
            attachmentsCount: result.submission.attachments.length,
          },
          ipAddress: extractClientIp(req),
        });

        res.json(result);
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Impossible de traiter cette candidature.',
        });
      }
    }
  );

  router.get(
    '/applications/submissions',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const submissions = listUserApplicationSubmissions(
        req.authUser!.uid,
        Number(req.query.limit) || 60
      );
      const emailConfig = getResendConfigStatus();
      res.json({
        submissions,
        emailRelayReady: emailConfig.ready,
      });
    }
  );

  router.post(
    '/applications/submissions/:id/confirm-portal',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const parsed = ConfirmPortalSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Référence portail invalide.' });
        return;
      }
      const updated = confirmPortalSubmission({
        submissionId: String(req.params.id || ''),
        userId: req.authUser!.uid,
        portalReference: parsed.data.portalReference,
      });
      if (!updated) {
        res.status(404).json({ error: 'Dossier de candidature introuvable.' });
        return;
      }
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
        action: 'application_portal_confirmed',
        targetType: 'application_submission',
        targetId: updated.id,
        details: {
          companyName: updated.companyName,
          roleTitle: updated.roleTitle,
          portalReference: updated.portalReference,
        },
        ipAddress: extractClientIp(req),
      });
      res.json({ submission: updated });
    }
  );

  // ===========================================================================
  // EMPLOYER DIRECT JOB POSTINGS (UNIVERSAL: EMAIL/PASSWORD + GOOGLE ACCOUNTS)
  // ===========================================================================
  const CreateEmployerJobSchema = z.object({
    companyName: z.string().trim().min(2).max(140),
    companyWebsite: z.string().trim().max(260).optional().default(''),
    title: z.string().trim().min(2).max(180),
    country: z.string().trim().max(100).optional().default('International'),
    city: z.string().trim().max(100).optional().default('Remote'),
    workMode: z.enum(['Remote', 'Hybrid', 'On-site']).optional().default('Hybrid'),
    contractType: z
      .enum(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'])
      .optional()
      .default('Full-time'),
    experienceLevel: z.string().trim().max(60).optional().default('Mid-Senior'),
    degreeRequired: z.string().trim().max(80).optional().default('Non spécifié'),
    salaryRange: z.string().trim().max(100).optional().default('Non communiqué'),
    skills: z.array(z.string().trim().max(60)).max(20).optional().default([]),
    languages: z.array(z.string().trim().max(40)).max(10).optional().default(['Français', 'Anglais']),
    description: z.string().trim().min(10).max(4000),
    visaSponsorship: z.string().trim().max(80).optional().default('Case-by-case'),
  });

  router.get('/employer/jobs', standardLimiter, (req, res) => {
    const jobs = listOpenEmployerJobs(Number(req.query.limit) || 100);
    res.json({ jobs });
  });

  router.post(
    '/employer/jobs',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const parsed = CreateEmployerJobSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Veuillez renseigner l’entreprise, le titre et une description complète (min. 10 caractères).',
          details: parsed.error.flatten(),
        });
        return;
      }
      const job = createEmployerJob({
        recruiterId: req.authUser!.uid,
        ...parsed.data,
      });
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
        action: 'employer_job_published',
        targetType: 'employer_job',
        targetId: job.id,
        details: { companyName: job.companyName, title: job.title, country: job.country },
        ipAddress: extractClientIp(req),
      });
      res.status(201).json({ job });
    }
  );

  router.post(
    '/employer/jobs/:id/close',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const jobId = String(req.params.id || '').trim();
      const closed = closeEmployerJobByOwner({
        jobId,
        actorUid: req.authUser!.uid,
        isAdmin: isAdminAuthUser(req.authUser),
      });
      if (!closed) {
        res.status(404).json({ error: 'Offre introuvable ou autorisation refusée.' });
        return;
      }
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'user',
        action: 'employer_job_closed',
        targetType: 'employer_job',
        targetId: jobId,
        details: {},
        ipAddress: extractClientIp(req),
      });
      res.json({ ok: true, id: jobId });
    }
  );

  // ===========================================================================
  // EMPLOYER DIRECT APPLICATION INBOX, ATTACHMENTS & REPLIES (STRICT OWNERSHIP)
  // ===========================================================================
  router.get(
    '/employer/applications',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const applications = listEmployerReceivedApplications(
        req.authUser!.uid,
        Number(req.query.limit) || 60
      );
      res.json({ applications });
    }
  );

  router.get(
    '/employer/applications/:id/attachments/:index',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0 || idx > 5) {
        res.status(400).json({ error: 'Index de pièce jointe invalide.' });
        return;
      }
      const att = getSubmissionAttachmentForActor({
        submissionId: String(req.params.id || ''),
        actorUid: req.authUser!.uid,
        attachmentIndex: idx,
      });
      if (!att) {
        res.status(404).json({ error: 'Pièce jointe introuvable ou accès non autorisé.' });
        return;
      }
      res.setHeader('Content-Type', att.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(att.buffer);
    }
  );

  router.post(
    '/employer/applications/:id/respond',
    requireFirebaseAuth,
    standardLimiter,
    (req: AuthedRequest, res) => {
      const parsed = EmployerRespondSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Réponse employeur ou statut invalide.',
          details: parsed.error.flatten(),
        });
        return;
      }
      const updated = respondToEmployerApplication({
        submissionId: String(req.params.id || ''),
        recruiterId: req.authUser!.uid,
        status: parsed.data.status,
        replyMessage: parsed.data.replyMessage,
      });
      if (!updated) {
        res.status(404).json({ error: 'Candidature directe introuvable ou non autorisée.' });
        return;
      }
      createNotification({
        uid: updated.userId,
        type: 'application_update',
        title: `Réponse employeur · ${updated.companyName} (${updated.roleTitle})`,
        body: parsed.data.replyMessage.slice(0, 600),
        companyId: updated.companyId,
        companyName: updated.companyName,
        classification: 'confirmed_job',
        channelStatus: { inApp: true, emailSent: false, pushReady: false },
        dedupKey: `emp_reply_${updated.id}_${Date.now()}`,
      });
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: isAdminAuthUser(req.authUser) ? 'admin' : 'recruiter',
        action: `employer_replied:${parsed.data.status}`,
        targetType: 'application_submission',
        targetId: updated.id,
        details: {
          companyName: updated.companyName,
          roleTitle: updated.roleTitle,
          status: parsed.data.status,
        },
        ipAddress: extractClientIp(req),
      });
      res.json({ submission: updated });
    }
  );

  // ===========================================================================
  // RESEND EMAIL DOMAIN DIAGNOSTICS & ADMIN SQLITE BACKUPS
  // ===========================================================================
  router.get(
    '/email/status',
    requireFirebaseAuth,
    standardLimiter,
    async (_req: AuthedRequest, res) => {
      const diagnostics = await verifyResendDomainStatus();
      res.json({ diagnostics });
    }
  );

  router.post(
    '/email/test-delivery',
    requireAdminAuth,
    scanLimiter,
    async (req: AuthedRequest, res) => {
      const recipient =
        typeof req.body?.to === 'string' && req.body.to.includes('@')
          ? req.body.to.trim()
          : req.authUser?.email || '';
      if (!recipient) {
        res.status(400).json({ error: 'Adresse destinataire requise pour le test e-mail.' });
        return;
      }
      const testCv = Buffer.from(
        `CV TEST JOBFOUNDS\nCandidat : ${req.authUser?.email || 'Admin'}\nDate UTC : ${new Date().toISOString()}`,
        'utf8'
      ).toString('base64');
      const result = await submitRealApplication({
        userId: req.authUser!.uid,
        candidateName: 'Test Livraison JOBFOUNDS',
        candidateEmail: req.authUser!.email || recipient,
        companyName: 'JOBFOUNDS Verification',
        roleTitle: 'Test livraison candidature avec pièce jointe',
        opportunityType: 'published_job',
        channel: 'resend_email',
        recipientEmail: recipient,
        recipientName: 'Destinataire Test',
        subject: '[JOBFOUNDS] Test réel d’envoi de candidature + CV joint',
        coverLetter:
          'Ceci est un test réel de transmission de candidature via Resend avec CV en pièce jointe afin de vérifier la remise effective et la conservation de la preuve fournisseur.',
        cvVersionName: 'CV-Test-Verification.txt',
        attachments: [
          {
            filename: 'CV-Test-JOBFOUNDS.txt',
            contentType: 'text/plain',
            base64Content: testCv,
          },
        ],
        explicitAuthorization: true,
      });
      res.json(result);
    }
  );

  router.get('/admin/backups', requireAdminAuth, standardLimiter, (_req, res) => {
    res.json({ backups: listEngineDbBackups() });
  });

  router.post('/admin/backups/create', requireAdminAuth, scanLimiter, (req: AuthedRequest, res) => {
    const backup = createEngineDbBackup('manual');
    writeAuditLog({
      actorUid: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      action: 'sqlite_backup_created',
      targetType: 'database',
      targetId: backup.filename,
      details: backup,
      ipAddress: extractClientIp(req),
    });
    res.json({ backup, backups: listEngineDbBackups() });
  });

  // ===========================================================================
  // ADMIN ONLY: HOSTINGER PRODUCTION DEPLOYMENT CENTER
  // ===========================================================================
  const deployLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 40,
    maxGuest: 0,
    bucketPrefix: 'admin_deploy',
  });

  const DeployConfigSchema = z.object({
    protocol: z.enum(['ssh', 'ftps']),
    host: z.string().trim().max(253),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().max(80),
    remotePath: z.string().trim().min(2).max(220),
    domain: z.string().trim().min(3).max(160),
    environment: z.enum(['production', 'staging']),
    nodeVersion: z.string().trim().min(1).max(24),
    authMethod: z.enum(['ssh_key', 'password']),
    sshPrivateKey: z.string().max(16_000).optional(),
    sshPassphrase: z.string().max(500).optional(),
    clearSshKey: z.boolean().optional(),
  });

  const DeployEnvUpdateSchema = z.object({
    entries: z
      .array(
        z.object({
          key: z.string().trim().min(2).max(80),
          value: z.string().max(16_000).optional(),
          clear: z.boolean().optional(),
        })
      )
      .min(1)
      .max(30),
  });

  const DeployTransientAuthSchema = z.object({
    oneTimePassword: z.string().max(500).optional(),
  });

  const DomainCheckSchema = z.object({
    domain: z.string().trim().min(3).max(160).optional(),
  });

  router.get('/admin/deploy/state', requireAdminAuth, standardLimiter, (_req: AuthedRequest, res) => {
    try {
      res.json(getDeployDashboardState());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load deployment state.',
      });
    }
  });

  router.put('/admin/deploy/config', requireAdminAuth, deployLimiter, (req: AuthedRequest, res) => {
    const parsed = DeployConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Configuration Hostinger invalide.',
        details: parsed.error.flatten(),
      });
      return;
    }
    try {
      const config = saveHostingerConfig(parsed.data);
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'hostinger_config_updated',
        targetType: 'deployment',
        targetId: config.domain,
        details: {
          protocol: config.protocol,
          host: config.host,
          port: config.port,
          remotePath: config.remotePath,
          domain: config.domain,
          environment: config.environment,
          authMethod: config.authMethod,
          hasSshKey: config.hasSshKey,
        },
        ipAddress: extractClientIp(req),
      });
      res.json({ config, state: getDeployDashboardState() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossible d’enregistrer la configuration Hostinger.',
      });
    }
  });

  router.put('/admin/deploy/env', requireAdminAuth, deployLimiter, (req: AuthedRequest, res) => {
    const parsed = DeployEnvUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Format de variables d’environnement invalide.' });
      return;
    }
    try {
      const envVars = saveDeployEnvVars(parsed.data.entries);
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'hostinger_env_updated',
        targetType: 'deployment',
        targetId: 'env_vault',
        details: {
          updatedKeys: parsed.data.entries.map((e) => e.key),
        },
        ipAddress: extractClientIp(req),
      });
      res.json({ envVars, state: getDeployDashboardState() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossible d’enregistrer les variables d’environnement.',
      });
    }
  });

  router.post('/admin/deploy/test-connection', requireAdminAuth, deployLimiter, async (req: AuthedRequest, res) => {
    const parsed = DeployTransientAuthSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Paramètres de test de connexion invalides.' });
      return;
    }
    try {
      const result = await testHostingerConnection(parsed.data.oneTimePassword);
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'hostinger_connection_tested',
        targetType: 'deployment',
        targetId: result.host || 'unconfigured',
        details: {
          protocol: result.protocol,
          connected: result.connected,
          remoteNodeVersion: result.remoteNodeVersion,
          remotePathAccessible: result.remotePathAccessible,
        },
        ipAddress: extractClientIp(req),
      });
      res.json({ result, state: getDeployDashboardState() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Échec du test de connexion Hostinger.',
      });
    }
  });

  router.post('/admin/deploy/check-domain', requireAdminAuth, deployLimiter, async (req: AuthedRequest, res) => {
    const parsed = DomainCheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Nom de domaine invalide.' });
      return;
    }
    try {
      const result = await checkLiveDomainHealth(parsed.data.domain);
      res.json({ result });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Vérification du domaine impossible.',
      });
    }
  });

  router.post('/admin/deploy/run', requireAdminAuth, deployLimiter, (req: AuthedRequest, res) => {
    const parsed = DeployTransientAuthSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Paramètres de déploiement invalides.' });
      return;
    }
    try {
      const run = startHostingerDeployment({
        triggeredBy: req.authUser!.email || req.authUser!.uid,
        oneTimePassword: parsed.data.oneTimePassword,
      });
      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        action: 'hostinger_deploy_started',
        targetType: 'deployment',
        targetId: run.id,
        details: {
          domain: run.domain,
          protocol: run.protocol,
        },
        ipAddress: extractClientIp(req),
      });
      res.status(202).json({ run });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Impossible de lancer le déploiement.',
      });
    }
  });

  router.get('/admin/deploy/runs/:runId', requireAdminAuth, standardLimiter, (req: AuthedRequest, res) => {
    const runId = String(req.params.runId || '');
    if (!/^deploy_[0-9]+_[a-f0-9]+$/.test(runId)) {
      res.status(400).json({ error: 'Identifiant de déploiement invalide.' });
      return;
    }
    const run = getDeployRunById(runId);
    if (!run) {
      res.status(404).json({ error: 'Déploiement introuvable.' });
      return;
    }
    res.json({ run });
  });

  router.get('/admin/deploy/package', requireAdminAuth, deployLimiter, (_req: AuthedRequest, res) => {
    const bundlePath = getLatestBundlePath();
    if (!bundlePath || !fs.existsSync(bundlePath)) {
      res.status(404).json({
        error: 'Aucune archive de production disponible. Lancez un déploiement pour générer le bundle.',
      });
      return;
    }
    const filename = path.basename(bundlePath);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(bundlePath).pipe(res);
  });

  // ===========================================================================
  // HOSTINGER UNLIMITED CRON JOB ENDPOINT (Secured by CRON_SECRET header)
  // ===========================================================================
  const cronLimiter = createRateLimiter({
    windowMs: 60_000,
    maxAuthenticated: 10,
    maxGuest: 10,
    bucketPrefix: 'hostinger_cron',
  });

  function isValidCronSecret(req: express.Request): { ok: boolean; misconfigured?: boolean } {
    const expected = (process.env.CRON_SECRET || '').trim();
    if (expected.length < 16) {
      return { ok: false, misconfigured: true };
    }
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const customHeader = String(req.headers['x-cron-secret'] || '').trim();
    const candidate = customHeader || bearerToken;
    if (!candidate) return { ok: false };

    const expectedBuf = Buffer.from(expected, 'utf8');
    const candidateBuf = Buffer.from(candidate, 'utf8');
    if (expectedBuf.length !== candidateBuf.length) return { ok: false };
    return { ok: crypto.timingSafeEqual(expectedBuf, candidateBuf) };
  }

  const handleCronTick = async (req: express.Request, res: express.Response) => {
    const check = isValidCronSecret(req);
    if (check.misconfigured) {
      res.status(503).json({
        error: 'CRON_SECRET non configuré (minimum 16 caractères requis dans les variables Hostinger).',
      });
      return;
    }
    if (!check.ok) {
      res.status(401).json({ error: 'Jeton CRON_SECRET invalide ou manquant.' });
      return;
    }
    try {
      // HTTP requests stay well under Hostinger proxy timeout (25s), resuming remaining queue on next Cron tick
      const summary = await runCronBatch({
        maxJobs: 5,
        maxDurationMs: 25_000,
        maxMemoryMb: 1800,
        trigger: 'hostinger_http_cron',
      });
      res.json({ ok: true, summary });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Erreur lors de l’exécution du cycle Cron.',
      });
    }
  };

  router.post('/cron/tick', cronLimiter, handleCronTick);
  router.get('/cron/tick', cronLimiter, handleCronTick);

  return router;
}
