import crypto from 'crypto';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import {
  clampStr,
  extractDomainFromUrl,
  normalizeCanonicalName,
  sanitizeHttpUrl,
} from './serverSecurity.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'smartrecruiters'
  | 'custom_jsonld'
  | 'none';
export type SignalType =
  | 'expansion'
  | 'new_office'
  | 'contract_project'
  | 'new_department'
  | 'frequent_hiring'
  | 'growth_announcement'
  | 'skill_demand'
  | 'career_page_surge';

export type NeedClassification =
  | 'confirmed_job'
  | 'confirmed_hiring_need'
  | 'probable_hiring_signal'
  | 'potential_opportunity';

export type ContactConfidenceLevel = 'confirmed' | 'probable' | 'unverified';
export type AdminReviewStatus = 'pending' | 'verified' | 'rejected';

export type BackgroundJobType =
  | 'monitor_career_page'
  | 'scan_company_signals'
  | 'discover_hr_contacts'
  | 'evaluate_candidate_matches'
  | 'dispatch_notifications';

export interface CompanyRecord {
  id: string;
  canonicalKey: string;
  officialName: string;
  officialWebsite: string;
  domain: string;
  country: string;
  location: string;
  sector: string;
  estimatedSize: string;
  careersUrl: string;
  atsProvider: AtsProvider;
  atsBoardToken: string;
  monitored: boolean;
  monitorIntervalMinutes: number;
  lastMonitoredAt: string | null;
  frequentSkills: string[];
  hiringVelocity: 'High' | 'Moderate' | 'Low' | 'Unknown';
  verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  verifiedAt: string | null;
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  activeJobsCount?: number;
  signalsCount?: number;
  contactsCount?: number;
}

export interface CompanySignalRecord {
  id: string;
  companyId: string;
  companyName?: string;
  companyCountry?: string;
  companySector?: string;
  signalType: SignalType;
  classification: NeedClassification;
  title: string;
  summary: string;
  evidenceQuote: string;
  skillsInferred: string[];
  sourceName: string;
  sourceUrl: string;
  detectedAt: string;
  reliabilityScore: number;
  relevanceScore: number;
  adminStatus: AdminReviewStatus;
  adminNote: string;
}

export interface CareerJobRecord {
  id: string;
  companyId: string;
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
  status: 'active' | 'removed' | 'expired';
  applicationDeadline?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
}

export interface CareerChangeRecord {
  id: string;
  companyId: string;
  careerJobId: string;
  changeType: 'added' | 'modified' | 'removed' | 'expired';
  jobTitle: string;
  details: Record<string, any>;
  detectedAt: string;
}

export interface HrContactRecord {
  id: string;
  companyId: string;
  companyName?: string;
  fullName: string;
  roleTitle: string;
  department: string;
  roleCategory: string;
  publicProfileUrl: string;
  publicChannel: string;
  publicEmail?: string;
  emailDomainVerified: boolean;
  mxVerified: boolean;
  sourceName: string;
  sourceUrl: string;
  verifiedAt: string;
  confidenceLevel: ContactConfidenceLevel;
  confidenceScore: number;
  verificationNote: string;
  adminStatus: AdminReviewStatus;
}

export type ApplicationSubmissionChannel =
  | 'resend_email'
  | 'official_portal'
  | 'jobfounds_direct';

export type ApplicationDeliveryStatus =
  | 'transmitted_email'
  | 'transmitted_jobfounds_portal'
  | 'awaiting_portal_confirmation'
  | 'portal_confirmed_by_user'
  | 'failed';

export type EmployerApplicationStatus =
  | 'received'
  | 'under_review'
  | 'interview_scheduled'
  | 'offer_received'
  | 'rejected'
  | 'message_received';

export interface ApplicationSubmissionRecord {
  id: string;
  userId: string;
  recruiterId: string;
  candidateName: string;
  candidateEmail: string;
  applicationId: string;
  companyId: string;
  companyName: string;
  roleTitle: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  classification: NeedClassification | '';
  channel: ApplicationSubmissionChannel;
  recipientEmail: string;
  recipientName: string;
  officialUrl: string;
  subject: string;
  coverLetterPreview: string;
  coverLetterFull: string;
  cvVersionName: string;
  attachments: Array<{ filename: string; contentType: string; sizeBytes: number }>;
  explicitAuthorization: boolean;
  authorizationTimestamp: string;
  transmitted: boolean;
  deliveryStatus: ApplicationDeliveryStatus;
  providerMessageId: string;
  portalConfirmedAt: string | null;
  portalReference: string;
  employerStatus: EmployerApplicationStatus;
  employerReply: string;
  employerRepliedAt: string | null;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJobRecord {
  id: string;
  jobType: BackgroundJobType;
  dedupKey: string;
  payload: Record<string, any>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, any> | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SourceConfigRecord {
  id: string;
  name: string;
  category: 'ats' | 'job_feed' | 'ai_search' | 'verification' | 'notification';
  enabled: boolean;
  rateLimitPerHour: number;
  callsLastHour: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  status: 'active' | 'degraded' | 'paused';
  updatedAt: string;
}

export interface CandidateSubscriptionRecord {
  uid: string;
  email: string;
  profile: Record<string, any>;
  preferredCountries: string[];
  preferredSectors: string[];
  frequency: 'instant' | 'daily' | 'weekly';
  channels: { inApp: boolean; email: boolean; push: boolean };
  enabled: boolean;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  uid: string;
  type:
    | 'new_job'
    | 'hiring_signal'
    | 'hidden_opportunity'
    | 'new_contact'
    | 'profile_match'
    | 'spontaneous_invite'
    | 'application_update';
  title: string;
  body: string;
  companyId: string;
  companyName: string;
  classification: NeedClassification | '';
  matchScore: number | null;
  evidenceUrl: string;
  channelStatus: {
    inApp: boolean;
    emailSent: boolean;
    emailReason?: string;
    pushReady: boolean;
  };
  read: boolean;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  ipAddress: string;
  createdAt: string;
}

const PROJECT_ROOT = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

export function resolveEngineDataDir(): string {
  const configured = (process.env.JOBFOUNDS_DATA_DIR || '').trim();
  if (configured) {
    const resolved = path.resolve(configured);
    const tmpRoot = path.resolve(os.tmpdir());
    const distRoot = path.resolve(PROJECT_ROOT, 'dist');
    if (
      resolved === tmpRoot ||
      resolved.startsWith(`${tmpRoot}${path.sep}`) ||
      resolved === distRoot ||
      resolved.startsWith(`${distRoot}${path.sep}`)
    ) {
      console.warn(
        `[JOBFOUNDS DB] Ignoring unsafe JOBFOUNDS_DATA_DIR inside temp/build directory (${resolved}); falling back to ${DEFAULT_DATA_DIR}.`
      );
      return DEFAULT_DATA_DIR;
    }
    return resolved;
  }
  return DEFAULT_DATA_DIR;
}

export function getEngineDbPath(): string {
  return path.join(resolveEngineDataDir(), 'jobfonds_engine.sqlite');
}

export function getEngineStorageInfo(): {
  dataDir: string;
  dbPath: string;
  usesExternalPersistentDir: boolean;
  dbExists: boolean;
  dbSizeBytes: number;
} {
  const dataDir = resolveEngineDataDir();
  const dbPath = getEngineDbPath();
  const dbExists = fs.existsSync(dbPath);
  const dbSizeBytes = dbExists ? fs.statSync(dbPath).size : 0;
  return {
    dataDir,
    dbPath,
    usesExternalPersistentDir: path.resolve(dataDir) !== path.resolve(DEFAULT_DATA_DIR),
    dbExists,
    dbSizeBytes,
  };
}

let dbInstance: DatabaseSync | null = null;

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getEngineDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const dataDir = resolveEngineDataDir();
  const dbPath = getEngineDbPath();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA cache_size = -16000;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      official_name TEXT NOT NULL,
      official_website TEXT DEFAULT '',
      domain TEXT DEFAULT '',
      country TEXT DEFAULT '',
      location TEXT DEFAULT '',
      sector TEXT DEFAULT '',
      estimated_size TEXT DEFAULT '',
      careers_url TEXT DEFAULT '',
      ats_provider TEXT DEFAULT 'none',
      ats_board_token TEXT DEFAULT '',
      monitored INTEGER DEFAULT 1,
      monitor_interval_minutes INTEGER DEFAULT 360,
      last_monitored_at TEXT,
      frequent_skills_json TEXT DEFAULT '[]',
      hiring_velocity TEXT DEFAULT 'Unknown',
      verification_status TEXT DEFAULT 'Partially Verified',
      verified_at TEXT,
      source_name TEXT DEFAULT 'Manual Registration',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_signals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      signal_type TEXT NOT NULL,
      classification TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_quote TEXT DEFAULT '',
      skills_inferred_json TEXT DEFAULT '[]',
      source_name TEXT NOT NULL,
      source_url TEXT DEFAULT '',
      detected_at TEXT NOT NULL,
      reliability_score INTEGER DEFAULT 50,
      relevance_score INTEGER DEFAULT 50,
      admin_status TEXT DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      dedup_hash TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS career_jobs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      department TEXT DEFAULT '',
      location TEXT DEFAULT '',
      country TEXT DEFAULT '',
      work_mode TEXT DEFAULT 'Hybrid',
      contract_type TEXT DEFAULT 'Full-time',
      skills_json TEXT DEFAULT '[]',
      url TEXT DEFAULT '',
      ats_source TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      removed_at TEXT,
      UNIQUE(company_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS career_changes (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      career_job_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      job_title TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      detected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hr_contacts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      department TEXT DEFAULT '',
      role_category TEXT DEFAULT 'Other',
      public_profile_url TEXT DEFAULT '',
      public_channel TEXT DEFAULT '',
      email_domain_verified INTEGER DEFAULT 0,
      mx_verified INTEGER DEFAULT 0,
      source_name TEXT NOT NULL,
      source_url TEXT DEFAULT '',
      verified_at TEXT NOT NULL,
      confidence_level TEXT DEFAULT 'unverified',
      confidence_score INTEGER DEFAULT 40,
      verification_note TEXT DEFAULT '',
      admin_status TEXT DEFAULT 'pending',
      dedup_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      dedup_key TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      result_json TEXT,
      error_message TEXT,
      created_by TEXT DEFAULT 'scheduler',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bg_jobs_status_next ON background_jobs(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_bg_jobs_dedup ON background_jobs(dedup_key, status);

    CREATE TABLE IF NOT EXISTS source_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      rate_limit_per_hour INTEGER NOT NULL DEFAULT 60,
      calls_last_hour INTEGER NOT NULL DEFAULT 0,
      hour_bucket TEXT DEFAULT '',
      last_success_at TEXT,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_subscriptions (
      uid TEXT PRIMARY KEY,
      email TEXT DEFAULT '',
      profile_json TEXT DEFAULT '{}',
      preferred_countries_json TEXT DEFAULT '[]',
      preferred_sectors_json TEXT DEFAULT '[]',
      frequency TEXT DEFAULT 'instant',
      channels_json TEXT DEFAULT '{"inApp":true,"email":false,"push":false}',
      enabled INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      company_id TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      classification TEXT DEFAULT '',
      match_score INTEGER,
      evidence_url TEXT DEFAULT '',
      channel_status_json TEXT DEFAULT '{}',
      read INTEGER DEFAULT 0,
      dedup_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_uid ON notifications(uid, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      uid TEXT DEFAULT 'system',
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      status TEXT NOT NULL,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_uid TEXT NOT NULL,
      actor_email TEXT DEFAULT '',
      actor_role TEXT DEFAULT 'user',
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT DEFAULT '',
      details_json TEXT DEFAULT '{}',
      ip_address TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crm_email_sync_events (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      application_id TEXT NOT NULL,
      company TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      detected_stage TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      reason TEXT DEFAULT '',
      received_at TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      UNIQUE(uid, gmail_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_crm_email_sync_uid ON crm_email_sync_events(uid, synced_at DESC);

    CREATE TABLE IF NOT EXISTS deploy_config (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL DEFAULT 'ssh',
      host TEXT DEFAULT '',
      port INTEGER NOT NULL DEFAULT 65002,
      username TEXT DEFAULT '',
      remote_path TEXT NOT NULL DEFAULT '~/domains/jobfounds.com/nodejs',
      domain TEXT NOT NULL DEFAULT 'jobfounds.com',
      environment TEXT NOT NULL DEFAULT 'production',
      node_version TEXT NOT NULL DEFAULT '22.x',
      auth_method TEXT NOT NULL DEFAULT 'ssh_key',
      encrypted_ssh_key TEXT DEFAULT '',
      encrypted_passphrase TEXT DEFAULT '',
      has_ssh_key INTEGER NOT NULL DEFAULT 0,
      last_connection_status TEXT DEFAULT 'untested',
      last_connection_message TEXT DEFAULT '',
      last_connection_checked_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deploy_env_vars (
      env_key TEXT PRIMARY KEY,
      is_secret INTEGER NOT NULL DEFAULT 1,
      encrypted_value TEXT DEFAULT '',
      plain_value TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deploy_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      triggered_by TEXT DEFAULT '',
      domain TEXT DEFAULT 'jobfounds.com',
      protocol TEXT DEFAULT 'ssh',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      build_status TEXT DEFAULT 'pending',
      server_status TEXT DEFAULT 'unknown',
      steps_json TEXT NOT NULL DEFAULT '[]',
      logs_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT DEFAULT '',
      backup_path TEXT DEFAULT '',
      bundle_path TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_deploy_runs_started ON deploy_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS application_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      application_id TEXT DEFAULT '',
      company_id TEXT DEFAULT '',
      company_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      opportunity_type TEXT NOT NULL DEFAULT 'published_job',
      classification TEXT DEFAULT '',
      channel TEXT NOT NULL,
      recipient_email TEXT DEFAULT '',
      recipient_name TEXT DEFAULT '',
      official_url TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      cover_letter_preview TEXT DEFAULT '',
      cv_version_name TEXT DEFAULT '',
      attachments_json TEXT DEFAULT '[]',
      explicit_authorization INTEGER NOT NULL DEFAULT 0,
      authorization_timestamp TEXT NOT NULL,
      transmitted INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL,
      provider_message_id TEXT DEFAULT '',
      portal_confirmed_at TEXT,
      portal_reference TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_submissions_user ON application_submissions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS auth_users (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      account_role TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(uid) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      code_salt TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_codes(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_verif_email ON email_verification_codes(email, created_at DESC);
  `);

  // Safe additive column migrations for existing production SQLite databases
  const safeAddColumn = (table: string, colDef: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
    } catch {
      // Column already exists
    }
  };
  safeAddColumn('career_jobs', "application_deadline TEXT DEFAULT ''");
  safeAddColumn('hr_contacts', "public_email TEXT DEFAULT ''");
  safeAddColumn('application_submissions', "recruiter_id TEXT DEFAULT ''");
  safeAddColumn('application_submissions', "candidate_name TEXT DEFAULT ''");
  safeAddColumn('application_submissions', "candidate_email TEXT DEFAULT ''");
  safeAddColumn('application_submissions', "cover_letter_full TEXT DEFAULT ''");
  safeAddColumn('application_submissions', "attachments_data_json TEXT DEFAULT '[]'");
  safeAddColumn('application_submissions', "employer_status TEXT DEFAULT 'received'");
  safeAddColumn('application_submissions', "employer_reply TEXT DEFAULT ''");
  safeAddColumn('application_submissions', 'employer_replied_at TEXT');
  safeAddColumn('email_verification_codes', "purpose TEXT NOT NULL DEFAULT 'verify_email'");
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_app_submissions_recruiter ON application_submissions(recruiter_id, created_at DESC);'
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_workspace_data (
      uid TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL DEFAULT '{}',
      cvs_json TEXT NOT NULL DEFAULT '[]',
      applications_json TEXT NOT NULL DEFAULT '[]',
      watchlist_json TEXT NOT NULL DEFAULT '[]',
      account_role TEXT NOT NULL DEFAULT 'candidate',
      lang TEXT NOT NULL DEFAULT 'fr',
      discoverable INTEGER NOT NULL DEFAULT 0,
      gdpr_consent INTEGER NOT NULL DEFAULT 1,
      company_name TEXT NOT NULL DEFAULT '',
      company_website TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);

  // Initialize real external source registry (connector definitions only — zero fake business data)
  const defaultSources: Array<{
    id: string;
    name: string;
    category: SourceConfigRecord['category'];
    rateLimitPerHour: number;
  }> = [
    { id: 'greenhouse_api', name: 'Greenhouse Official Job Board API', category: 'ats', rateLimitPerHour: 120 },
    { id: 'lever_api', name: 'Lever Official Postings API', category: 'ats', rateLimitPerHour: 120 },
    { id: 'ashby_api', name: 'Ashby Public Job Board API', category: 'ats', rateLimitPerHour: 120 },
    { id: 'workday_api', name: 'Workday Official CXS Careers API', category: 'ats', rateLimitPerHour: 90 },
    { id: 'smartrecruiters_api', name: 'SmartRecruiters Official Postings API', category: 'ats', rateLimitPerHour: 120 },
    { id: 'custom_career_jsonld', name: 'Official Career Page JSON-LD Checker', category: 'ats', rateLimitPerHour: 60 },
    { id: 'arbeitnow_api', name: 'Arbeitnow Public Job Feed', category: 'job_feed', rateLimitPerHour: 300 },
    { id: 'remotive_api', name: 'Remotive Remote Job Feed', category: 'job_feed', rateLimitPerHour: 300 },
    { id: 'themuse_api', name: 'The Muse Public Job API', category: 'job_feed', rateLimitPerHour: 300 },
    { id: 'jobicy_api', name: 'Jobicy International Job Feed', category: 'job_feed', rateLimitPerHour: 300 },
    { id: 'himalayas_api', name: 'Himalayas Global Job Feed', category: 'job_feed', rateLimitPerHour: 300 },
    { id: 'gemini_google_search', name: 'Gemini + Google Search Grounding', category: 'ai_search', rateLimitPerHour: 100 },
    { id: 'dns_mx_verifier', name: 'DNS MX Corporate Domain Verifier', category: 'verification', rateLimitPerHour: 240 },
    { id: 'gmail_api', name: 'Gmail Read-Only Recruiter Reply Sync', category: 'verification', rateLimitPerHour: 120 },
    { id: 'resend_email', name: 'Transactional Email Relay (Resend)', category: 'notification', rateLimitPerHour: 100 },
  ];

  const now = new Date().toISOString();
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO source_configs (id, name, category, enabled, rate_limit_per_hour, calls_last_hour, status, updated_at)
    VALUES (?, ?, ?, 1, ?, 0, 'active', ?)
  `);
  for (const s of defaultSources) {
    insertSource.run(s.id, s.name, s.category, s.rateLimitPerHour, now);
  }
  db.prepare(
    "UPDATE source_configs SET rate_limit_per_hour = 300 WHERE category = 'job_feed' AND rate_limit_per_hour < 300"
  ).run();

  dbInstance = db;
  return db;
}

// -----------------------------------------------------------------------------
// Source Governance & Quotas
// -----------------------------------------------------------------------------
export function listSourceConfigs(): SourceConfigRecord[] {
  const db = getEngineDb();
  const rows = db.prepare('SELECT * FROM source_configs ORDER BY category, name').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    enabled: Boolean(r.enabled),
    rateLimitPerHour: Number(r.rate_limit_per_hour || 60),
    callsLastHour: Number(r.calls_last_hour || 0),
    lastSuccessAt: r.last_success_at || null,
    lastError: r.last_error || null,
    status: r.status || 'active',
    updatedAt: r.updated_at,
  }));
}

export function isSourceEnabled(sourceId: string): boolean {
  const db = getEngineDb();
  const row = db
    .prepare('SELECT enabled, rate_limit_per_hour, calls_last_hour, hour_bucket FROM source_configs WHERE id = ?')
    .get(sourceId) as any;
  if (!row) return true;
  if (!row.enabled) return false;
  const bucket = new Date().toISOString().slice(0, 13);
  if (row.hour_bucket === bucket && Number(row.calls_last_hour) >= Number(row.rate_limit_per_hour)) {
    return false;
  }
  return true;
}

export function recordSourceCall(sourceId: string, ok: boolean, errorMsg?: string): void {
  const db = getEngineDb();
  const now = new Date().toISOString();
  const bucket = now.slice(0, 13);
  const row = db
    .prepare('SELECT calls_last_hour, hour_bucket, enabled FROM source_configs WHERE id = ?')
    .get(sourceId) as any;
  if (!row) return;
  const nextCount = row.hour_bucket === bucket ? Number(row.calls_last_hour || 0) + 1 : 1;
  const nextStatus = !row.enabled ? 'paused' : ok ? 'active' : 'degraded';
  db.prepare(`
    UPDATE source_configs
    SET calls_last_hour = ?,
        hour_bucket = ?,
        last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
        last_error = CASE WHEN ? = 1 THEN NULL ELSE ? END,
        status = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextCount, bucket, ok ? 1 : 0, now, ok ? 1 : 0, errorMsg ? clampStr(errorMsg, 400) : null, nextStatus, now, sourceId);
}

export function setSourceEnabled(sourceId: string, enabled: boolean): SourceConfigRecord | null {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE source_configs
    SET enabled = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(enabled ? 1 : 0, enabled ? 'active' : 'paused', now, sourceId);
  return listSourceConfigs().find((s) => s.id === sourceId) || null;
}

// -----------------------------------------------------------------------------
// AI Usage & Budget Governance
// -----------------------------------------------------------------------------
export function getDailyAiUsageSummary(): {
  callsToday: number;
  tokensToday: number;
  estimatedCostUsdToday: number;
  maxCallsPerDay: number;
  maxCostUsdPerDay: number;
  withinBudget: boolean;
} {
  const db = getEngineDb();
  const dayPrefix = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(`
      SELECT
        COUNT(*) as cnt,
        COALESCE(SUM(prompt_tokens + output_tokens), 0) as toks,
        COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM ai_usage_logs
      WHERE created_at LIKE ?
    `)
    .get(`${dayPrefix}%`) as any;

  const maxCallsPerDay = Number(process.env.AI_DAILY_MAX_CALLS) || 500;
  const maxCostUsdPerDay = Number(process.env.AI_DAILY_MAX_COST_USD) || 15;
  const callsToday = Number(row?.cnt || 0);
  const estimatedCostUsdToday = Number(Number(row?.cost || 0).toFixed(4));
  return {
    callsToday,
    tokensToday: Number(row?.toks || 0),
    estimatedCostUsdToday,
    maxCallsPerDay,
    maxCostUsdPerDay,
    withinBudget: callsToday < maxCallsPerDay && estimatedCostUsdToday < maxCostUsdPerDay,
  };
}

export function logAiUsage(params: {
  uid?: string;
  endpoint: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  status: 'ok' | 'error';
  latencyMs: number;
}): void {
  const db = getEngineDb();
  const pTok = Math.max(0, Math.round(params.promptTokens || 0));
  const oTok = Math.max(0, Math.round(params.outputTokens || 0));
  // Conservative estimate for Flash-class Gemini models ($0.15 / 1M input, $0.60 / 1M output)
  const cost = (pTok / 1_000_000) * 0.15 + (oTok / 1_000_000) * 0.6;
  db.prepare(`
    INSERT INTO ai_usage_logs (id, uid, endpoint, model, prompt_tokens, output_tokens, estimated_cost_usd, status, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `ai_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    clampStr(params.uid || 'system', 128),
    clampStr(params.endpoint, 120),
    clampStr(params.model, 80),
    pTok,
    oTok,
    Number(cost.toFixed(6)),
    params.status,
    Math.max(0, Math.round(params.latencyMs)),
    new Date().toISOString()
  );
}

// -----------------------------------------------------------------------------
// Audit Logs (Immutable Trail)
// -----------------------------------------------------------------------------
export function writeAuditLog(params: {
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}): void {
  const db = getEngineDb();
  db.prepare(`
    INSERT INTO audit_logs (id, actor_uid, actor_email, actor_role, action, target_type, target_id, details_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    clampStr(params.actorUid || 'system', 128),
    clampStr(params.actorEmail || '', 200),
    clampStr(params.actorRole || 'user', 40),
    clampStr(params.action, 120),
    clampStr(params.targetType, 60),
    clampStr(params.targetId || '', 128),
    JSON.stringify(params.details || {}).slice(0, 4000),
    clampStr(params.ipAddress || '', 80),
    new Date().toISOString()
  );
}

export function listAuditLogs(limit = 50): AuditLogRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(200, Math.max(1, limit))) as any[];
  return rows.map((r) => ({
    id: r.id,
    actorUid: r.actor_uid,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: safeJsonParse(r.details_json, {}),
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  }));
}

// -----------------------------------------------------------------------------
// Companies DB with Deduplication & Merge
// -----------------------------------------------------------------------------
export function detectAtsFromCareersUrl(careersUrl: string): {
  provider: AtsProvider;
  token: string;
} {
  if (!careersUrl) return { provider: 'none', token: '' };
  try {
    const parsed = new URL(careersUrl);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (host.includes('greenhouse.io') && parts.length > 0) {
      // boards.greenhouse.io/{token} or job-boards.greenhouse.io/{token}
      const token = parts[0] === 'embed' && parts[1] === 'job_board'
        ? parsed.searchParams.get('for') || ''
        : parts[0];
      if (token && /^[a-zA-Z0-9_-]+$/.test(token)) {
        return { provider: 'greenhouse', token: token.toLowerCase() };
      }
    }
    if (host.includes('lever.co') && parts.length > 0) {
      // jobs.lever.co/{token}
      const token = parts[0];
      if (token && /^[a-zA-Z0-9_-]+$/.test(token)) {
        return { provider: 'lever', token: token.toLowerCase() };
      }
    }
    if (host.includes('ashbyhq.com') && parts.length > 0) {
      // jobs.ashbyhq.com/{token}
      const token = parts[0];
      if (token && /^[a-zA-Z0-9_-]+$/.test(token)) {
        return { provider: 'ashby', token };
      }
    }
    if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) {
      // Example: https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite
      const hostSub = host.split('.')[0] || '';
      const filteredParts = parts.filter(
        (p) => !/^[a-z]{2}(-[A-Z]{2})?$/i.test(p) && p.toLowerCase() !== 'recruiting'
      );
      const site =
        host.endsWith('.myworkdaysite.com') && filteredParts.length >= 2
          ? filteredParts[1]
          : filteredParts[0] || '';
      const tenant =
        host.endsWith('.myworkdaysite.com') && filteredParts.length >= 2
          ? filteredParts[0]
          : hostSub;
      if (tenant && site && /^[a-zA-Z0-9_-]+$/.test(tenant) && /^[a-zA-Z0-9_-]+$/.test(site)) {
        return { provider: 'workday', token: `${host}|${tenant}|${site}` };
      }
    }
    if (host.includes('smartrecruiters.com') && parts.length > 0) {
      // Example: https://jobs.smartrecruiters.com/Visa or careers.smartrecruiters.com/Company
      const token = parts[0];
      if (token && /^[a-zA-Z0-9._-]+$/.test(token)) {
        return { provider: 'smartrecruiters', token };
      }
    }
    return { provider: 'custom_jsonld', token: '' };
  } catch {
    return { provider: 'none', token: '' };
  }
}

function mapCompanyRow(r: any): CompanyRecord {
  return {
    id: r.id,
    canonicalKey: r.canonical_key,
    officialName: r.official_name,
    officialWebsite: r.official_website || '',
    domain: r.domain || '',
    country: r.country || '',
    location: r.location || '',
    sector: r.sector || '',
    estimatedSize: r.estimated_size || '',
    careersUrl: r.careers_url || '',
    atsProvider: (r.ats_provider || 'none') as AtsProvider,
    atsBoardToken: r.ats_board_token || '',
    monitored: Boolean(r.monitored),
    monitorIntervalMinutes: Number(r.monitor_interval_minutes || 360),
    lastMonitoredAt: r.last_monitored_at || null,
    frequentSkills: safeJsonParse<string[]>(r.frequent_skills_json, []),
    hiringVelocity: (r.hiring_velocity || 'Unknown') as CompanyRecord['hiringVelocity'],
    verificationStatus: (r.verification_status || 'Partially Verified') as CompanyRecord['verificationStatus'],
    verifiedAt: r.verified_at || null,
    sourceName: r.source_name || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    activeJobsCount: r.active_jobs_count !== undefined ? Number(r.active_jobs_count) : undefined,
    signalsCount: r.signals_count !== undefined ? Number(r.signals_count) : undefined,
    contactsCount: r.contacts_count !== undefined ? Number(r.contacts_count) : undefined,
  };
}

export function upsertCompany(input: {
  officialName: string;
  officialWebsite?: string;
  country?: string;
  location?: string;
  sector?: string;
  estimatedSize?: string;
  careersUrl?: string;
  atsProvider?: AtsProvider;
  atsBoardToken?: string;
  monitored?: boolean;
  monitorIntervalMinutes?: number;
  frequentSkills?: string[];
  hiringVelocity?: CompanyRecord['hiringVelocity'];
  verificationStatus?: CompanyRecord['verificationStatus'];
  sourceName?: string;
}): { company: CompanyRecord; created: boolean; merged: boolean } {
  const db = getEngineDb();
  const cleanName = clampStr(input.officialName, 140);
  if (!cleanName) {
    throw new Error('Company officialName is required.');
  }
  const website = sanitizeHttpUrl(input.officialWebsite);
  const careersUrl = sanitizeHttpUrl(input.careersUrl);
  const domain = extractDomainFromUrl(website) || extractDomainFromUrl(careersUrl);
  const detectedAts = detectAtsFromCareersUrl(careersUrl);
  const atsProvider = input.atsProvider && input.atsProvider !== 'none' ? input.atsProvider : detectedAts.provider;
  const atsBoardToken = clampStr(input.atsBoardToken || detectedAts.token, 120);

  const canonicalKey = domain && !/(greenhouse|lever|ashbyhq|linkedin|workday|smartrecruiters)\./i.test(domain)
    ? `dom:${domain}`
    : `name:${normalizeCanonicalName(cleanName)}`;

  // Deduplication check: match by canonicalKey, exact domain, or normalized name
  let existing = db.prepare('SELECT * FROM companies WHERE canonical_key = ?').get(canonicalKey) as any;
  if (!existing && domain && !/(greenhouse|lever|ashbyhq|linkedin)\./i.test(domain)) {
    existing = db.prepare('SELECT * FROM companies WHERE domain = ?').get(domain) as any;
  }
  if (!existing) {
    const norm = normalizeCanonicalName(cleanName);
    const all = db.prepare('SELECT * FROM companies').all() as any[];
    existing = all.find((c) => normalizeCanonicalName(c.official_name) === norm) || null;
  }

  const now = new Date().toISOString();
  if (existing) {
    const mergedSkills = Array.from(
      new Set([
        ...safeJsonParse<string[]>(existing.frequent_skills_json, []),
        ...(input.frequentSkills || []).map((s) => clampStr(s, 60)).filter(Boolean),
      ])
    ).slice(0, 40);

    db.prepare(`
      UPDATE companies SET
        official_name = COALESCE(NULLIF(?, ''), official_name),
        official_website = CASE WHEN ? != '' THEN ? ELSE official_website END,
        domain = CASE WHEN ? != '' THEN ? ELSE domain END,
        country = CASE WHEN ? != '' THEN ? ELSE country END,
        location = CASE WHEN ? != '' THEN ? ELSE location END,
        sector = CASE WHEN ? != '' THEN ? ELSE sector END,
        estimated_size = CASE WHEN ? != '' THEN ? ELSE estimated_size END,
        careers_url = CASE WHEN ? != '' THEN ? ELSE careers_url END,
        ats_provider = CASE WHEN ? != 'none' THEN ? ELSE ats_provider END,
        ats_board_token = CASE WHEN ? != '' THEN ? ELSE ats_board_token END,
        monitored = CASE WHEN ? IS NOT NULL THEN ? ELSE monitored END,
        monitor_interval_minutes = CASE WHEN ? IS NOT NULL THEN ? ELSE monitor_interval_minutes END,
        frequent_skills_json = ?,
        hiring_velocity = CASE WHEN ? != '' THEN ? ELSE hiring_velocity END,
        verification_status = CASE WHEN ? != '' THEN ? ELSE verification_status END,
        verified_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      cleanName,
      website, website,
      domain, domain,
      clampStr(input.country, 80), clampStr(input.country, 80),
      clampStr(input.location, 120), clampStr(input.location, 120),
      clampStr(input.sector, 120), clampStr(input.sector, 120),
      clampStr(input.estimatedSize, 80), clampStr(input.estimatedSize, 80),
      careersUrl, careersUrl,
      atsProvider, atsProvider,
      atsBoardToken, atsBoardToken,
      input.monitored !== undefined ? 1 : null,
      input.monitored !== undefined ? (input.monitored ? 1 : 0) : null,
      input.monitorIntervalMinutes !== undefined ? 1 : null,
      input.monitorIntervalMinutes !== undefined
        ? Math.max(15, Math.min(10080, Math.round(input.monitorIntervalMinutes)))
        : null,
      JSON.stringify(mergedSkills),
      input.hiringVelocity || '', input.hiringVelocity || '',
      input.verificationStatus || '', input.verificationStatus || '',
      now,
      now,
      existing.id
    );

    const updated = getCompanyById(existing.id)!;
    return { company: updated, created: false, merged: true };
  }

  const id = `cmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const interval = Math.max(
    15,
    Math.min(10080, Math.round(input.monitorIntervalMinutes || Number(process.env.ENGINE_DEFAULT_MONITOR_MINUTES) || 360))
  );
  const skills = Array.from(
    new Set((input.frequentSkills || []).map((s) => clampStr(s, 60)).filter(Boolean))
  ).slice(0, 40);

  db.prepare(`
    INSERT INTO companies (
      id, canonical_key, official_name, official_website, domain, country, location,
      sector, estimated_size, careers_url, ats_provider, ats_board_token,
      monitored, monitor_interval_minutes, frequent_skills_json, hiring_velocity,
      verification_status, verified_at, source_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    canonicalKey,
    cleanName,
    website,
    domain,
    clampStr(input.country, 80),
    clampStr(input.location, 120),
    clampStr(input.sector, 120),
    clampStr(input.estimatedSize, 80),
    careersUrl,
    atsProvider,
    atsBoardToken,
    input.monitored === false ? 0 : 1,
    interval,
    JSON.stringify(skills),
    input.hiringVelocity || 'Unknown',
    input.verificationStatus || (website || careersUrl ? 'Partially Verified' : 'Unverified'),
    now,
    clampStr(input.sourceName || 'Manual Registration', 120),
    now,
    now
  );

  return { company: getCompanyById(id)!, created: true, merged: false };
}

export function getCompanyById(id: string): CompanyRecord | null {
  const db = getEngineDb();
  const row = db
    .prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM career_jobs cj WHERE cj.company_id = c.id AND cj.status = 'active') as active_jobs_count,
        (SELECT COUNT(*) FROM company_signals cs WHERE cs.company_id = c.id AND cs.admin_status != 'rejected') as signals_count,
        (SELECT COUNT(*) FROM hr_contacts hc WHERE hc.company_id = c.id AND hc.admin_status != 'rejected') as contacts_count
      FROM companies c
      WHERE c.id = ?
    `)
    .get(id) as any;
  return row ? mapCompanyRow(row) : null;
}

export function listCompanies(filters?: {
  search?: string;
  country?: string;
  sector?: string;
  monitoredOnly?: boolean;
  limit?: number;
}): CompanyRecord[] {
  const db = getEngineDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters?.monitoredOnly) {
    clauses.push('c.monitored = 1');
  }
  if (filters?.country) {
    clauses.push('LOWER(c.country) LIKE ?');
    params.push(`%${filters.country.toLowerCase()}%`);
  }
  if (filters?.sector) {
    clauses.push('LOWER(c.sector) LIKE ?');
    params.push(`%${filters.sector.toLowerCase()}%`);
  }
  if (filters?.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    clauses.push('(LOWER(c.official_name) LIKE ? OR LOWER(c.domain) LIKE ? OR LOWER(c.sector) LIKE ? OR LOWER(c.location) LIKE ?)');
    params.push(q, q, q, q);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, filters?.limit || 100));
  const rows = db
    .prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM career_jobs cj WHERE cj.company_id = c.id AND cj.status = 'active') as active_jobs_count,
        (SELECT COUNT(*) FROM company_signals cs WHERE cs.company_id = c.id AND cs.admin_status != 'rejected') as signals_count,
        (SELECT COUNT(*) FROM hr_contacts hc WHERE hc.company_id = c.id AND hc.admin_status != 'rejected') as contacts_count
      FROM companies c
      ${whereSql}
      ORDER BY c.updated_at DESC
      LIMIT ?
    `)
    .all(...params, limit) as any[];
  return rows.map(mapCompanyRow);
}

export function mergeCompanies(sourceId: string, targetId: string): CompanyRecord {
  if (sourceId === targetId) throw new Error('Cannot merge a company with itself.');
  const db = getEngineDb();
  const source = getCompanyById(sourceId);
  const target = getCompanyById(targetId);
  if (!source || !target) throw new Error('Source or target company not found.');

  const mergedSkills = Array.from(new Set([...target.frequentSkills, ...source.frequentSkills])).slice(0, 40);
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    // Reassign child records, ignoring duplicates
    db.prepare('UPDATE OR IGNORE company_signals SET company_id = ? WHERE company_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE career_jobs SET company_id = ? WHERE company_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE career_changes SET company_id = ? WHERE company_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE hr_contacts SET company_id = ? WHERE company_id = ?').run(targetId, sourceId);

    db.prepare(`
      UPDATE companies SET
        official_website = COALESCE(NULLIF(official_website, ''), ?),
        domain = COALESCE(NULLIF(domain, ''), ?),
        careers_url = COALESCE(NULLIF(careers_url, ''), ?),
        ats_provider = CASE WHEN ats_provider = 'none' THEN ? ELSE ats_provider END,
        ats_board_token = COALESCE(NULLIF(ats_board_token, ''), ?),
        country = COALESCE(NULLIF(country, ''), ?),
        location = COALESCE(NULLIF(location, ''), ?),
        sector = COALESCE(NULLIF(sector, ''), ?),
        estimated_size = COALESCE(NULLIF(estimated_size, ''), ?),
        frequent_skills_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      source.officialWebsite,
      source.domain,
      source.careersUrl,
      source.atsProvider,
      source.atsBoardToken,
      source.country,
      source.location,
      source.sector,
      source.estimatedSize,
      JSON.stringify(mergedSkills),
      now,
      targetId
    );

    db.prepare('DELETE FROM companies WHERE id = ?').run(sourceId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getCompanyById(targetId)!;
}

export function updateCompanyMonitored(companyId: string, updates: Partial<{
  officialName: string;
  officialWebsite: string;
  careersUrl: string;
  country: string;
  location: string;
  sector: string;
  estimatedSize: string;
  monitored: boolean;
  monitorIntervalMinutes: number;
  verificationStatus: CompanyRecord['verificationStatus'];
  lastMonitoredAt: string;
  hiringVelocity: CompanyRecord['hiringVelocity'];
  frequentSkills: string[];
}>): CompanyRecord | null {
  const db = getEngineDb();
  const current = getCompanyById(companyId);
  if (!current) return null;

  const careersUrl = updates.careersUrl !== undefined ? sanitizeHttpUrl(updates.careersUrl) : current.careersUrl;
  const website = updates.officialWebsite !== undefined ? sanitizeHttpUrl(updates.officialWebsite) : current.officialWebsite;
  const detectedAts = detectAtsFromCareersUrl(careersUrl);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE companies SET
      official_name = ?,
      official_website = ?,
      domain = ?,
      careers_url = ?,
      ats_provider = ?,
      ats_board_token = ?,
      country = ?,
      location = ?,
      sector = ?,
      estimated_size = ?,
      monitored = ?,
      monitor_interval_minutes = ?,
      verification_status = ?,
      last_monitored_at = ?,
      hiring_velocity = ?,
      frequent_skills_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.officialName ? clampStr(updates.officialName, 140) : current.officialName,
    website,
    extractDomainFromUrl(website) || current.domain,
    careersUrl,
    updates.careersUrl !== undefined ? detectedAts.provider : current.atsProvider,
    updates.careersUrl !== undefined ? detectedAts.token : current.atsBoardToken,
    updates.country !== undefined ? clampStr(updates.country, 80) : current.country,
    updates.location !== undefined ? clampStr(updates.location, 120) : current.location,
    updates.sector !== undefined ? clampStr(updates.sector, 120) : current.sector,
    updates.estimatedSize !== undefined ? clampStr(updates.estimatedSize, 80) : current.estimatedSize,
    updates.monitored !== undefined ? (updates.monitored ? 1 : 0) : current.monitored ? 1 : 0,
    updates.monitorIntervalMinutes !== undefined
      ? Math.max(15, Math.min(10080, Math.round(updates.monitorIntervalMinutes)))
      : current.monitorIntervalMinutes,
    updates.verificationStatus || current.verificationStatus,
    updates.lastMonitoredAt !== undefined ? updates.lastMonitoredAt : current.lastMonitoredAt,
    updates.hiringVelocity || current.hiringVelocity,
    JSON.stringify(updates.frequentSkills || current.frequentSkills),
    now,
    companyId
  );

  return getCompanyById(companyId);
}

// -----------------------------------------------------------------------------
// Signals CRUD & Moderation
// -----------------------------------------------------------------------------
export function recordCompanySignal(input: {
  companyId: string;
  signalType: SignalType;
  classification: NeedClassification;
  title: string;
  summary: string;
  evidenceQuote?: string;
  skillsInferred?: string[];
  sourceName: string;
  sourceUrl?: string;
  detectedAt?: string;
  reliabilityScore: number;
  relevanceScore: number;
}): { signal: CompanySignalRecord; inserted: boolean } {
  const db = getEngineDb();
  const cleanTitle = clampStr(input.title, 220);
  const cleanSummary = clampStr(input.summary, 1500);
  const cleanUrl = sanitizeHttpUrl(input.sourceUrl);
  const dedupHash = crypto
    .createHash('sha256')
    .update(`${input.companyId}|${input.signalType}|${cleanTitle.toLowerCase()}|${cleanUrl.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);

  const existing = db.prepare('SELECT * FROM company_signals WHERE dedup_hash = ?').get(dedupHash) as any;
  if (existing) {
    return { signal: mapSignalRow(existing), inserted: false };
  }

  const id = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = input.detectedAt || new Date().toISOString();
  const skills = Array.from(
    new Set((input.skillsInferred || []).map((s) => clampStr(s, 60)).filter(Boolean))
  ).slice(0, 20);

  db.prepare(`
    INSERT INTO company_signals (
      id, company_id, signal_type, classification, title, summary, evidence_quote,
      skills_inferred_json, source_name, source_url, detected_at,
      reliability_score, relevance_score, admin_status, dedup_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    input.companyId,
    input.signalType,
    input.classification,
    cleanTitle,
    cleanSummary,
    clampStr(input.evidenceQuote || '', 600),
    JSON.stringify(skills),
    clampStr(input.sourceName || 'Public Source', 120),
    cleanUrl,
    now,
    Math.min(100, Math.max(0, Math.round(input.reliabilityScore))),
    Math.min(100, Math.max(0, Math.round(input.relevanceScore))),
    dedupHash
  );

  const row = db.prepare('SELECT * FROM company_signals WHERE id = ?').get(id) as any;
  return { signal: mapSignalRow(row), inserted: true };
}

function mapSignalRow(r: any): CompanySignalRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    companyCountry: r.company_country,
    companySector: r.company_sector,
    signalType: r.signal_type,
    classification: r.classification,
    title: r.title,
    summary: r.summary,
    evidenceQuote: r.evidence_quote || '',
    skillsInferred: safeJsonParse<string[]>(r.skills_inferred_json, []),
    sourceName: r.source_name,
    sourceUrl: r.source_url || '',
    detectedAt: r.detected_at,
    reliabilityScore: Number(r.reliability_score || 50),
    relevanceScore: Number(r.relevance_score || 50),
    adminStatus: r.admin_status || 'pending',
    adminNote: r.admin_note || '',
  };
}

export function listSignals(filters?: {
  companyId?: string;
  includeRejected?: boolean;
  limit?: number;
}): CompanySignalRecord[] {
  const db = getEngineDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters?.companyId) {
    clauses.push('cs.company_id = ?');
    params.push(filters.companyId);
  }
  if (!filters?.includeRejected) {
    clauses.push("cs.admin_status != 'rejected'");
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, filters?.limit || 80));
  const rows = db
    .prepare(`
      SELECT cs.*, c.official_name as company_name, c.country as company_country, c.sector as company_sector
      FROM company_signals cs
      JOIN companies c ON c.id = cs.company_id
      ${whereSql}
      ORDER BY cs.detected_at DESC
      LIMIT ?
    `)
    .all(...params, limit) as any[];
  return rows.map(mapSignalRow);
}

export function reviewSignalAdmin(
  signalId: string,
  status: AdminReviewStatus,
  adminNote = '',
  classification?: NeedClassification
): CompanySignalRecord | null {
  const db = getEngineDb();
  db.prepare(`
    UPDATE company_signals
    SET admin_status = ?,
        admin_note = ?,
        classification = COALESCE(?, classification)
    WHERE id = ?
  `).run(status, clampStr(adminNote, 500), classification || null, signalId);
  const row = db
    .prepare(`
      SELECT cs.*, c.official_name as company_name, c.country as company_country, c.sector as company_sector
      FROM company_signals cs
      JOIN companies c ON c.id = cs.company_id
      WHERE cs.id = ?
    `)
    .get(signalId) as any;
  return row ? mapSignalRow(row) : null;
}

// -----------------------------------------------------------------------------
// Career Jobs & Changes
// -----------------------------------------------------------------------------
export function listCompanyCareerJobs(companyId: string, includeRemoved = false): CareerJobRecord[] {
  const db = getEngineDb();
  const whereStatus = includeRemoved ? '' : "AND status = 'active'";
  const rows = db
    .prepare(`SELECT * FROM career_jobs WHERE company_id = ? ${whereStatus} ORDER BY last_seen_at DESC LIMIT 200`)
    .all(companyId) as any[];
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    externalId: r.external_id,
    title: r.title,
    department: r.department || '',
    location: r.location || '',
    country: r.country || '',
    workMode: (r.work_mode || 'Hybrid') as CareerJobRecord['workMode'],
    contractType: r.contract_type || 'Full-time',
    skills: safeJsonParse<string[]>(r.skills_json, []),
    url: r.url || '',
    atsSource: r.ats_source,
    contentHash: r.content_hash,
    status: r.status,
    applicationDeadline: r.application_deadline || '',
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at || null,
  }));
}

export function listAllActiveCareerJobs(limit = 150): Array<CareerJobRecord & { companyName: string; companySector: string }> {
  const db = getEngineDb();
  const rows = db
    .prepare(`
      SELECT cj.*, c.official_name as company_name, c.sector as company_sector
      FROM career_jobs cj
      JOIN companies c ON c.id = cj.company_id
      WHERE cj.status = 'active'
      ORDER BY cj.first_seen_at DESC
      LIMIT ?
    `)
    .all(Math.min(300, Math.max(1, limit))) as any[];
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    companySector: r.company_sector || '',
    externalId: r.external_id,
    title: r.title,
    department: r.department || '',
    location: r.location || '',
    country: r.country || '',
    workMode: (r.work_mode || 'Hybrid') as CareerJobRecord['workMode'],
    contractType: r.contract_type || 'Full-time',
    skills: safeJsonParse<string[]>(r.skills_json, []),
    url: r.url || '',
    atsSource: r.ats_source,
    contentHash: r.content_hash,
    status: r.status,
    applicationDeadline: r.application_deadline || '',
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    removedAt: r.removed_at || null,
  }));
}

export function listCompanyCareerChanges(companyId: string, limit = 50): CareerChangeRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM career_changes WHERE company_id = ? ORDER BY detected_at DESC LIMIT ?')
    .all(companyId, Math.min(200, Math.max(1, limit))) as any[];
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    careerJobId: r.career_job_id,
    changeType: r.change_type,
    jobTitle: r.job_title,
    details: safeJsonParse(r.details_json, {}),
    detectedAt: r.detected_at,
  }));
}

// -----------------------------------------------------------------------------
// HR Contacts CRUD & Verification
// -----------------------------------------------------------------------------
export function upsertHrContact(input: {
  companyId: string;
  fullName: string;
  roleTitle: string;
  department?: string;
  roleCategory?: string;
  publicProfileUrl?: string;
  publicChannel?: string;
  publicEmail?: string;
  emailDomainVerified?: boolean;
  mxVerified?: boolean;
  sourceName: string;
  sourceUrl?: string;
  confidenceLevel: ContactConfidenceLevel;
  confidenceScore: number;
  verificationNote?: string;
}): { contact: HrContactRecord; inserted: boolean } {
  const db = getEngineDb();
  const cleanName = clampStr(input.fullName, 120);
  const cleanRole = clampStr(input.roleTitle, 140);
  if (!cleanName || !cleanRole) {
    throw new Error('Contact fullName and roleTitle are required.');
  }
  const dedupKey = `${input.companyId}::${cleanName.toLowerCase()}::${cleanRole.toLowerCase()}`;
  const now = new Date().toISOString();
  const profileUrl = sanitizeHttpUrl(input.publicProfileUrl);
  const srcUrl = sanitizeHttpUrl(input.sourceUrl);
  const cleanPublicEmail =
    typeof input.publicEmail === 'string' &&
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input.publicEmail.trim())
      ? input.publicEmail.trim().toLowerCase().slice(0, 160)
      : '';

  const existing = db.prepare('SELECT * FROM hr_contacts WHERE dedup_key = ?').get(dedupKey) as any;
  if (existing) {
    db.prepare(`
      UPDATE hr_contacts SET
        department = COALESCE(NULLIF(?, ''), department),
        public_profile_url = COALESCE(NULLIF(?, ''), public_profile_url),
        public_channel = COALESCE(NULLIF(?, ''), public_channel),
        public_email = COALESCE(NULLIF(?, ''), public_email),
        email_domain_verified = ?,
        mx_verified = ?,
        source_name = ?,
        source_url = COALESCE(NULLIF(?, ''), source_url),
        verified_at = ?,
        confidence_level = ?,
        confidence_score = ?,
        verification_note = ?
      WHERE id = ?
    `).run(
      clampStr(input.department || '', 100),
      profileUrl,
      clampStr(input.publicChannel || '', 120),
      cleanPublicEmail,
      input.emailDomainVerified ? 1 : 0,
      input.mxVerified ? 1 : 0,
      clampStr(input.sourceName, 120),
      srcUrl,
      now,
      input.confidenceLevel,
      Math.min(100, Math.max(0, Math.round(input.confidenceScore))),
      clampStr(input.verificationNote || '', 400),
      existing.id
    );
    const updated = db.prepare('SELECT * FROM hr_contacts WHERE id = ?').get(existing.id) as any;
    return { contact: mapContactRow(updated), inserted: false };
  }

  const id = `cnt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO hr_contacts (
      id, company_id, full_name, role_title, department, role_category,
      public_profile_url, public_channel, public_email, email_domain_verified, mx_verified,
      source_name, source_url, verified_at, confidence_level, confidence_score,
      verification_note, admin_status, dedup_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    input.companyId,
    cleanName,
    cleanRole,
    clampStr(input.department || '', 100),
    clampStr(input.roleCategory || 'Other', 80),
    profileUrl,
    clampStr(input.publicChannel || 'Public Profile', 120),
    cleanPublicEmail,
    input.emailDomainVerified ? 1 : 0,
    input.mxVerified ? 1 : 0,
    clampStr(input.sourceName, 120),
    srcUrl,
    now,
    input.confidenceLevel,
    Math.min(100, Math.max(0, Math.round(input.confidenceScore))),
    clampStr(input.verificationNote || '', 400),
    dedupKey
  );
  const created = db.prepare('SELECT * FROM hr_contacts WHERE id = ?').get(id) as any;
  return { contact: mapContactRow(created), inserted: true };
}

function mapContactRow(r: any): HrContactRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    fullName: r.full_name,
    roleTitle: r.role_title,
    department: r.department || '',
    roleCategory: r.role_category || 'Other',
    publicProfileUrl: r.public_profile_url || '',
    publicChannel: r.public_channel || '',
    publicEmail: r.public_email || '',
    emailDomainVerified: Boolean(r.email_domain_verified),
    mxVerified: Boolean(r.mx_verified),
    sourceName: r.source_name,
    sourceUrl: r.source_url || '',
    verifiedAt: r.verified_at,
    confidenceLevel: (r.confidence_level || 'unverified') as ContactConfidenceLevel,
    confidenceScore: Number(r.confidence_score || 40),
    verificationNote: r.verification_note || '',
    adminStatus: (r.admin_status || 'pending') as AdminReviewStatus,
  };
}

export function listHrContacts(filters?: {
  companyId?: string;
  includeRejected?: boolean;
  limit?: number;
}): HrContactRecord[] {
  const db = getEngineDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters?.companyId) {
    clauses.push('hc.company_id = ?');
    params.push(filters.companyId);
  }
  if (!filters?.includeRejected) {
    clauses.push("hc.admin_status != 'rejected'");
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, filters?.limit || 80));
  const rows = db
    .prepare(`
      SELECT hc.*, c.official_name as company_name
      FROM hr_contacts hc
      JOIN companies c ON c.id = hc.company_id
      ${whereSql}
      ORDER BY hc.confidence_score DESC, hc.verified_at DESC
      LIMIT ?
    `)
    .all(...params, limit) as any[];
  return rows.map(mapContactRow);
}

export function reviewHrContactAdmin(
  contactId: string,
  adminStatus: AdminReviewStatus,
  confidenceLevel?: ContactConfidenceLevel
): HrContactRecord | null {
  const db = getEngineDb();
  db.prepare(`
    UPDATE hr_contacts
    SET admin_status = ?,
        confidence_level = COALESCE(?, confidence_level)
    WHERE id = ?
  `).run(adminStatus, confidenceLevel || null, contactId);
  const row = db
    .prepare(`
      SELECT hc.*, c.official_name as company_name
      FROM hr_contacts hc
      JOIN companies c ON c.id = hc.company_id
      WHERE hc.id = ?
    `)
    .get(contactId) as any;
  return row ? mapContactRow(row) : null;
}

// -----------------------------------------------------------------------------
// Background Task Queue (Deduplicated, Retried, Persistent)
// -----------------------------------------------------------------------------
export function enqueueBackgroundJob(params: {
  jobType: BackgroundJobType;
  dedupKey: string;
  payload: Record<string, any>;
  createdBy?: string;
  maxAttempts?: number;
  delaySeconds?: number;
}): { job: BackgroundJobRecord; deduplicated: boolean } {
  const db = getEngineDb();
  const cleanDedup = clampStr(params.dedupKey, 200);
  const existing = db
    .prepare("SELECT * FROM background_jobs WHERE dedup_key = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(cleanDedup) as any;
  if (existing) {
    return { job: mapBgJobRow(existing), deduplicated: true };
  }

  const id = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date();
  const nextRun = new Date(now.getTime() + Math.max(0, params.delaySeconds || 0) * 1000).toISOString();
  db.prepare(`
    INSERT INTO background_jobs (
      id, job_type, dedup_key, payload_json, status, attempts, max_attempts,
      next_run_at, created_by, created_at
    ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
  `).run(
    id,
    params.jobType,
    cleanDedup,
    JSON.stringify(params.payload || {}),
    Math.min(5, Math.max(1, params.maxAttempts || 3)),
    nextRun,
    clampStr(params.createdBy || 'scheduler', 128),
    now.toISOString()
  );
  const created = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(id) as any;
  return { job: mapBgJobRow(created), deduplicated: false };
}

function mapBgJobRow(r: any): BackgroundJobRecord {
  return {
    id: r.id,
    jobType: r.job_type,
    dedupKey: r.dedup_key,
    payload: safeJsonParse(r.payload_json, {}),
    status: r.status,
    attempts: Number(r.attempts || 0),
    maxAttempts: Number(r.max_attempts || 3),
    nextRunAt: r.next_run_at,
    startedAt: r.started_at || null,
    finishedAt: r.finished_at || null,
    result: safeJsonParse(r.result_json, null),
    errorMessage: r.error_message || null,
    createdBy: r.created_by || 'scheduler',
    createdAt: r.created_at,
  };
}

export function listBackgroundJobs(limit = 60): BackgroundJobRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(200, Math.max(1, limit))) as any[];
  return rows.map(mapBgJobRow);
}

export function claimNextDueJob(): BackgroundJobRecord | null {
  const db = getEngineDb();
  const now = new Date().toISOString();
  const row = db
    .prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'queued' AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT 1
    `)
    .get(now) as any;
  if (!row) return null;

  const res = db
    .prepare(`
      UPDATE background_jobs
      SET status = 'running', attempts = attempts + 1, started_at = ?
      WHERE id = ? AND status = 'queued'
    `)
    .run(now, row.id);
  if (res.changes === 0) return null;

  const claimed = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(row.id) as any;
  return claimed ? mapBgJobRow(claimed) : null;
}

export function completeBackgroundJob(jobId: string, result: Record<string, any>): void {
  const db = getEngineDb();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'completed', finished_at = ?, result_json = ?, error_message = NULL
    WHERE id = ?
  `).run(new Date().toISOString(), JSON.stringify(result).slice(0, 8000), jobId);
}

export function recoverStaleRunningJobs(staleAfterMinutes = 25): {
  requeued: number;
  failed: number;
} {
  const db = getEngineDb();
  const cutoffIso = new Date(Date.now() - Math.max(5, staleAfterMinutes) * 60_000).toISOString();
  const staleRows = db
    .prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'running' AND started_at IS NOT NULL AND started_at <= ?
    `)
    .all(cutoffIso) as any[];

  let requeued = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  for (const row of staleRows) {
    const attempts = Number(row.attempts || 0);
    const maxAttempts = Number(row.max_attempts || 3);
    if (attempts < maxAttempts) {
      db.prepare(`
        UPDATE background_jobs
        SET status = 'queued', next_run_at = ?, error_message = ?
        WHERE id = ? AND status = 'running'
      `).run(nowIso, 'Reprise automatique après interruption précédente (limite de temps Hostinger).', row.id);
      requeued++;
    } else {
      db.prepare(`
        UPDATE background_jobs
        SET status = 'failed', finished_at = ?, error_message = ?
        WHERE id = ? AND status = 'running'
      `).run(nowIso, 'Interruption répétée dépassant le nombre maximal de tentatives.', row.id);
      failed++;
    }
  }

  return { requeued, failed };
}

export function countQueuedBackgroundJobs(): number {
  const db = getEngineDb();
  const row = db
    .prepare("SELECT COUNT(*) as c FROM background_jobs WHERE status = 'queued'")
    .get() as any;
  return Number(row?.c || 0);
}

export function closeEngineDb(): void {
  if (!dbInstance) return;
  try {
    dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // ignore checkpoint errors during shutdown
  }
  try {
    dbInstance.close();
  } catch {
    // ignore close errors
  }
  dbInstance = null;
}

export function failBackgroundJob(job: BackgroundJobRecord, errorMessage: string): void {
  const db = getEngineDb();
  const now = Date.now();
  const cleanErr = clampStr(errorMessage, 1000);
  if (job.attempts < job.maxAttempts) {
    // Exponential backoff: 30s, 120s, 480s
    const backoffMs = 30_000 * Math.pow(4, Math.max(0, job.attempts - 1));
    db.prepare(`
      UPDATE background_jobs
      SET status = 'queued', next_run_at = ?, error_message = ?
      WHERE id = ?
    `).run(new Date(now + backoffMs).toISOString(), cleanErr, job.id);
  } else {
    db.prepare(`
      UPDATE background_jobs
      SET status = 'failed', finished_at = ?, error_message = ?
      WHERE id = ?
    `).run(new Date(now).toISOString(), cleanErr, job.id);
  }
}

export function retryFailedJob(jobId: string): BackgroundJobRecord | null {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'queued', attempts = 0, next_run_at = ?, error_message = NULL, finished_at = NULL
    WHERE id = ? AND status IN ('failed', 'cancelled')
  `).run(now, jobId);
  const row = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(jobId) as any;
  return row ? mapBgJobRow(row) : null;
}

// -----------------------------------------------------------------------------
// Candidate Subscriptions & Personalized Notifications
// -----------------------------------------------------------------------------
export function upsertCandidateSubscription(input: {
  uid: string;
  email: string;
  profile: Record<string, any>;
  preferredCountries: string[];
  preferredSectors: string[];
  frequency: 'instant' | 'daily' | 'weekly';
  channels: { inApp: boolean; email: boolean; push: boolean };
  enabled: boolean;
}): CandidateSubscriptionRecord {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO candidate_subscriptions (
      uid, email, profile_json, preferred_countries_json, preferred_sectors_json,
      frequency, channels_json, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      email = excluded.email,
      profile_json = excluded.profile_json,
      preferred_countries_json = excluded.preferred_countries_json,
      preferred_sectors_json = excluded.preferred_sectors_json,
      frequency = excluded.frequency,
      channels_json = excluded.channels_json,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    clampStr(input.uid, 128),
    clampStr(input.email, 200),
    JSON.stringify(input.profile || {}).slice(0, 12000),
    JSON.stringify((input.preferredCountries || []).slice(0, 20)),
    JSON.stringify((input.preferredSectors || []).slice(0, 20)),
    input.frequency || 'instant',
    JSON.stringify({
      inApp: Boolean(input.channels?.inApp ?? true),
      email: Boolean(input.channels?.email ?? false),
      push: Boolean(input.channels?.push ?? false),
    }),
    input.enabled ? 1 : 0,
    now
  );
  return getCandidateSubscription(input.uid)!;
}

export function getCandidateSubscription(uid: string): CandidateSubscriptionRecord | null {
  const db = getEngineDb();
  const r = db.prepare('SELECT * FROM candidate_subscriptions WHERE uid = ?').get(uid) as any;
  if (!r) return null;
  return {
    uid: r.uid,
    email: r.email || '',
    profile: safeJsonParse(r.profile_json, {}),
    preferredCountries: safeJsonParse(r.preferred_countries_json, []),
    preferredSectors: safeJsonParse(r.preferred_sectors_json, []),
    frequency: (r.frequency || 'instant') as CandidateSubscriptionRecord['frequency'],
    channels: safeJsonParse(r.channels_json, { inApp: true, email: false, push: false }),
    enabled: Boolean(r.enabled),
    updatedAt: r.updated_at,
  };
}

export function listActiveCandidateSubscriptions(): CandidateSubscriptionRecord[] {
  const db = getEngineDb();
  const rows = db.prepare('SELECT * FROM candidate_subscriptions WHERE enabled = 1').all() as any[];
  return rows.map((r) => ({
    uid: r.uid,
    email: r.email || '',
    profile: safeJsonParse(r.profile_json, {}),
    preferredCountries: safeJsonParse(r.preferred_countries_json, []),
    preferredSectors: safeJsonParse(r.preferred_sectors_json, []),
    frequency: (r.frequency || 'instant') as CandidateSubscriptionRecord['frequency'],
    channels: safeJsonParse(r.channels_json, { inApp: true, email: false, push: false }),
    enabled: Boolean(r.enabled),
    updatedAt: r.updated_at,
  }));
}

export function createNotification(input: {
  uid: string;
  type: NotificationRecord['type'];
  title: string;
  body: string;
  companyId?: string;
  companyName?: string;
  classification?: NeedClassification | '';
  matchScore?: number | null;
  evidenceUrl?: string;
  channelStatus: NotificationRecord['channelStatus'];
  dedupKey?: string;
}): { notification: NotificationRecord; created: boolean } {
  const db = getEngineDb();
  if (input.dedupKey) {
    const existing = db
      .prepare('SELECT * FROM notifications WHERE uid = ? AND dedup_key = ? LIMIT 1')
      .get(input.uid, input.dedupKey) as any;
    if (existing) {
      return { notification: mapNotificationRow(existing), created: false };
    }
  }
  const id = `ntf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (
      id, uid, type, title, body, company_id, company_name, classification,
      match_score, evidence_url, channel_status_json, read, dedup_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    clampStr(input.uid, 128),
    input.type,
    clampStr(input.title, 200),
    clampStr(input.body, 1200),
    clampStr(input.companyId || '', 128),
    clampStr(input.companyName || '', 140),
    input.classification || '',
    input.matchScore !== undefined && input.matchScore !== null ? Math.round(input.matchScore) : null,
    sanitizeHttpUrl(input.evidenceUrl),
    JSON.stringify(input.channelStatus || { inApp: true, emailSent: false, pushReady: false }),
    input.dedupKey ? clampStr(input.dedupKey, 200) : null,
    now
  );
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any;
  return { notification: mapNotificationRow(row), created: true };
}

function mapNotificationRow(r: any): NotificationRecord {
  return {
    id: r.id,
    uid: r.uid,
    type: r.type,
    title: r.title,
    body: r.body,
    companyId: r.company_id || '',
    companyName: r.company_name || '',
    classification: (r.classification || '') as NotificationRecord['classification'],
    matchScore: r.match_score !== null && r.match_score !== undefined ? Number(r.match_score) : null,
    evidenceUrl: r.evidence_url || '',
    channelStatus: safeJsonParse(r.channel_status_json, {
      inApp: true,
      emailSent: false,
      pushReady: false,
    }),
    read: Boolean(r.read),
    createdAt: r.created_at,
  };
}

export function listUserNotifications(uid: string, limit = 60): NotificationRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM notifications WHERE uid = ? ORDER BY created_at DESC LIMIT ?')
    .all(uid, Math.min(200, Math.max(1, limit))) as any[];
  return rows.map(mapNotificationRow);
}

export function markNotificationRead(uid: string, notificationId?: string): number {
  const db = getEngineDb();
  if (notificationId) {
    const res = db
      .prepare('UPDATE notifications SET read = 1 WHERE uid = ? AND id = ?')
      .run(uid, notificationId);
    return Number(res.changes || 0);
  }
  const res = db.prepare('UPDATE notifications SET read = 1 WHERE uid = ? AND read = 0').run(uid);
  return Number(res.changes || 0);
}

// -----------------------------------------------------------------------------
// CRM Recruiter Email Sync Events (Real Authorized Gmail Replies)
// -----------------------------------------------------------------------------
export interface CrmEmailSyncEventRecord {
  id: string;
  uid: string;
  applicationId: string;
  company: string;
  gmailMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  detectedStage: string;
  confidence: 'high' | 'medium';
  reason: string;
  receivedAt: string;
  syncedAt: string;
}

function mapCrmEmailSyncRow(r: any): CrmEmailSyncEventRecord {
  return {
    id: r.id,
    uid: r.uid,
    applicationId: r.application_id,
    company: r.company,
    gmailMessageId: r.gmail_message_id,
    sender: r.sender,
    subject: r.subject || '',
    snippet: r.snippet || '',
    detectedStage: r.detected_stage,
    confidence: r.confidence === 'high' ? 'high' : 'medium',
    reason: r.reason || '',
    receivedAt: r.received_at,
    syncedAt: r.synced_at,
  };
}

export function recordCrmEmailSyncEvent(input: {
  uid: string;
  applicationId: string;
  company: string;
  gmailMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  detectedStage: string;
  confidence: 'high' | 'medium';
  reason: string;
  receivedAt: string;
}): { event: CrmEmailSyncEventRecord; created: boolean } {
  const db = getEngineDb();
  const cleanMsgId = clampStr(input.gmailMessageId, 200);
  const existing = db
    .prepare('SELECT * FROM crm_email_sync_events WHERE uid = ? AND gmail_message_id = ?')
    .get(input.uid, cleanMsgId) as any;
  if (existing) {
    return { event: mapCrmEmailSyncRow(existing), created: false };
  }

  const now = new Date().toISOString();
  const id = `esync_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO crm_email_sync_events (
      id, uid, application_id, company, gmail_message_id, sender, subject,
      snippet, detected_stage, confidence, reason, received_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    clampStr(input.uid, 128),
    clampStr(input.applicationId, 128),
    clampStr(input.company, 160),
    cleanMsgId,
    clampStr(input.sender, 240),
    clampStr(input.subject, 300),
    clampStr(input.snippet, 600),
    clampStr(input.detectedStage, 60),
    input.confidence === 'high' ? 'high' : 'medium',
    clampStr(input.reason, 300),
    clampStr(input.receivedAt, 64),
    now
  );

  const createdRow = db.prepare('SELECT * FROM crm_email_sync_events WHERE id = ?').get(id) as any;
  return { event: mapCrmEmailSyncRow(createdRow), created: true };
}

export function listCrmEmailSyncEvents(uid: string, limit = 50): CrmEmailSyncEventRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM crm_email_sync_events WHERE uid = ? ORDER BY synced_at DESC LIMIT ?')
    .all(uid, Math.min(200, Math.max(1, limit))) as any[];
  return rows.map(mapCrmEmailSyncRow);
}

// -----------------------------------------------------------------------------
// Admin Global Metrics Aggregation
// -----------------------------------------------------------------------------
export function getEngineOverviewMetrics() {
  const db = getEngineDb();
  const scalar = (sql: string) => Number(((db.prepare(sql).get() as any)?.c) || 0);
  const aiToday = getDailyAiUsageSummary();
  return {
    companiesRegistered: scalar('SELECT COUNT(*) as c FROM companies'),
    companiesMonitored: scalar('SELECT COUNT(*) as c FROM companies WHERE monitored = 1'),
    signalsDetected: scalar("SELECT COUNT(*) as c FROM company_signals WHERE admin_status != 'rejected'"),
    unpublishedOpportunities: scalar(
      "SELECT COUNT(*) as c FROM company_signals WHERE classification != 'confirmed_job' AND admin_status != 'rejected'"
    ),
    publishedCareerJobs: scalar("SELECT COUNT(*) as c FROM career_jobs WHERE status = 'active'"),
    careerChangesLogged: scalar('SELECT COUNT(*) as c FROM career_changes'),
    contactsIdentified: scalar("SELECT COUNT(*) as c FROM hr_contacts WHERE admin_status != 'rejected'"),
    contactsVerified: scalar(
      "SELECT COUNT(*) as c FROM hr_contacts WHERE confidence_level = 'confirmed' AND admin_status != 'rejected'"
    ),
    jobsQueued: scalar("SELECT COUNT(*) as c FROM background_jobs WHERE status = 'queued'"),
    jobsRunning: scalar("SELECT COUNT(*) as c FROM background_jobs WHERE status = 'running'"),
    jobsCompleted: scalar("SELECT COUNT(*) as c FROM background_jobs WHERE status = 'completed'"),
    jobsFailed: scalar("SELECT COUNT(*) as c FROM background_jobs WHERE status = 'failed'"),
    notificationsSent: scalar('SELECT COUNT(*) as c FROM notifications'),
    subscribedCandidates: scalar('SELECT COUNT(*) as c FROM candidate_subscriptions WHERE enabled = 1'),
    crmEmailRepliesDetected: scalar('SELECT COUNT(*) as c FROM crm_email_sync_events'),
    applicationsSubmittedCount: scalar("SELECT COUNT(*) as c FROM application_submissions WHERE transmitted = 1 OR delivery_status = 'portal_confirmed_by_user'"),
    aiUsage: aiToday,
    sources: listSourceConfigs(),
  };
}

// -----------------------------------------------------------------------------
// Real Application Submissions & Verifiable Delivery Receipts
// -----------------------------------------------------------------------------
function mapApplicationSubmissionRow(r: any): ApplicationSubmissionRecord {
  return {
    id: r.id,
    userId: r.user_id,
    recruiterId: r.recruiter_id || '',
    candidateName: r.candidate_name || '',
    candidateEmail: r.candidate_email || '',
    applicationId: r.application_id || '',
    companyId: r.company_id || '',
    companyName: r.company_name,
    roleTitle: r.role_title,
    opportunityType:
      r.opportunity_type === 'hidden_opportunity' ? 'hidden_opportunity' : 'published_job',
    classification: (r.classification || '') as NeedClassification | '',
    channel: r.channel as ApplicationSubmissionChannel,
    recipientEmail: r.recipient_email || '',
    recipientName: r.recipient_name || '',
    officialUrl: r.official_url || '',
    subject: r.subject || '',
    coverLetterPreview: r.cover_letter_preview || '',
    coverLetterFull: r.cover_letter_full || r.cover_letter_preview || '',
    cvVersionName: r.cv_version_name || '',
    attachments: safeJsonParse<Array<{ filename: string; contentType: string; sizeBytes: number }>>(
      r.attachments_json,
      []
    ),
    explicitAuthorization: Boolean(r.explicit_authorization),
    authorizationTimestamp: r.authorization_timestamp,
    transmitted: Boolean(r.transmitted),
    deliveryStatus: r.delivery_status as ApplicationDeliveryStatus,
    providerMessageId: r.provider_message_id || '',
    portalConfirmedAt: r.portal_confirmed_at || null,
    portalReference: r.portal_reference || '',
    employerStatus: (r.employer_status || 'received') as EmployerApplicationStatus,
    employerReply: r.employer_reply || '',
    employerRepliedAt: r.employer_replied_at || null,
    errorMessage: r.error_message || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createApplicationSubmission(input: {
  userId: string;
  recruiterId?: string;
  candidateName?: string;
  candidateEmail?: string;
  applicationId?: string;
  companyId?: string;
  companyName: string;
  roleTitle: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  classification?: NeedClassification | '';
  channel: ApplicationSubmissionChannel;
  recipientEmail?: string;
  recipientName?: string;
  officialUrl?: string;
  subject?: string;
  coverLetterPreview?: string;
  coverLetterFull?: string;
  cvVersionName?: string;
  attachments?: Array<{ filename: string; contentType: string; sizeBytes: number }>;
  attachmentsData?: Array<{ filename: string; contentType: string; base64Content: string }>;
  explicitAuthorization: boolean;
  authorizationTimestamp: string;
  transmitted: boolean;
  deliveryStatus: ApplicationDeliveryStatus;
  providerMessageId?: string;
  errorMessage?: string;
}): ApplicationSubmissionRecord {
  const db = getEngineDb();
  const id = `sub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO application_submissions (
      id, user_id, recruiter_id, candidate_name, candidate_email,
      application_id, company_id, company_name, role_title,
      opportunity_type, classification, channel, recipient_email, recipient_name,
      official_url, subject, cover_letter_preview, cover_letter_full, cv_version_name,
      attachments_json, attachments_data_json,
      explicit_authorization, authorization_timestamp, transmitted, delivery_status,
      provider_message_id, employer_status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)
  `).run(
    id,
    clampStr(input.userId, 128),
    clampStr(input.recruiterId || '', 128),
    clampStr(input.candidateName || '', 140),
    clampStr(input.candidateEmail || '', 200),
    clampStr(input.applicationId || '', 128),
    clampStr(input.companyId || '', 128),
    clampStr(input.companyName, 160),
    clampStr(input.roleTitle, 180),
    input.opportunityType,
    input.classification || '',
    input.channel,
    clampStr(input.recipientEmail || '', 200),
    clampStr(input.recipientName || '', 140),
    sanitizeHttpUrl(input.officialUrl),
    clampStr(input.subject || '', 240),
    clampStr(input.coverLetterPreview || '', 1200),
    clampStr(input.coverLetterFull || input.coverLetterPreview || '', 10_000),
    clampStr(input.cvVersionName || '', 160),
    JSON.stringify((input.attachments || []).slice(0, 5)),
    JSON.stringify((input.attachmentsData || []).slice(0, 3)),
    input.explicitAuthorization ? 1 : 0,
    clampStr(input.authorizationTimestamp, 64),
    input.transmitted ? 1 : 0,
    input.deliveryStatus,
    clampStr(input.providerMessageId || '', 160),
    clampStr(input.errorMessage || '', 500),
    now,
    now
  );
  const row = db.prepare('SELECT * FROM application_submissions WHERE id = ?').get(id) as any;
  return mapApplicationSubmissionRow(row);
}

export function getApplicationSubmissionById(
  submissionId: string,
  userId: string
): ApplicationSubmissionRecord | null {
  const db = getEngineDb();
  const row = db
    .prepare('SELECT * FROM application_submissions WHERE id = ? AND user_id = ?')
    .get(submissionId, userId) as any;
  return row ? mapApplicationSubmissionRow(row) : null;
}

export function listUserApplicationSubmissions(
  userId: string,
  limit = 60
): ApplicationSubmissionRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM application_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Math.min(200, Math.max(1, limit))) as any[];
  return rows.map(mapApplicationSubmissionRow);
}

export function listEmployerReceivedApplications(
  recruiterId: string,
  limit = 60
): ApplicationSubmissionRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare(
      "SELECT * FROM application_submissions WHERE recruiter_id = ? AND channel = 'jobfounds_direct' ORDER BY created_at DESC LIMIT ?"
    )
    .all(recruiterId, Math.min(200, Math.max(1, limit))) as any[];
  return rows.map(mapApplicationSubmissionRow);
}

export function getSubmissionAttachmentForActor(params: {
  submissionId: string;
  actorUid: string;
  attachmentIndex: number;
}): { filename: string; contentType: string; buffer: Buffer } | null {
  const db = getEngineDb();
  const row = db
    .prepare('SELECT user_id, recruiter_id, attachments_data_json FROM application_submissions WHERE id = ?')
    .get(params.submissionId) as any;
  if (!row) return null;
  if (row.user_id !== params.actorUid && row.recruiter_id !== params.actorUid) {
    return null;
  }
  const items = safeJsonParse<Array<{ filename: string; contentType: string; base64Content: string }>>(
    row.attachments_data_json,
    []
  );
  const target = items[params.attachmentIndex];
  if (!target || !target.base64Content) return null;
  return {
    filename: target.filename || 'document',
    contentType: target.contentType || 'application/octet-stream',
    buffer: Buffer.from(target.base64Content, 'base64'),
  };
}

export function respondToEmployerApplication(params: {
  submissionId: string;
  recruiterId: string;
  status: EmployerApplicationStatus;
  replyMessage: string;
}): ApplicationSubmissionRecord | null {
  const db = getEngineDb();
  const existing = db
    .prepare(
      "SELECT * FROM application_submissions WHERE id = ? AND recruiter_id = ? AND channel = 'jobfounds_direct'"
    )
    .get(params.submissionId, params.recruiterId) as any;
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE application_submissions
    SET employer_status = ?,
        employer_reply = ?,
        employer_replied_at = ?,
        updated_at = ?
    WHERE id = ? AND recruiter_id = ?
  `).run(
    params.status,
    clampStr(params.replyMessage, 4000),
    now,
    now,
    params.submissionId,
    params.recruiterId
  );
  const updated = db
    .prepare('SELECT * FROM application_submissions WHERE id = ?')
    .get(params.submissionId) as any;
  return updated ? mapApplicationSubmissionRow(updated) : null;
}

export function confirmPortalSubmission(params: {
  submissionId: string;
  userId: string;
  portalReference?: string;
}): ApplicationSubmissionRecord | null {
  const db = getEngineDb();
  const existing = getApplicationSubmissionById(params.submissionId, params.userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE application_submissions
    SET delivery_status = 'portal_confirmed_by_user',
        transmitted = 1,
        portal_confirmed_at = ?,
        portal_reference = ?,
        updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(now, clampStr(params.portalReference || '', 140), now, params.submissionId, params.userId);
  return getApplicationSubmissionById(params.submissionId, params.userId);
}

// -----------------------------------------------------------------------------
// SQLite Automated Backup & Rotation (Hostinger Production Reliability)
// -----------------------------------------------------------------------------
export interface EngineDbBackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export function getEngineBackupDir(): string {
  return path.join(resolveEngineDataDir(), 'backups');
}

export function listEngineDbBackups(): EngineDbBackupInfo[] {
  const backupDir = getEngineBackupDir();
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.sqlite') && f.startsWith('jobfounds-'))
    .map((filename) => {
      const fullPath = path.join(backupDir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createEngineDbBackup(reason = 'scheduled', keepLatest = 7): EngineDbBackupInfo {
  const db = getEngineDb();
  const backupDir = getEngineBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Non-fatal if another reader holds WAL
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'backup';
  const filename = `jobfounds-${stamp}-${safeReason}.sqlite`;
  const targetPath = path.join(backupDir, filename);
  fs.copyFileSync(getEngineDbPath(), targetPath);

  // Rotate older backups to bound disk usage
  const all = listEngineDbBackups();
  for (const stale of all.slice(Math.max(1, keepLatest))) {
    try {
      fs.unlinkSync(path.join(backupDir, stale.filename));
    } catch {
      // ignore cleanup error
    }
  }
  const stat = fs.statSync(targetPath);
  return {
    filename,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  };
}

// =============================================================================
// AUTHENTICATION ACCOUNTS & 5-DIGIT EMAIL VERIFICATION CODE STORAGE
// =============================================================================

export interface AuthUserRecord {
  uid: string;
  email: string;
  fullName: string;
  passwordHash: string;
  passwordSalt: string;
  emailVerified: boolean;
  verifiedAt: string | null;
  accountRole: 'candidate' | 'recruiter';
  createdAt: string;
  updatedAt: string;
}

export type VerificationCodePurpose = 'verify_email' | 'reset_password';

export interface EmailVerificationCodeRecord {
  id: string;
  userId: string;
  email: string;
  purpose: VerificationCodePurpose;
  codeHash: string;
  codeSalt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  createdAt: string;
}

export interface UserWorkspaceRecord {
  uid: string;
  profile: Record<string, any> | null;
  cvs: Array<Record<string, any>>;
  applications: Array<Record<string, any>>;
  watchlist: Array<Record<string, any>>;
  accountRole: 'candidate' | 'recruiter';
  lang: string;
  discoverable: boolean;
  gdprConsent: boolean;
  companyName: string;
  companyWebsite: string;
  updatedAt: string;
}

function mapAuthUserRow(row: Record<string, any>): AuthUserRecord {
  return {
    uid: String(row.uid),
    email: String(row.email),
    fullName: String(row.full_name || ''),
    passwordHash: String(row.password_hash || ''),
    passwordSalt: String(row.password_salt || ''),
    emailVerified: Boolean(row.email_verified),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    accountRole: row.account_role === 'recruiter' ? 'recruiter' : 'candidate',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVerificationCodeRow(row: Record<string, any>): EmailVerificationCodeRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    email: String(row.email),
    purpose: row.purpose === 'reset_password' ? 'reset_password' : 'verify_email',
    codeHash: String(row.code_hash),
    codeSalt: String(row.code_salt),
    expiresAt: String(row.expires_at),
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 5),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    createdAt: String(row.created_at),
  };
}

export function getAuthUserByEmail(email: string): AuthUserRecord | null {
  const db = getEngineDb();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = db
    .prepare('SELECT * FROM auth_users WHERE email = ? LIMIT 1')
    .get(normalized) as Record<string, any> | undefined;
  return row ? mapAuthUserRow(row) : null;
}

export function getAuthUserByUid(uid: string): AuthUserRecord | null {
  const db = getEngineDb();
  const cleanUid = uid.trim();
  if (!cleanUid) return null;
  const row = db
    .prepare('SELECT * FROM auth_users WHERE uid = ? LIMIT 1')
    .get(cleanUid) as Record<string, any> | undefined;
  return row ? mapAuthUserRow(row) : null;
}

export function createAuthUserRecord(input: {
  email: string;
  fullName: string;
  passwordHash: string;
  passwordSalt: string;
  accountRole?: 'candidate' | 'recruiter';
}): AuthUserRecord {
  const db = getEngineDb();
  const now = new Date().toISOString();
  const uid = `jf_${crypto.randomBytes(12).toString('hex')}`;
  const email = input.email.trim().toLowerCase();
  const fullName = clampStr(input.fullName, 120) || email.split('@')[0];
  const accountRole = input.accountRole === 'recruiter' ? 'recruiter' : 'candidate';

  db.prepare(
    `INSERT INTO auth_users (
      uid, email, full_name, password_hash, password_salt,
      email_verified, verified_at, account_role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
  ).run(uid, email, fullName, input.passwordHash, input.passwordSalt, accountRole, now, now);

  return getAuthUserByUid(uid)!;
}

export function markAuthUserEmailVerified(uid: string): AuthUserRecord | null {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE auth_users SET email_verified = 1, verified_at = ?, updated_at = ? WHERE uid = ?'
  ).run(now, now, uid);
  return getAuthUserByUid(uid);
}

export function updateAuthUserPassword(
  uid: string,
  passwordHash: string,
  passwordSalt: string
): AuthUserRecord | null {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE auth_users
     SET password_hash = ?, password_salt = ?, email_verified = 1,
         verified_at = COALESCE(verified_at, ?), updated_at = ?
     WHERE uid = ?`
  ).run(passwordHash, passwordSalt, now, now, uid);
  return getAuthUserByUid(uid);
}

export function deleteAuthUserByUid(uid: string): void {
  const db = getEngineDb();
  db.prepare('DELETE FROM user_workspace_data WHERE uid = ?').run(uid);
  db.prepare('DELETE FROM auth_users WHERE uid = ?').run(uid);
}

export function createEmailVerificationCodeRecord(input: {
  userId: string;
  email: string;
  purpose?: VerificationCodePurpose;
  codeHash: string;
  codeSalt: string;
  expiresAt: string;
  maxAttempts?: number;
}): EmailVerificationCodeRecord {
  const db = getEngineDb();
  const now = new Date().toISOString();
  const id = `evc_${crypto.randomBytes(10).toString('hex')}`;
  const email = input.email.trim().toLowerCase();
  const purpose: VerificationCodePurpose =
    input.purpose === 'reset_password' ? 'reset_password' : 'verify_email';
  const maxAttempts = Math.max(1, Math.min(10, input.maxAttempts ?? 5));

  // Invalidate any prior unconsumed codes for this user + purpose
  db.prepare(
    'UPDATE email_verification_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL'
  ).run(now, input.userId, purpose);

  db.prepare(
    `INSERT INTO email_verification_codes (
      id, user_id, email, purpose, code_hash, code_salt, expires_at, attempts, max_attempts, consumed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`
  ).run(id, input.userId, email, purpose, input.codeHash, input.codeSalt, input.expiresAt, maxAttempts, now);

  const row = db
    .prepare('SELECT * FROM email_verification_codes WHERE id = ? LIMIT 1')
    .get(id) as Record<string, any>;
  return mapVerificationCodeRow(row);
}

export function getLatestActiveVerificationCode(
  userId: string,
  purpose: VerificationCodePurpose = 'verify_email'
): EmailVerificationCodeRecord | null {
  const db = getEngineDb();
  const row = db
    .prepare(
      `SELECT * FROM email_verification_codes
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, purpose) as Record<string, any> | undefined;
  return row ? mapVerificationCodeRow(row) : null;
}

export function getLatestVerificationCodeAny(
  userId: string,
  purpose: VerificationCodePurpose = 'verify_email'
): EmailVerificationCodeRecord | null {
  const db = getEngineDb();
  const row = db
    .prepare(
      `SELECT * FROM email_verification_codes
       WHERE user_id = ? AND purpose = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, purpose) as Record<string, any> | undefined;
  return row ? mapVerificationCodeRow(row) : null;
}

export function incrementVerificationCodeAttempts(codeId: string): number {
  const db = getEngineDb();
  db.prepare(
    'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?'
  ).run(codeId);
  const row = db
    .prepare('SELECT attempts FROM email_verification_codes WHERE id = ? LIMIT 1')
    .get(codeId) as { attempts?: number } | undefined;
  return Number(row?.attempts || 0);
}

export function consumeVerificationCode(codeId: string): void {
  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?').run(now, codeId);
}

export function getUserWorkspaceData(uid: string): UserWorkspaceRecord | null {
  const db = getEngineDb();
  const cleanUid = uid.trim();
  if (!cleanUid) return null;
  const row = db
    .prepare('SELECT * FROM user_workspace_data WHERE uid = ? LIMIT 1')
    .get(cleanUid) as Record<string, any> | undefined;
  if (!row) return null;
  const parsedProfile = safeJsonParse<Record<string, any> | null>(row.profile_json, null);
  return {
    uid: String(row.uid),
    profile: parsedProfile && Object.keys(parsedProfile).length > 0 ? parsedProfile : null,
    cvs: safeJsonParse<Array<Record<string, any>>>(row.cvs_json, []),
    applications: safeJsonParse<Array<Record<string, any>>>(row.applications_json, []),
    watchlist: safeJsonParse<Array<Record<string, any>>>(row.watchlist_json, []),
    accountRole: row.account_role === 'recruiter' ? 'recruiter' : 'candidate',
    lang: String(row.lang || 'fr'),
    discoverable: Boolean(row.discoverable),
    gdprConsent: row.gdpr_consent !== 0,
    companyName: String(row.company_name || ''),
    companyWebsite: String(row.company_website || ''),
    updatedAt: String(row.updated_at),
  };
}

export function upsertUserWorkspaceData(
  uid: string,
  patch: Partial<{
    profile: Record<string, any> | null;
    cvs: Array<Record<string, any>>;
    applications: Array<Record<string, any>>;
    watchlist: Array<Record<string, any>>;
    accountRole: 'candidate' | 'recruiter';
    lang: string;
    discoverable: boolean;
    gdprConsent: boolean;
    companyName: string;
    companyWebsite: string;
  }>
): UserWorkspaceRecord {
  const db = getEngineDb();
  const existing = getUserWorkspaceData(uid);
  const now = new Date().toISOString();

  const nextProfile = patch.profile !== undefined ? patch.profile : existing?.profile ?? null;
  const nextCvs = Array.isArray(patch.cvs) ? patch.cvs.slice(0, 25) : existing?.cvs ?? [];
  const nextApps = Array.isArray(patch.applications)
    ? patch.applications.slice(0, 200)
    : existing?.applications ?? [];
  const nextWatch = Array.isArray(patch.watchlist)
    ? patch.watchlist.slice(0, 100)
    : existing?.watchlist ?? [];
  const nextRole =
    patch.accountRole === 'recruiter'
      ? 'recruiter'
      : patch.accountRole === 'candidate'
        ? 'candidate'
        : existing?.accountRole ?? 'candidate';
  const allowedLangs = new Set(['fr', 'en', 'es', 'de', 'pt', 'ar']);
  const nextLang =
    typeof patch.lang === 'string' && allowedLangs.has(patch.lang)
      ? patch.lang
      : existing?.lang ?? 'fr';
  const nextDiscoverable =
    typeof patch.discoverable === 'boolean' ? patch.discoverable : existing?.discoverable ?? false;
  const nextGdpr =
    typeof patch.gdprConsent === 'boolean' ? patch.gdprConsent : existing?.gdprConsent ?? true;
  const nextCompName =
    typeof patch.companyName === 'string'
      ? clampStr(patch.companyName, 140)
      : existing?.companyName ?? '';
  const nextCompWeb =
    typeof patch.companyWebsite === 'string'
      ? clampStr(patch.companyWebsite, 300)
      : existing?.companyWebsite ?? '';

  db.prepare(
    `INSERT INTO user_workspace_data (
      uid, profile_json, cvs_json, applications_json, watchlist_json,
      account_role, lang, discoverable, gdpr_consent, company_name, company_website, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      profile_json = excluded.profile_json,
      cvs_json = excluded.cvs_json,
      applications_json = excluded.applications_json,
      watchlist_json = excluded.watchlist_json,
      account_role = excluded.account_role,
      lang = excluded.lang,
      discoverable = excluded.discoverable,
      gdpr_consent = excluded.gdpr_consent,
      company_name = excluded.company_name,
      company_website = excluded.company_website,
      updated_at = excluded.updated_at`
  ).run(
    uid,
    JSON.stringify(nextProfile || {}),
    JSON.stringify(nextCvs),
    JSON.stringify(nextApps),
    JSON.stringify(nextWatch),
    nextRole,
    nextLang,
    nextDiscoverable ? 1 : 0,
    nextGdpr ? 1 : 0,
    nextCompName,
    nextCompWeb,
    now
  );

  // Keep account_role synced on auth_users if present
  db.prepare('UPDATE auth_users SET account_role = ?, updated_at = ? WHERE uid = ?').run(
    nextRole,
    now,
    uid
  );

  return getUserWorkspaceData(uid)!;
}

export function deleteUserWorkspaceData(uid: string): void {
  const db = getEngineDb();
  db.prepare('DELETE FROM user_workspace_data WHERE uid = ?').run(uid);
}


