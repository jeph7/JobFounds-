import assert from 'node:assert/strict';
import { clampStr, isSafePublicHttpUrl, sanitizeHttpUrl } from '../serverSecurity.ts';
import { safeExternalUrl } from '../src/utils/safeUrl.ts';
import {
  enqueueBackgroundJob,
  getCompanyById,
  getEngineDb,
  getEngineOverviewMetrics,
  isSourceEnabled,
  listAuditLogs,
  listCompanyCareerChanges,
  listCompanyCareerJobs,
  listCrmEmailSyncEvents,
  listUserNotifications,
  mergeCompanies,
  recordCompanySignal,
  recordCrmEmailSyncEvent,
  setSourceEnabled,
  upsertCandidateSubscription,
  upsertCompany,
  upsertHrContact,
  writeAuditLog,
} from '../serverEngineDb.ts';
import { monitorCompanyCareerPage } from '../serverCareerMonitor.ts';
import {
  classifyRecruiterEmailReply,
  computeCandidateIntelligenceMatches,
  dispatchNotificationsForCandidate,
  getResendConfigStatus,
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
  } finally {
    // Clean up synthetic test records so production SQLite stays clean
    const db = getEngineDb();
    for (const cid of createdCompanyIds) {
      db.prepare('DELETE FROM companies WHERE id = ?').run(cid);
    }
    db.prepare('DELETE FROM notifications WHERE uid = ?').run(testUid);
    db.prepare('DELETE FROM candidate_subscriptions WHERE uid = ?').run(testUid);
    db.prepare('DELETE FROM crm_email_sync_events WHERE uid = ?').run(testUid);
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
