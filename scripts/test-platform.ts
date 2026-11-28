import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  attachFirebaseAuth,
  BOOTSTRAP_ADMIN_EMAIL,
  clampStr,
  isSafePublicHttpUrl,
  registerAppTokenVerifier,
  registerUserModerationChecker,
  requireFirebaseAuth,
  sanitizeHttpUrl,
} from '../serverSecurity.ts';
import { safeExternalUrl } from '../src/utils/safeUrl.ts';
import {
  confirmPortalSubmission,
  createAuthUserRecord,
  createEngineDbBackup,
  deleteAuthUserByUid,
  detectAtsFromCareersUrl,
  enqueueBackgroundJob,
  getAccountModerationStatus,
  getAuthUserByEmail,
  getCompanyById,
  getEngineDb,
  getEngineOverviewMetrics,
  getLatestActiveVerificationCode,
  getSubmissionAttachmentForActor,
  grantAdminRoleByEmail,
  isSourceEnabled,
  listAuditLogs,
  listCompanyCareerChanges,
  listCompanyCareerJobs,
  listCrmEmailSyncEvents,
  listEmployerReceivedApplications,
  listEngineDbBackups,
  listUserApplicationSubmissions,
  listUserNotifications,
  markAuthUserEmailVerified,
  mergeCompanies,
  recordCompanySignal,
  recordCrmEmailSyncEvent,
  respondToEmployerApplication,
  revokeAdminRoleByEmail,
  setSourceEnabled,
  upsertCandidateSubscription,
  upsertCompany,
  upsertHrContact,
  upsertUserWorkspaceData,
  writeAuditLog,
} from '../serverEngineDb.ts';
import {
  createAuthRouter,
  createPasswordCredentials,
  generateFiveDigitCode,
  issueAndSendFiveDigitCode,
  issueAppSessionToken,
  verifyAppSessionToken,
  verifyFiveDigitCodeForUser,
  verifyPasswordCredentials,
} from '../serverAuthEngine.ts';
import { createIntelligenceRouter } from '../serverIntelligenceRoutes.ts';
import { monitorCompanyCareerPage } from '../serverCareerMonitor.ts';
import {
  checkLiveJobAvailability,
  detectScamRedFlags,
  submitRealApplication,
  verifyResendDomainStatus,
} from '../serverApplicationEngine.ts';
import { fetchAggregatedLiveJobFeeds, matchJobGeographyScore, type NormalizedFeedJob } from '../serverJobFeeds.ts';
import {
  computeBaselineMatch,
  initialCandidateProfile,
  initialCvDocuments,
  isLegacyDemoCv,
  isLegacyDemoProfile,
} from '../src/data/initialData.ts';
import {
  classifyRecruiterEmailReply,
  computeCandidateIntelligenceMatches,
  dispatchNotificationsForCandidate,
  getResendConfigStatus,
  runCronBatch,
  runWorkerTick,
  verifyCorporateDomainMx,
} from '../serverWorkerEngine.ts';
import {
  serializeAdminOverviewMetrics,
  serializeCareerChange,
  serializeCompany,
  serializeMatchItem,
  serializeNotification,
} from '../serverIntelligenceRoutes.ts';

async function runTests() {
  let passed = 0;
  const check = (name: string, fn: () => void | Promise<void>) =>
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  [PASS] ${name}`);
      });

  console.log('Running JOBFOUNDS Recruitment Intelligence & Security Integration Tests...\n');

  // Track created test entities for clean teardown
  const createdCompanyIds: string[] = [];
  const testUid = `test_uid_${Date.now()}`;
  const testJobIds: string[] = [];
  let createdAuditAction = '';

  try {
    // 1. Security & SSRF / XSS validation
    await check('URL validation blocks unsafe schemes and private/local hosts', () => {
      assert.equal(isSafePublicHttpUrl('javascript:alert(1)'), false);
      assert.equal(isSafePublicHttpUrl('file:///etc/passwd'), false);
      assert.equal(isSafePublicHttpUrl('http://localhost:3000/api/health'), false);
      assert.equal(isSafePublicHttpUrl('http://127.0.0.1/admin'), false);
      assert.equal(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data/'), false);
      assert.equal(isSafePublicHttpUrl('http://10.0.0.5/internal'), false);
      assert.equal(isSafePublicHttpUrl('http://192.168.1.10/'), false);
      assert.equal(isSafePublicHttpUrl('http://172.16.0.1/'), false);
      assert.equal(isSafePublicHttpUrl('https://careers.qonto.com/jobs'), true);
      assert.equal(sanitizeHttpUrl('javascript:void(0)'), '');
      assert.equal(sanitizeHttpUrl('https://jobs.abb.com/role/123'), 'https://jobs.abb.com/role/123');
    });

    await check('Frontend safeExternalUrl rejects dangerous protocols', () => {
      assert.equal(safeExternalUrl('javascript:alert(1)'), null);
      assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
      assert.equal(safeExternalUrl('ftp://example.com/file'), null);
      assert.equal(safeExternalUrl('https://remotive.com/remote-jobs'), 'https://remotive.com/remote-jobs');
    });

    await check('Input clamping enforces strict max character bounds', () => {
      const oversized = 'A'.repeat(500);
      assert.equal(clampStr(oversized, 120).length, 120);
      assert.equal(clampStr(null, 50), '');
      assert.equal(clampStr('  hello  ', 20), 'hello');
    });

    // 2. Live HTTP Server & Auth Enforcement
    await check('GET /api/health returns 200 OK with live SQLite engine telemetry', async () => {
      const res = await fetch('http://127.0.0.1:3000/api/health');
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        status?: string;
        ok?: boolean;
        engine?: { sqliteReady?: boolean; backgroundWorkerActive?: boolean };
      };
      assert.ok(body.status === 'ok' || body.ok === true);
      assert.equal(body.engine?.sqliteReady, true, 'Expected engine.sqliteReady = true');
      assert.equal(body.engine?.backgroundWorkerActive, true, 'Expected engine.backgroundWorkerActive = true');
    });

    await check('Sensitive APIs enforce 401 AUTH_REQUIRED without valid Firebase Bearer token', async () => {
      const protectedRoutes: Array<{ method: 'GET' | 'POST'; path: string; body?: unknown }> = [
        { method: 'POST', path: '/api/jobs/search', body: { query: 'engineer' } },
        { method: 'GET', path: '/api/intelligence/companies' },
        { method: 'GET', path: '/api/notifications' },
        { method: 'GET', path: '/api/admin/overview' },
      ];
      for (const route of protectedRoutes) {
        const res = await fetch(`http://127.0.0.1:3000${route.path}`, {
          method: route.method,
          headers: route.body ? { 'Content-Type': 'application/json' } : undefined,
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        assert.equal(
          res.status,
          401,
          `Expected 401 on unauthenticated ${route.method} ${route.path}, got ${res.status}`
        );
      }
    });

    await check('POST /api/jobs/feeds returns real live job listings & rate-limit headers', async () => {
      const res = await fetch('http://127.0.0.1:3000/api/jobs/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'engineer', country: '' }),
      });
      assert.equal(res.status, 200);
      const remaining = res.headers.get('x-ratelimit-remaining');
      assert.ok(remaining !== null, 'Expected X-RateLimit-Remaining header');
      const data = (await res.json()) as {
        jobs?: Array<{ id: string; title: string; company: string; sourceUrl: string }>;
        activeProviders?: string[];
      };
      assert.ok(Array.isArray(data.jobs), 'Expected jobs array');
      assert.ok(data.jobs.length > 0, 'Expected at least 1 live job from public feeds');
      assert.ok(
        data.jobs.every((j) => Boolean(j.id && j.title && j.company)),
        'All normalized feed jobs must have id, title, and company'
      );
      console.log(
        `         -> Received ${data.jobs.length} live jobs from providers: ${(data.activeProviders || []).join(', ')}`
      );
    });

    await check('Default JSON body limit (256KB) rejects oversized payloads on non-upload routes', async () => {
      const hugePayload = JSON.stringify({ title: 'Test', description: 'X'.repeat(350_000) });
      const res = await fetch('http://127.0.0.1:3000/api/jobs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugePayload,
      });
      assert.equal(res.status, 413);
    });

    await check('GET / renders HTML entry with JOBFOUNDS metadata', async () => {
      const res = await fetch('http://127.0.0.1:3000/');
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('JOBFOUNDS'), 'HTML should include JOBFOUNDS brand title');
    });

    // 3. Company Database, Automatic Deduplication & Duplicate Merge
    let primaryCompanyId = '';
    await check('SQLite Company DB persists, deduplicates, and merges duplicate entities cleanly', () => {
      const uniqueTag = Date.now().toString(36);
      const first = upsertCompany({
        officialName: `Linear TestCorp ${uniqueTag}`,
        officialWebsite: `https://linear-test-${uniqueTag}.example.com`,
        country: 'United States',
        location: 'San Francisco / Remote',
        sector: 'Developer Tools',
        careersUrl: 'https://jobs.ashbyhq.com/linear',
        frequentSkills: ['TypeScript', 'React'],
        sourceName: 'Automated Integration Test',
      });
      assert.equal(first.created, true);
      primaryCompanyId = first.company.id;
      createdCompanyIds.push(primaryCompanyId);

      // Re-inserting same domain must deduplicate instead of creating a duplicate
      const dedup = upsertCompany({
        officialName: `Linear TestCorp ${uniqueTag} Inc.`,
        officialWebsite: `https://www.linear-test-${uniqueTag}.example.com`,
        frequentSkills: ['Node.js'],
      });
      assert.equal(dedup.created, false);
      assert.equal(dedup.merged, true);
      assert.equal(dedup.company.id, primaryCompanyId);
      assert.ok(dedup.company.frequentSkills.includes('Node.js'));

      // Create a distinct duplicate with different domain and merge it into primary
      const dup = upsertCompany({
        officialName: `Linear Duplicate ${uniqueTag}`,
        officialWebsite: `https://linear-dup-${uniqueTag}.example.com`,
        frequentSkills: ['PostgreSQL'],
      });
      assert.equal(dup.created, true);
      createdCompanyIds.push(dup.company.id);

      const merged = mergeCompanies(dup.company.id, primaryCompanyId);
      assert.equal(merged.id, primaryCompanyId);
      assert.ok(merged.frequentSkills.includes('PostgreSQL'));
      assert.equal(getCompanyById(dup.company.id), null);
    });

    // 4. Live Official ATS Career Page Monitoring + Diff Engine
    await check('Live ATS Career Monitor reads real official public ATS board, persists jobs & diffs changes', async () => {
      const result = await monitorCompanyCareerPage(primaryCompanyId);
      assert.equal(result.atsProvider, 'ashby');
      assert.ok(result.activeCount > 0, `Expected real active jobs from Linear Ashby ATS board (warning: ${result.warning || 'none'})`);
      assert.ok(result.addedCount > 0, 'Expected initial scan to detect added jobs');

      const storedJobs = listCompanyCareerJobs(primaryCompanyId);
      const changes = listCompanyCareerChanges(primaryCompanyId);
      assert.ok(storedJobs.length > 0, 'Expected persisted career_jobs rows');
      assert.ok(changes.length > 0, 'Expected persisted career_changes diff rows');

      // Run a second pass immediately — should detect 0 newly added jobs (idempotent diff)
      const secondRun = await monitorCompanyCareerPage(primaryCompanyId);
      assert.equal(secondRun.addedCount, 0, 'Second immediate scan must not duplicate existing active jobs');

      console.log(
        `         -> Live Ashby ATS board scanned: ${result.activeCount} real jobs persisted, top skills: ${result.extractedSkills.slice(0, 5).join(', ')}`
      );
    });

    // 5. Real DNS MX Corporate Domain Verification
    await check('Real DNS MX verification confirms corporate mail domain (stripe.com) and flags invalid domains', async () => {
      const validMx = await verifyCorporateDomainMx('stripe.com');
      assert.equal(validMx.verified, true, 'Expected stripe.com to have valid MX records');
      assert.ok(validMx.mxHosts.length > 0);

      const invalidMx = await verifyCorporateDomainMx('nonexistent-domain-jobfounds-xyz-99999.invalid');
      assert.equal(invalidMx.verified, false);
      console.log(`         -> stripe.com verified MX host: ${validMx.mxHosts[0]}`);
    });

    // 6. Signals, Verified Contacts, 4-Tier Explainable Matching & Candidate Notifications
    await check('Central 4-tier Matching Engine & Notification Dispatcher work offline with stored signals, jobs & contacts', async () => {
      const sigRes = recordCompanySignal({
        companyId: primaryCompanyId,
        signalType: 'expansion',
        classification: 'probable_hiring_signal',
        title: 'European engineering hub expansion',
        summary: 'Public product roadmap and engineering team growth across Europe.',
        evidenceQuote: 'Scaling distributed product engineering teams.',
        skillsInferred: ['TypeScript', 'React', 'Node.js'],
        sourceName: 'Public Engineering Blog',
        sourceUrl: 'https://linear.app/blog',
        reliabilityScore: 82,
        relevanceScore: 88,
      });
      assert.equal(sigRes.inserted, true);

      const hrRes = upsertHrContact({
        companyId: primaryCompanyId,
        fullName: 'Talent Acquisition Team',
        roleTitle: 'Engineering Recruiting',
        department: 'Engineering',
        roleCategory: 'hr_talent',
        publicProfileUrl: 'https://jobs.ashbyhq.com/linear',
        publicChannel: 'Official Ashby Careers Portal',
        emailDomainVerified: true,
        mxVerified: true,
        sourceName: 'Official Ashby Careers Portal',
        sourceUrl: 'https://jobs.ashbyhq.com/linear',
        confidenceLevel: 'confirmed',
        confidenceScore: 92,
        verificationNote: 'Official public careers portal verified',
      });
      assert.equal(hrRes.inserted, true);

      const matches = computeCandidateIntelligenceMatches({
        currentTitle: 'Senior Full-Stack Engineer',
        yearsExperience: 6,
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
        preferredCountries: ['United States', 'France'],
        preferredWorkModes: ['Remote', 'Hybrid'],
        relocationReady: true,
        targetSectors: ['Developer Tools'],
      });
      assert.ok(matches.length > 0, 'Expected explainable matches');
      assert.ok(
        matches.some((m) => m.companyId === primaryCompanyId && m.classification === 'confirmed_job'),
        'Expected Tier 1 confirmed_job match from live ATS'
      );
      assert.ok(
        matches.some((m) => m.companyId === primaryCompanyId && m.classification === 'probable_hiring_signal'),
        'Expected Tier 3 probable_hiring_signal match from recorded signal'
      );
      const topMatch = matches.find((m) => m.companyId === primaryCompanyId)!;
      assert.ok(topMatch.recommendedContact, 'Expected recommended verified HR contact attached');

      const sub = upsertCandidateSubscription({
        uid: testUid,
        email: 'candidate-test@example.com',
        profile: {
          currentTitle: 'Senior Full-Stack Engineer',
          yearsExperience: 6,
          skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
          preferredWorkModes: ['Remote'],
        },
        preferredCountries: ['United States'],
        preferredSectors: ['Developer Tools'],
        frequency: 'instant',
        channels: { inApp: true, email: false, push: false },
        enabled: true,
      });

      const dispatched = await dispatchNotificationsForCandidate(sub, 50);
      assert.ok(dispatched.createdCount > 0, 'Expected at least 1 personalized notification created');

      const storedNotifs = listUserNotifications(testUid, 20);
      assert.ok(storedNotifs.length > 0);
      console.log(
        `         -> Generated ${matches.length} explainable matches and ${dispatched.createdCount} persisted candidate notifications`
      );
    });

    // 7. Autonomous Background Task Queue, Deduplication & Worker Tick
    await check('Background Task Queue deduplicates tasks and executes via runWorkerTick with zero users connected', async () => {
      const dedupKey = `test_match_dispatch_${Date.now()}`;
      const j1 = enqueueBackgroundJob({
        jobType: 'dispatch_notifications',
        dedupKey,
        payload: { trigger: 'automated_test' },
        createdBy: 'test_suite',
      });
      assert.equal(j1.deduplicated, false);
      testJobIds.push(j1.job.id);

      const j2 = enqueueBackgroundJob({
        jobType: 'dispatch_notifications',
        dedupKey,
        payload: { trigger: 'automated_test' },
        createdBy: 'test_suite',
      });
      assert.equal(j2.deduplicated, true);
      assert.equal(j2.job.id, j1.job.id);

      const tickResult = await runWorkerTick(2);
      assert.ok(tickResult.processed >= 1, 'Expected worker tick to process queued job');
    });

    // 8. Admin Source Governance & Immutable Audit Logs
    await check('Admin source pause/resume and immutable audit logs persist cleanly', () => {
      const initial = isSourceEnabled('themuse_api');
      setSourceEnabled('themuse_api', !initial);
      assert.equal(isSourceEnabled('themuse_api'), !initial);
      setSourceEnabled('themuse_api', initial);
      assert.equal(isSourceEnabled('themuse_api'), initial);

      createdAuditAction = `test_audit_${Date.now()}`;
      writeAuditLog({
        actorUid: 'test_admin',
        actorEmail: 'test@jobfounds.local',
        action: createdAuditAction,
        targetType: 'source',
        targetId: 'themuse_api',
        details: { toggled: true },
        ipAddress: '127.0.0.1',
      });
      const logs = listAuditLogs(20);
      assert.ok(logs.some((l) => l.action === createdAuditAction));

      const overview = getEngineOverviewMetrics();
      assert.ok(typeof overview.companiesRegistered === 'number');
      assert.ok(Array.isArray(overview.sources) && overview.sources.length > 0);
    });

    // 9. Backend-to-Frontend API Contract Serializers & Resend Diagnostics
    await check('API serializers emit exact frontend contract fields (zero undefined/object traps) & Resend status', () => {
      const serializedMetrics = serializeAdminOverviewMetrics();
      assert.equal(typeof serializedMetrics.publishedJobsActive, 'number');
      assert.equal(typeof serializedMetrics.publishedJobsExpired, 'number');
      assert.equal(typeof serializedMetrics.signalsTotal, 'number');
      assert.equal(typeof serializedMetrics.contactsTotal, 'number');
      assert.equal(typeof serializedMetrics.sources[0]?.callsCurrentHour, 'number');

      const company = getCompanyById(primaryCompanyId)!;
      const sc = serializeCompany(company);
      assert.equal(typeof sc.officialDomain, 'string');
      assert.ok(Array.isArray(sc.sourceNames));

      const changes = listCompanyCareerChanges(primaryCompanyId);
      if (changes[0]) {
        const sch = serializeCareerChange(changes[0]);
        assert.equal(typeof sch.details, 'string', 'Career change details must serialize to safe string');
      }

      const matches = computeCandidateIntelligenceMatches({
        currentTitle: 'Engineer',
        skills: ['TypeScript'],
      });
      if (matches[0]) {
        const sm = serializeMatchItem(matches[0]);
        assert.equal(typeof sm.overallScore, 'number');
        assert.equal(typeof sm.breakdown.skills, 'number');
        assert.equal(typeof sm.breakdown.locationAndMobility, 'number');
        assert.ok(Array.isArray(sm.proofs) && sm.proofs.length > 0);
      }

      const notifs = listUserNotifications(testUid, 5);
      if (notifs[0]) {
        const sn = serializeNotification(notifs[0]);
        assert.equal(typeof sn.channelInApp, 'boolean');
        assert.equal(typeof sn.channelEmailSent, 'boolean');
        assert.equal(typeof sn.actionUrl, 'string');
      }

      const resendStatus = getResendConfigStatus();
      assert.equal(typeof resendStatus.ready, 'boolean');
      assert.equal(typeof resendStatus.resendKeyConfigured, 'boolean');
    });

    // 10. Module 7 Gmail Recruiter Reply Classification, SQLite Persistence & Auth Guards
    await check('Module 7 Gmail reply classifier, SQLite deduplication, and new Module 1 & 7 auth routes work cleanly', async () => {
      assert.equal(
        classifyRecruiterEmailReply({
          subject: 'Invitation entretien technique - Stripe',
          snippet: 'Merci de choisir un créneau sur Calendly pour notre entretien.',
        }).detectedStage,
        'Interview Scheduled'
      );
      assert.equal(
        classifyRecruiterEmailReply({
          subject: 'Formal Job Offer — Senior Engineer',
          snippet: 'We are pleased to offer you the position with our team.',
        }).detectedStage,
        'Offer Received'
      );
      assert.equal(
        classifyRecruiterEmailReply({
          subject: 'Suite à votre candidature',
          snippet: 'Malheureusement, nous ne retenons pas votre profil pour ce poste.',
        }).detectedStage,
        'Rejected'
      );
      assert.equal(
        classifyRecruiterEmailReply({
          subject: 'Application received',
          snippet: 'Thank you for applying, our team is currently reviewing your application.',
        }).detectedStage,
        'Under Review'
      );
      assert.equal(
        classifyRecruiterEmailReply({
          subject: 'Quick question about your portfolio',
          snippet: 'Could you share the link to your latest architecture project?',
        }).detectedStage,
        'Message Received'
      );

      const gmailMsgId = `gmail_test_${Date.now()}`;
      const e1 = recordCrmEmailSyncEvent({
        uid: testUid,
        applicationId: 'app_test_1',
        company: 'Stripe',
        gmailMessageId: gmailMsgId,
        sender: 'recruiting@stripe.com',
        subject: 'Interview invitation',
        snippet: 'Pick a Calendly slot',
        detectedStage: 'Interview Scheduled',
        confidence: 'high',
        reason: 'Interview invitation detected.',
        receivedAt: new Date().toISOString(),
      });
      assert.equal(e1.created, true);

      const e2 = recordCrmEmailSyncEvent({
        uid: testUid,
        applicationId: 'app_test_1',
        company: 'Stripe',
        gmailMessageId: gmailMsgId,
        sender: 'recruiting@stripe.com',
        subject: 'Interview invitation',
        snippet: 'Pick a Calendly slot',
        detectedStage: 'Interview Scheduled',
        confidence: 'high',
        reason: 'Interview invitation detected.',
        receivedAt: new Date().toISOString(),
      });
      assert.equal(e2.created, false);
      assert.equal(e2.event.id, e1.event.id);

      const history = listCrmEmailSyncEvents(testUid, 10);
      assert.ok(history.some((ev) => ev.gmailMessageId === gmailMsgId));

      // Verify new Module 1 & Module 7 endpoints enforce Firebase Auth (401 without token)
      const rDiscover = await fetch('http://127.0.0.1:3000/api/intelligence/discover-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countries: ['France', 'Canada'] }),
      });
      assert.equal(rDiscover.status, 401);

      const rGmail = await fetch('http://127.0.0.1:3000/api/crm/gmail-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applications: [] }),
      });
      assert.equal(rGmail.status, 401);

      const rHistory = await fetch('http://127.0.0.1:3000/api/crm/email-sync-history');
      assert.equal(rHistory.status, 401);
    });

    // 11. Live Job Availability Check, Scam Filter, ATS Merge & 9-Criteria Matching
    await check('Live availability check blocks SSRF, detects scam red flags, merges verified ATS jobs & scores all 9 criteria', async () => {
      // SSRF block
      const unsafeCheck = await checkLiveJobAvailability('http://127.0.0.1:3000/api/health');
      assert.equal(unsafeCheck.available, false);
      assert.equal(unsafeCheck.status, 'unreachable');

      // Live public ATS URL check
      const liveCheck = await checkLiveJobAvailability('https://jobs.ashbyhq.com/linear');
      assert.ok(
        liveCheck.status === 'available' || liveCheck.status === 'unverifiable',
        `Expected available or unverifiable for public Ashby URL, got ${liveCheck.status}`
      );

      // Scam red-flag detection
      const scamFlags = detectScamRedFlags(
        'Urgent remote job! Pay $200 registration fee via Western Union and contact us only on Telegram @recruiter.'
      );
      assert.ok(scamFlags.length > 0, 'Expected scam red-flag detector to catch upfront-fee / Telegram-only scam');
      assert.equal(
        detectScamRedFlags('Senior TypeScript Engineer — Full-time CDI in Paris with official ATS.').length,
        0
      );

      // 9-criteria matching verification
      const matches = computeCandidateIntelligenceMatches({
        currentTitle: 'Senior Full-Stack Engineer',
        yearsExperience: 6,
        highestDegree: 'Master in Computer Science',
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
        languages: ['French', 'English'],
        preferredCountries: ['United States', 'France'],
        preferredWorkModes: ['Remote', 'Hybrid'],
        relocationReady: true,
        workAuthorization: 'EU Citizen / Visa sponsorship eligible',
        availability: 'Immediate (1 month notice)',
        minSalaryAnnualUsd: 90000,
        targetSectors: ['Developer Tools'],
      });
      const m = matches.find((item) => item.companyId === primaryCompanyId);
      assert.ok(m, 'Expected match for primary test company');
      const serialized = serializeMatchItem(m);
      for (const dimKey of [
        'skills',
        'experience',
        'education',
        'languages',
        'locationAndMobility',
        'workAuthorization',
        'availability',
        'salary',
        'sourceReliability',
        'signalReliability',
      ] as const) {
        assert.equal(
          typeof serialized.breakdown[dimKey],
          'number',
          `Expected numeric 9-criteria breakdown.${dimKey}`
        );
      }
      assert.equal(serialized.breakdown.sourceReliability, serialized.breakdown.signalReliability);

      // ATS merge inside live feeds
      const feedResult = await fetchAggregatedLiveJobFeeds({ query: '', country: '' });
      assert.ok(
        feedResult.jobs.some((j) => j.id.startsWith('ats_')),
        'Expected verified SQLite ATS career jobs to be merged into aggregated live job feeds'
      );
    });

    // 12. Honest Real Application Submission Engine, Ownership Scoping & Auth Enforcement
    await check('Application submission enforces explicit authorization, attachment validation, honest status & user ownership', async () => {
      // Must reject if explicitAuthorization is false
      await assert.rejects(
        () =>
          submitRealApplication({
            userId: testUid,
            candidateEmail: 'candidate-test@example.com',
            candidateName: 'Test Candidate',
            companyId: primaryCompanyId,
            companyName: 'Linear TestCorp',
            roleTitle: 'Senior Engineer',
            opportunityType: 'published_job',
            channel: 'official_portal',
            officialUrl: 'https://jobs.ashbyhq.com/linear',
            subject: 'Application',
            coverLetter: 'Cover letter body',
            explicitAuthorization: false,
          }),
        /autorisation|explicit/i
      );

      // Must reject dangerous attachment MIME types
      await assert.rejects(
        () =>
          submitRealApplication({
            userId: testUid,
            candidateEmail: 'candidate-test@example.com',
            candidateName: 'Test Candidate',
            companyName: 'Linear TestCorp',
            roleTitle: 'Senior Engineer',
            opportunityType: 'published_job',
            channel: 'official_portal',
            officialUrl: 'https://jobs.ashbyhq.com/linear',
            subject: 'Application',
            coverLetter: 'Cover letter body',
            attachments: [
              {
                filename: 'malware.exe',
                contentType: 'application/x-msdownload',
                base64Content: Buffer.from('MZtest').toString('base64'),
              },
            ],
            explicitAuthorization: true,
          }),
        /autoris|mime|unsupported|type|format/i
      );

      // Official portal submission MUST return transmitted: false and awaiting_portal_confirmation
      const portalRes = await submitRealApplication({
        userId: testUid,
        candidateEmail: 'candidate-test@example.com',
        candidateName: 'Test Candidate',
        companyId: primaryCompanyId,
        companyName: 'Linear TestCorp',
        roleTitle: 'Senior Full-Stack Engineer',
        opportunityType: 'published_job',
        channel: 'official_portal',
        officialUrl: 'https://jobs.ashbyhq.com/linear',
        subject: 'Application — Senior Full-Stack Engineer',
        coverLetter: 'Interested in joining the engineering team.',
        attachments: [
          {
            filename: 'cv-test.txt',
            contentType: 'text/plain',
            base64Content: Buffer.from('Test CV content').toString('base64'),
          },
        ],
        explicitAuthorization: true,
      });
      assert.equal(portalRes.transmitted, false, 'Official portal handoff must NEVER pretend transmitted=true');
      assert.equal(portalRes.submission.deliveryStatus, 'awaiting_portal_confirmation');

      // Different user must NOT be able to confirm another user's submission
      const wrongUserConfirm = confirmPortalSubmission({
        submissionId: portalRes.submission.id,
        userId: 'other_uid_forbidden',
      });
      assert.equal(wrongUserConfirm, null, 'Expected cross-user confirmation to be blocked');

      // Owner confirmation transitions status cleanly
      const ownerConfirmed = confirmPortalSubmission({
        submissionId: portalRes.submission.id,
        userId: testUid,
        portalReference: 'ATS-CONF-2026',
      });
      assert.ok(ownerConfirmed);
      assert.equal(ownerConfirmed.deliveryStatus, 'portal_confirmed_by_user');

      const storedSubs = listUserApplicationSubmissions(testUid, 10);
      assert.ok(storedSubs.some((s) => s.id === portalRes.submission.id));

      // Verify new HTTP application endpoints enforce 401 Firebase Auth
      for (const route of [
        { method: 'POST', path: '/api/jobs/check-availability', body: { url: 'https://jobs.ashbyhq.com/linear' } },
        { method: 'POST', path: '/api/applications/submit', body: { companyName: 'Test' } },
        { method: 'GET', path: '/api/applications/submissions' },
        { method: 'GET', path: '/api/employer/applications' },
        { method: 'GET', path: '/api/email/status' },
      ]) {
        const res = await fetch(`http://127.0.0.1:3000${route.path}`, {
          method: route.method,
          headers: route.body ? { 'Content-Type': 'application/json' } : undefined,
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        assert.equal(res.status, 401, `Expected 401 on unauthenticated ${route.method} ${route.path}`);
      }
    });

    // 13. E2E-C & E2E-D: Complete Direct Application Loop (Candidate -> Employer Inbox -> Attachment Download -> Employer Reply -> Candidate Notification & CRM)
    const testRecruiterUid = `test_recruiter_${Date.now()}`;
    await check('E2E-C/D: Direct application lands in employer inbox with CV attachment, strict access control, employer reply & candidate notification', async () => {
      const cvText = 'CV Candidat Test — Senior Full-Stack Engineer TypeScript React Node.js';
      const directRes = await submitRealApplication({
        userId: testUid,
        recruiterId: testRecruiterUid,
        candidateName: 'Alice Martin',
        candidateEmail: 'alice.martin@example.com',
        companyId: primaryCompanyId,
        companyName: 'Linear TestCorp',
        roleTitle: 'Staff Platform Engineer',
        opportunityType: 'published_job',
        classification: 'confirmed_job',
        channel: 'jobfounds_direct',
        subject: 'Candidature directe — Staff Platform Engineer',
        coverLetter: 'Bonjour, je souhaite rejoindre votre équipe plateforme et je joins mon CV adapté.',
        cvVersionName: 'CV Alice Martin — Plateforme',
        attachments: [
          {
            filename: 'CV_Alice_Martin.txt',
            contentType: 'text/plain',
            base64Content: Buffer.from(cvText, 'utf8').toString('base64'),
          },
        ],
        explicitAuthorization: true,
      });
      assert.equal(directRes.transmitted, true);
      assert.equal(directRes.deliveryStatus, 'transmitted_jobfounds_portal');
      assert.equal(directRes.submission.recruiterId, testRecruiterUid);

      // Employer receives application in their inbox
      const employerInbox = listEmployerReceivedApplications(testRecruiterUid, 20);
      assert.ok(employerInbox.some((a) => a.id === directRes.submission.id));
      const received = employerInbox.find((a) => a.id === directRes.submission.id)!;
      assert.equal(received.candidateName, 'Alice Martin');
      assert.equal(received.attachments.length, 1);

      // Employer can download candidate attachment; unauthorized 3rd party MUST be blocked
      const attOk = getSubmissionAttachmentForActor({
        submissionId: received.id,
        actorUid: testRecruiterUid,
        attachmentIndex: 0,
      });
      assert.ok(attOk);
      assert.equal(attOk.buffer.toString('utf8'), cvText);

      const attForbidden = getSubmissionAttachmentForActor({
        submissionId: received.id,
        actorUid: 'intruder_uid_blocked',
        attachmentIndex: 0,
      });
      assert.equal(attForbidden, null, 'Unauthorized actor must not access candidate CV attachment');

      // Employer was notified of incoming direct application
      const recruiterNotifs = listUserNotifications(testRecruiterUid, 10);
      assert.ok(recruiterNotifs.some((n) => n.title.includes('Staff Platform Engineer')));

      // Employer responds & updates status -> candidate submission reflects reply cleanly
      const wrongRecruiterReply = respondToEmployerApplication({
        submissionId: received.id,
        recruiterId: 'intruder_recruiter',
        status: 'interview_scheduled',
        replyMessage: 'Spoofed reply',
      });
      assert.equal(wrongRecruiterReply, null, 'Cross-recruiter reply must be blocked');

      const replied = respondToEmployerApplication({
        submissionId: received.id,
        recruiterId: testRecruiterUid,
        status: 'interview_scheduled',
        replyMessage: 'Bonjour Alice, nous souhaitons planifier un entretien technique jeudi à 14h.',
      });
      assert.ok(replied);
      assert.equal(replied.employerStatus, 'interview_scheduled');
      assert.ok(replied.employerReply.includes('entretien technique'));
    });

    // 14. E2E-B & ATS Coverage: Workday + SmartRecruiters ATS Detection, Resend Domain Diagnostics & Spontaneous Email Honesty
    await check('E2E-B/ATS: Workday & SmartRecruiters detection, Resend domain diagnostics & honest Resend unconfigured handling', async () => {
      const wd = detectAtsFromCareersUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite');
      assert.equal(wd.provider, 'workday');
      assert.equal(wd.token, 'nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite');

      const sr = detectAtsFromCareersUrl('https://jobs.smartrecruiters.com/Visa');
      assert.equal(sr.provider, 'smartrecruiters');
      assert.equal(sr.token, 'Visa');

      const diag = await verifyResendDomainStatus();
      assert.equal(typeof diag.ready, 'boolean');
      assert.equal(typeof diag.dnsSpfDetected, 'boolean');
      assert.equal(typeof diag.dnsDmarcDetected, 'boolean');

      // Spontaneous application via resend_email when Resend is unconfigured MUST honestly return transmitted: false
      if (!diag.ready) {
        const spontRes = await submitRealApplication({
          userId: testUid,
          candidateName: 'Alice Martin',
          candidateEmail: 'alice.martin@example.com',
          companyId: primaryCompanyId,
          companyName: 'Linear TestCorp',
          roleTitle: 'Candidature spontanée — Ingénieur IA',
          opportunityType: 'hidden_opportunity',
          classification: 'probable_hiring_signal',
          channel: 'resend_email',
          recipientEmail: 'careers@stripe.com',
          subject: 'Candidature spontanée — Ingénieur IA',
          coverLetter: 'Suite à votre signal d’expansion en Europe, je vous propose ma candidature spontanée.',
          explicitAuthorization: true,
        });
        assert.equal(spontRes.transmitted, false, 'Must never fake email transmission when Resend is not configured');
        assert.equal(spontRes.deliveryStatus, 'failed');
        assert.equal(spontRes.mxVerified, true, 'Expected real DNS MX verification on stripe.com');
      }
    });

    // 15. E2E-E & E2E-F: Offline Autonomous Cron Batch, SQLite Backup Rotation & Live HTTP Security Headers
    await check('E2E-E/F: Offline runCronBatch monitoring, SQLite backup creation/rotation & live HTTP security headers', async () => {
      const cronSummary = await runCronBatch({
        maxJobs: 2,
        maxDurationMs: 15_000,
        maxMemoryMb: 1800,
        trigger: 'e2e_test_cron',
      });
      assert.equal(typeof cronSummary.processed, 'number');
      assert.equal(typeof cronSummary.remainingQueued, 'number');

      const backup = createEngineDbBackup('e2e_test', 7);
      assert.ok(backup.filename.startsWith('jobfounds-'));
      assert.ok(backup.sizeBytes > 0);
      const allBackups = listEngineDbBackups();
      assert.ok(allBackups.some((b) => b.filename === backup.filename));

      const healthRes = await fetch('http://127.0.0.1:3000/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      const healthBody = (await healthRes.json()) as any;
      assert.equal(healthBody.ok, true);
      assert.equal(healthBody.engine.sqliteReady, true);
      assert.ok(typeof healthBody.engine.backupsCount === 'number' && healthBody.engine.backupsCount >= 0);
      assert.ok(typeof healthBody.engine.nodeVersion === 'string' && healthBody.engine.nodeVersion.startsWith('v'));
    });

    // 16. Zero Fake Demo Data + 9-Criteria Unified Baseline Matching
    await check('Zero fake initial data (profile/CV empty), safe legacy purge & unified 9-criteria baseline match', () => {
      assert.equal(initialCandidateProfile.fullName, '');
      assert.equal(initialCandidateProfile.skills.length, 0);
      assert.equal(initialCvDocuments.length, 0);

      // Legacy demo detection must purge ONLY old fake seeds, never real user records
      assert.equal(
        isLegacyDemoProfile({
          ...initialCandidateProfile,
          fullName: 'Candidat JOBFOUNDS',
          currentTitle: 'Senior Full-Stack & Product Engineer',
          yearsExperience: 6,
          originCountry: 'France',
        }),
        true
      );
      assert.equal(
        isLegacyDemoProfile({
          ...initialCandidateProfile,
          fullName: 'Jean-Marc Pierre',
          currentTitle: 'Software Engineer',
        }),
        false
      );
      assert.equal(
        isLegacyDemoCv({
          id: 'cv-primary-1',
          versionName: 'CV',
          updatedAt: '2026-01-01',
          template: 'executive',
          fullName: 'Candidat JOBFOUNDS',
          headline: '',
          email: 'contact@jobfounds.com',
          phone: '+33 6 00 00 00 00',
          location: '',
          linkedin: '',
          summary: '',
          experiences: [],
          education: [],
          skills: [],
          languages: [],
        }),
        true
      );
      assert.equal(
        isLegacyDemoCv({
          id: 'cv-real-1',
          versionName: 'Mon CV',
          updatedAt: '2026-01-01',
          template: 'executive',
          fullName: 'Jean-Marc Pierre',
          headline: 'Engineer',
          email: 'jm@realmail.com',
          phone: '+509 0000 0000',
          location: 'Port-au-Prince',
          linkedin: '',
          summary: '',
          experiences: [],
          education: [],
          skills: ['TypeScript'],
          languages: ['Français'],
        }),
        false
      );

      const baseline = computeBaselineMatch(
        {
          ...initialCandidateProfile,
          fullName: 'Real Candidate',
          currentTitle: 'Senior TypeScript Engineer',
          yearsExperience: 6,
          highestDegree: 'Master Computer Science',
          skills: ['TypeScript', 'React', 'Node.js'],
          languages: ['Français', 'English'],
          preferredCountries: ['Canada', 'France'],
          preferredWorkModes: ['Remote', 'Hybrid'],
          relocationReady: true,
          workAuthorization: 'Work permit / Visa sponsorship eligible',
          availability: 'Immediate',
          minSalaryAnnualUsd: 80000,
        },
        {
          id: 'job_test_9',
          title: 'Senior TypeScript Engineer',
          company: 'Real Corp',
          country: 'Canada',
          city: 'Montreal',
          workMode: 'Remote',
          contractType: 'Full-time',
          experienceLevel: 'Senior',
          degreeRequired: 'Master',
          salaryRange: '$100,000 - $120,000 USD',
          salaryMinAnnualUsd: 100000,
          languages: ['English', 'French'],
          skills: ['TypeScript', 'React', 'SQL'],
          publishedDate: new Date().toISOString().slice(0, 10),
          sourceName: 'Official ATS',
          sourceUrl: 'https://boards.greenhouse.io/realcorp/jobs/1',
          verificationStatus: 'Verified',
          verificationSummary: 'Verified official ATS',
          description: 'Build reliable software.',
          visaSponsorship: 'Available',
        }
      );

      assert.ok(baseline.score >= 60 && baseline.score <= 100);
      for (const key of [
        'skills',
        'experience',
        'education',
        'languages',
        'locationAndMobility',
        'workAuthorization',
        'availability',
        'salary',
        'sourceReliability',
      ] as const) {
        assert.equal(typeof baseline.breakdown[key], 'number', `Expected 9-criteria breakdown.${key}`);
      }
    });

    // 17. International 7-Continent Geography Matching & Multi-Region Live Feeds (Zero Cross-Continent Leakage)
    await check('7-Continent strict geography matching (4-tier, zero leakage) & live international feeds', async () => {
      const mkJob = (
        country: string,
        city: string,
        workMode: 'Remote' | 'Hybrid' | 'On-site' = 'On-site',
        title = 'Software Engineer'
      ): NormalizedFeedJob => ({
        id: `geo_${country}_${city}`,
        title,
        company: 'Global Org',
        country,
        city,
        workMode,
        contractType: 'Full-time',
        experienceLevel: 'Mid-level',
        degreeRequired: 'Not specified',
        salaryRange: 'Not disclosed',
        languages: ['English'],
        skills: ['TypeScript'],
        publishedDate: new Date().toISOString().slice(0, 10),
        sourceName: 'Official ATS',
        sourceUrl: 'https://example.org/jobs/1',
        verificationStatus: 'Verified',
        verificationSummary: 'Verified',
        description: 'Role',
      });

      // Exact country & region member matches -> tier 3
      assert.equal(matchJobGeographyScore(mkJob('France', 'Paris'), ['Europe']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Canada', 'Montreal'), ['Amérique du Nord']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Brazil', 'Sao Paulo'), ['Amérique latine']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Haiti', 'Port-au-Prince'), ['Caraïbes']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Haiti', 'Port-au-Prince'), ['Haïti']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Senegal', 'Dakar'), ['Afrique']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Japan', 'Tokyo'), ['Asie']), 3);
      assert.equal(matchJobGeographyScore(mkJob('Australia', 'Sydney'), ['Océanie']), 3);

      // Haiti belongs strictly to Caribbean / Americas, NEVER Africa or Europe
      assert.equal(matchJobGeographyScore(mkJob('Haiti', 'Port-au-Prince'), ['Afrique']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Haiti', 'Port-au-Prince'), ['Europe']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Americas', 'Remote', 'Remote'), ['Haïti']), 2);
      assert.equal(matchJobGeographyScore(mkJob('Caribbean', 'Remote', 'Remote'), ['Haïti']), 2);
      assert.equal(matchJobGeographyScore(mkJob('EMEA', 'Remote', 'Remote'), ['Haïti']), 0);
      assert.equal(matchJobGeographyScore(mkJob('EMEA', 'Remote', 'Remote'), ['Caraïbes']), 0);

      // Anti-leakage: UK / Ireland / Spain / US-only / South Africa / European-restricted EMEA MUST NEVER leak
      assert.equal(matchJobGeographyScore(mkJob('UK', 'UK', 'Remote', 'Account Executive EMEA'), ['Sénégal']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Ireland, Spain, UK', 'Remote', 'Remote'), ['Sénégal']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Europe, EMEA, Germany, European timezones', 'Remote', 'Remote'), ['Sénégal']), 0);
      assert.equal(matchJobGeographyScore(mkJob('South Africa', 'Cape Town', 'Remote'), ['Sénégal']), 0);
      assert.equal(matchJobGeographyScore(mkJob('South Africa', 'Cape Town', 'Remote'), ['Afrique']), 3);
      assert.equal(matchJobGeographyScore(mkJob('UK', 'London', 'Remote'), ['Haïti']), 0);
      assert.equal(matchJobGeographyScore(mkJob('USA Remote', 'Remote', 'Remote'), ['Haïti']), 0);
      assert.equal(matchJobGeographyScore(mkJob('USA Remote', 'Remote', 'Remote'), ['France']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Germany', 'Berlin', 'On-site'), ['Océanie']), 0);
      assert.equal(matchJobGeographyScore(mkJob('Brazil', 'Sao Paulo', 'On-site'), ['Afrique']), 0);
      // Regional EMEA remote matches Europe & Africa (tier 2)
      assert.equal(matchJobGeographyScore(mkJob('EMEA', 'Remote', 'Remote'), ['Europe']), 2);
      assert.equal(matchJobGeographyScore(mkJob('EMEA', 'Remote', 'Remote'), ['Afrique']), 2);

      // Unrestricted Worldwide remote matches everywhere as tier 1 (strictly below tier 3 & tier 2)
      assert.equal(matchJobGeographyScore(mkJob('Worldwide', 'Remote', 'Remote'), ['Caraïbes']), 1);
      assert.equal(matchJobGeographyScore(mkJob('Anywhere', 'Remote', 'Remote'), ['Haïti']), 1);

      // Query live HTTP /api/jobs/feeds across diverse regions & countries and verify zero cross-country leakage
      for (const region of ['Europe', 'Amérique du Nord', 'Amérique latine', 'Caraïbes', 'Afrique', 'Asie', 'Océanie']) {
        const res = await fetch('http://127.0.0.1:3000/api/jobs/feeds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '', country: region }),
        });
        assert.equal(res.status, 200, `Expected 200 for international feed region=${region}`);
        const payload = (await res.json()) as {
          jobs?: Array<{ sourceUrl?: string; country?: string; city?: string }>;
          activeProviders?: string[];
        };
        assert.ok(Array.isArray(payload.jobs) && payload.jobs.length > 0, `Expected real jobs for region=${region}`);
        assert.ok(
          payload.jobs.every((j) => Boolean(j.sourceUrl && j.sourceUrl.startsWith('http'))),
          `All jobs returned for ${region} must have valid official URLs`
        );
      }

      // Live leakage regression check: every returned job must genuinely match the searched country, its region, or Worldwide remote
      for (const { countryQuery, expectedRe } of [
        { countryQuery: 'Haïti', expectedRe: /\b(haiti|ayiti|caribbean|caraibes|americas|latam|worldwide|anywhere|global)\b/i },
        { countryQuery: 'Sénégal', expectedRe: /\b(senegal|dakar|africa|afrique|emea|worldwide|anywhere|global)\b/i },
        { countryQuery: 'Brésil', expectedRe: /\b(brazil|bresil|brasil|latam|latin america|americas|worldwide|anywhere|global)\b/i },
        { countryQuery: 'Japon', expectedRe: /\b(japan|japon|tokyo|asia|apac|worldwide|anywhere|global)\b/i },
      ]) {
        const res = await fetch('http://127.0.0.1:3000/api/jobs/feeds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '', country: countryQuery }),
        });
        assert.equal(res.status, 200);
        const payload = (await res.json()) as { jobs?: Array<{ country?: string; city?: string }> };
        assert.ok(Array.isArray(payload.jobs) && payload.jobs.length > 0, `Expected results for ${countryQuery}`);
        for (const job of payload.jobs) {
          const loc = `${job.country || ''} ${job.city || ''}`;
          assert.ok(
            expectedRe.test(loc),
            `Geography leak detected for ${countryQuery}: returned "${job.country} / ${job.city}"`
          );
        }
      }
    });

    // 24. Email/Password Registration + Mandatory 5-Digit Verification Code + Strict API Gate
    let testAuthUserId = '';
    await check('Email/Password auth hashes credentials with scrypt, enforces 5-digit confirmation code, and blocks unverified accounts on protected APIs', async () => {
      // 24a. Confirm live dev server mounts /api/auth/* routes
      const liveMe = await fetch('http://127.0.0.1:3000/api/auth/me');
      assert.equal(liveMe.status, 401);
      const liveBadLogin = await fetch('http://127.0.0.1:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@jobfounds-test.invalid', password: 'WrongPassword123' }),
      });
      assert.equal(liveBadLogin.status, 401);
      const liveShortPwd = await fetch('http://127.0.0.1:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: 'Test User', email: 'short@jobfounds-test.invalid', password: '123' }),
      });
      assert.equal(liveShortPwd.status, 400);

      // 24b. Verify 5-digit code format (strictly 5 digits 10000-99999)
      for (let i = 0; i < 20; i += 1) {
        const sample = generateFiveDigitCode();
        assert.match(sample, /^\d{5}$/, `Generated code must be strictly 5 digits: ${sample}`);
      }

      // 24c. Spin up an isolated Express app mounting the exact auth router + security middleware on port 0
      registerAppTokenVerifier(verifyAppSessionToken);
      const authApp = express();
      authApp.use(express.json());
      authApp.use('/api', attachFirebaseAuth);
      authApp.use('/api', createAuthRouter());
      authApp.get('/api/protected-workspace', requireFirebaseAuth, (req: any, res) => {
        res.json({ ok: true, uid: req.authUser.uid, emailVerified: req.authUser.emailVerified });
      });

      const srv = await new Promise<http.Server>((resolve) => {
        const s = authApp.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        const testEmail = `verify-test-${Date.now()}@jobfounds-test.invalid`;
        const testPassword = 'StrongPassword#2026';

        // Create account via scrypt & verify password hash is never plaintext
        const { passwordHash, passwordSalt } = createPasswordCredentials(testPassword);
        assert.notEqual(passwordHash, testPassword);
        assert.ok(passwordHash.length >= 64 && passwordSalt.length >= 16);

        const user = createAuthUserRecord({
          email: testEmail,
          fullName: 'Jean-Baptiste Test',
          passwordHash,
          passwordSalt,
        });
        testAuthUserId = user.uid;
        assert.equal(user.emailVerified, false, 'New account MUST start unverified');
        assert.equal(verifyPasswordCredentials(testPassword, user), true);
        assert.equal(verifyPasswordCredentials('WrongPassword123', user), false);

        // Issue hashed 5-digit code (verify stored hash is NOT plaintext code)
        const issued = await issueAndSendFiveDigitCode(user, { skipEmailForTest: true });
        assert.match(issued.codeForTest || '', /^\d{5}$/);
        const activeCodeRow = getLatestActiveVerificationCode(user.uid);
        assert.ok(activeCodeRow, 'Active verification code row must exist');
        assert.notEqual(activeCodeRow!.codeHash, issued.codeForTest, '5-digit code must be hashed at rest');

        // Wrong password -> 401
        const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail, password: 'WrongPassword123' }),
        });
        assert.equal(badLoginRes.status, 401);

        // Right password on unverified account -> verificationRequired=true + unverified token
        const unverifiedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail, password: testPassword }),
        });
        assert.equal(unverifiedLoginRes.status, 200);
        const unverifiedLoginBody = (await unverifiedLoginRes.json()) as {
          verificationRequired?: boolean;
          token?: string;
          user?: { emailVerified?: boolean };
        };
        assert.equal(unverifiedLoginBody.verificationRequired, true);
        assert.equal(unverifiedLoginBody.user?.emailVerified, false);
        assert.ok(unverifiedLoginBody.token);

        // Unverified Bearer token MUST be rejected (403 EMAIL_NOT_VERIFIED) on protected workspace APIs
        const blockedRes = await fetch(`${baseUrl}/api/protected-workspace`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${unverifiedLoginBody.token}` },
        });
        assert.equal(blockedRes.status, 403, 'Unverified account token MUST receive 403');
        const blockedBody = (await blockedRes.json()) as { code?: string };
        assert.equal(blockedBody.code, 'EMAIL_NOT_VERIFIED');

        // Malformed code (4 digits) -> 400
        const malformedRes = await fetch(`${baseUrl}/api/auth/verify-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${unverifiedLoginBody.token}`,
          },
          body: JSON.stringify({ email: testEmail, code: '1234' }),
        });
        assert.equal(malformedRes.status, 400);

        // Wrong 5-digit code -> 400 & decrements remainingAttempts to 4
        const wrongCode = issued.codeForTest === '12345' ? '54321' : '12345';
        const wrongCodeRes = await fetch(`${baseUrl}/api/auth/verify-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${unverifiedLoginBody.token}`,
          },
          body: JSON.stringify({ email: testEmail, code: wrongCode }),
        });
        assert.equal(wrongCodeRes.status, 400);
        const wrongCodeBody = (await wrongCodeRes.json()) as { remainingAttempts?: number };
        assert.equal(wrongCodeBody.remainingAttempts, 4);
        assert.equal(getAuthUserByEmail(testEmail)?.emailVerified, false);

        // Valid 5-digit code -> 200 verified=true + unlocks protected workspace APIs
        const okVerifyRes = await fetch(`${baseUrl}/api/auth/verify-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${unverifiedLoginBody.token}`,
          },
          body: JSON.stringify({ email: testEmail, code: issued.codeForTest }),
        });
        assert.equal(okVerifyRes.status, 200);
        const okVerifyBody = (await okVerifyRes.json()) as {
          verified?: boolean;
          token?: string;
          user?: { emailVerified?: boolean };
        };
        assert.equal(okVerifyBody.verified, true);
        assert.equal(okVerifyBody.user?.emailVerified, true);
        assert.ok(okVerifyBody.token);

        const unlockedRes = await fetch(`${baseUrl}/api/protected-workspace`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${okVerifyBody.token}` },
        });
        assert.equal(unlockedRes.status, 200, 'Verified account token must succeed on protected APIs');

        // 5 wrong guesses lock the 5-digit code & prevent subsequent use even with the real code
        const lockUser = createAuthUserRecord({
          email: `lock-test-${Date.now()}@jobfounds-test.invalid`,
          fullName: 'Lock Test',
          passwordHash,
          passwordSalt,
        });
        try {
          const lockIssued = await issueAndSendFiveDigitCode(lockUser, { skipEmailForTest: true });
          const badGuess = lockIssued.codeForTest === '99999' ? '11111' : '99999';
          let lastResult: any = null;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            lastResult = verifyFiveDigitCodeForUser(lockUser, badGuess);
            assert.equal(lastResult.ok, false);
          }
          assert.equal(lastResult.code, 'CODE_LOCKED');
          const afterLock = verifyFiveDigitCodeForUser(lockUser, lockIssued.codeForTest!);
          assert.equal(afterLock.ok, false);
          assert.equal(afterLock.code, 'NO_ACTIVE_CODE');
        } finally {
          deleteAuthUserByUid(lockUser.uid);
        }

        // Token verification sanity check
        const verifiedTokenDirect = issueAppSessionToken(getAuthUserByEmail(testEmail)!);
        const verifiedClaims = verifyAppSessionToken(verifiedTokenDirect);
        assert.equal(verifiedClaims?.emailVerified, true);
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        if (testAuthUserId) {
          deleteAuthUserByUid(testAuthUserId);
          testAuthUserId = '';
        }
      }
    });

    // 25. Persistent HttpOnly Cookie, SQLite Workspace Persistence & Purpose-Scoped 5-Digit Password Reset
    await check('HttpOnly session cookie, CSRF origin guard, SQLite workspace CRUD/isolation & 5-digit password reset', async () => {
      // 25a. Probe live port 3000 new endpoints
      const liveBadForgot = await fetch('http://127.0.0.1:3000/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });
      assert.equal(liveBadForgot.status, 400);

      const liveWorkspaceUnauth = await fetch('http://127.0.0.1:3000/api/account/workspace');
      assert.equal(liveWorkspaceUnauth.status, 401);

      const liveLogout = await fetch('http://127.0.0.1:3000/api/auth/logout', { method: 'POST' });
      assert.equal(liveLogout.status, 200);
      const liveLogoutCookie = liveLogout.headers.get('set-cookie') || '';
      assert.ok(liveLogoutCookie.includes('jf_session='), 'Logout must clear jf_session cookie');
      assert.ok(liveLogoutCookie.includes('Max-Age=0'), 'Logout cookie must expire immediately');

      // 25b. Isolated Express server with full auth + workspace + CSRF cookie protection
      registerAppTokenVerifier(verifyAppSessionToken);
      const app25 = express();
      app25.use(express.json());
      app25.use('/api', attachFirebaseAuth);
      app25.use('/api', createAuthRouter());

      const srv = await new Promise<http.Server>((resolve) => {
        const s = app25.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const createdUids: string[] = [];
      try {
        const email1 = `persist-u1-${Date.now()}@jobfounds-test.invalid`;
        const email2 = `persist-u2-${Date.now()}@jobfounds-test.invalid`;
        const initialPwd = 'InitialPass#2026';
        const resetPwd = 'UpdatedPass#2027';

        const cred1 = createPasswordCredentials(initialPwd);
        const u1 = createAuthUserRecord({
          email: email1,
          fullName: 'Claire Moreau',
          passwordHash: cred1.passwordHash,
          passwordSalt: cred1.passwordSalt,
        });
        createdUids.push(u1.uid);

        const cred2 = createPasswordCredentials(initialPwd);
        const u2 = createAuthUserRecord({
          email: email2,
          fullName: 'Marc Laurent',
          passwordHash: cred2.passwordHash,
          passwordSalt: cred2.passwordSalt,
        });
        createdUids.push(u2.uid);

        // Issue verify_email code for u1 and confirm purpose isolation against reset-password
        const verifyIssued = await issueAndSendFiveDigitCode(u1, {
          purpose: 'verify_email',
          skipEmailForTest: true,
        });
        const wrongPurposeReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email1,
            code: verifyIssued.codeForTest,
            newPassword: resetPwd,
          }),
        });
        assert.equal(
          wrongPurposeReset.status,
          400,
          'verify_email code must NEVER be accepted by reset-password'
        );

        // Unverified account MUST be blocked (403) from /api/account/workspace
        const unverifiedToken = issueAppSessionToken(u1);
        const unverifiedWs = await fetch(`${baseUrl}/api/account/workspace`, {
          headers: { Authorization: `Bearer ${unverifiedToken}` },
        });
        assert.equal(unverifiedWs.status, 403);

        // Verify u1 email -> receive HttpOnly jf_session cookie
        const verifyRes = await fetch(`${baseUrl}/api/auth/verify-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email1, code: verifyIssued.codeForTest }),
        });
        assert.equal(verifyRes.status, 200);
        const setCookieHeader = verifyRes.headers.get('set-cookie') || '';
        assert.ok(setCookieHeader.includes('jf_session='), 'Verify response must set jf_session cookie');
        assert.ok(/HttpOnly/i.test(setCookieHeader), 'jf_session cookie must be HttpOnly');
        const cookiePair = setCookieHeader.split(';')[0].trim();

        // Cookie-only session restore (no Bearer header!) -> 200 authenticated
        const meWithCookie = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Cookie: cookiePair },
        });
        assert.equal(meWithCookie.status, 200);
        const meBody = (await meWithCookie.json()) as {
          authenticated?: boolean;
          user?: { uid?: string; emailVerified?: boolean };
        };
        assert.equal(meBody.authenticated, true);
        assert.equal(meBody.user?.uid, u1.uid);
        assert.equal(meBody.user?.emailVerified, true);

        // CSRF origin guard: cross-origin cookie mutation MUST be blocked (401)
        const csrfAttempt = await fetch(`${baseUrl}/api/account/workspace`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookiePair,
            Origin: 'https://evil-attacker.invalid',
          },
          body: JSON.stringify({ companyName: 'Pwned Corp' }),
        });
        assert.equal(csrfAttempt.status, 401, 'Cross-origin cookie mutation must be blocked');

        // Same-origin cookie PUT /api/account/workspace -> persists in SQLite
        const saveWsRes = await fetch(`${baseUrl}/api/account/workspace`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookiePair,
            Origin: baseUrl,
          },
          body: JSON.stringify({
            profile: { fullName: 'Claire Moreau', currentTitle: 'Data Engineer', skills: ['Python', 'SQL'] },
            cvs: [{ id: 'cv_1', versionName: 'CV Data' }],
            applications: [{ id: 'app_1', company: 'Stripe', role: 'Data Engineer', stage: 'Applied' }],
            watchlist: [{ id: 'watch_1', label: 'Stripe' }],
            accountRole: 'candidate',
            lang: 'fr',
            discoverable: true,
          }),
        });
        assert.equal(saveWsRes.status, 200);

        // Cookie-only GET /api/account/workspace returns exact persisted workspace
        const getWsRes = await fetch(`${baseUrl}/api/account/workspace`, {
          headers: { Cookie: cookiePair },
        });
        assert.equal(getWsRes.status, 200);
        const getWsBody = (await getWsRes.json()) as {
          workspace?: {
            profile?: { currentTitle?: string };
            cvs?: Array<{ id: string }>;
            applications?: Array<{ company: string }>;
            discoverable?: boolean;
          };
        };
        assert.equal(getWsBody.workspace?.profile?.currentTitle, 'Data Engineer');
        assert.equal(getWsBody.workspace?.cvs?.[0]?.id, 'cv_1');
        assert.equal(getWsBody.workspace?.applications?.[0]?.company, 'Stripe');
        assert.equal(getWsBody.workspace?.discoverable, true);

        // Verify u2 and confirm strict UID isolation (u2 sees null workspace, never u1's data)
        const verifyU2 = await issueAndSendFiveDigitCode(u2, {
          purpose: 'verify_email',
          skipEmailForTest: true,
        });
        const verifyU2Res = await fetch(`${baseUrl}/api/auth/verify-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email2, code: verifyU2.codeForTest }),
        });
        assert.equal(verifyU2Res.status, 200);
        const u2Body = (await verifyU2Res.json()) as { token?: string };
        const u2WsRes = await fetch(`${baseUrl}/api/account/workspace`, {
          headers: { Authorization: `Bearer ${u2Body.token}` },
        });
        assert.equal(u2WsRes.status, 200);
        const u2WsBody = (await u2WsRes.json()) as { workspace: unknown };
        assert.equal(u2WsBody.workspace, null, 'User 2 must never see User 1 workspace');

        // Issue reset_password 5-digit code for u1 -> verify wrong code fails & valid code resets password
        const freshU1 = getAuthUserByEmail(email1)!;
        const resetIssued = await issueAndSendFiveDigitCode(freshU1, {
          purpose: 'reset_password',
          skipEmailForTest: true,
        });
        assert.match(resetIssued.codeForTest || '', /^\d{5}$/);

        const badResetCode = resetIssued.codeForTest === '22222' ? '33333' : '22222';
        const badResetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email1,
            code: badResetCode,
            newPassword: resetPwd,
          }),
        });
        assert.equal(badResetRes.status, 400);

        const okResetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email1,
            code: resetIssued.codeForTest,
            newPassword: resetPwd,
          }),
        });
        assert.equal(okResetRes.status, 200);
        const okResetBody = (await okResetRes.json()) as { reset?: boolean; token?: string };
        assert.equal(okResetBody.reset, true);
        assert.ok(okResetBody.token);
        assert.ok(
          (okResetRes.headers.get('set-cookie') || '').includes('jf_session='),
          'Reset password must refresh HttpOnly session cookie'
        );

        // Old password MUST fail (401); new password MUST succeed (200)
        const oldPwdLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email1, password: initialPwd }),
        });
        assert.equal(oldPwdLogin.status, 401, 'Old password must be rejected after reset');

        const newPwdLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email1, password: resetPwd }),
        });
        assert.equal(newPwdLogin.status, 200, 'New password must succeed after reset');

        // DELETE /api/account/workspace?deleteAccount=true erases both workspace and user cleanly
        const delRes = await fetch(`${baseUrl}/api/account/workspace?deleteAccount=true`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${okResetBody.token}` },
        });
        assert.equal(delRes.status, 200);
        assert.equal(getAuthUserByEmail(email1), null, 'Account must be deleted after GDPR erasure');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        for (const uid of createdUids) {
          deleteAuthUserByUid(uid);
        }
      }
    });

    // 26. Dynamic Admin Promotion, Full User Dossiers & Account/Submission Moderation (Valider / Refuser / Suspendre)
    await check('Admin role promotion, full user dossier visibility (zero credential leak), account moderation & submission approval/rejection', async () => {
      // 26a. Probe live server /api/admin/users requires auth (401)
      const liveAdminUsers = await fetch('http://127.0.0.1:3000/api/admin/users');
      assert.equal(liveAdminUsers.status, 401, 'Live /api/admin/users must reject unauthenticated requests');

      // 26b. Isolated Express app with exact auth + admin router
      registerAppTokenVerifier(verifyAppSessionToken);
      const adminApp = express();
      adminApp.use(express.json());
      adminApp.use('/api', attachFirebaseAuth);
      adminApp.use('/api', createAuthRouter());

      const srv = await new Promise<http.Server>((resolve) => {
        const s = adminApp.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const createdUids: string[] = [];
      const createdAdminEmails: string[] = [];
      const createdSubIds: string[] = [];
      const ts = Date.now();
      const seedAdminEmail = `seed-admin-${ts}@jobfounds-test.invalid`;
      const promotedEmail = `new-admin-${ts}@jobfounds-test.invalid`;
      const memberEmail = `member-${ts}@jobfounds-test.invalid`;
      const testPwd = 'AdminTestPass#2026';

      try {
        const creds = createPasswordCredentials(testPwd);
        const seedAdmin = markAuthUserEmailVerified(
          createAuthUserRecord({
            email: seedAdminEmail,
            fullName: 'Seed Admin',
            passwordHash: creds.passwordHash,
            passwordSalt: creds.passwordSalt,
          }).uid
        )!;
        createdUids.push(seedAdmin.uid);
        grantAdminRoleByEmail(seedAdminEmail, BOOTSTRAP_ADMIN_EMAIL, 'Test seed admin');
        createdAdminEmails.push(seedAdminEmail);

        const newAdminUser = markAuthUserEmailVerified(
          createAuthUserRecord({
            email: promotedEmail,
            fullName: 'Nouveau Compte Admin',
            passwordHash: creds.passwordHash,
            passwordSalt: creds.passwordSalt,
          }).uid
        )!;
        createdUids.push(newAdminUser.uid);

        // Regular unverified member with workspace profile & CVs
        const memberUser = createAuthUserRecord({
          email: memberEmail,
          fullName: 'Membre Standard',
          passwordHash: creds.passwordHash,
          passwordSalt: creds.passwordSalt,
        });
        createdUids.push(memberUser.uid);
        upsertUserWorkspaceData(memberUser.uid, {
          profile: {
            fullName: 'Membre Standard',
            currentTitle: 'Data Analyst',
            originCountry: 'Haïti',
            preferredCountries: ['Canada', 'France'],
            skills: ['SQL', 'Python'],
            languages: ['Français', 'Anglais'],
          },
          cvs: [
            {
              id: 'cv_1',
              versionName: 'CV Data',
              fullName: 'Membre Standard',
              headline: 'Data Analyst',
              skills: ['SQL', 'Python'],
              updatedAt: '2026-11-28',
            },
          ],
          applications: [
            {
              id: 'crm_1',
              company: 'Acme Global',
              role: 'Data Analyst',
              stage: 'Application Prepared',
              type: 'Confirmed Job',
              dateAdded: '2026-11-28',
            },
          ],
        });

        const seedToken = issueAppSessionToken(seedAdmin);
        const promotedToken = issueAppSessionToken(newAdminUser);

        // Before promotion, newAdminUser MUST receive 403 on /api/admin/users
        const deniedRes = await fetch(`${baseUrl}/api/admin/users`, {
          headers: { Authorization: `Bearer ${promotedToken}` },
        });
        assert.equal(deniedRes.status, 403, 'Non-admin user must receive 403 on /api/admin/users');

        // Seed admin promotes newAdminUser via POST /api/admin/admins/grant
        const grantRes = await fetch(`${baseUrl}/api/admin/admins/grant`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${seedToken}`,
          },
          body: JSON.stringify({ email: promotedEmail, note: 'Co-administrateur' }),
        });
        assert.equal(grantRes.status, 201);
        createdAdminEmails.push(promotedEmail);

        // Promoted account now sees isAdmin=true on /api/auth/me
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${promotedToken}` },
        });
        assert.equal(meRes.status, 200);
        const meBody = (await meRes.json()) as { user?: { isAdmin?: boolean } };
        assert.equal(meBody.user?.isAdmin, true, 'Promoted account must immediately have isAdmin=true');

        // Promoted admin can list all users & view complete dossier without leaking passwordHash/passwordSalt
        const listRes = await fetch(`${baseUrl}/api/admin/users`, {
          headers: { Authorization: `Bearer ${promotedToken}` },
        });
        assert.equal(listRes.status, 200);
        const listText = await listRes.text();
        assert.ok(!listText.includes('passwordHash') && !listText.includes('passwordSalt'), 'Password secrets must NEVER leak');
        const listBody = JSON.parse(listText) as { users: Array<{ uid: string; email: string }> };
        assert.ok(listBody.users.some((u) => u.uid === memberUser.uid), 'Member must appear in admin user directory');

        const dossierRes = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(memberUser.uid)}`, {
          headers: { Authorization: `Bearer ${promotedToken}` },
        });
        assert.equal(dossierRes.status, 200);
        const dossierBody = (await dossierRes.json()) as {
          dossier: {
            summary: { originCountry: string; cvsCount: number };
            cvs: Array<{ versionName: string }>;
            trackedApplications: Array<{ company: string }>;
          };
        };
        assert.equal(dossierBody.dossier.summary.originCountry, 'Haïti');
        assert.equal(dossierBody.dossier.cvs.length, 1);
        assert.equal(dossierBody.dossier.trackedApplications[0]?.company, 'Acme Global');

        // Promoted admin approves & verifies memberUser
        const approveRes = await fetch(
          `${baseUrl}/api/admin/users/${encodeURIComponent(memberUser.uid)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${promotedToken}`,
            },
            body: JSON.stringify({
              moderationStatus: 'approved',
              emailVerified: true,
              accountRole: 'recruiter',
              moderationNote: 'Dossier vérifié',
            }),
          }
        );
        assert.equal(approveRes.status, 200);
        const approvedMember = getAuthUserByEmail(memberEmail)!;
        assert.equal(approvedMember.emailVerified, true);
        assert.equal(approvedMember.accountRole, 'recruiter');
        assert.equal(approvedMember.moderationStatus, 'approved');

        // Member can log in while approved
        const okLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: memberEmail, password: testPwd }),
        });
        assert.equal(okLoginRes.status, 200);
        const okLoginBody = (await okLoginRes.json()) as { token: string };

        // Admin suspends/rejects member -> existing session immediately invalid (401) & login blocked (403 ACCOUNT_MODERATED)
        const rejectRes = await fetch(
          `${baseUrl}/api/admin/users/${encodeURIComponent(memberUser.uid)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${promotedToken}`,
            },
            body: JSON.stringify({
              moderationStatus: 'rejected',
              moderationNote: 'Documents non conformes',
            }),
          }
        );
        assert.equal(rejectRes.status, 200);

        const blockedTokenMe = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${okLoginBody.token}` },
        });
        assert.equal(blockedTokenMe.status, 401, 'Rejected/suspended user session token must immediately stop working');

        const blockedLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: memberEmail, password: testPwd }),
        });
        assert.equal(blockedLogin.status, 403, 'Rejected/suspended user must receive 403 on login');
        const blockedLoginBody = (await blockedLogin.json()) as { code?: string };
        assert.equal(blockedLoginBody.code, 'ACCOUNT_MODERATED');

        // Admin moderates a submitted application (approve -> reject)
        const subResult = await submitRealApplication({
          userId: memberUser.uid,
          candidateEmail: memberEmail,
          candidateName: 'Membre Standard',
          companyName: 'Global Corp',
          roleTitle: 'BI Analyst',
          opportunityType: 'published_job',
          channel: 'jobfounds_direct',
          recruiterId: seedAdmin.uid,
          subject: 'Candidature BI Analyst',
          coverLetter: 'Lettre de motivation réelle pour test admin.',
          explicitAuthorization: true,
        });
        createdSubIds.push(subResult.submission.id);

        const modSubApprove = await fetch(
          `${baseUrl}/api/admin/applications/${encodeURIComponent(subResult.submission.id)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${promotedToken}`,
            },
            body: JSON.stringify({ status: 'approved', note: 'Candidature validée' }),
          }
        );
        assert.equal(modSubApprove.status, 200);
        const modSubBody = (await modSubApprove.json()) as {
          submission: { adminModerationStatus: string };
        };
        assert.equal(modSubBody.submission.adminModerationStatus, 'approved');

        const modSubReject = await fetch(
          `${baseUrl}/api/admin/applications/${encodeURIComponent(subResult.submission.id)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${promotedToken}`,
            },
            body: JSON.stringify({ status: 'rejected', note: 'Incomplète' }),
          }
        );
        assert.equal(modSubReject.status, 200);
        const modSubRejectBody = (await modSubReject.json()) as {
          submission: { adminModerationStatus: string };
        };
        assert.equal(modSubRejectBody.submission.adminModerationStatus, 'rejected');

        // Bootstrap owner cannot be revoked (400)
        const revokeOwnerRes = await fetch(`${baseUrl}/api/admin/admins/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${promotedToken}`,
          },
          body: JSON.stringify({ email: BOOTSTRAP_ADMIN_EMAIL }),
        });
        assert.equal(revokeOwnerRes.status, 400, 'Bootstrap owner admin cannot be revoked');

        // Seed admin revokes promotedEmail -> promotedEmail loses admin access immediately (403)
        const revokePromotedRes = await fetch(`${baseUrl}/api/admin/admins/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${seedToken}`,
          },
          body: JSON.stringify({ email: promotedEmail }),
        });
        assert.equal(revokePromotedRes.status, 200);

        const afterRevokeRes = await fetch(`${baseUrl}/api/admin/users`, {
          headers: { Authorization: `Bearer ${promotedToken}` },
        });
        assert.equal(afterRevokeRes.status, 403, 'Revoked admin must immediately receive 403');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        const db = getEngineDb();
        for (const sid of createdSubIds) {
          db.prepare('DELETE FROM application_submissions WHERE id = ?').run(sid);
        }
        for (const email of createdAdminEmails) {
          revokeAdminRoleByEmail(email);
          db.prepare('DELETE FROM audit_logs WHERE actor_email = ? OR target_id = ?').run(
            email,
            email
          );
        }
        for (const uid of createdUids) {
          db.prepare('DELETE FROM notifications WHERE uid = ?').run(uid);
          db.prepare('DELETE FROM audit_logs WHERE actor_uid = ? OR target_id = ?').run(uid, uid);
          deleteAuthUserByUid(uid);
        }
      }
    });

    // 27. Unified Google/Firebase User Visibility for Email/Password Admins + Hard Server Lockout on Suspension
    await check('Google/Firebase users mirror to SQLite directory for Email/Password admins and are hard-blocked (403) when suspended/rejected', async () => {
      registerAppTokenVerifier(verifyAppSessionToken);
      registerUserModerationChecker(getAccountModerationStatus);

      const stamp = Date.now();
      const adminEmail = `pwd-admin-${stamp}@jobfounds-test.invalid`;
      const googleEmail = `google-member-${stamp}@jobfounds-test.invalid`;
      const googleUid = `firebase_google_uid_${stamp}`;
      const testPwd = 'AdminSecret#2026!';

      const { passwordHash, passwordSalt } = createPasswordCredentials(testPwd);
      const adminUser = createAuthUserRecord({
        email: adminEmail,
        fullName: 'Password Admin',
        passwordHash,
        passwordSalt,
      });
      markAuthUserEmailVerified(adminUser.uid);
      grantAdminRoleByEmail(adminEmail, BOOTSTRAP_ADMIN_EMAIL, 'Test 27 Password Admin');
      const adminToken = issueAppSessionToken({ ...adminUser, emailVerified: true });

      const app = express();
      app.use(express.json());
      // Test hook simulating verified Firebase Google ID token alongside real attachFirebaseAuth
      app.use('/api', (req: any, _res, next) => {
        if (req.headers['x-test-google-user'] === '1') {
          req.authUser = {
            uid: googleUid,
            email: googleEmail,
            name: 'Marie Google',
            emailVerified: true,
            provider: 'firebase',
            isAdmin: false,
          };
          return next();
        }
        return attachFirebaseAuth(req, _res, next);
      });
      app.use('/api', createAuthRouter());
      app.get('/api/protected-workspace', requireFirebaseAuth, (req: any, res) => {
        res.json({ ok: true, uid: req.authUser.uid, provider: req.authUser.provider });
      });

      const srv = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        // 1. Google user syncs directory & workspace (and cannot self-escalate moderationStatus/isAdmin)
        const syncRes = await fetch(`${baseUrl}/api/account/sync-directory`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-test-google-user': '1',
          },
          body: JSON.stringify({
            fullName: 'Marie Google',
            accountRole: 'candidate',
            lang: 'fr',
            discoverable: true,
            gdprConsent: true,
            profile: {
              fullName: 'Marie Google',
              currentTitle: 'Product Designer',
              originCountry: 'Haïti',
              preferredCountries: ['Canada', 'France'],
              skills: ['Figma', 'UX Research'],
              languages: ['Français', 'Anglais', 'Créole haïtien'],
            },
            cvs: [
              {
                id: `cv_google_${stamp}`,
                versionName: 'CV UX Global',
                fullName: 'Marie Google',
                headline: 'Product Designer',
                location: 'Port-au-Prince',
                skills: ['Figma'],
                updatedDate: '2026-11-28',
              },
            ],
            applications: [
              {
                id: `app_google_${stamp}`,
                company: 'Shopify',
                role: 'Staff Product Designer',
                stage: 'Applied',
                type: 'published_job',
                dateAdded: '2026-11-28',
              },
            ],
            isAdmin: true,
            moderationStatus: 'approved',
          }),
        });
        assert.equal(syncRes.status, 200, 'Google user directory sync must succeed');

        // 2. Email/Password Admin sees the Google user in /api/admin/users AND full dossier in /api/admin/users/:uid
        const listRes = await fetch(`${baseUrl}/api/admin/users`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(listRes.status, 200);
        const listBody = (await listRes.json()) as {
          users: Array<{ uid: string; email: string; provider: string; cvsCount: number; trackedAppsCount: number }>;
        };
        const foundGoogle = listBody.users.find((u) => u.email === googleEmail);
        assert.ok(foundGoogle, 'Email/Password admin MUST see Google/Firebase users in unified directory');
        assert.equal(foundGoogle!.provider, 'firebase');
        assert.equal(foundGoogle!.cvsCount, 1);
        assert.equal(foundGoogle!.trackedAppsCount, 1);

        const dossierRes = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(googleUid)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        assert.equal(dossierRes.status, 200);
        const dossierBody = (await dossierRes.json()) as {
          dossier: {
            summary: { provider: string; originCountry: string };
            cvs: Array<{ versionName: string }>;
            trackedApplications: Array<{ company: string }>;
          };
        };
        assert.equal(dossierBody.dossier.summary.provider, 'firebase');
        assert.equal(dossierBody.dossier.summary.originCountry, 'Haïti');
        assert.equal(dossierBody.dossier.cvs[0]?.versionName, 'CV UX Global');
        assert.equal(dossierBody.dossier.trackedApplications[0]?.company, 'Shopify');

        // 3. Before suspension, Google user accesses /api/auth/me and /api/protected-workspace -> 200
        const okMeRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { 'x-test-google-user': '1' },
        });
        assert.equal(okMeRes.status, 200);
        const okProtRes = await fetch(`${baseUrl}/api/protected-workspace`, {
          headers: { 'x-test-google-user': '1' },
        });
        assert.equal(okProtRes.status, 200);

        // 4. Admin suspends Google user -> BOTH /api/auth/me and protected APIs immediately return 403 ACCOUNT_MODERATED
        const suspendRes = await fetch(
          `${baseUrl}/api/admin/users/${encodeURIComponent(googleUid)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
              email: googleEmail,
              moderationStatus: 'suspended',
              moderationNote: 'Activité suspecte vérifiée',
            }),
          }
        );
        assert.equal(suspendRes.status, 200);

        const blockedMeRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { 'x-test-google-user': '1' },
        });
        assert.equal(blockedMeRes.status, 403, 'Suspended Google user must get 403 on /api/auth/me');
        const blockedMeBody = (await blockedMeRes.json()) as {
          code?: string;
          moderationStatus?: string;
          moderationNote?: string;
        };
        assert.equal(blockedMeBody.code, 'ACCOUNT_MODERATED');
        assert.equal(blockedMeBody.moderationStatus, 'suspended');
        assert.equal(blockedMeBody.moderationNote, 'Activité suspecte vérifiée');

        const blockedProtRes = await fetch(`${baseUrl}/api/protected-workspace`, {
          headers: { 'x-test-google-user': '1' },
        });
        assert.equal(
          blockedProtRes.status,
          403,
          'Suspended Google user must get 403 on all requireFirebaseAuth endpoints'
        );
        const blockedProtBody = (await blockedProtRes.json()) as { code?: string };
        assert.equal(blockedProtBody.code, 'ACCOUNT_MODERATED');

        // 5. Admin re-approves Google user -> access immediately restored (200)
        const restoreRes = await fetch(
          `${baseUrl}/api/admin/users/${encodeURIComponent(googleUid)}/moderate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
              email: googleEmail,
              moderationStatus: 'approved',
              moderationNote: 'Réactivé après vérification',
            }),
          }
        );
        assert.equal(restoreRes.status, 200);

        const restoredProtRes = await fetch(`${baseUrl}/api/protected-workspace`, {
          headers: { 'x-test-google-user': '1' },
        });
        assert.equal(restoredProtRes.status, 200, 'Re-approved Google user must regain 200 access');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        const db = getEngineDb();
        db.prepare('DELETE FROM account_directory WHERE email = ? OR uid = ?').run(googleEmail, googleUid);
        db.prepare('DELETE FROM user_workspace_data WHERE uid = ?').run(googleUid);
        db.prepare('DELETE FROM audit_logs WHERE actor_email = ? OR target_id = ? OR target_id = ?').run(
          adminEmail,
          googleUid,
          googleEmail
        );
        revokeAdminRoleByEmail(adminEmail);
        deleteAuthUserByUid(adminUser.uid);
      }
    });

    // 28. Zero Fictitious Data, 9-Criteria Canonical Parity & Candidate Metadata Persistence
    await check('Zero fictitious seed data, 9-criteria canonical parity, and submission candidate identity persistence', async () => {
      const initMod = await import('../src/data/initialData.ts');
      assert.equal(initMod.initialJobs.length, 0, 'initialJobs must be empty');
      assert.equal(initMod.initialHiddenOpportunities.length, 0, 'initialHiddenOpportunities must be empty');
      assert.equal(initMod.initialApplications.length, 0, 'initialApplications must be empty');
      assert.equal(initMod.initialWatchlist.length, 0, 'initialWatchlist must be empty');
      assert.equal(initMod.initialCvDocuments.length, 0, 'initialCvDocuments must be empty');
      assert.equal(initMod.initialCandidateProfile.fullName, '', 'initialCandidateProfile.fullName must be empty');

      const baseline = initMod.computeBaselineMatch(
        {
          ...initMod.initialCandidateProfile,
          fullName: 'Real Candidate',
          currentTitle: 'Backend Engineer',
          yearsExperience: 5,
          highestDegree: 'Master',
          skills: ['TypeScript', 'Node.js'],
          languages: ['French', 'English'],
          preferredCountries: ['Canada'],
          preferredCities: ['Montreal'],
          workAuthorization: 'Work permit',
          availability: 'Immediate',
          minSalaryAnnualUsd: 80000,
        },
        {
          id: 'verify_parity_job',
          title: 'Backend Engineer',
          company: 'Verified Corp',
          country: 'Canada',
          city: 'Montreal',
          workMode: 'Hybrid',
          contractType: 'Full-time',
          experienceLevel: 'Mid-level',
          degreeRequired: 'Bachelor',
          salaryRange: '90,000 - 110,000 USD',
          salaryMinAnnualUsd: 90000,
          languages: ['English', 'French'],
          skills: ['TypeScript', 'Node.js'],
          publishedDate: new Date().toISOString().slice(0, 10),
          sourceName: 'Official ATS',
          sourceUrl: 'https://jobs.ashbyhq.com/linear',
          verificationStatus: 'Verified',
          verificationSummary: 'Verified ATS feed',
          description: 'Backend TypeScript role in Montreal.',
        }
      );
      const canonicalKeys = [
        'skills',
        'experience',
        'education',
        'languages',
        'locationAndMobility',
        'workAuthorization',
        'availability',
        'salary',
        'sourceReliability',
      ] as const;
      assert.deepEqual(Object.keys(baseline.breakdown).sort(), [...canonicalKeys].sort());

      const portalSub = await submitRealApplication({
        userId: testUid,
        candidateEmail: 'candidate-real@example.com',
        candidateName: 'Candidate RealName',
        companyId: primaryCompanyId,
        companyName: 'Linear TestCorp',
        roleTitle: 'Senior Backend Engineer',
        opportunityType: 'published_job',
        channel: 'official_portal',
        officialUrl: 'https://jobs.ashbyhq.com/linear',
        subject: 'Candidature Senior Backend Engineer',
        coverLetter: 'Bonjour, voici ma candidature officielle vérifiée.',
        explicitAuthorization: true,
      });
      assert.equal(portalSub.transmitted, false, 'official_portal must NEVER mark transmitted=true');
      assert.equal(portalSub.deliveryStatus, 'awaiting_portal_confirmation');
      assert.equal(portalSub.submission.candidateName, 'Candidate RealName');
      assert.equal(portalSub.submission.candidateEmail, 'candidate-real@example.com');
    });

    // 29. Universal Employer Job Publishing (Email/Password + Google) & Owner Scoping
    await check('Email/Password employer can publish, list, and close employer jobs with strict owner enforcement', async () => {
      const empEmail = `emp_pub_${Date.now()}@jobfounds-test.local`;
      const otherEmail = `emp_other_${Date.now()}@jobfounds-test.local`;
      const empCreds = createPasswordCredentials('EmpPass!2026');
      const otherCreds = createPasswordCredentials('OtherPass!2026');
      const empReg = createAuthUserRecord({
        email: empEmail,
        passwordHash: empCreds.passwordHash,
        passwordSalt: empCreds.passwordSalt,
        fullName: 'Marie Employeur',
      });
      const otherReg = createAuthUserRecord({
        email: otherEmail,
        passwordHash: otherCreds.passwordHash,
        passwordSalt: otherCreds.passwordSalt,
        fullName: 'Paul Autre',
      });
      markAuthUserEmailVerified(empReg.uid);
      markAuthUserEmailVerified(otherReg.uid);

      const empToken = issueAppSessionToken({ ...empReg, emailVerified: true });
      const otherToken = issueAppSessionToken({ ...otherReg, emailVerified: true });

      const app = express();
      app.use(express.json());
      app.use('/api', attachFirebaseAuth);
      app.use('/api', createIntelligenceRouter());
      const srv = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      let publishedId = '';
      try {
        // Unauthenticated publish must be blocked (401)
        const unauthRes = await fetch(`${baseUrl}/api/employer/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName: 'Test Employer Co',
            title: 'Full-Stack Developer',
            description: 'Role description with at least ten characters.',
          }),
        });
        assert.equal(unauthRes.status, 401);

        // Email/Password recruiter publishes job (201)
        const pubRes = await fetch(`${baseUrl}/api/employer/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${empToken}`,
          },
          body: JSON.stringify({
            companyName: 'Caraïbes Tech SA',
            companyWebsite: 'https://caraibestech.example.com',
            title: 'Ingénieur Full-Stack Node.js',
            country: 'Haïti',
            city: 'Port-au-Prince',
            workMode: 'Hybrid',
            contractType: 'Full-time',
            salaryRange: '45 000 - 60 000 USD',
            skills: ['TypeScript', 'Node.js', 'React'],
            description: 'Développement de plateformes web et APIs sécurisées pour la région Caraïbes.',
          }),
        });
        assert.equal(pubRes.status, 201);
        const pubData = (await pubRes.json()) as { job: { id: string; recruiterId: string; country: string } };
        assert.ok(pubData.job.id.startsWith('empjob_'));
        assert.equal(pubData.job.recruiterId, empReg.uid);
        assert.equal(pubData.job.country, 'Haïti');
        publishedId = pubData.job.id;

        // Public listing exposes the new employer job
        const listRes = await fetch(`${baseUrl}/api/employer/jobs`);
        assert.equal(listRes.status, 200);
        const listData = (await listRes.json()) as { jobs: Array<{ id: string }> };
        assert.ok(listData.jobs.some((j) => j.id === publishedId));

        // Another user cannot close someone else's job (404)
        const stealRes = await fetch(
          `${baseUrl}/api/employer/jobs/${encodeURIComponent(publishedId)}/close`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${otherToken}`,
            },
            body: JSON.stringify({}),
          }
        );
        assert.equal(stealRes.status, 404);

        // Owner closes job (200) -> removed from open list
        const closeRes = await fetch(
          `${baseUrl}/api/employer/jobs/${encodeURIComponent(publishedId)}/close`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${empToken}`,
            },
            body: JSON.stringify({}),
          }
        );
        assert.equal(closeRes.status, 200);

        const afterRes = await fetch(`${baseUrl}/api/employer/jobs`);
        const afterData = (await afterRes.json()) as { jobs: Array<{ id: string }> };
        assert.ok(!afterData.jobs.some((j) => j.id === publishedId));
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
        const db = getEngineDb();
        if (publishedId) {
          db.prepare('DELETE FROM employer_jobs WHERE id = ?').run(publishedId);
          db.prepare('DELETE FROM audit_logs WHERE target_id = ?').run(publishedId);
        }
        deleteAuthUserByUid(empReg.uid);
        deleteAuthUserByUid(otherReg.uid);
      }
    });

    // Clean recruiter test notifications
    getEngineDb().prepare('DELETE FROM notifications WHERE uid = ?').run(testRecruiterUid);
  } finally {
    // Clean up synthetic test records so production SQLite stays clean
    const db = getEngineDb();
    for (const cid of createdCompanyIds) {
      db.prepare('DELETE FROM companies WHERE id = ?').run(cid);
    }
    db.prepare('DELETE FROM notifications WHERE uid = ?').run(testUid);
    db.prepare('DELETE FROM candidate_subscriptions WHERE uid = ?').run(testUid);
    db.prepare('DELETE FROM crm_email_sync_events WHERE uid = ?').run(testUid);
    db.prepare('DELETE FROM application_submissions WHERE user_id = ?').run(testUid);
    for (const jid of testJobIds) {
      db.prepare('DELETE FROM background_jobs WHERE id = ?').run(jid);
    }
    if (createdAuditAction) {
      db.prepare('DELETE FROM audit_logs WHERE action = ?').run(createdAuditAction);
    }
  }

  console.log(`\nAll ${passed} tests passed successfully.`);
}

runTests().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
