import { auth } from '../firebase';
import {
  AdminEngineOverview,
  AdminReviewStatus,
  ApplicationAttachmentInput,
  ApplicationDeliveryStatus,
  ApplicationSubmissionChannel,
  ApplicationSubmissionRecord,
  AtsReport,
  BackgroundJobRecord,
  CandidateProfile,
  CandidateSubscriptionRecord,
  CareerChangeRecord,
  CareerJobRecord,
  CompanyIntelligenceReport,
  CompanyRecord,
  CompanySignalRecord,
  ConnectionTestResult,
  ContactConfidenceLevel,
  CrmEmailSyncEvent,
  CvDocument,
  DeployAuthMethod,
  DeployConfigView,
  DeployDashboardState,
  DeployEnvVarItem,
  DeployProtocol,
  DeployRunRecord,
  DomainHealthCheckResult,
  EmployerApplicationStatus,
  GroundingSource,
  HiddenOpportunity,
  HrContactRecord,
  IntelligenceMatchItem,
  InterviewPrepReport,
  InterviewSimFeedback,
  InterviewSimMessage,
  GeocodedPlace,
  GeoReverseResponse,
  GeoSearchResponse,
  JobAvailabilityCheck,
  JobListing,
  Lang,
  NeedClassification,
  NotificationRecord,
  OutreachDraft,
  RecruiterFinderResult,
  ResendDomainDiagnostics,
  SalaryVisaReport,
  SmartMatchReport,
  SourceConfigRecord,
  VerificationReport,
} from '../types';

// Session token for Email/Password verified accounts — held strictly in JS memory (never localStorage)
let inMemoryAppSessionToken: string | null = null;

export function setAppSessionToken(token: string | null): void {
  inMemoryAppSessionToken = token && token.trim() ? token.trim() : null;
}

export function getAppSessionToken(): string | null {
  return inMemoryAppSessionToken;
}

async function resolveBearerToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      if (idToken) return idToken;
    }
  } catch {
    // fallback to in-memory app session token
  }
  return inMemoryAppSessionToken;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await resolveBearerToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export interface AppAuthUser {
  uid: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  accountRole: 'candidate' | 'recruiter';
  isAdmin: boolean;
  provider: 'password' | 'firebase';
}

export function authRegisterWithPassword(payload: {
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string;
  password: string;
  accountRole?: 'candidate' | 'recruiter';
}) {
  return postJson<{
    user: AppAuthUser;
    token: string;
    verificationRequired: boolean;
    emailSent: boolean;
    emailReason: string;
    expiresAt: string;
    cooldownSeconds: number;
  }>('/api/auth/register', payload);
}

export function authLoginWithPassword(payload: { email: string; password: string }) {
  return postJson<{
    user: AppAuthUser;
    token: string;
    verificationRequired: boolean;
    emailSent?: boolean;
    emailReason?: string;
    expiresAt?: string;
  }>('/api/auth/login', payload);
}

export function authVerifyEmailCode(payload: { email: string; code: string }) {
  return postJson<{
    verified: boolean;
    user: AppAuthUser;
    token: string;
    message: string;
  }>('/api/auth/verify-code', payload);
}

export function authResendVerificationCode(payload: { email: string }) {
  return postJson<{
    alreadyVerified?: boolean;
    user?: AppAuthUser;
    token?: string;
    emailSent: boolean;
    emailReason: string;
    expiresAt?: string;
    cooldownSeconds?: number;
  }>('/api/auth/resend-code', payload);
}

export function authForgotPassword(payload: { email: string }) {
  return postJson<{
    emailSent: boolean;
    emailReason: string;
    expiresAt?: string;
    cooldownSeconds?: number;
  }>('/api/auth/forgot-password', payload);
}

export function authResetPassword(payload: {
  email: string;
  code: string;
  newPassword: string;
}) {
  return postJson<{
    reset: boolean;
    user: AppAuthUser;
    token: string;
    message: string;
  }>('/api/auth/reset-password', payload);
}

export function authLogout() {
  return postJson<{ ok: boolean }>('/api/auth/logout', {});
}

export async function authFetchCurrentSession(): Promise<{
  authenticated: boolean;
  blocked?: boolean;
  moderationStatus?: 'rejected' | 'suspended';
  moderationNote?: string;
  error?: string;
  user?: AppAuthUser;
  token?: string;
}> {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: await getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({ authenticated: false }));
    if (res.status === 403 && data?.code === 'ACCOUNT_MODERATED') {
      return {
        authenticated: false,
        blocked: true,
        moderationStatus:
          data.moderationStatus === 'rejected' ? 'rejected' : 'suspended',
        moderationNote: String(data.moderationNote || ''),
        error: String(data.error || ''),
      };
    }
    if (!res.ok) {
      return { authenticated: false };
    }
    return data as { authenticated: boolean; user?: AppAuthUser; token?: string };
  } catch {
    return { authenticated: false };
  }
}

export function syncFirebaseDirectoryProfile(payload: {
  fullName?: string;
  accountRole?: 'candidate' | 'recruiter';
  lang?: string;
  discoverable?: boolean;
  gdprConsent?: boolean;
  companyName?: string;
  companyWebsite?: string;
  profile?: CandidateProfile | null;
  cvs?: CvDocument[];
  applications?: any[];
  watchlist?: any[];
}) {
  return requestJson<{ synced: boolean }>('POST', '/api/account/sync-directory', payload);
}

export interface ServerWorkspaceData {
  uid: string;
  profile: CandidateProfile | null;
  cvs: CvDocument[];
  applications: any[];
  watchlist: any[];
  accountRole: 'candidate' | 'recruiter';
  lang: string;
  discoverable: boolean;
  gdprConsent: boolean;
  companyName: string;
  companyWebsite: string;
  updatedAt: string;
}

export function fetchServerWorkspace() {
  return requestJson<{ workspace: ServerWorkspaceData | null }>('GET', '/api/account/workspace');
}

export function saveServerWorkspace(patch: {
  profile?: CandidateProfile | null;
  cvs?: CvDocument[];
  applications?: any[];
  watchlist?: any[];
  accountRole?: 'candidate' | 'recruiter';
  lang?: string;
  discoverable?: boolean;
  gdprConsent?: boolean;
  companyName?: string;
  companyWebsite?: string;
}) {
  return requestJson<{ workspace: ServerWorkspaceData }>('PUT', '/api/account/workspace', patch);
}

export function deleteServerWorkspace(deleteAccount = false) {
  const qs = deleteAccount ? '?deleteAccount=true' : '';
  return requestJson<{ deleted: boolean }>('DELETE', `/api/account/workspace${qs}`);
}

async function requestJson<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const headers = { ...(await getAuthHeaders()), ...(extraHeaders || {}) };
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || data?.code === 'AUTH_REQUIRED') {
      throw new Error(
        data?.error ||
          'Connexion requise : veuillez vous connecter avec votre compte JOBFOUNDS pour utiliser cette fonctionnalité.'
      );
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>('POST', url, body);
}

export function fetchLiveJobFeeds(params: {
  query?: string;
  country?: string;
  city?: string;
  workMode?: string;
  contractType?: string;
}) {
  return postJson<{
    jobs: JobListing[];
    activeProviders: string[];
    fetchedAt: string;
  }>('/api/jobs/feeds', params);
}

export function fetchCompanyIntelligence(params: {
  companyName: string;
  country?: string;
  lang: Lang;
}) {
  return postJson<CompanyIntelligenceReport>('/api/company/intel', params);
}

export function searchGlobalJobs(params: {
  query: string;
  country: string;
  city: string;
  workMode: string;
  contractType: string;
  experienceLevel: string;
  degree: string;
  skills: string;
  languages: string;
  minSalary: string;
  company: string;
  datePosted: string;
  lang: Lang;
}) {
  return postJson<{
    searchSummary: string;
    jobs: JobListing[];
    groundingSources: GroundingSource[];
  }>('/api/jobs/search', params);
}

export function discoverHiddenOpportunities(params: {
  sector: string;
  country: string;
  city: string;
  roleFocus: string;
  companyQuery: string;
  lang: Lang;
}) {
  return postJson<{
    radarSummary: string;
    opportunities: HiddenOpportunity[];
    groundingSources: GroundingSource[];
  }>('/api/opportunities/discover', params);
}

export function verifyJobOffer(params: {
  companyName: string;
  jobTitle: string;
  jobUrl: string;
  contactEmail: string;
  salaryOffered: string;
  jobText: string;
  lang: Lang;
}) {
  return postJson<VerificationReport>('/api/jobs/verify', params);
}

export function importCvFile(params: {
  fileName: string;
  mimeType: string;
  base64Data: string;
  lang: Lang;
}) {
  return postJson<Partial<CvDocument>>('/api/cv/import-file', params);
}

export function optimizeCv(params: {
  action: 'correct' | 'optimize' | 'tailor' | 'cover_letter' | 'import_parse';
  cvData?: CvDocument;
  rawText?: string;
  targetJob?: string;
  lang: Lang;
}) {
  return postJson<any>('/api/cv/optimize', params);
}

export function analyzeAtsResume(params: {
  cvText: string;
  jobDescription: string;
  lang: Lang;
}) {
  return postJson<AtsReport>('/api/ats/analyze', params);
}

export function evaluateSmartMatch(params: {
  profile: CandidateProfile;
  job: JobListing;
  lang: Lang;
}) {
  return postJson<SmartMatchReport>('/api/match/evaluate', params);
}

export function findRecruiters(params: {
  company: string;
  country: string;
  department: string;
  lang: Lang;
}) {
  return postJson<RecruiterFinderResult>('/api/recruiters/find', params);
}

export function simulateInterviewTurn(params: {
  role: string;
  company: string;
  details: string;
  profile: CandidateProfile;
  history: InterviewSimMessage[];
  userAnswer: string;
  lang: Lang;
}) {
  return postJson<{
    feedback: InterviewSimFeedback | null;
    nextQuestion: string;
    questionCategory: string;
    isComplete: boolean;
    finalSummary: string;
  }>('/api/interview/simulate', params);
}

export function checkWatchlistTarget(params: {
  kind: 'company' | 'search';
  label: string;
  country: string;
  sector: string;
  lang: Lang;
}) {
  return postJson<{
    newSignalsCount: number;
    classification: string;
    summary: string;
    highlights: string[];
    checkedAt: string;
    groundingSources: GroundingSource[];
  }>('/api/watchlist/check', params);
}

export function generateOutreach(params: {
  profile: CandidateProfile;
  opportunity: HiddenOpportunity | JobListing;
  lang: Lang;
}) {
  return postJson<OutreachDraft>('/api/career/assist', {
    mode: 'outreach',
    payload: { profile: params.profile, opportunity: params.opportunity },
    lang: params.lang,
  });
}

export function generateInterviewPrep(params: {
  role: string;
  company: string;
  details: string;
  profile: CandidateProfile;
  lang: Lang;
}) {
  return postJson<InterviewPrepReport>('/api/career/assist', {
    mode: 'interview',
    payload: {
      role: params.role,
      company: params.company,
      details: params.details,
      profile: params.profile,
    },
    lang: params.lang,
  });
}

export function fetchSalaryVisaIntel(params: {
  role: string;
  experienceLevel: string;
  destinationCountry: string;
  destinationCity: string;
  originCountry: string;
  lang: Lang;
}) {
  return postJson<SalaryVisaReport>('/api/career/assist', {
    mode: 'salary_visa',
    payload: params,
    lang: params.lang,
  });
}

// =============================================================================
// GLOBAL RECRUITMENT INTELLIGENCE, CAREER MONITOR, HR CONTACTS & MATCHING APIs
// =============================================================================

export function fetchIntelligenceCompanies(params?: {
  search?: string;
  country?: string;
  sector?: string;
  monitored?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.country) qs.set('country', params.country);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.monitored) qs.set('monitored', 'true');
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return requestJson<{ companies: CompanyRecord[] }>('GET', `/api/intelligence/companies${query}`);
}

export function registerIntelligenceCompany(payload: {
  officialName: string;
  officialWebsite?: string;
  country?: string;
  location?: string;
  sector?: string;
  estimatedSize?: string;
  careersUrl?: string;
  monitored?: boolean;
  monitorIntervalMinutes?: number;
  autoCheckNow?: boolean;
}) {
  return requestJson<{
    company: CompanyRecord;
    created: boolean;
    merged: boolean;
    monitorResult?: any;
  }>('POST', '/api/intelligence/companies', payload);
}

export function fetchIntelligenceCompanyDetail(companyId: string) {
  return requestJson<{
    company: CompanyRecord;
    careerJobs: CareerJobRecord[];
    careerChanges: CareerChangeRecord[];
    signals: CompanySignalRecord[];
    contacts: HrContactRecord[];
  }>('GET', `/api/intelligence/companies/${encodeURIComponent(companyId)}`);
}

export function updateIntelligenceCompany(
  companyId: string,
  payload: Partial<{
    officialName: string;
    officialWebsite: string;
    careersUrl: string;
    country: string;
    location: string;
    sector: string;
    estimatedSize: string;
    monitored: boolean;
    monitorIntervalMinutes: number;
    verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  }>
) {
  return requestJson<{ company: CompanyRecord }>(
    'PATCH',
    `/api/intelligence/companies/${encodeURIComponent(companyId)}`,
    payload
  );
}

export function triggerCareerPageMonitor(companyId: string, mode: 'sync' | 'queue' = 'sync') {
  return requestJson<{ result?: any; queued?: boolean; job?: BackgroundJobRecord }>(
    'POST',
    `/api/intelligence/companies/${encodeURIComponent(companyId)}/monitor-career`,
    { mode }
  );
}

export function triggerCompanySignalScan(companyId: string, mode: 'sync' | 'queue' = 'sync') {
  return requestJson<{ result?: any; queued?: boolean; job?: BackgroundJobRecord }>(
    'POST',
    `/api/intelligence/companies/${encodeURIComponent(companyId)}/scan-signals`,
    { mode }
  );
}

export function triggerHrContactDiscovery(
  companyId: string,
  department = '',
  mode: 'sync' | 'queue' = 'sync'
) {
  return requestJson<{ result?: any; queued?: boolean; job?: BackgroundJobRecord }>(
    'POST',
    `/api/intelligence/companies/${encodeURIComponent(companyId)}/discover-contacts`,
    { department, mode }
  );
}

export function fetchIntelligenceSignals(companyId?: string) {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return requestJson<{ signals: CompanySignalRecord[] }>('GET', `/api/intelligence/signals${qs}`);
}

export function fetchIntelligenceContacts(companyId?: string) {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return requestJson<{ contacts: HrContactRecord[] }>('GET', `/api/intelligence/contacts${qs}`);
}

export function fetchIntelligenceCareerJobs(limit = 120) {
  return requestJson<{ jobs: CareerJobRecord[] }>(
    'GET',
    `/api/intelligence/career-jobs?limit=${limit}`
  );
}

export function computeIntelligenceMatches(profile: Partial<CandidateProfile>) {
  return requestJson<{
    matches: IntelligenceMatchItem[];
    counts: {
      total: number;
      confirmedJobs: number;
      confirmedNeeds: number;
      probableSignals: number;
      potentialOpportunities: number;
    };
    evaluatedAt: string;
  }>('POST', '/api/intelligence/match', { profile });
}

// =============================================================================
// PERSONALIZED CANDIDATE NOTIFICATIONS & OFFLINE PREFERENCES
// =============================================================================

export function fetchUserNotifications() {
  return requestJson<{
    notifications: NotificationRecord[];
    unreadCount: number;
    subscription: CandidateSubscriptionRecord | null;
    emailDeliveryAvailable: boolean;
  }>('GET', '/api/notifications');
}

export function saveNotificationPreferences(payload: {
  profile: Record<string, any>;
  preferredCountries: string[];
  preferredSectors: string[];
  frequency: 'instant' | 'daily' | 'weekly';
  channels: { inApp: boolean; email: boolean; push: boolean };
  enabled: boolean;
}) {
  return requestJson<{ subscription: CandidateSubscriptionRecord }>(
    'PUT',
    '/api/notifications/preferences',
    payload
  );
}

export function markUserNotificationRead(id?: string) {
  return requestJson<{ updated: number }>('POST', '/api/notifications/read', { id });
}

export function runCandidateNotificationMatchNow(payload?: {
  profile?: Record<string, any>;
  preferredCountries?: string[];
  preferredSectors?: string[];
}) {
  return requestJson<{
    created: number;
    emailSent: boolean;
    notifications: NotificationRecord[];
  }>('POST', '/api/notifications/run-match', payload ?? {});
}

// =============================================================================
// ADMIN ENGINE CONTROL, SOURCE GOVERNANCE & AUDIT LOGS
// =============================================================================

export function fetchAdminEngineOverview() {
  return requestJson<AdminEngineOverview>('GET', '/api/admin/overview');
}

export function adminToggleSource(sourceId: string, enabled: boolean) {
  return requestJson<{ source: SourceConfigRecord }>(
    'POST',
    `/api/admin/sources/${encodeURIComponent(sourceId)}/toggle`,
    { enabled }
  );
}

export function adminReviewSignal(
  signalId: string,
  payload: {
    adminStatus: AdminReviewStatus;
    adminNote?: string;
    classification?: NeedClassification;
  }
) {
  return requestJson<{ signal: CompanySignalRecord }>(
    'POST',
    `/api/admin/signals/${encodeURIComponent(signalId)}/review`,
    payload
  );
}

export function adminReviewContact(
  contactId: string,
  payload: {
    adminStatus: AdminReviewStatus;
    confidenceLevel?: ContactConfidenceLevel;
  }
) {
  return requestJson<{ contact: HrContactRecord }>(
    'POST',
    `/api/admin/contacts/${encodeURIComponent(contactId)}/review`,
    payload
  );
}

export function adminMergeCompanies(sourceId: string, targetId: string) {
  return requestJson<{ company: CompanyRecord }>('POST', '/api/admin/companies/merge', {
    sourceId,
    targetId,
  });
}

export function adminEnqueueBackgroundJob(payload: {
  jobType: BackgroundJobRecord['jobType'];
  companyId?: string;
  department?: string;
}) {
  return requestJson<{ job: BackgroundJobRecord; deduplicated: boolean }>(
    'POST',
    '/api/admin/jobs/enqueue',
    payload
  );
}

export function adminRetryBackgroundJob(jobId: string) {
  return requestJson<{ job: BackgroundJobRecord }>(
    'POST',
    `/api/admin/jobs/${encodeURIComponent(jobId)}/retry`
  );
}

export function adminRunWorkerTickNow() {
  return requestJson<{
    summary: { scheduledRecurring: number; processed: number; succeeded: number; failed: number };
  }>('POST', '/api/admin/worker/tick');
}

export function adminSendTestEmail(to?: string) {
  return requestJson<{
    recipient: string;
    emailSent: boolean;
    emailReason: string;
    messageId?: string;
    config: {
      resendKeyConfigured: boolean;
      fromEmailConfigured: boolean;
      fromEmail: string;
      ready: boolean;
    };
  }>('POST', '/api/admin/email/test', to ? { to } : {});
}

export function adminScanAllCareers() {
  return requestJson<{
    scannedCount: number;
    results: Array<{
      companyId: string;
      companyName: string;
      atsProvider: string;
      activeCount: number;
      addedCount: number;
      removedCount: number;
      error?: string;
    }>;
  }>('POST', '/api/admin/companies/scan-all-careers', {});
}

// =============================================================================
// ADMIN ONLY: PLATFORM USERS, FULL DOSSIERS, ADMIN ROLE MANAGEMENT & SUBMISSIONS
// =============================================================================

export type UserModerationStatus = 'approved' | 'pending' | 'rejected' | 'suspended';

export interface AdminPlatformUserSummary {
  uid: string;
  email: string;
  fullName: string;
  provider: 'password' | 'firebase';
  emailVerified: boolean;
  verifiedAt: string | null;
  accountRole: 'candidate' | 'recruiter';
  isAdmin: boolean;
  moderationStatus: UserModerationStatus;
  moderationNote: string;
  moderatedBy: string;
  moderatedAt: string | null;
  lang: string;
  discoverable: boolean;
  gdprConsent: boolean;
  companyName: string;
  companyWebsite: string;
  currentTitle: string;
  originCountry: string;
  preferredCountries: string[];
  skills: string[];
  languages: string[];
  cvsCount: number;
  trackedAppsCount: number;
  watchlistCount: number;
  submittedAppsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRoleRecord {
  email: string;
  grantedBy: string;
  note: string;
  createdAt: string;
  source: 'bootstrap' | 'env' | 'database';
  removable: boolean;
}

export interface AdminSubmissionView {
  id: string;
  userId: string;
  candidateName: string;
  candidateEmail: string;
  companyName: string;
  roleTitle: string;
  opportunityType: string;
  channel: string;
  recipientEmail: string;
  officialUrl: string;
  deliveryStatus: string;
  transmitted: boolean;
  employerStatus: string;
  attachmentsCount: number;
  adminModerationStatus: 'pending' | 'approved' | 'rejected';
  adminModerationNote: string;
  adminModeratedBy: string;
  adminModeratedAt: string | null;
  createdAt: string;
}

export interface AdminUserDossier {
  summary: AdminPlatformUserSummary;
  profile: Record<string, any> | null;
  cvs: Array<{
    id: string;
    versionName: string;
    fullName: string;
    headline: string;
    location: string;
    skillsCount: number;
    updatedAt: string;
  }>;
  trackedApplications: Array<{
    id: string;
    company: string;
    role: string;
    stage: string;
    type: string;
    dateAdded: string;
  }>;
  submittedApplications: AdminSubmissionView[];
  notificationsCount: number;
}

export function fetchAdminPlatformUsers(search = '') {
  const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return requestJson<{
    users: AdminPlatformUserSummary[];
    admins: AdminRoleRecord[];
  }>('GET', `/api/admin/users${qs}`);
}

export function fetchAdminUserDossier(uid: string) {
  return requestJson<{ dossier: AdminUserDossier }>(
    'GET',
    `/api/admin/users/${encodeURIComponent(uid)}`
  );
}

export function adminModerateUser(
  uid: string,
  payload: {
    email?: string;
    moderationStatus?: UserModerationStatus;
    moderationNote?: string;
    emailVerified?: boolean;
    accountRole?: 'candidate' | 'recruiter';
    isAdmin?: boolean;
  }
) {
  return requestJson<{ user: AppAuthUser }>(
    'POST',
    `/api/admin/users/${encodeURIComponent(uid)}/moderate`,
    payload
  );
}

export function adminGrantAdminRole(email: string, note = '') {
  return requestJson<{
    grant: AdminRoleRecord;
    admins: AdminRoleRecord[];
    message: string;
  }>('POST', '/api/admin/admins/grant', { email, note });
}

export function adminRevokeAdminRole(email: string) {
  return requestJson<{
    revoked: boolean;
    admins: AdminRoleRecord[];
  }>('POST', '/api/admin/admins/revoke', { email });
}

export function fetchAdminSubmissions(limit = 120) {
  return requestJson<{ submissions: AdminSubmissionView[] }>(
    'GET',
    `/api/admin/applications?limit=${limit}`
  );
}

export function adminModerateSubmission(
  submissionId: string,
  payload: { status: 'pending' | 'approved' | 'rejected'; note?: string }
) {
  return requestJson<{ submission: AdminSubmissionView }>(
    'POST',
    `/api/admin/applications/${encodeURIComponent(submissionId)}/moderate`,
    payload
  );
}

// =============================================================================
// MULTI-COUNTRY COMPANY DISCOVERY (MODULE 1) & GMAIL CRM SYNC (MODULE 7)
// =============================================================================

export function discoverMultiCountryCompanies(payload: {
  countries: string[];
  sector?: string;
  keywords?: string;
  lang?: Lang;
}) {
  return requestJson<{
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
  }>('POST', '/api/intelligence/discover-companies', payload);
}

export function syncGmailCrmReplies(
  gmailAccessToken: string,
  applications: Array<{
    id: string;
    company: string;
    role: string;
    stage?: string;
    contactName?: string;
    contactChannel?: string;
  }>
) {
  return requestJson<{
    syncedAt: string;
    scannedMessages: number;
    matchedReplies: Array<
      Omit<CrmEmailSyncEvent, 'id' | 'syncedAt'> & { isNew: boolean }
    >;
  }>(
    'POST',
    '/api/crm/gmail-sync',
    { applications },
    { 'X-Gmail-Access-Token': gmailAccessToken }
  );
}

export function fetchCrmEmailSyncHistory(limit = 40) {
  return requestJson<{ events: CrmEmailSyncEvent[] }>(
    'GET',
    `/api/crm/email-sync-history?limit=${limit}`
  );
}

// =============================================================================
// REAL LIVE JOB AVAILABILITY & APPLICATION SUBMISSION ENGINE
// =============================================================================

export function checkJobAvailability(url: string) {
  return requestJson<{ result: JobAvailabilityCheck }>('POST', '/api/jobs/check-availability', {
    url,
  });
}

export function submitRealApplication(payload: {
  applicationId?: string;
  companyId?: string;
  recruiterId?: string;
  companyName: string;
  roleTitle: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  classification?: NeedClassification | '';
  channel: ApplicationSubmissionChannel;
  recipientEmail?: string;
  recipientName?: string;
  officialUrl?: string;
  subject: string;
  coverLetter: string;
  cvVersionName?: string;
  candidateName?: string;
  attachments?: ApplicationAttachmentInput[];
  explicitAuthorization: true;
}) {
  return requestJson<{
    submission: ApplicationSubmissionRecord;
    transmitted: boolean;
    deliveryStatus: ApplicationDeliveryStatus;
    message: string;
    nextStepUrl?: string;
    mxVerified?: boolean;
    availabilityCheck?: JobAvailabilityCheck | null;
  }>('POST', '/api/applications/submit', payload);
}

export function fetchApplicationSubmissions(limit = 60) {
  return requestJson<{
    submissions: ApplicationSubmissionRecord[];
    emailRelayReady: boolean;
  }>('GET', `/api/applications/submissions?limit=${limit}`);
}

export function confirmPortalApplicationSubmission(submissionId: string, portalReference = '') {
  return requestJson<{ submission: ApplicationSubmissionRecord }>(
    'POST',
    `/api/applications/submissions/${encodeURIComponent(submissionId)}/confirm-portal`,
    { portalReference }
  );
}

export function fetchEmployerApplications(limit = 60) {
  return requestJson<{ applications: ApplicationSubmissionRecord[] }>(
    'GET',
    `/api/employer/applications?limit=${limit}`
  );
}

export function respondToEmployerApplicationApi(
  submissionId: string,
  payload: { status: EmployerApplicationStatus; replyMessage: string }
) {
  return requestJson<{ submission: ApplicationSubmissionRecord }>(
    'POST',
    `/api/employer/applications/${encodeURIComponent(submissionId)}/respond`,
    payload
  );
}

export async function downloadSubmissionAttachment(
  submissionId: string,
  index: number,
  fallbackFilename = 'document'
): Promise<void> {
  const token = (await resolveBearerToken()) || '';
  const res = await fetch(
    `/api/employer/applications/${encodeURIComponent(submissionId)}/attachments/${index}`,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Téléchargement refusé (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fetchEmailDeliveryStatus() {
  return requestJson<{ diagnostics: ResendDomainDiagnostics }>('GET', '/api/email/status');
}

// =============================================================================
// OPENSTREETMAP & NOMINATIM FREE GEOCODING CLIENT HELPERS
// =============================================================================

export function searchGeoPlaces(params: {
  q?: string;
  city?: string;
  country?: string;
  lang?: Lang;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.city) qs.set('city', params.city);
  if (params.country) qs.set('country', params.country);
  if (params.lang) qs.set('lang', params.lang);
  if (params.limit) qs.set('limit', String(params.limit));
  return requestJson<GeoSearchResponse>('GET', `/api/geo/search?${qs.toString()}`);
}

export function reverseGeoPlace(lat: number, lon: number, lang: Lang = 'fr') {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    lang,
  });
  return requestJson<GeoReverseResponse>('GET', `/api/geo/reverse?${qs.toString()}`);
}

export function resolveGeoBatch(labels: string[], lang: Lang = 'fr') {
  return postJson<{ resolved: Record<string, GeocodedPlace> }>('/api/geo/resolve-batch', {
    labels,
    lang,
  });
}

// =============================================================================
// ADMIN ONLY: HOSTINGER PRODUCTION DEPLOYMENT CENTER API HELPERS
// =============================================================================

export function fetchAdminDeployState() {
  return requestJson<DeployDashboardState>('GET', '/api/admin/deploy/state');
}

export function saveAdminDeployConfig(payload: {
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  domain: string;
  environment: 'production' | 'staging';
  nodeVersion: string;
  authMethod: DeployAuthMethod;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  clearSshKey?: boolean;
}) {
  return requestJson<{ config: DeployConfigView; state: DeployDashboardState }>(
    'PUT',
    '/api/admin/deploy/config',
    payload
  );
}

export function saveAdminDeployEnv(
  entries: Array<{ key: string; value?: string; clear?: boolean }>
) {
  return requestJson<{ envVars: DeployEnvVarItem[]; state: DeployDashboardState }>(
    'PUT',
    '/api/admin/deploy/env',
    { entries }
  );
}

export function testAdminHostingerConnection(oneTimePassword?: string) {
  return requestJson<{ result: ConnectionTestResult; state: DeployDashboardState }>(
    'POST',
    '/api/admin/deploy/test-connection',
    oneTimePassword ? { oneTimePassword } : {}
  );
}

export function checkAdminLiveDomain(domain?: string) {
  return requestJson<{ result: DomainHealthCheckResult }>(
    'POST',
    '/api/admin/deploy/check-domain',
    domain ? { domain } : {}
  );
}

export function triggerAdminHostingerDeploy(oneTimePassword?: string) {
  return requestJson<{ run: DeployRunRecord }>(
    'POST',
    '/api/admin/deploy/run',
    oneTimePassword ? { oneTimePassword } : {}
  );
}

export function fetchAdminDeployRun(runId: string) {
  return requestJson<{ run: DeployRunRecord }>(
    'GET',
    `/api/admin/deploy/runs/${encodeURIComponent(runId)}`
  );
}

export async function downloadAdminDeployBundle(): Promise<void> {
  const token = (await resolveBearerToken()) || '';
  const res = await fetch('/api/admin/deploy/package', {
    method: 'GET',
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Téléchargement échoué (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || 'jobfounds-release.tar.gz';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// DIRECT EMPLOYER JOB POSTINGS (EMAIL/PASSWORD + GOOGLE ACCOUNTS)
// =============================================================================
export function fetchServerEmployerJobs(limit = 100) {
  return requestJson<{ jobs: import('../types').CompanyJobDoc[] }>(
    'GET',
    `/api/employer/jobs?limit=${limit}`
  );
}

export function createServerEmployerJob(payload: {
  companyName: string;
  companyWebsite?: string;
  title: string;
  country?: string;
  city?: string;
  workMode?: import('../types').WorkMode;
  contractType?: import('../types').ContractType;
  experienceLevel?: string;
  degreeRequired?: string;
  salaryRange?: string;
  skills?: string[];
  languages?: string[];
  description: string;
  visaSponsorship?: string;
}) {
  return requestJson<{ job: import('../types').CompanyJobDoc }>(
    'POST',
    '/api/employer/jobs',
    payload
  );
}

export function closeServerEmployerJob(jobId: string) {
  return requestJson<{ ok: boolean; id: string }>(
    'POST',
    `/api/employer/jobs/${encodeURIComponent(jobId)}/close`,
    {}
  );
}


