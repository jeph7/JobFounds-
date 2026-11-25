import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe2,
  Info,
  Loader2,
  Mail,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Unlink,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ApplicationStage,
  CandidateProfile,
  CrmEmailSyncEvent,
  CvDocument,
  InterviewPrepReport,
  InterviewSimMessage,
  Lang,
  SalaryVisaReport,
  TrackedApplication,
} from '../types';
import { L, t } from '../i18n';
import {
  fetchCrmEmailSyncHistory,
  fetchSalaryVisaIntel,
  generateInterviewPrep,
  simulateInterviewTurn,
  syncGmailCrmReplies,
} from '../utils/api';
import {
  connectGmailReadonly,
  disconnectGmail,
  getConnectedGmailEmail,
  getGmailAccessToken,
} from '../firebase';
import { safeExternalUrl } from '../utils/safeUrl';
import { LiveVoiceCoach } from './LiveVoiceCoach';
import { CareerLocationMapHub } from './CareerLocationMapHub';

function parseSalaryNumeric(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/\u00a0/g, ' ').trim();
  const matches = cleaned.match(/\d[\d\s.,]*\s*[kK]?/g);
  if (!matches || matches.length === 0) return 0;
  const values = matches
    .map((m) => {
      const hasK = /[kK]$/.test(m.trim());
      const digits = m.replace(/[kK\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '');
      const num = parseFloat(digits.replace(',', '.'));
      if (!Number.isFinite(num)) return 0;
      return hasK && num < 2000 ? num * 1000 : num;
    })
    .filter((v) => v > 0);
  if (values.length === 0) return 0;
  if (values.length >= 2) {
    return Math.round((values[0] + values[1]) / 2);
  }
  return Math.round(values[0]);
}

interface CareerHubProps {
  lang: Lang;
  profile: CandidateProfile;
  cvVersions?: CvDocument[];
  applications: TrackedApplication[];
  onSaveApplication: (app: TrackedApplication) => void;
  onDeleteApplication: (id: string) => void;
  openAddFormSignal: number;
  initialSubTab?: 'tracker' | 'interview' | 'mobility';
  subTabTrigger?: number;
}

const CRM_STAGES: ApplicationStage[] = [
  'Opportunity Identified',
  'Application Prepared',
  'Awaiting Authorization',
  'Application Sent',
  'Message Received',
  'Under Review',
  'Interview Scheduled',
  'Offer Received',
  'Rejected',
  'Completed',
];

function normalizeCrmStage(stage: ApplicationStage): ApplicationStage {
  switch (stage) {
    case 'To Prepare':
      return 'Application Prepared';
    case 'Applied':
    case 'Spontaneous Sent':
      return 'Application Sent';
    case 'Interviewing':
      return 'Interview Scheduled';
    case 'Offer':
      return 'Offer Received';
    case 'Archived':
      return 'Completed';
    default:
      return stage;
  }
}

function daysBetween(isoDate?: string): number | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

export function CareerHub({
  lang,
  profile,
  cvVersions = [],
  applications,
  onSaveApplication,
  onDeleteApplication,
  initialSubTab = 'tracker',
  subTabTrigger = 0,
}: CareerHubProps) {
  const tr = t(lang);
  const [subTab, setSubTab] = useState<'tracker' | 'interview' | 'mobility'>(initialSubTab);

  useEffect(() => {
    if (subTabTrigger > 0) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab, subTabTrigger]);

  // Recruitment CRM state
  const [stageFilter, setStageFilter] = useState<'ALL' | ApplicationStage>('ALL');
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newType, setNewType] = useState<'Confirmed Job' | 'Spontaneous'>('Confirmed Job');
  const [newContactName, setNewContactName] = useState('');
  const [newContactChannel, setNewContactChannel] = useState('');
  const [newCvId, setNewCvId] = useState(cvVersions[0]?.id || '');
  const [newFollowUp, setNewFollowUp] = useState('');
  const [newNextAction, setNewNextAction] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Real Authorized Gmail Read-Only Sync state (Module 7)
  const [gmailConnectedEmail, setGmailConnectedEmail] = useState<string | null>(
    () => getConnectedGmailEmail()
  );
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailSyncNotice, setGmailSyncNotice] = useState<string | null>(null);
  const [gmailEvents, setGmailEvents] = useState<CrmEmailSyncEvent[]>([]);
  const [showGmailHistory, setShowGmailHistory] = useState(false);

  useEffect(() => {
    fetchCrmEmailSyncHistory(30)
      .then((res) => setGmailEvents(res.events || []))
      .catch(() => {
        // user may not be signed in yet
      });
  }, []);

  // Interview Tab Mode: Live Voice Coach, Text Simulator, or Structured Prep Brief
  const [interviewMode, setInterviewMode] = useState<'voice' | 'simulator' | 'brief'>('voice');
  const [intRole, setIntRole] = useState(applications[0]?.role ?? profile.currentTitle);
  const [intCompany, setIntCompany] = useState(applications[0]?.company ?? 'Qonto');
  const [intDetails, setIntDetails] = useState(applications[0]?.notes ?? '');
  const [intLoading, setIntLoading] = useState(false);
  const [intError, setIntError] = useState<string | null>(null);
  const [intReport, setIntReport] = useState<InterviewPrepReport | null>(null);

  // Interactive Simulator state
  const [simMessages, setSimMessages] = useState<InterviewSimMessage[]>([]);
  const [simInput, setSimInput] = useState('');
  const [simComplete, setSimComplete] = useState(false);
  const [simSummary, setSimSummary] = useState('');

  // Salary & Visa Intelligence state
  const [mobRole, setMobRole] = useState(profile.currentTitle);
  const [mobExp, setMobExp] = useState(`${profile.yearsExperience} ans / Senior`);
  const [mobCountry, setMobCountry] = useState('Suisse');
  const [mobCity, setMobCity] = useState('Zurich');
  const [mobOrigin, setMobOrigin] = useState(profile.originCountry);
  const [mobLoading, setMobLoading] = useState(false);
  const [mobError, setMobError] = useState<string | null>(null);
  const [mobReport, setMobReport] = useState<SalaryVisaReport | null>(null);

  const visibleApps = applications.filter(
    (app) => stageFilter === 'ALL' || normalizeCrmStage(app.stage) === stageFilter
  );

  const pendingApprovals = applications.filter(
    (app) =>
      normalizeCrmStage(app.stage) === 'Awaiting Authorization' ||
      app.approvalStatus === 'pending_user_approval'
  );

  const pipelineChartData = useMemo(
    () =>
      CRM_STAGES.map((stage) => ({
        stage: tr.stageLabels[stage],
        count: applications.filter((a) => normalizeCrmStage(a.stage) === stage).length,
      })),
    [applications, tr.stageLabels]
  );

  const salaryChartData = useMemo(() => {
    if (!mobReport) return [];
    const items = [
      { band: 'P25', amount: parseSalaryNumeric(mobReport.salaryBands.p25), raw: mobReport.salaryBands.p25, color: '#A9D8F5' },
      { band: L(lang, 'Médiane', 'Median'), amount: parseSalaryNumeric(mobReport.salaryBands.median), raw: mobReport.salaryBands.median, color: '#287BC7' },
      { band: 'P75', amount: parseSalaryNumeric(mobReport.salaryBands.p75), raw: mobReport.salaryBands.p75, color: '#102B52' },
      { band: 'Lead / Exec', amount: parseSalaryNumeric(mobReport.salaryBands.executive), raw: mobReport.salaryBands.executive, color: '#06132F' },
    ];
    return items.some((i) => i.amount > 0) ? items : [];
  }, [mobReport, lang]);

  const handleAddApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRole.trim() || !newCompany.trim()) return;
    const chosenCv = cvVersions.find((c) => c.id === newCvId);
    const isSpontaneous = newType === 'Spontaneous';
    const item: TrackedApplication = {
      id: `app_${Date.now()}`,
      role: newRole.trim(),
      company: newCompany.trim(),
      location: newLocation.trim() || 'International',
      type: newType,
      stage: isSpontaneous ? 'Awaiting Authorization' : 'Application Prepared',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: newFollowUp,
      contactName: newContactName.trim(),
      contactChannel: newContactChannel.trim(),
      cvVersionId: chosenCv?.id || '',
      cvVersionName: chosenCv?.versionName || '',
      approvalStatus: isSpontaneous ? 'pending_user_approval' : 'not_required',
      responseReceived: false,
      responseSource: 'none',
      followUpCount: 0,
      nextAction: newNextAction.trim(),
      notes: newNotes.trim(),
    };
    onSaveApplication(item);
    setNewRole('');
    setNewCompany('');
    setNewLocation('');
    setNewContactName('');
    setNewContactChannel('');
    setNewFollowUp('');
    setNewNextAction('');
    setNewNotes('');
    setShowAdd(false);
  };

  const handleAuthorizeAndMarkSent = (app: TrackedApplication) => {
    const today = new Date().toISOString().slice(0, 10);
    const defaultFollowUp =
      app.followUpDate || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    onSaveApplication({
      ...app,
      approvalStatus: 'approved_by_user',
      stage: 'Application Sent',
      sentDate: app.sentDate || today,
      followUpDate: defaultFollowUp,
      nextAction:
        lang === 'fr'
          ? `Relance polie prévue le ${defaultFollowUp} si aucune réponse`
          : `Polite follow-up scheduled for ${defaultFollowUp} if no reply`,
    });
  };

  const handleLogFollowUp = (app: TrackedApplication) => {
    const today = new Date().toISOString().slice(0, 10);
    const nextFollowUp = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    onSaveApplication({
      ...app,
      followUpCount: (app.followUpCount || 0) + 1,
      lastFollowUpAt: today,
      followUpDate: nextFollowUp,
    });
  };

  const handleConnectGmail = async () => {
    setGmailConnecting(true);
    setGmailError(null);
    setGmailSyncNotice(null);
    try {
      const { email } = await connectGmailReadonly();
      setGmailConnectedEmail(email || 'Gmail');
      setGmailSyncNotice(
        lang === 'fr'
          ? `Gmail connecté en lecture seule (${email || 'compte Google'}). Cliquez sur « Synchroniser les réponses » pour analyser les réponses réelles des recruteurs.`
          : `Gmail connected in read-only mode (${email || 'Google account'}). Click "Sync Recruiter Replies" to scan real inbox replies.`
      );
    } catch (err) {
      setGmailError(
        err instanceof Error
          ? err.message
          : lang === 'fr'
          ? 'Connexion Gmail annulée ou refusée.'
          : 'Gmail connection cancelled or denied.'
      );
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleDisconnectGmail = () => {
    disconnectGmail();
    setGmailConnectedEmail(null);
    setGmailSyncNotice(null);
    setGmailError(null);
  };

  const handleSyncGmailReplies = async () => {
    const token = getGmailAccessToken();
    if (!token) {
      setGmailConnectedEmail(null);
      setGmailError(
        lang === 'fr'
          ? 'Session Gmail expirée. Reconnectez Gmail en lecture seule.'
          : 'Gmail session expired. Please reconnect Gmail read-only.'
      );
      return;
    }
    if (applications.length === 0) {
      setGmailSyncNotice(
        lang === 'fr'
          ? 'Ajoutez au moins une candidature dans votre CRM pour rechercher les réponses correspondantes.'
          : 'Add at least one tracked application in your CRM before syncing replies.'
      );
      return;
    }

    setGmailSyncing(true);
    setGmailError(null);
    setGmailSyncNotice(null);
    try {
      const res = await syncGmailCrmReplies(
        token,
        applications.map((a) => ({
          id: a.id,
          company: a.company,
          role: a.role,
          stage: a.stage,
          contactName: a.contactName,
          contactChannel: a.contactChannel,
        }))
      );

      let updatedCount = 0;
      for (const reply of res.matchedReplies) {
        const target = applications.find((a) => a.id === reply.applicationId);
        if (!target) continue;
        const summaryLine = `[Gmail · ${reply.receivedAt.slice(0, 10)}] ${reply.subject || reply.sender}: ${reply.snippet}`.slice(0, 950);
        onSaveApplication({
          ...target,
          stage: reply.detectedStage,
          responseReceived: true,
          responseSource: 'gmail_sync',
          responseSummary: summaryLine,
          nextAction:
            reply.detectedStage === 'Interview Scheduled'
              ? lang === 'fr'
                ? 'Préparer l’entretien dans le simulateur JOBFOUNDS'
                : 'Prepare for interview in JOBFOUNDS Simulator'
              : reply.detectedStage === 'Offer Received'
              ? lang === 'fr'
                ? 'Comparer l’offre dans Salaires & Visas avant acceptation'
                : 'Benchmark offer in Salaries & Visas before accepting'
              : target.nextAction,
        });
        updatedCount++;
      }

      const history = await fetchCrmEmailSyncHistory(30);
      setGmailEvents(history.events || []);

      setGmailSyncNotice(
        lang === 'fr'
          ? `Synchronisation Gmail terminée : ${res.scannedMessages} e-mail(s) récents analysé(s), ${res.matchedReplies.length} réponse(s) recruteur détectée(s), ${updatedCount} candidature(s) mise(s) à jour.`
          : `Gmail sync complete: ${res.scannedMessages} recent email(s) scanned, ${res.matchedReplies.length} recruiter repl(ies) matched, ${updatedCount} application(s) updated.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gmail sync failed.';
      if (msg.toLowerCase().includes('expired')) {
        disconnectGmail();
        setGmailConnectedEmail(null);
      }
      setGmailError(msg);
    } finally {
      setGmailSyncing(false);
    }
  };

  const handleRunInterviewPrep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intRole.trim() || !intCompany.trim()) return;
    setIntLoading(true);
    setIntError(null);
    try {
      const res = await generateInterviewPrep({
        role: intRole,
        company: intCompany,
        details: intDetails,
        profile,
        lang,
      });
      setIntReport(res);
    } catch (err) {
      setIntError(err instanceof Error ? err.message : 'Interview preparation failed.');
    } finally {
      setIntLoading(false);
    }
  };

  const handleStartSimulation = async () => {
    if (!intRole.trim() || !intCompany.trim()) return;
    setIntLoading(true);
    setIntError(null);
    setSimMessages([]);
    setSimComplete(false);
    setSimSummary('');
    try {
      const res = await simulateInterviewTurn({
        role: intRole,
        company: intCompany,
        details: intDetails,
        profile,
        history: [],
        userAnswer: '',
        lang,
      });
      setSimMessages([
        {
          speaker: 'interviewer',
          text: res.nextQuestion,
          category: res.questionCategory,
        },
      ]);
    } catch (err) {
      setIntError(err instanceof Error ? err.message : 'Unable to start interview simulation.');
    } finally {
      setIntLoading(false);
    }
  };

  const handleSubmitSimAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simInput.trim() || intLoading) return;
    const answerText = simInput.trim();
    const updatedHistory: InterviewSimMessage[] = [
      ...simMessages,
      { speaker: 'candidate', text: answerText },
    ];
    setSimMessages(updatedHistory);
    setSimInput('');
    setIntLoading(true);
    setIntError(null);
    try {
      const res = await simulateInterviewTurn({
        role: intRole,
        company: intCompany,
        details: intDetails,
        profile,
        history: updatedHistory,
        userAnswer: answerText,
        lang,
      });

      const withFeedback: InterviewSimMessage[] = updatedHistory.map((m, idx) =>
        idx === updatedHistory.length - 1 ? { ...m, feedback: res.feedback } : m
      );

      if (res.isComplete) {
        setSimMessages(withFeedback);
        setSimComplete(true);
        setSimSummary(res.finalSummary || '');
      } else {
        setSimMessages([
          ...withFeedback,
          {
            speaker: 'interviewer',
            text: res.nextQuestion,
            category: res.questionCategory,
          },
        ]);
      }
    } catch (err) {
      setIntError(err instanceof Error ? err.message : 'Simulation turn failed.');
    } finally {
      setIntLoading(false);
    }
  };

  const handleRunMobilityIntel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobRole.trim() || !mobCountry.trim()) return;
    setMobLoading(true);
    setMobError(null);
    try {
      const res = await fetchSalaryVisaIntel({
        role: mobRole,
        experienceLevel: mobExp,
        destinationCountry: mobCountry,
        destinationCity: mobCity,
        originCountry: mobOrigin,
        lang,
      });
      setMobReport(res);
    } catch (err) {
      setMobError(err instanceof Error ? err.message : 'Salary & visa lookup failed.');
    } finally {
      setMobLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation Header */}
      <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold text-jf-navy">
              {L(
                lang,
                'Suivi des candidatures, simulateur d’entretien & mobilité',
                'Application Tracker, Interactive Interview Simulator & Visas'
              )}
            </h1>
            <p className="text-sm text-slate-600">
              {L(
                lang,
                'Planifiez vos relances, entraînez-vous en conditions réelles avec feedback instantané et vérifiez salaires et permis de travail.',
                'Schedule follow-ups, practice live interactive interviews with instant feedback, and research global compensation and work visas.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-jf-ice rounded-lg self-start border border-jf-border">
            <button
              type="button"
              onClick={() => setSubTab('tracker')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'tracker'
                  ? 'bg-jf-navy text-white'
                  : 'text-jf-dark hover:text-jf-navy'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>
                {L(lang, 'Suivi', 'Tracker')} ({applications.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('interview')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'interview'
                  ? 'bg-jf-navy text-white'
                  : 'text-jf-dark hover:text-jf-navy'
              }`}
            >
              <MessageSquareText className="w-3.5 h-3.5" />
              <span>{L(lang, 'Entretiens & Simulateur', 'Interview Simulator')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('mobility')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'mobility'
                  ? 'bg-jf-navy text-white'
                  : 'text-jf-dark hover:text-jf-navy'
              }`}
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span>{L(lang, 'Salaires & Visas', 'Salaries & Visas')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* SUB-TAB 1: 10-STATUS RECRUITMENT CRM & RESPONSE TRACKING */}
      {subTab === 'tracker' && (
        <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
          {/* Real Authorized Gmail Read-Only Recruiter Reply Sync & Authorization Gate (Module 7) */}
          <div className="p-4 bg-jf-ice border border-jf-border rounded-xl space-y-3 text-xs text-jf-dark">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-jf-blue shrink-0 mt-0.5" />
                <div>
                  <strong className="text-jf-navy">
                    {lang === 'fr'
                      ? 'Synchronisation Gmail (Lecture seule · Autorisée) & Garde-fou d’envoi : '
                      : 'Gmail Sync (Read-Only · User-Authorized) & Send Guardrail: '}
                  </strong>
                  {lang === 'fr'
                    ? 'Aucune candidature ni relance n’est envoyée sans votre autorisation explicite. Connectez Gmail en lecture seule pour détecter automatiquement les réponses réelles des recruteurs (entretiens, refus, offres) et mettre à jour vos statuts CRM.'
                    : 'No application or follow-up is ever sent without your explicit authorization. Connect Gmail in read-only mode to detect real recruiter replies (interviews, rejections, offers) and automatically update your CRM statuses.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {pendingApprovals.length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-jf-navy text-jf-sky font-mono font-semibold whitespace-nowrap">
                    {pendingApprovals.length}{' '}
                    {lang === 'fr' ? 'en attente d’autorisation' : 'awaiting authorization'}
                  </span>
                )}

                {!gmailConnectedEmail ? (
                  <button
                    type="button"
                    onClick={handleConnectGmail}
                    disabled={gmailConnecting}
                    className="px-3.5 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-jf-navy font-medium inline-flex items-center gap-2 shadow-xs transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    {gmailConnecting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-jf-blue" />
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      </svg>
                    )}
                    <span>
                      {lang === 'fr' ? 'Connecter Gmail (lecture seule)' : 'Connect Gmail (Read-Only)'}
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="px-2.5 py-1.5 rounded-lg bg-white border border-jf-border text-jf-navy font-medium inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{gmailConnectedEmail}</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleSyncGmailReplies}
                      disabled={gmailSyncing}
                      className="px-3.5 py-2 rounded-lg bg-jf-blue hover:bg-jf-blue-hover text-white font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-60 whitespace-nowrap"
                    >
                      {gmailSyncing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {gmailSyncing
                          ? lang === 'fr'
                            ? 'Analyse Gmail...'
                            : 'Scanning Gmail...'
                          : lang === 'fr'
                          ? 'Synchroniser les réponses'
                          : 'Sync Recruiter Replies'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectGmail}
                      title={lang === 'fr' ? 'Déconnecter Gmail' : 'Disconnect Gmail'}
                      className="p-2 rounded-lg bg-white border border-jf-border text-slate-600 hover:text-jf-navy"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                {gmailEvents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowGmailHistory((v) => !v)}
                    className="px-3 py-2 rounded-lg bg-white border border-jf-border text-jf-navy hover:bg-jf-soft font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Info className="w-3.5 h-3.5 text-jf-blue" />
                    <span>
                      {lang === 'fr' ? 'Réponses détectées' : 'Detected Replies'} ({gmailEvents.length})
                    </span>
                  </button>
                )}
              </div>
            </div>

            {gmailSyncNotice && (
              <div className="p-2.5 bg-white border border-jf-sky rounded-lg text-jf-navy">
                {gmailSyncNotice}
              </div>
            )}
            {gmailError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {gmailError}
              </div>
            )}

            {showGmailHistory && gmailEvents.length > 0 && (
              <div className="pt-2 border-t border-jf-border space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-jf-dark">
                  {lang === 'fr'
                    ? 'Historique persisté des réponses recruteurs détectées via Gmail'
                    : 'Persisted Recruiter Replies Detected via Gmail'}
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {gmailEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2.5 bg-white border border-jf-border rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-semibold text-jf-navy truncate">
                          {ev.company} — {ev.subject || ev.sender}
                        </div>
                        <div className="text-[11px] text-slate-600 line-clamp-1">{ev.snippet}</div>
                        <div className="text-[11px] text-slate-500">
                          {ev.sender} · {ev.receivedAt.slice(0, 10)} · {ev.reason}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-jf-navy text-jf-sky font-mono text-[11px] whitespace-nowrap self-start sm:self-center">
                        {ev.detectedStage}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-jf-ice rounded-lg border border-jf-border">
              <button
                type="button"
                onClick={() => setStageFilter('ALL')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                  stageFilter === 'ALL' ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                }`}
              >
                {tr.common.all} ({applications.length})
              </button>
              {CRM_STAGES.map((stage) => {
                const count = applications.filter((a) => normalizeCrmStage(a.stage) === stage).length;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setStageFilter(stage)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                      stageFilter === stage ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                    }`}
                  >
                    {tr.stageLabels[stage]} ({count})
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="px-3.5 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{L(lang, 'Nouvelle candidature', 'Log Application')}</span>
            </button>
          </div>

          {applications.length > 0 && (
            <div className="p-4 bg-jf-ice/70 border border-jf-border rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-jf-navy">
                  <BarChart3 className="w-4 h-4 text-jf-blue" />
                  <span>
                    {L(
                      lang,
                      'Pipeline CRM des candidatures (10 statuts)',
                      'Recruitment CRM Pipeline (10 Statuses)'
                    )}
                  </span>
                </div>
                <span className="font-mono text-xs tabular-nums text-jf-dark">
                  {applications.length} {L(lang, 'dossiers', 'total')}
                </span>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={pipelineChartData}
                    margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#D5EBFA" vertical={false} />
                    <XAxis
                      dataKey="stage"
                      tick={{ fontSize: 10, fill: '#102B52' }}
                      axisLine={{ stroke: '#D5EBFA' }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#06132F',
                        border: '1px solid #102B52',
                        borderRadius: '8px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      cursor={{ fill: '#D5EBFA', opacity: 0.35 }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={36}>
                      {pipelineChartData.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={idx === 6 || idx === 7 ? '#06132F' : '#287BC7'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {showAdd && (
            <form
              onSubmit={handleAddApplication}
              className="p-4 bg-jf-ice border border-jf-border rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"
            >
              <input
                type="text"
                required
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder={lang === 'fr' ? 'Poste visé *' : 'Target Role *'}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <input
                type="text"
                required
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder={L(lang, 'Entreprise *', 'Company *')}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder={lang === 'fr' ? 'Ville, Pays' : 'City, Country'}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'Confirmed Job' | 'Spontaneous')}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              >
                <option value="Confirmed Job">
                  {lang === 'fr' ? 'Offre confirmée' : 'Confirmed Job'}
                </option>
                <option value="Spontaneous">
                  {lang === 'fr' ? 'Candidature spontanée' : 'Spontaneous'}
                </option>
              </select>
              <input
                type="text"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder={lang === 'fr' ? 'Contact destinataire (RH / Manager)' : 'Recipient Contact'}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={newContactChannel}
                onChange={(e) => setNewContactChannel(e.target.value)}
                placeholder={lang === 'fr' ? 'Canal / e-mail pro / portail' : 'Channel / email / portal'}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <select
                value={newCvId}
                onChange={(e) => setNewCvId(e.target.value)}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              >
                <option value="">{lang === 'fr' ? 'CV utilisé (optionnel)' : 'CV used (optional)'}</option>
                {cvVersions.map((cv) => (
                  <option key={cv.id} value={cv.id}>
                    {cv.versionName}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newFollowUp}
                onChange={(e) => setNewFollowUp(e.target.value)}
                aria-label="Follow-up date"
                className="px-3 py-2 font-mono bg-white border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={newNextAction}
                onChange={(e) => setNewNextAction(e.target.value)}
                placeholder={lang === 'fr' ? 'Prochaine action prévue' : 'Next planned action'}
                className="sm:col-span-2 px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder={lang === 'fr' ? 'Notes / lettre de motivation' : 'Notes / cover letter summary'}
                className="px-3 py-2 bg-white border border-jf-border rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg"
              >
                {L(lang, 'Enregistrer dans le CRM', 'Save to CRM')}
              </button>
            </form>
          )}

          {visibleApps.length === 0 ? (
            <div className="py-12 text-center space-y-2 border border-dashed border-jf-border rounded-xl">
              <p className="text-sm font-medium text-jf-navy">
                {lang === 'fr' ? 'Aucune candidature dans cette étape.' : 'No applications in this stage.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleApps.map((app) => {
                const currentStage = normalizeCrmStage(app.stage);
                const needsApproval =
                  currentStage === 'Awaiting Authorization' ||
                  app.approvalStatus === 'pending_user_approval';
                const isExpanded = expandedAppId === app.id;
                const daysSinceLastContact = daysBetween(app.lastFollowUpAt || app.sentDate);
                const canFollowUpResponsibly =
                  daysSinceLastContact === null || daysSinceLastContact >= 5;
                const sourceHref = safeExternalUrl(app.sourceUrl);

                return (
                  <div
                    key={app.id}
                    className={`border rounded-xl overflow-hidden transition-colors ${
                      needsApproval
                        ? 'border-jf-blue bg-jf-soft/30'
                        : 'border-jf-border bg-white'
                    }`}
                  >
                    <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-jf-navy">{app.role}</span>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-jf-ice border border-jf-border text-jf-dark">
                            {app.type === 'Spontaneous'
                              ? lang === 'fr'
                                ? 'Spontanée'
                                : 'Spontaneous'
                              : lang === 'fr'
                                ? 'Offre publiée'
                                : 'Published Job'}
                          </span>
                          {app.responseReceived && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-jf-navy text-jf-sky inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{lang === 'fr' ? 'Réponse reçue' : 'Reply Received'}</span>
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-jf-dark">{app.company}</span>
                          <span>· {app.location}</span>
                          <span className="font-mono">· {lang === 'fr' ? 'Ajouté' : 'Added'} {app.dateAdded}</span>
                          {app.sentDate && (
                            <span className="font-mono">· {lang === 'fr' ? 'Envoyé' : 'Sent'} {app.sentDate}</span>
                          )}
                          {app.contactName && <span>· RH: {app.contactName}</span>}
                          {app.cvVersionName && <span>· CV: {app.cvVersionName}</span>}
                        </div>
                        {app.nextAction && (
                          <div className="text-xs text-jf-blue font-medium">
                            {lang === 'fr' ? 'Prochaine action : ' : 'Next action: '}
                            {app.nextAction}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {needsApproval && (
                          <button
                            type="button"
                            onClick={() => handleAuthorizeAndMarkSent(app)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1.5"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>
                              {lang === 'fr'
                                ? 'Autoriser et marquer envoyée'
                                : 'Authorize & Mark Sent'}
                            </span>
                          </button>
                        )}

                        <select
                          value={currentStage}
                          onChange={(e) => {
                            const nextStage = e.target.value as ApplicationStage;
                            onSaveApplication({
                              ...app,
                              stage: nextStage,
                              sentDate:
                                nextStage === 'Application Sent' && !app.sentDate
                                  ? new Date().toISOString().slice(0, 10)
                                  : app.sentDate,
                              responseReceived:
                                nextStage === 'Message Received' ||
                                nextStage === 'Interview Scheduled' ||
                                nextStage === 'Offer Received'
                                  ? true
                                  : app.responseReceived,
                            });
                          }}
                          className="text-xs font-medium px-2.5 py-1.5 border border-jf-border rounded-lg bg-white text-jf-navy"
                        >
                          {CRM_STAGES.map((st) => (
                            <option key={st} value={st}>
                              {tr.stageLabels[st]}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => setExpandedAppId(isExpanded ? null : app.id)}
                          className="px-2.5 py-1.5 text-xs font-medium text-jf-dark bg-jf-ice hover:bg-jf-soft border border-jf-border rounded-lg inline-flex items-center gap-1"
                        >
                          <span>{lang === 'fr' ? 'Détails CRM' : 'CRM Details'}</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIntRole(app.role);
                            setIntCompany(app.company);
                            setIntDetails(app.notes);
                            setSubTab('interview');
                          }}
                          className="text-xs font-medium text-jf-blue hover:underline px-1"
                        >
                          {tr.common.prepInterview}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteApplication(app.id)}
                          aria-label="Delete application"
                          className="p-1.5 text-slate-400 hover:text-jf-navy"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Full CRM Record Panel */}
                    {isExpanded && (
                      <div className="p-4 border-t border-jf-border bg-jf-ice/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Contact destinataire' : 'Recipient Contact'}
                          </span>
                          <input
                            type="text"
                            value={app.contactName || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, contactName: e.target.value })
                            }
                            placeholder="Nom / Poste RH"
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Canal de contact' : 'Contact Channel'}
                          </span>
                          <input
                            type="text"
                            value={app.contactChannel || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, contactChannel: e.target.value })
                            }
                            placeholder="Portail / LinkedIn / Email pro"
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'CV utilisé' : 'CV Version Used'}
                          </span>
                          <select
                            value={app.cvVersionId || ''}
                            onChange={(e) => {
                              const found = cvVersions.find((c) => c.id === e.target.value);
                              onSaveApplication({
                                ...app,
                                cvVersionId: found?.id || '',
                                cvVersionName: found?.versionName || '',
                              });
                            }}
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          >
                            <option value="">—</option>
                            {cvVersions.map((cv) => (
                              <option key={cv.id} value={cv.id}>
                                {cv.versionName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Date d’envoi' : 'Sent Date'}
                          </span>
                          <input
                            type="date"
                            value={app.sentDate || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, sentDate: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 font-mono bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Date de relance' : 'Follow-Up Date'}
                          </span>
                          <input
                            type="date"
                            value={app.followUpDate || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, followUpDate: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 font-mono bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Date d’entretien' : 'Interview Date'}
                          </span>
                          <input
                            type="date"
                            value={app.interviewDate || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, interviewDate: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 font-mono bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Prochaine action' : 'Next Action'}
                          </span>
                          <input
                            type="text"
                            value={app.nextAction || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, nextAction: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <div className="space-y-1 flex flex-col justify-end">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-600">
                              {lang === 'fr' ? 'Relances :' : 'Follow-ups:'}{' '}
                              <strong className="font-mono text-jf-navy">{app.followUpCount || 0}</strong>
                            </span>
                            <button
                              type="button"
                              disabled={!canFollowUpResponsibly}
                              onClick={() => handleLogFollowUp(app)}
                              className="px-2.5 py-1.5 text-xs font-medium text-jf-navy bg-white border border-jf-border hover:bg-jf-soft disabled:opacity-50 rounded-lg"
                            >
                              {canFollowUpResponsibly
                                ? lang === 'fr'
                                  ? 'Journaliser 1 relance'
                                  : 'Log Follow-Up'
                                : lang === 'fr'
                                  ? 'Délai anti-spam (< 5j)'
                                  : 'Anti-spam wait (< 5d)'}
                            </button>
                          </div>
                        </div>
                        <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr'
                              ? 'Lettre / message envoyé (résumé)'
                              : 'Cover Letter / Message Used'}
                          </span>
                          <textarea
                            rows={2}
                            value={app.coverLetterUsed || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, coverLetterUsed: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                        <div className="sm:col-span-2 lg:col-span-3 p-3 bg-white border border-jf-border rounded-lg space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 font-semibold text-jf-navy cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(app.responseReceived)}
                                onChange={(e) =>
                                  onSaveApplication({
                                    ...app,
                                    responseReceived: e.target.checked,
                                    responseSource: e.target.checked ? 'manual_log' : 'none',
                                    stage:
                                      e.target.checked && currentStage === 'Application Sent'
                                        ? 'Message Received'
                                        : app.stage,
                                  })
                                }
                              />
                              <span>
                                {lang === 'fr'
                                  ? 'Réponse entreprise reçue (enregistrée manuellement)'
                                  : 'Employer response received (manually logged)'}
                              </span>
                            </label>
                            {sourceHref && (
                              <a
                                href={sourceHref}
                                target="_blank"
                                rel="noreferrer"
                                className="text-jf-blue hover:underline inline-flex items-center gap-1"
                              >
                                <span>{lang === 'fr' ? 'Lien source' : 'Source Link'}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <input
                            type="text"
                            value={app.responseSummary || ''}
                            onChange={(e) =>
                              onSaveApplication({ ...app, responseSummary: e.target.value })
                            }
                            placeholder={
                              lang === 'fr'
                                ? 'Résumé de la réponse reçue (ex. proposition de créneau entretien)…'
                                : 'Summary of employer reply…'
                            }
                            className="w-full px-2.5 py-1.5 bg-jf-ice/50 border border-jf-border rounded-lg"
                          />
                        </div>
                        <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                          <span className="font-medium text-slate-600">
                            {lang === 'fr' ? 'Notes de suivi' : 'Notes'}
                          </span>
                          <input
                            type="text"
                            value={app.notes}
                            onChange={(e) =>
                              onSaveApplication({ ...app, notes: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 2: INTERACTIVE INTERVIEW SIMULATOR + PREP BRIEF */}
      {subTab === 'interview' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setInterviewMode('voice')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                    interviewMode === 'voice'
                      ? 'bg-jf-navy text-white shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {lang === 'fr' ? 'Coach vocal en direct (Voix IA)' : 'Live Voice Coach (AI Voice)'}
                </button>
                <button
                  type="button"
                  onClick={() => setInterviewMode('simulator')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                    interviewMode === 'simulator'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {lang === 'fr' ? 'Simulateur écrit interactif' : 'Interactive Text Simulator'}
                </button>
                <button
                  type="button"
                  onClick={() => setInterviewMode('brief')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                    interviewMode === 'brief'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {lang === 'fr' ? 'Dossier de préparation complet' : 'Structured Prep Brief'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Poste visé' : 'Target Role'}
                </span>
                <input
                  type="text"
                  value={intRole}
                  onChange={(e) => setIntRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Entreprise' : 'Company'}
                </span>
                <input
                  type="text"
                  value={intCompany}
                  onChange={(e) => setIntCompany(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Contexte d’entretien' : 'Interview Context'}
              </span>
              <textarea
                rows={2}
                value={intDetails}
                onChange={(e) => setIntDetails(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </label>

            {interviewMode !== 'voice' && (
              <div className="flex justify-end gap-2">
                {interviewMode === 'simulator' ? (
                  <button
                    type="button"
                    onClick={handleStartSimulation}
                    disabled={intLoading}
                    className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-2"
                  >
                    {intLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : simMessages.length > 0 ? (
                      <RotateCcw className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>
                      {simMessages.length > 0
                        ? lang === 'fr'
                          ? 'Redémarrer la simulation'
                          : 'Restart Simulation'
                        : lang === 'fr'
                          ? 'Démarrer la simulation d’entretien'
                          : 'Start Interactive Simulation'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRunInterviewPrep}
                    disabled={intLoading}
                    className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-2"
                  >
                    {intLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>
                      {lang === 'fr' ? 'Générer le dossier de préparation' : 'Generate Prep Brief'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {interviewMode === 'voice' && (
            <LiveVoiceCoach
              lang={lang}
              profile={profile}
              role={intRole}
              company={intCompany}
              details={intDetails}
            />
          )}

          {intError && (
            <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
              {intError}
            </div>
          )}

          {/* INTERACTIVE SIMULATOR CONVERSATION */}
          {interviewMode === 'simulator' && simMessages.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="space-y-4">
                {simMessages.map((msg, idx) => (
                  <div key={idx} className="space-y-2">
                    <div
                      className={`p-4 rounded-lg border ${
                        msg.speaker === 'interviewer'
                          ? 'bg-slate-50 border-slate-200'
                          : 'bg-blue-50/50 border-blue-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs mb-1">
                        <span className="font-semibold text-slate-800">
                          {msg.speaker === 'interviewer'
                            ? `${intCompany} — ${lang === 'fr' ? 'Recruteur IA' : 'AI Interviewer'}`
                            : profile.fullName}
                        </span>
                        {msg.category && (
                          <span className="text-slate-500">{msg.category}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                        {msg.text}
                      </p>
                    </div>

                    {msg.feedback && (
                      <div className="ml-0 sm:ml-6 p-4 bg-jf-ice border border-jf-sky/70 rounded-lg space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
                          <span className="font-semibold text-jf-blue">
                            {lang === 'fr' ? 'Score' : 'Score'}: {msg.feedback.overallScore}/100
                          </span>
                          <span className="text-jf-dark">
                            {lang === 'fr' ? 'Clarté' : 'Clarity'}: {msg.feedback.clarity}%
                          </span>
                          <span className="text-jf-dark">
                            STAR: {msg.feedback.starStructure}%
                          </span>
                          <span className="text-jf-dark">
                            {lang === 'fr' ? 'Pertinence' : 'Relevance'}: {msg.feedback.relevance}%
                          </span>
                        </div>
                        <p className="text-jf-blue">
                          <strong>{lang === 'fr' ? 'Point fort : ' : 'Strength: '}</strong>
                          <span className="text-jf-navy">{msg.feedback.strength}</span>
                        </p>
                        <p className="text-jf-dark">
                          <strong>{lang === 'fr' ? 'Axe d’amélioration : ' : 'Improvement: '}</strong>
                          <span className="text-slate-700">{msg.feedback.improvement}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {simComplete && simSummary ? (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">
                    {lang === 'fr' ? 'Débriefing final de la simulation' : 'Final Simulation Debrief'}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {simSummary}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmitSimAnswer} className="space-y-3 pt-2 border-t border-slate-100">
                  <textarea
                    rows={3}
                    value={simInput}
                    onChange={(e) => setSimInput(e.target.value)}
                    placeholder={
                      lang === 'fr'
                        ? 'Rédigez votre réponse en structurant Situation, Tâche, Action, Résultat (STAR)…'
                        : 'Write your interview response using Situation, Task, Action, Result (STAR)…'
                    }
                    className="w-full p-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={intLoading || !simInput.trim()}
                      className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                    >
                      {intLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>{lang === 'fr' ? 'Soumettre et évaluer' : 'Submit & Evaluate'}</span>
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* STRUCTURED PREP BRIEF */}
          {interviewMode === 'brief' && intReport && !intLoading && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div className="pb-4 border-b border-slate-200 space-y-1.5">
                <h2 className="font-display text-xl font-semibold text-slate-900">
                  {intCompany} — {intRole}
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">{intReport.roleBrief}</p>
              </div>

              <div className="divide-y divide-slate-200">
                {intReport.questions.map((q, idx) => (
                  <div key={idx} className="py-4 space-y-1.5">
                    <div className="text-xs font-semibold text-blue-700">{q.category}</div>
                    <h3 className="text-sm font-semibold text-slate-900">{q.question}</h3>
                    <p className="text-xs text-slate-500">{q.whyAsked}</p>
                    <p className="text-xs text-slate-700 leading-relaxed pt-1">
                      <span className="font-semibold text-slate-900">
                        {lang === 'fr' ? 'Structure STAR : ' : 'STAR Guidance: '}
                      </span>
                      {q.starGuidance}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 text-xs">
                <div className="space-y-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'fr' ? 'Questions pertinentes à poser au recruteur' : 'Questions to Ask the Recruiter'}
                  </h3>
                  <ul className="space-y-1.5 text-slate-700">
                    {intReport.questionsForRecruiter.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'fr' ? 'Checklist avant l’entretien' : 'Pre-Interview Checklist'}
                  </h3>
                  <ul className="space-y-1.5 text-slate-700">
                    {intReport.preparationChecklist.map((c, i) => (
                      <li key={i}>• {c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* SUB-TAB 3: GLOBAL SALARY, VISA & WORK PERMIT INTELLIGENCE */}
      {subTab === 'mobility' && (
        <div className="space-y-6">
          <form
            onSubmit={handleRunMobilityIntel}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Métier / Poste' : 'Target Role'}
                </span>
                <input
                  type="text"
                  value={mobRole}
                  onChange={(e) => setMobRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Niveau' : 'Experience'}
                </span>
                <input
                  type="text"
                  value={mobExp}
                  onChange={(e) => setMobExp(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Pays de destination' : 'Destination Country'}
                </span>
                <input
                  type="text"
                  value={mobCountry}
                  onChange={(e) => setMobCountry(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Ville' : 'City'}
                </span>
                <input
                  type="text"
                  value={mobCity}
                  onChange={(e) => setMobCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  {lang === 'fr' ? 'Pays d’origine / citoyenneté' : 'Origin / Citizenship'}
                </span>
                <input
                  type="text"
                  value={mobOrigin}
                  onChange={(e) => setMobOrigin(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={mobLoading}
                className="px-5 py-2.5 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-2"
              >
                {mobLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe2 className="w-4 h-4" />}
                <span>
                  {L(
                    lang,
                    'Analyser salaires & permis de travail',
                    'Lookup Salaries & Work Permits'
                  )}
                </span>
              </button>
            </div>
          </form>

          {mobError && (
            <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
              {mobError}
            </div>
          )}

          {mobReport && !mobLoading && (
            <section className="bg-white border border-jf-border rounded-xl p-6 sm:p-8 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pb-6 border-b border-jf-border">
                <div>
                  <div className="text-xs text-slate-500">25e percentile</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-jf-navy">
                    {mobReport.salaryBands.p25}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{L(lang, 'Médiane marché', 'Market Median')}</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-jf-blue">
                    {mobReport.salaryBands.median}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">75e percentile</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-jf-navy">
                    {mobReport.salaryBands.p75}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Lead / Executive</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-jf-navy">
                    {mobReport.salaryBands.executive}
                  </div>
                </div>
              </div>

              {salaryChartData.length > 0 && (
                <div className="p-4 bg-jf-ice/70 border border-jf-border rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-jf-navy">
                      <BarChart3 className="w-4 h-4 text-jf-blue" />
                      <span>
                        {L(
                          lang,
                          'Courbe de rémunération estimée',
                          'Compensation Band Visualization'
                        )}{' '}
                        ({mobReport.currency})
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500">
                      {mobCity || mobCountry}
                    </span>
                  </div>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={salaryChartData}
                        margin={{ top: 10, right: 16, left: 4, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#D5EBFA" vertical={false} />
                        <XAxis
                          dataKey="band"
                          tick={{ fontSize: 12, fill: '#06132F' }}
                          axisLine={{ stroke: '#D5EBFA' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#475569' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) =>
                            v >= 1000 ? `${Math.round(Number(v) / 1000)}k` : String(v)
                          }
                        />
                        <Tooltip
                          formatter={(_val, _name, item) => [
                            item?.payload?.raw || _val,
                            mobReport.currency,
                          ]}
                          contentStyle={{
                            backgroundColor: '#06132F',
                            border: '1px solid #102B52',
                            borderRadius: '8px',
                            color: '#FFFFFF',
                            fontSize: '12px',
                          }}
                          cursor={{ fill: '#D5EBFA', opacity: 0.35 }}
                        />
                        <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={56}>
                          {salaryChartData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-jf-navy">
                  {L(lang, 'Contexte marché & fiscalité locale', 'Market & Cost Context')}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">{mobReport.marketContext}</p>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-jf-navy">
                  {L(lang, 'Visas & permis de travail applicables', 'Work Visa & Permit Pathways')}
                </h3>
                <div className="divide-y divide-jf-border border border-jf-border rounded-lg">
                  {mobReport.visaPathways.map((vp, idx) => (
                    <div key={idx} className="p-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-jf-navy">{vp.name}</span>
                        <span className="text-xs font-mono text-slate-600">
                          {vp.typicalTimeline} ·{' '}
                          {vp.employerSponsorshipRequired
                            ? lang === 'fr'
                              ? 'Sponsoring employeur requis'
                              : 'Employer sponsorship required'
                            : lang === 'fr'
                              ? 'Voie directe / autonome'
                              : 'Direct / self-eligible pathway'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{vp.eligibility}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-jf-navy">
                  {L(
                    lang,
                    'Conseils pratiques de négociation & mobilité',
                    'Practical Negotiation & Relocation Tips'
                  )}
                </h3>
                <ul className="space-y-1 text-xs text-slate-700">
                  {mobReport.practicalAdvice.map((tip, i) => (
                    <li key={i}>• {tip}</li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-slate-500 pt-3 border-t border-slate-100">
                {mobReport.disclaimer}
              </p>

              {mobReport.groundingSources && mobReport.groundingSources.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="font-medium text-jf-navy">{tr.common.groundingSources}:</span>
                  {mobReport.groundingSources.slice(0, 5).map((src) => {
                    const safeHref = safeExternalUrl(src.uri);
                    if (!safeHref) return null;
                    return (
                      <a
                        key={src.uri}
                        href={safeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-jf-blue hover:underline inline-flex items-center gap-1"
                      >
                        <span className="truncate max-w-xs">{src.title}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                      </a>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* INTERACTIVE OPENSTREETMAP & LEAFLET LOCATION HUB */}
          <CareerLocationMapHub
            lang={lang}
            defaultCity={mobCity || 'Zurich'}
            defaultCountry={mobCountry || 'Suisse'}
            onSelectLocation={({ country: selectedCtry, city: selectedCty }) => {
              if (selectedCtry) setMobCountry(selectedCtry);
              if (selectedCty) setMobCity(selectedCty);
            }}
          />
        </div>
      )}
    </div>
  );
}
