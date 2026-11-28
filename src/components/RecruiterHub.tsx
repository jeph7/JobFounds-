import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Download,
  Inbox,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  AccountRole,
  ApplicationSubmissionRecord,
  CompanyJobDoc,
  ContractType,
  ConversationDoc,
  EmployerApplicationStatus,
  Lang,
  MessageDoc,
  PublicCandidateDoc,
  RecruiterFinderResult,
  WorkMode,
} from '../types';
import {
  closeServerEmployerJob,
  createServerEmployerJob,
  downloadSubmissionAttachment,
  fetchEmployerApplications,
  findRecruiters,
  respondToEmployerApplicationApi,
} from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import {
  closeCompanyJob,
  createOrOpenConversation,
  publishCompanyJob,
  sendConversationMessage,
  subscribeConversationMessages,
} from '../utils/firestoreService';
import { VerificationStatusText } from './StatusText';

interface RecruiterHubProps {
  lang: Lang;
  uid: string | null;
  googleSignedIn?: boolean;
  userDisplayName: string;
  accountRole: AccountRole;
  companyNameDefault: string;
  companyWebsiteDefault: string;
  companyJobs: CompanyJobDoc[];
  publicCandidates: PublicCandidateDoc[];
  conversations: ConversationDoc[];
  onRefreshEmployerJobs?: () => void;
  onRequireSignIn: () => void;
  onNotify: (msg: string) => void;
}

export function RecruiterHub({
  lang,
  uid,
  googleSignedIn = false,
  userDisplayName,
  accountRole,
  companyNameDefault,
  companyWebsiteDefault,
  companyJobs,
  publicCandidates,
  conversations,
  onRefreshEmployerJobs,
  onRequireSignIn,
  onNotify,
}: RecruiterHubProps) {
  const [subTab, setSubTab] = useState<'directory' | 'portal' | 'inbox' | 'messages'>('directory');

  // 1. Verified HR / Recruiter Finder
  const [finderCompany, setFinderCompany] = useState('');
  const [finderCountry, setFinderCountry] = useState('');
  const [finderDept, setFinderDept] = useState('');
  const [finderLoading, setFinderLoading] = useState(false);
  const [finderError, setFinderError] = useState<string | null>(null);
  const [finderResult, setFinderResult] = useState<RecruiterFinderResult | null>(null);

  // 2. Employer Portal Job Publishing
  const [jobTitle, setJobTitle] = useState('');
  const [jobCompany, setJobCompany] = useState(companyNameDefault);
  const [jobWebsite, setJobWebsite] = useState(companyWebsiteDefault);
  const [jobCountry, setJobCountry] = useState('');
  const [jobCity, setJobCity] = useState('');
  const [jobWorkMode, setJobWorkMode] = useState<WorkMode>('Hybrid');
  const [jobContract, setJobContract] = useState<ContractType>('Full-time');
  const [jobSalary, setJobSalary] = useState('');
  const [jobSkills, setJobSkills] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [publishing, setPublishing] = useState(false);

  // 2b. Employer Received Direct Applications Inbox
  const [receivedApps, setReceivedApps] = useState<ApplicationSubmissionRecord[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, EmployerApplicationStatus>>({});
  const [replySubmittingId, setReplySubmittingId] = useState<string | null>(null);

  const loadEmployerInbox = async () => {
    if (!uid) return;
    setInboxLoading(true);
    setInboxError(null);
    try {
      const res = await fetchEmployerApplications(60);
      setReceivedApps(res.applications || []);
    } catch (err) {
      setInboxError(err instanceof Error ? err.message : 'Impossible de charger les candidatures reçues.');
    } finally {
      setInboxLoading(false);
    }
  };

  useEffect(() => {
    if (uid) {
      void loadEmployerInbox();
    } else {
      setReceivedApps([]);
    }
  }, [uid]);

  const handleEmployerRespond = async (app: ApplicationSubmissionRecord) => {
    if (!uid) {
      onRequireSignIn();
      return;
    }
    const replyMessage = (replyDrafts[app.id] || '').trim();
    const status: EmployerApplicationStatus = statusDrafts[app.id] || app.employerStatus || 'under_review';
    if (replyMessage.length < 2) {
      setInboxError(lang === 'fr' ? 'Saisissez un message de réponse pour le candidat.' : 'Enter a reply message for the candidate.');
      return;
    }
    setReplySubmittingId(app.id);
    setInboxError(null);
    try {
      const res = await respondToEmployerApplicationApi(app.id, { status, replyMessage });
      setReceivedApps((prev) => prev.map((item) => (item.id === app.id ? res.submission : item)));
      setReplyDrafts((prev) => ({ ...prev, [app.id]: '' }));
      // Mirror reply into Firestore direct conversation so candidate sees it in real time
      try {
        const convId = await createOrOpenConversation({
          candidateId: app.userId,
          recruiterId: uid,
          candidateName: app.candidateName || app.candidateEmail || 'Candidat',
          recruiterName: userDisplayName || app.companyName,
          companyName: app.companyName,
          jobTitle: app.roleTitle,
        });
        await sendConversationMessage({
          conversationId: convId,
          senderId: uid,
          recipientId: app.userId,
          senderName: userDisplayName || app.companyName,
          body: `[Statut : ${status}]\n${replyMessage}`,
        });
      } catch {
        // Non-blocking: SQLite reply + candidate notification already saved
      }
      onNotify(
        lang === 'fr'
          ? `Réponse envoyée à ${app.candidateName || 'candidat'} et synchronisée dans son suivi CRM.`
          : `Reply sent to ${app.candidateName || 'candidate'} and synced to their CRM.`
      );
    } catch (err) {
      setInboxError(err instanceof Error ? err.message : 'Échec de l’envoi de la réponse.');
    } finally {
      setReplySubmittingId(null);
    }
  };

  // 3. Direct Messaging
  const [activeConvId, setActiveConvId] = useState<string>(conversations[0]?.id ?? '');
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  useEffect(() => {
    if (!activeConvId && conversations[0]?.id) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  useEffect(() => {
    if (!uid || !activeConvId) {
      setMessages([]);
      return;
    }
    const unsub = subscribeConversationMessages(activeConvId, uid, setMessages);
    return () => unsub();
  }, [uid, activeConvId]);

  const activeConversation = conversations.find((c) => c.id === activeConvId) ?? null;

  const handleFindRecruiters = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finderCompany.trim()) return;
    setFinderLoading(true);
    setFinderError(null);
    try {
      const res = await findRecruiters({
        company: finderCompany,
        country: finderCountry,
        department: finderDept,
        lang,
      });
      setFinderResult(res);
    } catch (err) {
      setFinderError(err instanceof Error ? err.message : 'Recruiter lookup failed.');
    } finally {
      setFinderLoading(false);
    }
  };

  const handlePublishJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) {
      onRequireSignIn();
      return;
    }
    if (!jobTitle.trim() || !jobCompany.trim() || !jobDesc.trim()) return;
    setPublishing(true);
    try {
      const payload = {
        companyName: jobCompany.trim(),
        companyWebsite: jobWebsite.trim(),
        title: jobTitle.trim(),
        country: jobCountry.trim() || 'International',
        city: jobCity.trim() || 'Remote',
        workMode: jobWorkMode,
        contractType: jobContract,
        salaryRange: jobSalary.trim() || 'Non communiqué',
        skills: jobSkills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        languages: ['Français', 'Anglais'],
        description: jobDesc.trim(),
        experienceLevel: 'Mid-Senior',
        degreeRequired: 'Non spécifié',
        visaSponsorship: 'Case-by-case',
      };
      // Universal SQLite persistence (works for both Email/Password AND Google employers)
      await createServerEmployerJob(payload);
      // Optional Firestore mirror when signed in with Google
      if (googleSignedIn) {
        publishCompanyJob(uid, payload).catch(() => {});
      }
      onRefreshEmployerJobs?.();
      setJobTitle('');
      setJobDesc('');
      setJobSalary('');
      setJobSkills('');
      onNotify(
        lang === 'fr'
          ? 'Offre entreprise publiée et synchronisée dans la recherche mondiale.'
          : 'Employer job posted and synced to Global Job Search.'
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : lang === 'fr'
            ? 'Impossible de publier l’offre.'
            : 'Unable to publish employer job.'
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleCloseJob = async (job: CompanyJobDoc) => {
    if (!uid) return;
    try {
      if (job.id.startsWith('empjob_')) {
        await closeServerEmployerJob(job.id);
      } else if (googleSignedIn) {
        await closeCompanyJob(job.id);
      } else {
        await closeServerEmployerJob(job.id);
      }
      onRefreshEmployerJobs?.();
      onNotify(
        lang === 'fr' ? 'Offre clôturée avec succès.' : 'Job posting closed successfully.'
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : lang === 'fr'
            ? 'Impossible de clôturer cette offre.'
            : 'Unable to close this job.'
      );
    }
  };

  const handleStartMessageWithCandidate = async (candidate: PublicCandidateDoc) => {
    if (!uid) {
      onRequireSignIn();
      return;
    }
    if (candidate.userId === uid) {
      onNotify(
        lang === 'fr'
          ? 'Vous consultez votre propre fiche publique.'
          : 'This is your own public discovery profile.'
      );
      return;
    }
    const convId = await createOrOpenConversation({
      candidateId: candidate.userId,
      recruiterId: uid,
      candidateName: candidate.displayName,
      recruiterName: userDisplayName,
      companyName: jobCompany || companyNameDefault || 'Entreprise',
      jobTitle: candidate.headline,
    });
    setActiveConvId(convId);
    setSubTab('messages');
  };

  const handleStartMessageWithEmployer = async (job: CompanyJobDoc) => {
    if (!uid) {
      onRequireSignIn();
      return;
    }
    if (job.recruiterId === uid) {
      onNotify(
        lang === 'fr'
          ? 'Vous êtes l’auteur de cette offre.'
          : 'You are the recruiter who posted this role.'
      );
      return;
    }
    const convId = await createOrOpenConversation({
      candidateId: uid,
      recruiterId: job.recruiterId,
      candidateName: userDisplayName,
      recruiterName: job.companyName,
      companyName: job.companyName,
      jobTitle: job.title,
    });
    setActiveConvId(convId);
    setSubTab('messages');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !activeConversation || !msgInput.trim()) return;
    setSendingMsg(true);
    try {
      const recipientId =
        activeConversation.candidateId === uid
          ? activeConversation.recruiterId
          : activeConversation.candidateId;
      await sendConversationMessage({
        conversationId: activeConversation.id,
        senderId: uid,
        recipientId,
        senderName: userDisplayName,
        body: msgInput,
      });
      setMsgInput('');
    } finally {
      setSendingMsg(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold text-slate-900">
              {lang === 'fr'
                ? 'Annuaire RH vérifié, Portail Recruteurs & Messagerie directe'
                : 'Verified HR Finder, Employer Portal & Direct Messaging'}
            </h1>
            <p className="text-sm text-slate-600">
              {lang === 'fr'
                ? 'Identifiez les responsables RH publics, publiez des offres entreprises, découvrez des candidats consentants (sans PII exposée) et échangez directement.'
                : 'Identify verified public HR leaders, publish employer jobs, discover opt-in candidates (zero PII exposed), and message directly.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubTab('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'directory'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Annuaire RH IA' : 'HR Finder'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('portal')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'portal'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>
                {lang === 'fr' ? 'Portail Entreprises' : 'Employer Portal'} ({companyJobs.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('inbox')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'inbox'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>
                {lang === 'fr' ? 'Candidatures reçues' : 'Received Applications'} ({receivedApps.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('messages')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                subTab === 'messages'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>
                {lang === 'fr' ? 'Messagerie directe' : 'Direct Messages'} ({conversations.length})
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* TAB 1: VERIFIED HR & RECRUITER DECISION-MAKER FINDER */}
      {subTab === 'directory' && (
        <div className="space-y-6">
          <form
            onSubmit={handleFindRecruiters}
            className="bg-white border border-slate-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-12 gap-3"
          >
            <input
              type="text"
              required
              value={finderCompany}
              onChange={(e) => setFinderCompany(e.target.value)}
              placeholder={
                lang === 'fr'
                  ? 'Nom de l’entreprise (ex. Qonto, Mistral AI, ABB…)'
                  : 'Company name (e.g. Qonto, Mistral AI, ABB…)'
              }
              className="md:col-span-4 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
            <input
              type="text"
              value={finderCountry}
              onChange={(e) => setFinderCountry(e.target.value)}
              placeholder={lang === 'fr' ? 'Pays / Région' : 'Country / Region'}
              className="md:col-span-3 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
            <input
              type="text"
              value={finderDept}
              onChange={(e) => setFinderDept(e.target.value)}
              placeholder={lang === 'fr' ? 'Département (Tech, Product, Finance…)' : 'Department (Tech, Product, Finance…)'}
              className="md:col-span-3 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
            <button
              type="submit"
              disabled={finderLoading}
              className="md:col-span-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {finderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>{lang === 'fr' ? 'Identifier RH' : 'Find HR'}</span>
            </button>
          </form>

          {finderError && (
            <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
              {finderError}
            </div>
          )}

          {finderResult && !finderLoading && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                    <VerificationStatusText status={finderResult.emailDomainStatus} lang={lang} />
                    {finderResult.officialDomain && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono text-slate-700">{finderResult.officialDomain}</span>
                      </>
                    )}
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-medium ${
                        finderResult.domainMxVerified
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {finderResult.domainMxVerified
                        ? lang === 'fr'
                          ? 'DNS MX vérifié'
                          : 'DNS MX Verified'
                        : lang === 'fr'
                          ? 'DNS MX non confirmé'
                          : 'DNS MX Unconfirmed'}
                    </span>
                  </div>
                  <h2 className="font-display text-xl font-semibold text-slate-900">
                    {finderCompany}
                  </h2>
                  <p className="text-sm text-slate-600">{finderResult.companyOverview}</p>
                </div>
                {safeExternalUrl(finderResult.careersPortalUrl) && (
                  <a
                    href={safeExternalUrl(finderResult.careersPortalUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <span>{lang === 'fr' ? 'Portail Carrières' : 'Careers Portal'}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {finderResult.contacts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-200 rounded-lg space-y-1.5">
                  <p className="font-semibold text-slate-800">
                    {lang === 'fr'
                      ? 'Aucun contact RH publiquement vérifiable trouvé pour cette entreprise.'
                      : 'No publicly verifiable HR contact found for this company.'}
                  </p>
                  <p>
                    {lang === 'fr'
                      ? 'JOBFOUNDS n’invente jamais de nom ni d’adresse e-mail pour remplir l’annuaire. Utilisez directement le portail carrières officiel ci-dessus.'
                      : 'JOBFOUNDS never fabricates contact names or emails to fill results. Please apply directly through the official careers portal above.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {finderResult.contacts.map((c, idx) => {
                    const conf = c.confidenceLevel || (c.publicUrl ? 'probable' : 'unverified');
                    const confStyle =
                      conf === 'confirmed'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : conf === 'probable'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200';
                    const confLabel =
                      conf === 'confirmed'
                        ? lang === 'fr'
                          ? 'Contact vérifié (source publique)'
                          : 'Verified (public source)'
                        : conf === 'probable'
                          ? lang === 'fr'
                            ? 'Probable (à vérifier)'
                            : 'Probable (verify)'
                          : lang === 'fr'
                            ? 'Non vérifié'
                            : 'Unverified';
                    return (
                      <div key={idx} className="py-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {c.nameOrTitle}{' '}
                              <span className="font-normal text-slate-500">— {c.role}</span>
                            </span>
                            <span className={`px-2 py-0.5 text-[11px] font-medium rounded border ${confStyle}`}>
                              {confLabel}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2">
                            <span>{c.location}</span>
                            <span aria-hidden="true">·</span>
                            <span>{c.channel}</span>
                            {c.corporateEmail && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-jf-blue font-medium">
                                  {c.corporateEmail}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 pt-0.5">{c.verificationNote}</p>
                          <p className="text-xs text-slate-800">
                            <span className="font-semibold">
                              {lang === 'fr' ? 'Angle d’approche : ' : 'Approach tip: '}
                            </span>
                            {c.outreachTip}
                          </p>
                        </div>
                        {safeExternalUrl(c.publicUrl) && (
                          <a
                            href={safeExternalUrl(c.publicUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <span>{lang === 'fr' ? 'Source officielle' : 'Official source'}</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* TAB 2: EMPLOYER PORTAL & OPT-IN CANDIDATE DIRECTORY */}
      {subTab === 'portal' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Publish Employer Job */}
          <form
            onSubmit={handlePublishJob}
            className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="space-y-1 pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Publier une offre entreprise' : 'Publish Employer Job'}
              </h2>
              <p className="text-xs text-slate-500">
                {uid
                  ? lang === 'fr'
                    ? `Connecté en mode ${accountRole === 'recruiter' ? 'Recruteur' : 'Candidat (publication autorisée)'}. Les offres ouvertes apparaissent immédiatement dans la recherche mondiale (compte E-mail ou Google).`
                    : `Signed in (${accountRole}). Open roles appear live in Global Job Search (Email or Google account).`
                  : lang === 'fr'
                    ? 'Connectez-vous (E-mail vérifié ou Google) pour publier une offre entreprise.'
                    : 'Sign in (verified Email or Google) to publish live employer roles.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={jobCompany}
                onChange={(e) => setJobCompany(e.target.value)}
                placeholder={lang === 'fr' ? 'Entreprise' : 'Company'}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="url"
                value={jobWebsite}
                onChange={(e) => setJobWebsite(e.target.value)}
                placeholder="https://company.com"
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                required
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder={lang === 'fr' ? 'Intitulé du poste' : 'Job Title'}
                className="sm:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                required
                value={jobCountry}
                onChange={(e) => setJobCountry(e.target.value)}
                placeholder={lang === 'fr' ? 'Pays' : 'Country'}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                required
                value={jobCity}
                onChange={(e) => setJobCity(e.target.value)}
                placeholder={lang === 'fr' ? 'Ville' : 'City'}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <select
                value={jobWorkMode}
                onChange={(e) => setJobWorkMode(e.target.value as WorkMode)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="Hybrid">Hybrid</option>
                <option value="Remote">Remote</option>
                <option value="On-site">On-site</option>
              </select>
              <select
                value={jobContract}
                onChange={(e) => setJobContract(e.target.value as ContractType)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
                <option value="Freelance">Freelance</option>
              </select>
              <input
                type="text"
                value={jobSalary}
                onChange={(e) => setJobSalary(e.target.value)}
                placeholder={lang === 'fr' ? 'Salaire (ex. 70-85k EUR)' : 'Salary range'}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={jobSkills}
                onChange={(e) => setJobSkills(e.target.value)}
                placeholder={lang === 'fr' ? 'Compétences (virgules)' : 'Skills (comma-separated)'}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <textarea
                rows={3}
                required
                minLength={10}
                value={jobDesc}
                onChange={(e) => setJobDesc(e.target.value)}
                placeholder={lang === 'fr' ? 'Description du poste et responsabilités…' : 'Role description and responsibilities…'}
                className="sm:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={publishing}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-2"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>
                {uid
                  ? lang === 'fr'
                    ? 'Publier l’offre en direct'
                    : 'Publish Live Role'
                  : lang === 'fr'
                    ? 'Se connecter pour publier'
                    : 'Sign in to Publish'}
              </span>
            </button>
          </form>

          {/* Right column: Published Employer Jobs + Opt-in Candidate Directory */}
          <div className="xl:col-span-7 space-y-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {lang === 'fr'
                  ? 'Offres publiées directement par les entreprises'
                  : 'Direct Employer Job Postings'}
              </h2>
              {companyJobs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {uid
                    ? lang === 'fr'
                      ? 'Aucune offre entreprise publiée pour le moment.'
                      : 'No direct employer roles published yet.'
                    : lang === 'fr'
                      ? 'Connectez-vous pour consulter et contacter les entreprises membres.'
                      : 'Sign in to view and message direct employer listings.'}
                </p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {companyJobs.map((job) => (
                    <div key={job.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{job.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {job.companyName} · {job.city}, {job.country} · {job.workMode} ·{' '}
                          {job.salaryRange || '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {uid && job.recruiterId === uid ? (
                          <button
                            type="button"
                            onClick={() => void handleCloseJob(job)}
                            className="px-3 py-1.5 text-xs font-medium text-jf-navy bg-jf-soft hover:bg-jf-sky/70 border border-jf-sky rounded-lg inline-flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{lang === 'fr' ? 'Clôturer' : 'Close role'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartMessageWithEmployer(job)}
                            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg inline-flex items-center gap-1"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>{lang === 'fr' ? 'Contacter' : 'Message'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span>
                    {lang === 'fr'
                      ? 'Annuaire des candidats consentants (PII protégée)'
                      : 'Opt-In Candidate Directory (PII Protected)'}
                  </span>
                </h2>
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {publicCandidates.length}
                </span>
              </div>
              {publicCandidates.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {lang === 'fr'
                    ? 'Aucun profil candidat n’a encore activé la visibilité recruteur (activable dans Compte & RGPD).'
                    : 'No candidates have opted into recruiter discovery yet (toggleable in Account & Privacy).'}
                </p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {publicCandidates.map((cand) => (
                    <div key={cand.userId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {cand.displayName}{' '}
                          <span className="font-mono text-xs font-normal text-slate-500">
                            · {cand.yearsExperience} {lang === 'fr' ? 'ans' : 'yrs'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-700">{cand.headline}</div>
                        {cand.skills && cand.skills.length > 0 && (
                          <div className="text-xs text-slate-500">
                            {cand.skills.slice(0, 6).join(' · ')}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartMessageWithCandidate(cand)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{lang === 'fr' ? 'Écrire au candidat' : 'Message Candidate'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* TAB 2B: EMPLOYER DIRECT APPLICATIONS INBOX */}
      {subTab === 'inbox' && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fr'
                  ? 'Candidatures directes reçues via JOBFOUNDS'
                  : 'Direct Applications Received via JOBFOUNDS'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'fr'
                  ? 'Consultez les informations candidat, téléchargez les CV et documents joints, mettez à jour le statut et répondez directement.'
                  : 'Review candidate details, download attached CVs/documents, update status, and reply directly.'}
              </p>
            </div>
            {uid && (
              <button
                type="button"
                onClick={() => void loadEmployerInbox()}
                disabled={inboxLoading}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${inboxLoading ? 'animate-spin' : ''}`} />
                <span>{lang === 'fr' ? 'Actualiser' : 'Refresh'}</span>
              </button>
            )}
          </div>

          {!uid ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-700">
                {lang === 'fr'
                  ? 'Connectez-vous à votre compte employeur pour consulter les candidatures directes reçues.'
                  : 'Sign in with your employer account to inspect direct applications.'}
              </p>
              <button
                type="button"
                onClick={onRequireSignIn}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                {lang === 'fr' ? 'Connexion Google' : 'Sign in with Google'}
              </button>
            </div>
          ) : (
            <>
              {inboxError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {inboxError}
                </div>
              )}

              {inboxLoading && receivedApps.length === 0 ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{lang === 'fr' ? 'Chargement des candidatures…' : 'Loading applications…'}</span>
                </div>
              ) : receivedApps.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  {lang === 'fr'
                    ? 'Aucune candidature directe reçue pour le moment. Publiez une offre dans l’onglet Portail Entreprises pour recevoir des dossiers ici.'
                    : 'No direct applications received yet. Publish an opening in the Employer Portal tab to receive dossiers here.'}
                </div>
              ) : (
                <div className="space-y-4">
                  {receivedApps.map((app) => {
                    const currentStatus = statusDrafts[app.id] || app.employerStatus || 'received';
                    return (
                      <article key={app.id} className="border border-slate-200 rounded-xl p-5 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-slate-900">
                              {app.candidateName || app.candidateEmail || 'Candidat'}{' '}
                              <span className="font-normal text-slate-500">
                                ({app.candidateEmail || 'e-mail vérifié'})
                              </span>
                            </div>
                            <div className="text-xs text-slate-600">
                              {lang === 'fr' ? 'Poste :' : 'Role:'}{' '}
                              <span className="font-medium text-slate-900">{app.roleTitle}</span> ·{' '}
                              {app.companyName} ·{' '}
                              <span className="font-mono text-slate-500">
                                {app.createdAt.slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                            {app.cvVersionName && (
                              <div className="text-xs text-slate-500">
                                CV : {app.cvVersionName}
                              </div>
                            )}
                          </div>
                          <span className="px-2.5 py-1 text-[11px] font-mono rounded-md border border-slate-200 bg-slate-50 text-slate-800">
                            {app.employerStatus || 'received'}
                          </span>
                        </div>

                        {/* Cover Letter */}
                        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 whitespace-pre-line max-h-48 overflow-y-auto">
                          {app.coverLetterFull || app.coverLetterPreview}
                        </div>

                        {/* Downloadable Attachments */}
                        {app.attachments.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600 inline-flex items-center gap-1">
                              <Paperclip className="w-3.5 h-3.5" />
                              {lang === 'fr' ? 'Documents joints :' : 'Attachments:'}
                            </span>
                            {app.attachments.map((att, idx) => (
                              <button
                                key={`${app.id}_att_${idx}`}
                                type="button"
                                onClick={() =>
                                  void downloadSubmissionAttachment(app.id, idx, att.filename).catch((err) =>
                                    setInboxError(err instanceof Error ? err.message : 'Download failed')
                                  )
                                }
                                className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md inline-flex items-center gap-1.5"
                              >
                                <Download className="w-3 h-3" />
                                <span>{att.filename}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Existing Employer Reply */}
                        {app.employerReply && (
                          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-950 space-y-1">
                            <div className="font-semibold inline-flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>
                                {lang === 'fr' ? 'Dernière réponse envoyée' : 'Last reply sent'}
                                {app.employerRepliedAt
                                  ? ` · ${app.employerRepliedAt.slice(0, 16).replace('T', ' ')}`
                                  : ''}
                              </span>
                            </div>
                            <p className="whitespace-pre-line">{app.employerReply}</p>
                          </div>
                        )}

                        {/* Status Update & Reply Form */}
                        <div className="pt-3 border-t border-slate-100 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs font-medium text-slate-700">
                              {lang === 'fr' ? 'Décision / Statut :' : 'Status:'}
                            </label>
                            <select
                              value={currentStatus}
                              onChange={(e) =>
                                setStatusDrafts((prev) => ({
                                  ...prev,
                                  [app.id]: e.target.value as EmployerApplicationStatus,
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                            >
                              <option value="under_review">
                                {lang === 'fr' ? 'En cours d’examen' : 'Under Review'}
                              </option>
                              <option value="interview_scheduled">
                                {lang === 'fr' ? 'Entretien proposé' : 'Interview Scheduled'}
                              </option>
                              <option value="offer_received">
                                {lang === 'fr' ? 'Offre proposée' : 'Offer Extended'}
                              </option>
                              <option value="message_received">
                                {lang === 'fr' ? 'Message / Question' : 'Message / Question'}
                              </option>
                              <option value="rejected">
                                {lang === 'fr' ? 'Non retenu' : 'Rejected'}
                              </option>
                            </select>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={replyDrafts[app.id] || ''}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({ ...prev, [app.id]: e.target.value }))
                              }
                              placeholder={
                                lang === 'fr'
                                  ? 'Répondre au candidat (ex. créneau d’entretien, demande de précisions…)'
                                  : 'Reply to candidate (e.g. interview slot, follow-up question…)'
                              }
                              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                            />
                            <button
                              type="button"
                              disabled={replySubmittingId === app.id}
                              onClick={() => void handleEmployerRespond(app)}
                              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                              {replySubmittingId === app.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              <span>{lang === 'fr' ? 'Envoyer la réponse' : 'Send Reply'}</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* TAB 3: DIRECT MESSAGING */}
      {subTab === 'messages' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
          {!uid ? (
            <div className="lg:col-span-12 p-12 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900">
                {lang === 'fr'
                  ? 'Connectez-vous pour accéder à la messagerie sécurisée candidat ↔ recruteur.'
                  : 'Sign in with Google to use direct candidate-recruiter messaging.'}
              </p>
              <button
                type="button"
                onClick={onRequireSignIn}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                {lang === 'fr' ? 'Connexion Google' : 'Sign in with Google'}
              </button>
            </div>
          ) : (
            <>
              <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 divide-y divide-slate-200">
                {conversations.length === 0 ? (
                  <div className="p-6 text-xs text-slate-500">
                    {lang === 'fr'
                      ? 'Aucune conversation active. Contactez une entreprise ou un candidat depuis le Portail Entreprises.'
                      : 'No active threads yet. Start one from the Employer Portal.'}
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setActiveConvId(conv.id)}
                      className={`w-full text-left p-4 transition-colors block ${
                        activeConvId === conv.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {conv.companyName} — {conv.jobTitle}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {conv.candidateId === uid ? conv.recruiterName : conv.candidateName}
                      </div>
                      {conv.lastMessage && (
                        <div className="text-xs text-slate-600 mt-1 truncate">
                          {conv.lastMessage}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>

              <div className="lg:col-span-8 flex flex-col">
                {activeConversation ? (
                  <>
                    <div className="p-4 border-b border-slate-200">
                      <div className="text-sm font-semibold text-slate-900">
                        {activeConversation.jobTitle}
                      </div>
                      <div className="text-xs text-slate-500">
                        {activeConversation.companyName} · {activeConversation.candidateName} ↔{' '}
                        {activeConversation.recruiterName}
                      </div>
                    </div>

                    <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-96">
                      {messages.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          {lang === 'fr'
                            ? 'Démarrez l’échange professionnel ci-dessous.'
                            : 'Start the conversation below.'}
                        </p>
                      ) : (
                        messages.map((m) => {
                          const mine = m.senderId === uid;
                          return (
                            <div
                              key={m.id}
                              className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-md rounded-lg px-3.5 py-2.5 text-sm ${
                                  mine
                                    ? 'bg-blue-700 text-white'
                                    : 'bg-slate-100 text-slate-900'
                                }`}
                              >
                                <div
                                  className={`text-[11px] mb-1 ${
                                    mine ? 'text-blue-100' : 'text-slate-500'
                                  }`}
                                >
                                  {m.senderName}
                                </div>
                                <p className="whitespace-pre-line">{m.body}</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form
                      onSubmit={handleSendMessage}
                      className="p-4 border-t border-slate-200 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={msgInput}
                        onChange={(e) => setMsgInput(e.target.value)}
                        placeholder={
                          lang === 'fr' ? 'Écrire un message professionnel…' : 'Write a message…'
                        }
                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                      <button
                        type="submit"
                        disabled={sendingMsg || !msgInput.trim()}
                        className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{lang === 'fr' ? 'Envoyer' : 'Send'}</span>
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-8 text-xs text-slate-500">
                    {lang === 'fr'
                      ? 'Sélectionnez une conversation.'
                      : 'Select a conversation thread.'}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
