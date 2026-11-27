export type Lang = 'fr' | 'en' | 'es' | 'de' | 'pt' | 'ar';

export type AccountRole = 'candidate' | 'recruiter';

export type WorkspaceTab =
  | 'home'
  | 'jobs'
  | 'companies'
  | 'hidden'
  | 'verify'
  | 'cv'
  | 'ats'
  | 'matching'
  | 'career'
  | 'recruiters'
  | 'watchlist'
  | 'account'
  | 'admin';

export type JobFeedSource = 'all' | 'live_feeds' | 'ai_search' | 'employer_portal';

export interface CompanyIntelligenceReport {
  companyName: string;
  officialWebsite: string;
  headquarters: string;
  sector: string;
  estimatedSize: string;
  overview: string;
  hiringVelocity: 'High' | 'Moderate' | 'Selective';
  growthSignals: string[];
  typicalRolesHired: string[];
  careersPortalUrl: string;
  verificationNote: string;
  groundingSources?: GroundingSource[];
}

export type VerificationStatus =
  | 'Verified'
  | 'Partially Verified'
  | 'Unverified'
  | 'Suspicious'
  | 'Expired';

export type OpportunityClassification =
  | 'Confirmed Job'
  | 'Active Hiring Signal'
  | 'Potential Hiring Opportunity';

export type WorkMode = 'Remote' | 'Hybrid' | 'On-site';
export type ContractType =
  | 'Full-time'
  | 'Part-time'
  | 'Contract'
  | 'Internship'
  | 'Freelance';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  country: string;
  city: string;
  workMode: WorkMode;
  contractType: ContractType;
  experienceLevel: string;
  degreeRequired: string;
  salaryRange: string;
  salaryMinAnnualUsd?: number;
  languages: string[];
  skills: string[];
  publishedDate: string;
  applicationDeadline?: string;
  companyId?: string;
  sourceName: string;
  sourceUrl: string;
  verificationStatus: VerificationStatus;
  verificationSummary: string;
  description: string;
  recruiterHint?: string;
  visaSponsorship?: string;
  recruiterId?: string;
  isEmployerDirect?: boolean;
}

export interface JobAvailabilityCheck {
  url: string;
  finalUrl: string;
  available: boolean;
  status: 'available' | 'expired' | 'unreachable' | 'unverifiable';
  httpStatus: number | null;
  applicationDeadline: string;
  warnings: string[];
  checkedAt: string;
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

export interface ApplicationAttachmentInput {
  filename: string;
  contentType: string;
  base64Content: string;
  sizeBytes?: number;
}

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
  recruiterId?: string;
  candidateName?: string;
  candidateEmail?: string;
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
  coverLetterFull?: string;
  cvVersionName: string;
  attachments: Array<{ filename: string; contentType: string; sizeBytes: number }>;
  explicitAuthorization: boolean;
  authorizationTimestamp: string;
  transmitted: boolean;
  deliveryStatus: ApplicationDeliveryStatus;
  providerMessageId: string;
  portalConfirmedAt: string | null;
  portalReference: string;
  employerStatus?: EmployerApplicationStatus;
  employerReply?: string;
  employerRepliedAt?: string | null;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResendDomainDiagnostics {
  apiKeyConfigured: boolean;
  fromEmailConfigured: boolean;
  fromEmail: string;
  senderDomain: string;
  ready: boolean;
  dnsSpfDetected: boolean;
  dnsDmarcDetected: boolean;
  resendDomainStatus: 'verified' | 'pending' | 'not_found' | 'unconfigured' | 'check_failed';
  notes: string[];
}

export interface HiddenOpportunity {
  id: string;
  company: string;
  country: string;
  location: string;
  sector: string;
  classification: OpportunityClassification;
  potentialRoles: string[];
  detectionReason: string;
  signalEvidence: string;
  sourceName: string;
  sourceUrl: string;
  detectedDate: string;
  confidenceScore: number;
  confidenceJustification: string;
  professionalContact: {
    nameOrDepartment: string;
    channel: string;
    url: string;
  };
  spontaneousOutreachAngle: string;
}

export interface VerificationCheck {
  criterion: string;
  result: 'Pass' | 'Warning' | 'Fail' | 'Insufficient Data';
  detail: string;
}

export interface VerificationReport {
  status: VerificationStatus;
  trustScore: number;
  verdictHeadline: string;
  verdictExplanation: string;
  officialWebsite: string;
  officialDomain: string;
  liveUrlFindings?: string;
  urlInspected?: boolean;
  checks: VerificationCheck[];
  greenFlags: string[];
  redFlags: string[];
  recommendedNextSteps: string[];
  groundingSources?: GroundingSource[];
  checkedAt?: string;
}

export interface CvExperience {
  id: string;
  role: string;
  company: string;
  location: string;
  period: string;
  highlights: string[];
}

export interface CvEducation {
  id: string;
  degree: string;
  institution: string;
  year: string;
}

export type CvTemplateId = 'executive' | 'structured' | 'international';

export interface CvDocument {
  id: string;
  versionName: string;
  updatedAt: string;
  template: CvTemplateId;
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  summary: string;
  experiences: CvExperience[];
  education: CvEducation[];
  skills: string[];
  languages: string[];
}

export interface AtsReport {
  overallScore: number;
  keywordMatchScore: number;
  skillsScore: number;
  structureScore: number;
  experienceAlignmentScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  matchedSkills: string[];
  missingSkills: string[];
  missingInformation: string[];
  structureAudit: Array<{
    section: string;
    status: string;
    feedback: string;
  }>;
  recommendations: Array<{
    priority: string;
    title: string;
    detail: string;
  }>;
  detailedReport: string;
}

export interface CandidateProfile {
  fullName: string;
  currentTitle: string;
  yearsExperience: number;
  highestDegree: string;
  skills: string[];
  languages: string[];
  preferredCountries: string[];
  preferredCities: string[];
  minSalaryAnnualUsd: number;
  salaryCurrency: string;
  availability: string;
  preferredWorkModes: WorkMode[];
  preferredContracts: ContractType[];
  originCountry: string;
  workAuthorization?: string;
  relocationReady?: boolean;
  targetSectors?: string[];
}

export interface SmartMatchReport {
  overallScore: number;
  summary: string;
  advisoryNotice: string;
  dimensions: Array<{
    name: string;
    score: number;
    explanation: string;
  }>;
  strengths: string[];
  gapsToAddress: string[];
}

export type ApplicationStage =
  | 'Opportunity Identified'
  | 'Application Prepared'
  | 'Awaiting Authorization'
  | 'Application Sent'
  | 'Message Received'
  | 'Under Review'
  | 'Interview Scheduled'
  | 'Offer Received'
  | 'Rejected'
  | 'Completed'
  // Legacy compatibility stages
  | 'To Prepare'
  | 'Applied'
  | 'Spontaneous Sent'
  | 'Interviewing'
  | 'Offer'
  | 'Archived';

export interface TrackedApplication {
  id: string;
  role: string;
  company: string;
  companyId?: string;
  location: string;
  type: 'Confirmed Job' | 'Spontaneous';
  stage: ApplicationStage;
  dateAdded: string;
  sentDate?: string;
  followUpDate?: string;
  interviewDate?: string;
  sourceUrl?: string;
  salaryRange?: string;
  contactName?: string;
  contactRole?: string;
  contactChannel?: string;
  cvVersionId?: string;
  cvVersionName?: string;
  coverLetterUsed?: string;
  responseReceived?: boolean;
  responseSummary?: string;
  responseSource?: 'none' | 'manual_log' | 'in_app_message' | 'gmail_sync';
  nextAction?: string;
  approvalStatus?: 'not_required' | 'pending_user_approval' | 'approved_by_user';
  followUpCount?: number;
  lastFollowUpAt?: string;
  submissionId?: string;
  deliveryStatus?: ApplicationDeliveryStatus;
  deliveryChannel?: ApplicationSubmissionChannel;
  providerMessageId?: string;
  attachmentNames?: string[];
  notes: string;
}

export interface CrmEmailSyncEvent {
  id: string;
  applicationId: string;
  company: string;
  gmailMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  detectedStage: ApplicationStage;
  confidence: 'high' | 'medium';
  reason: string;
  receivedAt: string;
  syncedAt: string;
}

export interface WatchlistItem {
  id: string;
  kind: 'company' | 'search';
  label: string;
  country: string;
  sector: string;
  lastChecked: string;
  lastSignalSummary: string;
  unreadAlerts: number;
}

export interface PublicCandidateDoc {
  userId: string;
  displayName: string;
  headline: string;
  yearsExperience: number;
  highestDegree?: string;
  skills?: string[];
  languages?: string[];
  preferredCountries?: string[];
  preferredWorkModes?: string[];
  availability?: string;
  isOpenToRecruiters: boolean;
}

export interface CompanyJobDoc {
  id: string;
  recruiterId: string;
  companyName: string;
  companyWebsite?: string;
  title: string;
  country: string;
  city: string;
  workMode: WorkMode;
  contractType: ContractType;
  experienceLevel?: string;
  degreeRequired?: string;
  salaryRange?: string;
  skills?: string[];
  languages?: string[];
  description: string;
  visaSponsorship?: string;
  verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  status: 'open' | 'closed';
}

export interface ConversationDoc {
  id: string;
  candidateId: string;
  recruiterId: string;
  candidateName: string;
  recruiterName: string;
  companyName: string;
  jobTitle: string;
  lastMessage?: string;
  status: 'active' | 'archived';
}

export interface MessageDoc {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  body: string;
  createdAt?: any;
}

export interface RecruiterFinderResult {
  companyOverview: string;
  officialDomain: string;
  careersPortalUrl: string;
  emailDomainStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  domainMxVerified?: boolean;
  mxHosts?: string[];
  contacts: Array<{
    nameOrTitle: string;
    role: string;
    location: string;
    channel: string;
    corporateEmail?: string;
    publicUrl: string;
    confidenceLevel?: ContactConfidenceLevel;
    domainMxVerified?: boolean;
    verificationNote: string;
    outreachTip: string;
  }>;
  groundingSources?: GroundingSource[];
}

export interface InterviewSimFeedback {
  overallScore: number;
  clarity: number;
  starStructure: number;
  relevance: number;
  strength: string;
  improvement: string;
}

export interface InterviewSimMessage {
  speaker: 'interviewer' | 'candidate';
  text: string;
  category?: string;
  feedback?: InterviewSimFeedback | null;
}

export interface OutreachDraft {
  emailSubject: string;
  emailBody: string;
  linkedinNote: string;
  followUpTip: string;
}

export interface InterviewPrepReport {
  roleBrief: string;
  questions: Array<{
    category: string;
    question: string;
    whyAsked: string;
    starGuidance: string;
  }>;
  questionsForRecruiter: string[];
  preparationChecklist: string[];
}

export interface SalaryVisaReport {
  currency: string;
  salaryBands: {
    p25: string;
    median: string;
    p75: string;
    executive: string;
  };
  marketContext: string;
  visaPathways: Array<{
    name: string;
    eligibility: string;
    typicalTimeline: string;
    employerSponsorshipRequired: boolean;
  }>;
  practicalAdvice: string[];
  disclaimer: string;
  groundingSources?: GroundingSource[];
}

// =============================================================================
// GLOBAL RECRUITMENT INTELLIGENCE & AUTOMATION ENGINE TYPES
// =============================================================================
export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'smartrecruiters'
  | 'jsonld_html'
  | 'none';

export type NeedClassification =
  | 'confirmed_job'
  | 'confirmed_hiring_need'
  | 'probable_hiring_signal'
  | 'potential_opportunity';

export type SignalType =
  | 'expansion'
  | 'new_office'
  | 'new_contract'
  | 'new_department'
  | 'frequent_hiring'
  | 'growth_announcement'
  | 'skill_demand'
  | 'career_page_surge';

export type ContactConfidenceLevel = 'confirmed' | 'probable' | 'unverified';
export type AdminReviewStatus = 'pending' | 'verified' | 'rejected';

export interface CompanyRecord {
  id: string;
  canonicalName: string;
  officialName: string;
  officialDomain: string;
  officialWebsite: string;
  country: string;
  location: string;
  sector: string;
  estimatedSize: string;
  careersUrl: string;
  atsProvider: AtsProvider;
  atsBoardToken: string;
  frequentSkills: string[];
  monitored: boolean;
  monitorIntervalMinutes: number;
  lastMonitoredAt: string | null;
  lastVerifiedAt: string | null;
  verificationStatus: 'Verified' | 'Partially Verified' | 'Unverified';
  sourceNames: string[];
  activeJobsCount: number;
  signalsCount: number;
  contactsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySignalRecord {
  id: string;
  companyId: string;
  companyName?: string;
  signalType: SignalType;
  classification: NeedClassification;
  title: string;
  summary: string;
  evidenceText: string;
  sourceName: string;
  sourceUrl: string;
  detectedDate: string;
  reliabilityScore: number;
  relevanceScore: number;
  inferredRoles: string[];
  inferredSkills: string[];
  adminStatus: AdminReviewStatus;
  adminNote: string;
  createdAt: string;
}

export interface CareerJobRecord {
  id: string;
  companyId: string;
  companyName?: string;
  externalJobId: string;
  title: string;
  department: string;
  location: string;
  country: string;
  workMode: string;
  contractType: string;
  skills: string[];
  salaryRange: string;
  applyUrl: string;
  applicationDeadline?: string;
  status: 'active' | 'expired';
  firstSeenAt: string;
  lastSeenAt: string;
  expiredAt: string | null;
}

export interface CareerChangeRecord {
  id: string;
  companyId: string;
  jobId: string;
  changeType: 'added' | 'modified' | 'removed';
  jobTitle: string;
  details: string;
  detectedAt: string;
}

export interface HrContactRecord {
  id: string;
  companyId: string;
  companyName?: string;
  fullName: string;
  roleTitle: string;
  department: string;
  location: string;
  contactChannel: string;
  publicUrl: string;
  corporateEmail: string;
  domainMxVerified: boolean;
  confidenceLevel: ContactConfidenceLevel;
  sourceName: string;
  sourceUrl: string;
  verifiedAt: string | null;
  adminStatus: AdminReviewStatus;
  createdAt: string;
}

export interface IntelligenceMatchItem {
  id: string;
  companyId: string;
  companyName: string;
  country: string;
  location: string;
  sector: string;
  classification: NeedClassification;
  title: string;
  summary: string;
  overallScore: number;
  breakdown: {
    skills: number;
    experience: number;
    education?: number;
    languages: number;
    locationAndMobility: number;
    workAuthorization?: number;
    availability?: number;
    salary?: number;
    sectorAndRole: number;
    signalReliability?: number;
  };
  matchedSkills: string[];
  missingSkills: string[];
  proofs: Array<{ label: string; url: string; date: string }>;
  explanation: string;
  recommendedContact?: {
    fullName: string;
    roleTitle: string;
    channel: string;
    publicUrl: string;
    corporateEmail?: string;
    confidenceLevel: ContactConfidenceLevel;
  } | null;
  applyUrl: string;
}

export type NotificationType =
  | 'new_matching_job'
  | 'company_hiring_signal'
  | 'unpublished_opportunity'
  | 'new_hr_contact'
  | 'profile_match'
  | 'spontaneous_invite'
  | 'application_update';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  companyId: string;
  companyName: string;
  classification: NeedClassification | '';
  actionUrl: string;
  channelInApp: boolean;
  channelEmailSent: boolean;
  read: boolean;
  createdAt: string;
}

export interface CandidateSubscriptionRecord {
  uid: string;
  email: string;
  profile: Record<string, any>;
  preferredCountries: string[];
  preferredSectors: string[];
  frequency: 'instant' | 'daily' | 'weekly';
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
  };
  enabled: boolean;
  lastMatchedAt: string | null;
  updatedAt: string;
}

export interface BackgroundJobRecord {
  id: string;
  jobType:
    | 'monitor_career_page'
    | 'scan_company_signals'
    | 'discover_hr_contacts'
    | 'evaluate_candidate_matches'
    | 'dispatch_notifications';
  status: 'queued' | 'running' | 'completed' | 'failed';
  dedupKey: string;
  payload: Record<string, any>;
  resultSummary: string;
  errorMessage: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SourceConfigRecord {
  id: string;
  name: string;
  category: 'ats' | 'job_feed' | 'ai_search' | 'verification' | 'notification' | 'search_ai' | 'dns' | 'html_careers';
  enabled: boolean;
  rateLimitPerHour: number;
  callsCurrentHour: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string;
  updatedAt: string;
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

export interface AdminEngineOverview {
  metrics: {
    companiesRegistered: number;
    companiesMonitored: number;
    signalsTotal: number;
    signalsPending: number;
    publishedJobsActive: number;
    publishedJobsExpired: number;
    unpublishedOpportunities: number;
    contactsTotal: number;
    contactsVerified: number;
    jobsQueued: number;
    jobsRunning: number;
    jobsFailed: number;
    jobsCompleted: number;
    notificationsSent: number;
    candidateSubscribers: number;
    aiUsage: {
      callsToday: number;
      tokensToday: number;
      estimatedCostUsdToday: number;
      maxCallsPerDay: number;
      maxCostUsdPerDay: number;
      withinBudget: boolean;
    };
    sources: SourceConfigRecord[];
  };
  emailConfig?: {
    resendKeyConfigured: boolean;
    fromEmailConfigured: boolean;
    fromEmail: string;
    ready: boolean;
  };
  companies: CompanyRecord[];
  signals: CompanySignalRecord[];
  contacts: HrContactRecord[];
  backgroundJobs: BackgroundJobRecord[];
  auditLogs: AuditLogRecord[];
}

export interface GeocodedPlace {
  id: string;
  displayName: string;
  city: string;
  state?: string;
  country: string;
  countryCode?: string;
  lat: number;
  lon: number;
  osmUrl: string;
  category?: string;
  source: 'nominatim' | 'cache' | 'fallback';
}

export interface GeoSearchResponse {
  places: GeocodedPlace[];
  source: 'nominatim' | 'cache' | 'fallback';
  fallbackUsed: boolean;
  notice?: string;
}

export interface GeoReverseResponse {
  place: GeocodedPlace | null;
  source: 'nominatim' | 'cache' | 'fallback';
  fallbackUsed: boolean;
  notice?: string;
}

// =============================================================================
// HOSTINGER PRODUCTION DEPLOYMENT CENTER TYPES (ADMIN ONLY)
// =============================================================================
export type DeployProtocol = 'ssh' | 'ftps';
export type DeployAuthMethod = 'ssh_key' | 'password';
export type DeployStepState = 'pending' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';

export interface DeployConfigView {
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  domain: string;
  environment: 'production' | 'staging';
  nodeVersion: string;
  authMethod: DeployAuthMethod;
  hasSshKey: boolean;
  hasPassphrase: boolean;
  lastConnectionStatus: 'untested' | 'connected' | 'failed';
  lastConnectionMessage: string;
  lastConnectionCheckedAt: string | null;
  updatedAt: string;
  vaultEncryptionActive: boolean;
  vaultKeyMode: 'DEPLOY_VAULT_SECRET' | 'derived_server_key' | 'ephemeral';
}

export interface DeployEnvVarItem {
  key: string;
  label: string;
  description: string;
  category: 'core' | 'ai' | 'firebase' | 'email' | 'engine';
  required: boolean;
  isSecret: boolean;
  configured: boolean;
  value: string;
  updatedAt: string | null;
}

export interface DeployStepRecord {
  id: string;
  order: number;
  title: string;
  status: DeployStepState;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeployLogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  stepId: string;
  message: string;
}

export interface DeployRunRecord {
  id: string;
  status: 'running' | 'succeeded' | 'completed_with_warnings' | 'failed';
  triggeredBy: string;
  domain: string;
  protocol: DeployProtocol;
  startedAt: string;
  finishedAt: string | null;
  buildStatus: 'pending' | 'running' | 'succeeded' | 'failed';
  serverStatus: 'unknown' | 'online' | 'degraded' | 'offline';
  steps: DeployStepRecord[];
  logs: DeployLogEntry[];
  errorMessage: string;
  backupPath: string;
  hasDownloadableBundle: boolean;
}

export interface DomainHealthCheckResult {
  domain: string;
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  healthOk: boolean;
  latencyMs: number;
  engineStatus: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ConnectionTestResult {
  connected: boolean;
  protocol: DeployProtocol;
  host: string;
  port: number;
  message: string;
  remoteNodeVersion: string | null;
  remotePathAccessible: boolean;
  checkedAt: string;
}

export interface DeployDashboardState {
  config: DeployConfigView;
  envVars: DeployEnvVarItem[];
  preflight: {
    projectFilesOk: boolean;
    missingFiles: string[];
    requiredEnvReady: boolean;
    missingRequiredEnv: string[];
    connectionConfigured: boolean;
    readyToDeploy: boolean;
  };
  activeRunId: string | null;
  latestRun: DeployRunRecord | null;
  recentRuns: DeployRunRecord[];
  backupsCount: number;
  hasDownloadableBundle: boolean;
}

