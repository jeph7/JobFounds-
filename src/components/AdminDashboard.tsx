import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Building2,
  CheckCircle2,
  Cpu,
  Database,
  GitMerge,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  AdminEngineOverview,
  CompanyJobDoc,
  ConversationDoc,
  Lang,
} from '../types';
import {
  adminDeleteCompanyJob,
  adminUpdateCompanyJob,
  subscribeAllCompanyJobsAdmin,
  subscribeAllConversationsAdmin,
  subscribeAllUsersAdmin,
  UserAccountDoc,
} from '../utils/firestoreService';
import {
  adminMergeCompanies,
  adminRetryBackgroundJob,
  adminReviewContact,
  adminReviewSignal,
  adminRunWorkerTickNow,
  adminScanAllCareers,
  adminSendTestEmail,
  adminToggleSource,
  fetchAdminEngineOverview,
  updateIntelligenceCompany,
} from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import { VerificationStatusText } from './StatusText';
import { HostingerDeployPanel } from './HostingerDeployPanel';

interface AdminDashboardProps {
  lang: Lang;
  isAdmin: boolean;
  adminEmail: string | null;
  onNotify: (msg: string) => void;
}

type AdminSubTab = 'engine' | 'companies' | 'signals' | 'contacts' | 'jobs_logs' | 'cloud' | 'deploy';

export function AdminDashboard({
  lang,
  isAdmin,
  adminEmail,
  onNotify,
}: AdminDashboardProps) {
  const [engineData, setEngineData] = useState<AdminEngineOverview | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  const [allJobs, setAllJobs] = useState<CompanyJobDoc[]>([]);
  const [allUsers, setAllUsers] = useState<UserAccountDoc[]>([]);
  const [allConversations, setAllConversations] = useState<ConversationDoc[]>([]);

  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>('engine');
  const [searchTerm, setSearchTerm] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Merge duplicates state
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Resend email test state
  const [testEmailTo, setTestEmailTo] = useState(adminEmail || '');
  const [emailTestResult, setEmailTestResult] = useState<{ sent: boolean; message: string } | null>(null);

  const loadEngineOverview = useCallback(async () => {
    if (!isAdmin) return;
    setEngineLoading(true);
    setEngineError(null);
    try {
      const overview = await fetchAdminEngineOverview();
      setEngineData(overview);
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Unable to load admin engine metrics.');
    } finally {
      setEngineLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadEngineOverview();
    const unsubJobs = subscribeAllCompanyJobsAdmin(setAllJobs);
    const unsubUsers = subscribeAllUsersAdmin(setAllUsers);
    const unsubConvs = subscribeAllConversationsAdmin(setAllConversations);
    return () => {
      unsubJobs();
      unsubUsers();
      unsubConvs();
    };
  }, [isAdmin, loadEngineOverview]);

  const filteredJobs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allJobs.filter(
      (j) => !q || `${j.title} ${j.companyName} ${j.country} ${j.city}`.toLowerCase().includes(q)
    );
  }, [allJobs, searchTerm]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allUsers.filter(
      (u) =>
        !q ||
        `${u.fullName} ${u.email} ${u.companyName || ''} ${u.accountRole}`.toLowerCase().includes(q)
    );
  }, [allUsers, searchTerm]);

  if (!isAdmin) {
    return (
      <section className="bg-white border border-jf-border rounded-xl p-10 text-center space-y-3 max-w-xl mx-auto">
        <Lock className="w-8 h-8 text-jf-navy mx-auto" />
        <h1 className="font-display text-xl font-semibold text-jf-navy">
          {lang === 'fr'
            ? 'Accès réservé aux administrateurs autorisés'
            : 'Authorized Administrator Access Required'}
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          {lang === 'fr'
            ? 'Connectez-vous avec un compte administrateur vérifié pour piloter le moteur de surveillance, modérer les signaux et superviser les sources.'
            : 'Sign in with an authorized administrator account to control the intelligence engine, moderate signals, and manage data sources.'}
        </p>
      </section>
    );
  }

  const m = engineData?.metrics;

  const handleToggleSource = async (sourceId: string, nextEnabled: boolean) => {
    setBusyId(sourceId);
    try {
      await adminToggleSource(sourceId, nextEnabled);
      onNotify(
        nextEnabled
          ? lang === 'fr'
            ? `Source ${sourceId} réactivée.`
            : `Source ${sourceId} resumed.`
          : lang === 'fr'
            ? `Source ${sourceId} mise en pause.`
            : `Source ${sourceId} paused.`
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Toggle failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleWorkerTick = async () => {
    setBusyId('worker_tick');
    try {
      const res = await adminRunWorkerTickNow();
      onNotify(
        lang === 'fr'
          ? `Cycle worker exécuté : ${res.summary.processed} tâche(s) traitée(s) (${res.summary.succeeded} succès, ${res.summary.failed} échec).`
          : `Worker tick done: ${res.summary.processed} processed (${res.summary.succeeded} succeeded, ${res.summary.failed} failed).`
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Worker tick failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewSignal = async (signalId: string, adminStatus: 'verified' | 'rejected') => {
    setBusyId(signalId);
    try {
      await adminReviewSignal(signalId, { adminStatus });
      onNotify(
        adminStatus === 'verified'
          ? lang === 'fr'
            ? 'Signal validé par l’administrateur.'
            : 'Signal verified by admin.'
          : lang === 'fr'
            ? 'Signal rejeté et masqué.'
            : 'Signal rejected.'
      );
      await loadEngineOverview();
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewContact = async (contactId: string, adminStatus: 'verified' | 'rejected') => {
    setBusyId(contactId);
    try {
      await adminReviewContact(contactId, {
        adminStatus,
        confidenceLevel: adminStatus === 'verified' ? 'confirmed' : 'unverified',
      });
      onNotify(
        adminStatus === 'verified'
          ? lang === 'fr'
            ? 'Contact RH confirmé.'
            : 'HR contact verified.'
          : lang === 'fr'
            ? 'Contact RH rejeté.'
            : 'HR contact rejected.'
      );
      await loadEngineOverview();
    } finally {
      setBusyId(null);
    }
  };

  const handleMergeCompanies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) return;
    setBusyId('merge');
    try {
      const res = await adminMergeCompanies(mergeSourceId, mergeTargetId);
      onNotify(
        lang === 'fr'
          ? `Doublons fusionnés dans ${res.company.officialName}.`
          : `Duplicates merged into ${res.company.officialName}.`
      );
      setMergeSourceId('');
      setMergeTargetId('');
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Merge failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await adminRetryBackgroundJob(jobId);
      onNotify(lang === 'fr' ? 'Tâche relancée dans la file.' : 'Job requeued for retry.');
      await loadEngineOverview();
    } finally {
      setBusyId(null);
    }
  };

  const handleVerifyCompany = async (companyId: string) => {
    setBusyId(companyId);
    try {
      await updateIntelligenceCompany(companyId, { verificationStatus: 'Verified' });
      onNotify(lang === 'fr' ? 'Entreprise certifiée Vérifiée.' : 'Company certified Verified.');
      await loadEngineOverview();
    } finally {
      setBusyId(null);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('email_test');
    setEmailTestResult(null);
    try {
      const res = await adminSendTestEmail(testEmailTo.trim() || undefined);
      setEmailTestResult({
        sent: res.emailSent,
        message: res.emailSent
          ? lang === 'fr'
            ? `E-mail réel envoyé via Resend à ${res.recipient}${res.messageId ? ` (ID : ${res.messageId})` : ''}.`
            : `Real email sent via Resend to ${res.recipient}${res.messageId ? ` (ID: ${res.messageId})` : ''}.`
          : res.emailReason,
      });
      onNotify(
        res.emailSent
          ? lang === 'fr'
            ? 'E-mail de test Resend envoyé.'
            : 'Resend test email sent.'
          : res.emailReason
      );
      await loadEngineOverview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test email failed.';
      setEmailTestResult({ sent: false, message: msg });
    } finally {
      setBusyId(null);
    }
  };

  const handleScanAllCareers = async () => {
    setBusyId('scan_all_careers');
    try {
      const res = await adminScanAllCareers();
      const totalActive = res.results.reduce((s, r) => s + r.activeCount, 0);
      const totalAdded = res.results.reduce((s, r) => s + r.addedCount, 0);
      onNotify(
        lang === 'fr'
          ? `Scan ATS terminé : ${res.scannedCount} entreprises analysées · ${totalActive} offres actives (+${totalAdded} nouvelles).`
          : `ATS batch scan complete: ${res.scannedCount} companies scanned · ${totalActive} active jobs (+${totalAdded} new).`
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Batch scan failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCertifyJob = async (
    jobId: string,
    verificationStatus: 'Verified' | 'Partially Verified'
  ) => {
    setBusyId(jobId);
    try {
      await adminUpdateCompanyJob(jobId, { verificationStatus });
      onNotify(lang === 'fr' ? 'Offre employeur mise à jour.' : 'Employer job updated.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteEmployerJob = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await adminDeleteCompanyJob(jobId);
      onNotify(lang === 'fr' ? 'Offre employeur supprimée.' : 'Employer job deleted.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-jf-navy text-white border border-jf-dark rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-jf-sky">
            <Shield className="w-4 h-4" />
            <span>{adminEmail}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold text-white">
            {lang === 'fr'
              ? 'Tableau de Bord d’Administration & Pilotage du Moteur IA'
              : 'Admin Control Dashboard & Recruitment Engine Governance'}
          </h1>
          <p className="text-sm text-jf-soft/90 max-w-3xl">
            {lang === 'fr'
              ? 'Supervision en temps réel des entreprises surveillées, signaux sourcés, contacts RH, file de tâches arrière-plan, budget IA, sources actives et comptes Cloud.'
              : 'Live operational control over monitored companies, sourced signals, HR contacts, background task queue, AI cost budget, active sources, and cloud accounts.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyId === 'worker_tick'}
            onClick={() => void handleWorkerTick()}
            className="px-4 py-2 text-xs font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-lg inline-flex items-center gap-1.5"
          >
            {busyId === 'worker_tick' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{lang === 'fr' ? 'Exécuter 1 cycle worker' : 'Run Worker Tick'}</span>
          </button>
          <button
            type="button"
            disabled={engineLoading}
            onClick={() => void loadEngineOverview()}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-dark border border-jf-sky/30 hover:bg-jf-blue rounded-lg inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${engineLoading ? 'animate-spin' : ''}`} />
            <span>{lang === 'fr' ? 'Actualiser' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {engineError && (
        <div
          role="alert"
          className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-xl text-sm font-medium text-jf-navy"
        >
          {engineError}
        </div>
      )}

      {/* Real Operational KPI Grid */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: lang === 'fr' ? 'Entreprises / Suivies' : 'Companies / Monitored',
            value: m ? `${m.companiesRegistered} / ${m.companiesMonitored}` : '—',
            icon: Database,
          },
          {
            label: lang === 'fr' ? 'Offres Carrières Actives' : 'Active Career Jobs',
            value: m ? `${m.publishedJobsActive} (${m.publishedJobsExpired} exp.)` : '—',
            icon: Activity,
          },
          {
            label: lang === 'fr' ? 'Signaux / Non Publiés' : 'Signals / Unpublished',
            value: m ? `${m.signalsTotal} / ${m.unpublishedOpportunities}` : '—',
            icon: Radar,
          },
          {
            label: lang === 'fr' ? 'Contacts RH / Vérifiés' : 'HR Contacts / Verified',
            value: m ? `${m.contactsTotal} / ${m.contactsVerified}` : '—',
            icon: UserCheck,
          },
          {
            label: lang === 'fr' ? 'Tâches File / Échecs' : 'Jobs Queued / Failed',
            value: m ? `${m.jobsQueued + m.jobsRunning} / ${m.jobsFailed}` : '—',
            icon: Cpu,
          },
          {
            label: lang === 'fr' ? 'Notifs / Coût IA Jour' : 'Notifs / AI Cost Today',
            value: m
              ? `${m.notificationsSent} · $${m.aiUsage.estimatedCostUsdToday.toFixed(3)}`
              : '—',
            icon: Bell,
          },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-white border border-jf-border rounded-xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate">{kpi.label}</span>
                <Icon className="w-3.5 h-3.5 text-jf-blue shrink-0" />
              </div>
              <div className="font-mono text-base font-semibold tabular-nums text-jf-navy">
                {kpi.value}
              </div>
            </div>
          );
        })}
      </section>

      {/* Main Governance Tabs */}
      <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-jf-border">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-jf-ice rounded-lg border border-jf-border">
            {(
              [
                ['engine', lang === 'fr' ? 'Sources & Budget IA' : 'Sources & AI Budget'],
                ['companies', `${lang === 'fr' ? 'Entreprises' : 'Companies'} (${engineData?.companies.length ?? 0})`],
                ['signals', `${lang === 'fr' ? 'Signaux' : 'Signals'} (${engineData?.signals.length ?? 0})`],
                ['contacts', `${lang === 'fr' ? 'Contacts RH' : 'HR Contacts'} (${engineData?.contacts.length ?? 0})`],
                ['jobs_logs', `${lang === 'fr' ? 'Tâches & Audit' : 'Queue & Audit'} (${engineData?.backgroundJobs.length ?? 0})`],
                ['cloud', `${lang === 'fr' ? 'Cloud & Comptes' : 'Cloud & Accounts'} (${allUsers.length})`],
                ['deploy', lang === 'fr' ? 'Déploiement Hostinger' : 'Hostinger Deploy'],
              ] as Array<[AdminSubTab, string]>
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveSubTab(tabKey)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                  activeSubTab === tabKey
                    ? 'bg-jf-navy text-white'
                    : 'text-jf-dark hover:text-jf-navy'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {activeSubTab === 'cloud' && (
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={lang === 'fr' ? 'Filtrer comptes ou offres…' : 'Filter accounts or jobs…'}
              className="px-3 py-1.5 text-xs border border-jf-border rounded-lg w-56"
            />
          )}
        </div>

        {/* TAB 1: SOURCES GOVERNANCE & AI CONSUMPTION */}
        {activeSubTab === 'engine' && (
          <div className="space-y-6">
            {m && (
              <div className="p-4 bg-jf-ice border border-jf-border rounded-xl flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-jf-navy">
                    {lang === 'fr'
                      ? 'Consommation IA quotidienne & garde-fous de coût'
                      : 'Daily AI Usage & Cost Safeguards'}
                  </div>
                  <div className="text-slate-600 font-mono">
                    {m.aiUsage.callsToday} / {m.aiUsage.maxCallsPerDay} calls ·{' '}
                    {m.aiUsage.tokensToday.toLocaleString()} est. tokens · $
                    {m.aiUsage.estimatedCostUsdToday.toFixed(4)} / $
                    {m.aiUsage.maxCostUsdPerDay.toFixed(2)} USD
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded font-mono font-semibold ${
                    m.aiUsage.withinBudget
                      ? 'bg-jf-navy text-jf-sky'
                      : 'bg-jf-soft text-jf-navy border border-jf-dark'
                  }`}
                >
                  {m.aiUsage.withinBudget ? 'BUDGET OK' : 'LIMIT REACHED'}
                </span>
              </div>
            )}

            {/* Resend Real Transactional Email Relay Diagnostics & Live Test */}
            {engineData?.emailConfig && (
              <div className="p-4 bg-white border border-jf-border rounded-xl space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-jf-navy inline-flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-jf-blue" />
                      <span>
                        {lang === 'fr'
                          ? 'Relais E-mail Transactionnel (Resend API)'
                          : 'Transactional Email Relay (Resend API)'}
                      </span>
                    </div>
                    <div className="text-slate-600 font-mono text-[11px]">
                      RESEND_API_KEY: {engineData.emailConfig.resendKeyConfigured ? 'CONFIGURED' : 'MISSING'} ·{' '}
                      NOTIFICATION_FROM_EMAIL:{' '}
                      {engineData.emailConfig.fromEmailConfigured
                        ? engineData.emailConfig.fromEmail
                        : 'MISSING'}
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded font-mono font-semibold ${
                      engineData.emailConfig.ready
                        ? 'bg-jf-navy text-jf-sky'
                        : 'bg-jf-soft text-jf-navy border border-jf-sky'
                    }`}
                  >
                    {engineData.emailConfig.ready
                      ? lang === 'fr'
                        ? 'PRÊT'
                        : 'READY'
                      : lang === 'fr'
                        ? 'NON CONFIGURÉ (IN-APP ACTIF)'
                        : 'NOT CONFIGURED'}
                  </span>
                </div>

                <form onSubmit={handleSendTestEmail} className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    placeholder={adminEmail || 'admin@domain.com'}
                    className="px-3 py-1.5 bg-jf-ice border border-jf-border rounded-lg text-xs min-w-[240px]"
                  />
                  <button
                    type="submit"
                    disabled={busyId === 'email_test'}
                    className="px-3.5 py-1.5 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                  >
                    {busyId === 'email_test' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {lang === 'fr' ? 'Tester l’envoi Resend' : 'Send Resend Test Email'}
                    </span>
                  </button>
                  {!engineData.emailConfig.ready && (
                    <span className="text-[11px] text-slate-500">
                      {lang === 'fr'
                        ? 'Ajoutez RESEND_API_KEY et NOTIFICATION_FROM_EMAIL dans les Secrets serveur pour activer l’envoi.'
                        : 'Set RESEND_API_KEY and NOTIFICATION_FROM_EMAIL in server Secrets to enable delivery.'}
                    </span>
                  )}
                </form>

                {emailTestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] font-medium ${
                      emailTestResult.sent
                        ? 'bg-jf-soft/70 border-jf-blue text-jf-navy'
                        : 'bg-jf-ice border-jf-dark/30 text-jf-dark'
                    }`}
                  >
                    {emailTestResult.message}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto border border-jf-border rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Source / Connecteur' : 'Source'}</th>
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Catégorie' : 'Category'}</th>
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Quota horaire' : 'Hourly Rate'}</th>
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Dernier état' : 'Last Status'}</th>
                    <th className="py-2.5 px-4 font-semibold text-right">{lang === 'fr' ? 'Contrôle' : 'Control'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-jf-border">
                  {(m?.sources || []).map((src) => (
                    <tr key={src.id} className="hover:bg-jf-ice/40">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-jf-navy">{src.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{src.id}</div>
                      </td>
                      <td className="py-3 px-4 font-mono uppercase text-jf-dark">{src.category}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-jf-dark">
                        {src.callsCurrentHour} / {src.rateLimitPerHour} /h
                      </td>
                      <td className="py-3 px-4">
                        {src.lastErrorMessage ? (
                          <span className="text-jf-navy font-medium">
                            Err: {src.lastErrorMessage.slice(0, 70)}
                          </span>
                        ) : src.lastSuccessAt ? (
                          <span className="text-jf-blue font-mono">
                            OK · {src.lastSuccessAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={busyId === src.id}
                          onClick={() => void handleToggleSource(src.id, !src.enabled)}
                          className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 ${
                            src.enabled
                              ? 'bg-jf-soft text-jf-navy hover:bg-jf-sky/60'
                              : 'bg-jf-navy text-white hover:bg-jf-dark'
                          }`}
                        >
                          {src.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>
                            {src.enabled
                              ? lang === 'fr'
                                ? 'Mettre en pause'
                                : 'Pause'
                              : lang === 'fr'
                                ? 'Réactiver'
                                : 'Resume'}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: COMPANIES & DUPLICATE MERGE */}
        {activeSubTab === 'companies' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                {lang === 'fr'
                  ? 'Supervision du portefeuille d’entreprises et synchronisation en lot des pages carrières officielles (Greenhouse, Ashby, Lever, JSON-LD).'
                  : 'Monitored company registry and batch refresh of official ATS/JSON-LD career boards.'}
              </p>
              <button
                type="button"
                disabled={busyId === 'scan_all_careers'}
                onClick={() => void handleScanAllCareers()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
              >
                {busyId === 'scan_all_careers' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>
                  {lang === 'fr'
                    ? 'Scanner toutes les pages carrières ATS'
                    : 'Scan All Monitored ATS Boards'}
                </span>
              </button>
            </div>

            {(engineData?.companies.length ?? 0) >= 2 && (
              <form
                onSubmit={handleMergeCompanies}
                className="p-4 bg-jf-ice border border-jf-border rounded-xl flex flex-wrap items-center gap-3 text-xs"
              >
                <div className="inline-flex items-center gap-1.5 font-semibold text-jf-navy">
                  <GitMerge className="w-4 h-4 text-jf-blue" />
                  <span>{lang === 'fr' ? 'Fusionner un doublon :' : 'Merge Duplicate:'}</span>
                </div>
                <select
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                >
                  <option value="">{lang === 'fr' ? 'Doublon à absorber…' : 'Duplicate source…'}</option>
                  {engineData?.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.officialName} ({c.officialDomain || c.country || c.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">→</span>
                <select
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-jf-border rounded-lg"
                >
                  <option value="">{lang === 'fr' ? 'Fiche cible conservée…' : 'Target company…'}</option>
                  {engineData?.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.officialName} ({c.officialDomain || c.country || c.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || busyId === 'merge'}
                  className="px-3.5 py-1.5 font-semibold text-white bg-jf-navy hover:bg-jf-dark disabled:opacity-50 rounded-lg"
                >
                  {lang === 'fr' ? 'Fusionner' : 'Merge'}
                </button>
              </form>
            )}

            <div className="overflow-x-auto border border-jf-border rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Entreprise' : 'Company'}</th>
                    <th className="py-2.5 px-4 font-semibold">ATS / URL</th>
                    <th className="py-2.5 px-4 font-semibold">{lang === 'fr' ? 'Données' : 'Counts'}</th>
                    <th className="py-2.5 px-4 font-semibold text-right">{lang === 'fr' ? 'Actions' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-jf-border">
                  {(engineData?.companies || []).map((c) => (
                    <tr key={c.id} className="hover:bg-jf-ice/40">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-jf-navy">{c.officialName}</div>
                        <div className="text-slate-500">
                          {c.country || '—'} · {c.sector || '—'} · {c.verificationStatus}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-jf-dark">
                        {c.atsProvider} {c.officialDomain ? `· ${c.officialDomain}` : ''}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-jf-dark">
                        {c.activeJobsCount} jobs · {c.signalsCount} sig · {c.contactsCount} RH
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {c.verificationStatus !== 'Verified' && (
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => void handleVerifyCompany(c.id)}
                            className="px-2.5 py-1 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-md"
                          >
                            {lang === 'fr' ? 'Certifier' : 'Verify'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(engineData?.companies.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        {lang === 'fr'
                          ? 'Aucune entreprise enregistrée dans le moteur.'
                          : 'No companies registered in engine yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: SIGNALS & PROOFS MODERATION */}
        {activeSubTab === 'signals' && (
          <div className="space-y-3">
            {(engineData?.signals || []).length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {lang === 'fr' ? 'Aucun signal détecté.' : 'No signals detected yet.'}
              </div>
            ) : (
              engineData?.signals.map((sig) => {
                const href = safeExternalUrl(sig.sourceUrl);
                return (
                  <div
                    key={sig.id}
                    className="p-4 border border-jf-border rounded-xl flex flex-col lg:flex-row lg:items-start justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono px-2 py-0.5 rounded bg-jf-navy text-jf-sky">
                          {sig.classification}
                        </span>
                        <span className="font-semibold text-jf-navy">{sig.companyName}</span>
                        <span className="font-mono text-slate-500">
                          Fiabilité {sig.reliabilityScore}% · Pertinence {sig.relevanceScore}%
                        </span>
                        <span className="font-mono uppercase px-1.5 py-0.5 rounded bg-jf-ice border border-jf-border">
                          {sig.adminStatus}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-jf-navy">{sig.title}</div>
                      <p className="text-slate-600">{sig.summary}</p>
                      {sig.evidenceText && (
                        <p className="text-slate-500 italic">« {sig.evidenceText} »</p>
                      )}
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-jf-blue hover:underline inline-flex items-center gap-1"
                        >
                          <span>{sig.sourceName || 'Source'}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === sig.id}
                        onClick={() => void handleReviewSignal(sig.id, 'verified')}
                        className="px-3 py-1.5 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg"
                      >
                        {lang === 'fr' ? 'Valider' : 'Verify'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === sig.id}
                        onClick={() => void handleReviewSignal(sig.id, 'rejected')}
                        className="px-3 py-1.5 font-semibold text-jf-navy bg-jf-soft hover:bg-jf-sky/60 rounded-lg"
                      >
                        {lang === 'fr' ? 'Rejeter' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 4: HR CONTACTS MODERATION */}
        {activeSubTab === 'contacts' && (
          <div className="space-y-3">
            {(engineData?.contacts || []).length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {lang === 'fr' ? 'Aucun contact RH enregistré.' : 'No HR contacts recorded yet.'}
              </div>
            ) : (
              engineData?.contacts.map((ct) => {
                const href = safeExternalUrl(ct.publicUrl || ct.sourceUrl);
                return (
                  <div
                    key={ct.id}
                    className="p-4 border border-jf-border rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-jf-navy">{ct.fullName}</span>
                        <span className="text-slate-600">
                          {ct.roleTitle} · {ct.companyName}
                        </span>
                        <span className="font-mono px-1.5 py-0.5 rounded bg-jf-soft text-jf-navy">
                          {ct.confidenceLevel}
                        </span>
                        <span className="font-mono px-1.5 py-0.5 rounded bg-jf-ice border border-jf-border">
                          MX: {ct.domainMxVerified ? 'OK' : 'NO'} · {ct.adminStatus}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {ct.contactChannel} {ct.corporateEmail ? `· ${ct.corporateEmail}` : ''}
                      </div>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-jf-blue hover:underline inline-flex items-center gap-1"
                        >
                          <span>{ct.sourceName || 'Public Source'}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === ct.id}
                        onClick={() => void handleReviewContact(ct.id, 'verified')}
                        className="px-3 py-1.5 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg"
                      >
                        {lang === 'fr' ? 'Valider' : 'Verify'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === ct.id}
                        onClick={() => void handleReviewContact(ct.id, 'rejected')}
                        className="px-3 py-1.5 font-semibold text-jf-navy bg-jf-soft hover:bg-jf-sky/60 rounded-lg"
                      >
                        {lang === 'fr' ? 'Rejeter' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 5: BACKGROUND JOBS QUEUE & AUDIT LOGS */}
        {activeSubTab === 'jobs_logs' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-jf-navy">
                {lang === 'fr' ? 'File des tâches d’arrière-plan' : 'Background Task Queue'}
              </h3>
              <div className="overflow-x-auto border border-jf-border rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                      <th className="py-2 px-3 font-semibold">Type</th>
                      <th className="py-2 px-3 font-semibold">Statut</th>
                      <th className="py-2 px-3 font-semibold">Tentatives</th>
                      <th className="py-2 px-3 font-semibold">Résultat / Erreur</th>
                      <th className="py-2 px-3 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-jf-border">
                    {(engineData?.backgroundJobs || []).slice(0, 25).map((job) => (
                      <tr key={job.id}>
                        <td className="py-2.5 px-3 font-mono text-jf-navy">{job.jobType}</td>
                        <td className="py-2.5 px-3 font-mono uppercase">{job.status}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums">
                          {job.attempts}/{job.maxAttempts}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-md truncate">
                          {job.errorMessage || job.resultSummary || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {job.status === 'failed' && (
                            <button
                              type="button"
                              disabled={busyId === job.id}
                              onClick={() => void handleRetryJob(job.id)}
                              className="px-2.5 py-1 font-semibold text-white bg-jf-blue rounded-md inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Retry</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-jf-navy">
                {lang === 'fr' ? 'Journaux d’audit immuables' : 'Immutable Security & Action Audit Logs'}
              </h3>
              <div className="divide-y divide-jf-border border border-jf-border rounded-xl max-h-72 overflow-y-auto text-xs">
                {(engineData?.auditLogs || []).map((log) => (
                  <div key={log.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="space-x-2">
                      <span className="font-mono font-semibold text-jf-navy">{log.action}</span>
                      <span className="text-slate-500">
                        {log.actorEmail || log.actorUid} ({log.actorRole})
                      </span>
                      <span className="font-mono text-slate-400">
                        {log.targetType}:{log.targetId.slice(0, 14)}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {log.createdAt.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: CLOUD FIRESTORE ACCOUNTS & EMPLOYER JOB MODERATION */}
        {activeSubTab === 'cloud' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: lang === 'fr' ? 'Comptes Cloud' : 'Cloud Accounts', value: allUsers.length, icon: Users },
                { label: lang === 'fr' ? 'Offres Employeurs' : 'Employer Jobs', value: allJobs.length, icon: Building2 },
                {
                  label: lang === 'fr' ? 'Offres Certifiées' : 'Verified Jobs',
                  value: allJobs.filter((j) => j.verificationStatus === 'Verified').length,
                  icon: CheckCircle2,
                },
                { label: lang === 'fr' ? 'Conversations' : 'Conversations', value: allConversations.length, icon: MessageSquare },
              ].map((k) => {
                const Icon = k.icon;
                return (
                  <div key={k.label} className="p-3 bg-jf-ice border border-jf-border rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-500">{k.label}</div>
                      <div className="font-mono text-lg font-semibold text-jf-navy">{k.value}</div>
                    </div>
                    <Icon className="w-4 h-4 text-jf-blue" />
                  </div>
                );
              })}
            </div>

            {/* Employer Jobs Moderation */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-jf-navy inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-jf-blue" />
                <span>{lang === 'fr' ? 'Modération des offres employeurs' : 'Employer Job Moderation'}</span>
              </h3>
              <div className="overflow-x-auto border border-jf-border rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                      <th className="py-2.5 px-4 font-semibold">Offre</th>
                      <th className="py-2.5 px-4 font-semibold">Statut</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-jf-border">
                    {filteredJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-jf-navy">{job.title}</div>
                          <div className="text-slate-500">
                            {job.companyName} · {job.city}, {job.country}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <VerificationStatusText status={job.verificationStatus} lang={lang} />
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() =>
                              void handleCertifyJob(
                                job.id,
                                job.verificationStatus === 'Verified' ? 'Partially Verified' : 'Verified'
                              )
                            }
                            className="px-2.5 py-1 font-semibold text-white bg-jf-blue rounded-md"
                          >
                            {job.verificationStatus === 'Verified' ? 'Partielle' : 'Certifier'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => void handleDeleteEmployerJob(job.id)}
                            className="p-1 text-slate-500 hover:text-jf-navy"
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cloud Accounts */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-jf-navy">
                {lang === 'fr' ? 'Comptes utilisateurs enregistrés' : 'Registered Cloud Accounts'}
              </h3>
              <div className="overflow-x-auto border border-jf-border rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                      <th className="py-2.5 px-4 font-semibold">Utilisateur</th>
                      <th className="py-2.5 px-4 font-semibold">Rôle & Langue</th>
                      <th className="py-2.5 px-4 font-semibold">RGPD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-jf-border">
                    {filteredUsers.map((u) => (
                      <tr key={u.uid}>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-jf-navy">{u.fullName}</div>
                          <div className="font-mono text-slate-500">{u.email}</div>
                        </td>
                        <td className="py-3 px-4">
                          {u.accountRole} · <span className="font-mono uppercase">{u.lang}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {u.discoverable ? 'Annuaire ON' : 'Privé'} ·{' '}
                          {u.gdprConsent ? 'RGPD OK' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: HOSTINGER PRODUCTION DEPLOYMENT CENTER */}
        {activeSubTab === 'deploy' && (
          <HostingerDeployPanel lang={lang} onNotify={onNotify} />
        )}
      </section>
    </div>
  );
}
