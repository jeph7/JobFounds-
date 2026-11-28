import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Ban,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Eye,
  FileCheck2,
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
  ShieldOff,
  ShieldPlus,
  Trash2,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { auth } from '../firebase';
import {
  AdminEngineOverview,
  CompanyJobDoc,
  ConversationDoc,
  Lang,
} from '../types';
import {
  adminDeleteCompanyJob,
  adminFetchFirestoreUserDetails,
  adminGrantFirestoreAdmin,
  adminModerateFirestoreUser,
  adminRevokeFirestoreAdmin,
  adminUpdateCompanyJob,
  BOOTSTRAP_ADMIN_EMAIL,
  FirestoreAdminGrant,
  subscribeAllAdminsFirestore,
  subscribeAllCompanyJobsAdmin,
  subscribeAllConversationsAdmin,
  subscribeAllUsersAdmin,
  UserAccountDoc,
} from '../utils/firestoreService';
import {
  adminGrantAdminRole,
  adminMergeCompanies,
  adminModerateSubmission,
  adminModerateUser,
  AdminPlatformUserSummary,
  adminRetryBackgroundJob,
  adminReviewContact,
  adminReviewSignal,
  adminRevokeAdminRole,
  AdminRoleRecord,
  adminRunWorkerTickNow,
  adminScanAllCareers,
  adminSendTestEmail,
  AdminSubmissionView,
  adminToggleSource,
  AdminUserDossier,
  fetchAdminEngineOverview,
  fetchAdminPlatformUsers,
  fetchAdminSubmissions,
  fetchAdminUserDossier,
  updateIntelligenceCompany,
  UserModerationStatus,
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

type AdminSubTab =
  | 'users'
  | 'submissions'
  | 'engine'
  | 'companies'
  | 'signals'
  | 'contacts'
  | 'jobs_logs'
  | 'cloud'
  | 'deploy';

type UserFilterMode = 'all' | 'pending' | 'approved' | 'blocked' | 'admins';

interface UnifiedAdminUser {
  key: string;
  uid: string;
  firestoreUid?: string;
  serverUid?: string;
  email: string;
  fullName: string;
  provider: 'password' | 'firebase' | 'both';
  emailVerified: boolean;
  accountRole: 'candidate' | 'recruiter';
  isAdmin: boolean;
  moderationStatus: UserModerationStatus;
  moderationNote: string;
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
  submittedAppsCount: number;
  createdAt: string;
  firestoreProfile?: Record<string, any>;
}

export function AdminDashboard({
  lang,
  isAdmin,
  adminEmail,
  onNotify,
}: AdminDashboardProps) {
  const [engineData, setEngineData] = useState<AdminEngineOverview | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Server platform users, admin role grants, and submitted applications
  const [platformUsers, setPlatformUsers] = useState<AdminPlatformUserSummary[]>([]);
  const [adminRoles, setAdminRoles] = useState<AdminRoleRecord[]>([]);
  const [submissions, setSubmissions] = useState<AdminSubmissionView[]>([]);

  // Firestore cloud data (only subscribed when Firebase Google user is authenticated)
  const [allJobs, setAllJobs] = useState<CompanyJobDoc[]>([]);
  const [allUsers, setAllUsers] = useState<UserAccountDoc[]>([]);
  const [allConversations, setAllConversations] = useState<ConversationDoc[]>([]);
  const [firestoreAdmins, setFirestoreAdmins] = useState<FirestoreAdminGrant[]>([]);

  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState<UserFilterMode>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Grant new admin form
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminNote, setNewAdminNote] = useState('');
  const [moderationNoteInput, setModerationNoteInput] = useState('');

  // Expanded user dossier state
  const [expandedUserKey, setExpandedUserKey] = useState<string | null>(null);
  const [dossierMap, setDossierMap] = useState<Record<string, AdminUserDossier | null>>({});
  const [dossierLoadingKey, setDossierLoadingKey] = useState<string | null>(null);

  // Merge duplicates state
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Resend email test state
  const [testEmailTo, setTestEmailTo] = useState(adminEmail || '');
  const [emailTestResult, setEmailTestResult] = useState<{ sent: boolean; message: string } | null>(
    null
  );

  const loadEngineOverview = useCallback(async () => {
    if (!isAdmin) return;
    setEngineLoading(true);
    setEngineError(null);
    try {
      const [overview, usersRes, subsRes] = await Promise.all([
        fetchAdminEngineOverview(),
        fetchAdminPlatformUsers(),
        fetchAdminSubmissions(),
      ]);
      setEngineData(overview);
      setPlatformUsers(usersRes.users || []);
      setAdminRoles(usersRes.admins || []);
      setSubmissions(subsRes.submissions || []);
    } catch (err) {
      setEngineError(
        err instanceof Error ? err.message : 'Impossible de charger les données administrateur.'
      );
    } finally {
      setEngineLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadEngineOverview();
    if (!auth.currentUser) {
      return;
    }
    const unsubJobs = subscribeAllCompanyJobsAdmin(setAllJobs);
    const unsubUsers = subscribeAllUsersAdmin(setAllUsers);
    const unsubConvs = subscribeAllConversationsAdmin(setAllConversations);
    const unsubAdmins = subscribeAllAdminsFirestore(setFirestoreAdmins);
    return () => {
      unsubJobs();
      unsubUsers();
      unsubConvs();
      unsubAdmins();
    };
  }, [isAdmin, loadEngineOverview]);

  // Unify SQLite Email/Password accounts + Firestore Cloud accounts by email
  const unifiedUsers = useMemo<UnifiedAdminUser[]>(() => {
    const adminEmailSet = new Set<string>([
      BOOTSTRAP_ADMIN_EMAIL,
      ...adminRoles.map((r) => r.email.toLowerCase()),
      ...firestoreAdmins.map((r) => r.email.toLowerCase()),
    ]);
    const firestoreAdminUidSet = new Set<string>(firestoreAdmins.map((r) => r.uid));
    const map = new Map<string, UnifiedAdminUser>();

    for (const u of platformUsers) {
      const emailKey = (u.email || u.uid).toLowerCase();
      map.set(emailKey, {
        key: emailKey,
        uid: u.uid,
        serverUid: u.uid,
        email: u.email,
        fullName: u.fullName || 'Membre',
        provider: u.provider,
        emailVerified: u.emailVerified,
        accountRole: u.accountRole,
        isAdmin: Boolean(u.isAdmin || adminEmailSet.has(emailKey)),
        moderationStatus: u.moderationStatus || 'approved',
        moderationNote: u.moderationNote || '',
        lang: u.lang || 'fr',
        discoverable: u.discoverable,
        gdprConsent: u.gdprConsent,
        companyName: u.companyName || '',
        companyWebsite: u.companyWebsite || '',
        currentTitle: u.currentTitle || '',
        originCountry: u.originCountry || '',
        preferredCountries: u.preferredCountries || [],
        skills: u.skills || [],
        languages: u.languages || [],
        cvsCount: u.cvsCount || 0,
        trackedAppsCount: u.trackedAppsCount || 0,
        submittedAppsCount: u.submittedAppsCount || 0,
        createdAt: u.createdAt || '',
      });
    }

    for (const fu of allUsers) {
      const emailKey = (fu.email || fu.uid).toLowerCase();
      const existing = map.get(emailKey);
      const prof = (fu.profile || {}) as Record<string, any>;
      const isFsAdmin =
        adminEmailSet.has(emailKey) || firestoreAdminUidSet.has(fu.uid);

      if (existing) {
        const mergedStatus =
          existing.moderationStatus === 'rejected' || existing.moderationStatus === 'suspended'
            ? existing.moderationStatus
            : fu.moderationStatus || existing.moderationStatus;
        map.set(emailKey, {
          ...existing,
          firestoreUid: fu.uid,
          provider: existing.provider === 'password' ? 'both' : 'firebase',
          fullName: existing.fullName || fu.fullName || 'Membre',
          isAdmin: Boolean(existing.isAdmin || isFsAdmin),
          moderationStatus: mergedStatus,
          moderationNote: existing.moderationNote || fu.moderationNote || '',
          companyName: existing.companyName || fu.companyName || '',
          companyWebsite: existing.companyWebsite || fu.companyWebsite || '',
          currentTitle: existing.currentTitle || String(prof.currentTitle || ''),
          originCountry: existing.originCountry || String(prof.originCountry || ''),
          preferredCountries:
            existing.preferredCountries.length > 0
              ? existing.preferredCountries
              : Array.isArray(prof.preferredCountries)
                ? prof.preferredCountries.map(String)
                : [],
          skills:
            existing.skills.length > 0
              ? existing.skills
              : Array.isArray(prof.skills)
                ? prof.skills.map(String)
                : [],
          languages:
            existing.languages.length > 0
              ? existing.languages
              : Array.isArray(prof.languages)
                ? prof.languages.map(String)
                : [],
          firestoreProfile: prof,
        });
      } else {
        map.set(emailKey, {
          key: emailKey,
          uid: fu.uid,
          firestoreUid: fu.uid,
          email: fu.email,
          fullName: fu.fullName || 'Membre',
          provider: 'firebase',
          emailVerified: true,
          accountRole: fu.accountRole || 'candidate',
          isAdmin: isFsAdmin,
          moderationStatus: fu.moderationStatus || 'approved',
          moderationNote: fu.moderationNote || '',
          lang: fu.lang || 'fr',
          discoverable: Boolean(fu.discoverable),
          gdprConsent: Boolean(fu.gdprConsent),
          companyName: fu.companyName || '',
          companyWebsite: fu.companyWebsite || '',
          currentTitle: String(prof.currentTitle || ''),
          originCountry: String(prof.originCountry || ''),
          preferredCountries: Array.isArray(prof.preferredCountries)
            ? prof.preferredCountries.map(String)
            : [],
          skills: Array.isArray(prof.skills) ? prof.skills.map(String) : [],
          languages: Array.isArray(prof.languages) ? prof.languages.map(String) : [],
          cvsCount: 0,
          trackedAppsCount: 0,
          submittedAppsCount: 0,
          createdAt: '',
          firestoreProfile: prof,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [platformUsers, allUsers, adminRoles, firestoreAdmins]);

  const filteredUnifiedUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return unifiedUsers.filter((u) => {
      if (userFilter === 'pending' && !(u.moderationStatus === 'pending' || !u.emailVerified)) {
        return false;
      }
      if (userFilter === 'approved' && u.moderationStatus !== 'approved') {
        return false;
      }
      if (
        userFilter === 'blocked' &&
        u.moderationStatus !== 'rejected' &&
        u.moderationStatus !== 'suspended'
      ) {
        return false;
      }
      if (userFilter === 'admins' && !u.isAdmin) {
        return false;
      }
      if (!q) return true;
      return `${u.fullName} ${u.email} ${u.accountRole} ${u.companyName} ${u.currentTitle} ${u.originCountry} ${u.skills.join(' ')}`
        .toLowerCase()
        .includes(q);
    });
  }, [unifiedUsers, searchTerm, userFilter]);

  const filteredJobs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allJobs.filter(
      (j) => !q || `${j.title} ${j.companyName} ${j.country} ${j.city}`.toLowerCase().includes(q)
    );
  }, [allJobs, searchTerm]);

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
            ? 'Connectez-vous avec un compte administrateur vérifié pour gérer les utilisateurs, valider ou refuser les demandes et piloter le moteur.'
            : 'Sign in with an authorized administrator account to manage users, approve or reject records, and govern the intelligence engine.'}
        </p>
      </section>
    );
  }

  const m = engineData?.metrics;
  const selfEmailLower = (adminEmail || '').toLowerCase();

  // ---------------- User & Admin Management Handlers ----------------

  const handleGrantAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newAdminEmail.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusyId('grant_admin_form');
    setEngineError(null);
    try {
      const res = await adminGrantAdminRole(cleanEmail, newAdminNote.trim());
      setAdminRoles(res.admins);

      // If this email also has a Firestore account and current admin is Google-authenticated, sync /admins/{uid}
      const fsMatch = allUsers.find((u) => u.email.toLowerCase() === cleanEmail);
      if (fsMatch && auth.currentUser) {
        await adminGrantFirestoreAdmin({
          uid: fsMatch.uid,
          email: cleanEmail,
          grantedBy: adminEmail || BOOTSTRAP_ADMIN_EMAIL,
          note: newAdminNote.trim() || 'Nommé administrateur',
        }).catch(() => {});
      }

      setNewAdminEmail('');
      setNewAdminNote('');
      onNotify(
        lang === 'fr'
          ? `${cleanEmail} est maintenant compte Administrateur.`
          : `${cleanEmail} is now an Administrator account.`
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Erreur lors de la nomination admin.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeAdminEmail = async (email: string) => {
    const cleanEmail = email.toLowerCase();
    setBusyId(`revoke_${cleanEmail}`);
    setEngineError(null);
    try {
      const res = await adminRevokeAdminRole(cleanEmail);
      setAdminRoles(res.admins);

      const fsGrant = firestoreAdmins.find((g) => g.email.toLowerCase() === cleanEmail);
      if (fsGrant && auth.currentUser) {
        await adminRevokeFirestoreAdmin(fsGrant.uid).catch(() => {});
      }

      onNotify(
        lang === 'fr'
          ? `Droits administrateur retirés pour ${cleanEmail}.`
          : `Admin role revoked for ${cleanEmail}.`
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Impossible de retirer ce rôle admin.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleUserAdmin = async (u: UnifiedAdminUser) => {
    const nextAdmin = !u.isAdmin;
    setBusyId(`admin_toggle_${u.key}`);
    setEngineError(null);
    try {
      if (nextAdmin) {
        await adminGrantAdminRole(u.email, 'Promu depuis la liste utilisateurs');
        if (u.firestoreUid && auth.currentUser) {
          await adminGrantFirestoreAdmin({
            uid: u.firestoreUid,
            email: u.email,
            grantedBy: adminEmail || BOOTSTRAP_ADMIN_EMAIL,
            note: 'Promu depuis la liste utilisateurs',
          }).catch(() => {});
        }
        onNotify(
          lang === 'fr'
            ? `${u.email} promu Administrateur.`
            : `${u.email} promoted to Administrator.`
        );
      } else {
        await adminRevokeAdminRole(u.email);
        if (u.firestoreUid && auth.currentUser) {
          await adminRevokeFirestoreAdmin(u.firestoreUid).catch(() => {});
        }
        onNotify(
          lang === 'fr'
            ? `Rôle Administrateur retiré pour ${u.email}.`
            : `Admin role removed for ${u.email}.`
        );
      }
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Impossible de modifier le rôle admin.');
    } finally {
      setBusyId(null);
    }
  };

  const handleModerateUnifiedUser = async (
    u: UnifiedAdminUser,
    action: {
      moderationStatus?: UserModerationStatus;
      emailVerified?: boolean;
      accountRole?: 'candidate' | 'recruiter';
    }
  ) => {
    setBusyId(`mod_${u.key}`);
    setEngineError(null);
    try {
      const note = moderationNoteInput.trim();
      // ALWAYS sync moderation decision to the server SQLite directory so BOTH Password and Google accounts are enforced on APIs
      await adminModerateUser(u.serverUid || u.uid, {
        email: u.email,
        ...action,
        moderationNote: note || undefined,
      });
      // When authenticated via Firebase Admin, also mirror immediately to Firestore for real-time client lockout & Firestore rules
      if (u.firestoreUid && auth.currentUser) {
        await adminModerateFirestoreUser(u.firestoreUid, {
          accountRole: action.accountRole,
          moderationStatus: action.moderationStatus,
          moderationNote: note || undefined,
        }).catch(() => {});
      }
      setModerationNoteInput('');
      const label =
        action.moderationStatus === 'approved'
          ? lang === 'fr'
            ? `Compte ${u.email} validé.`
            : `Account ${u.email} approved.`
          : action.moderationStatus === 'rejected'
            ? lang === 'fr'
              ? `Compte ${u.email} refusé et bloqué.`
              : `Account ${u.email} rejected and blocked.`
            : action.moderationStatus === 'suspended'
              ? lang === 'fr'
                ? `Compte ${u.email} suspendu et bloqué.`
                : `Account ${u.email} suspended and blocked.`
              : lang === 'fr'
                ? `Compte ${u.email} mis à jour.`
                : `Account ${u.email} updated.`;
      onNotify(label);
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Erreur lors de la modération.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleUserDossier = async (u: UnifiedAdminUser) => {
    if (expandedUserKey === u.key) {
      setExpandedUserKey(null);
      return;
    }
    setExpandedUserKey(u.key);
    if (dossierMap[u.key]) return;

    setDossierLoadingKey(u.key);
    try {
      let resolvedDossier: AdminUserDossier | null = null;
      if (u.serverUid || u.uid) {
        const res = await fetchAdminUserDossier(u.serverUid || u.uid).catch(() => null);
        if (res?.dossier) {
          resolvedDossier = res.dossier;
        }
      }

      if (u.firestoreUid && auth.currentUser) {
        const fsDetails = await adminFetchFirestoreUserDetails(u.firestoreUid).catch(() => ({
          cvs: [],
          trackedApplications: [],
        }));
        if (resolvedDossier) {
          if (fsDetails.cvs.length > resolvedDossier.cvs.length) {
            resolvedDossier = { ...resolvedDossier, cvs: fsDetails.cvs };
          }
          if (fsDetails.trackedApplications.length > resolvedDossier.trackedApplications.length) {
            resolvedDossier = {
              ...resolvedDossier,
              trackedApplications: fsDetails.trackedApplications,
            };
          }
        } else {
          resolvedDossier = {
            summary: {
              uid: u.uid,
              email: u.email,
              fullName: u.fullName,
              provider: 'firebase',
              emailVerified: true,
              verifiedAt: null,
              accountRole: u.accountRole,
              isAdmin: u.isAdmin,
              moderationStatus: u.moderationStatus,
              moderationNote: u.moderationNote,
              moderatedBy: '',
              moderatedAt: null,
              lang: u.lang,
              discoverable: u.discoverable,
              gdprConsent: u.gdprConsent,
              companyName: u.companyName,
              companyWebsite: u.companyWebsite,
              currentTitle: u.currentTitle,
              originCountry: u.originCountry,
              preferredCountries: u.preferredCountries,
              skills: u.skills,
              languages: u.languages,
              cvsCount: fsDetails.cvs.length,
              trackedAppsCount: fsDetails.trackedApplications.length,
              watchlistCount: 0,
              submittedAppsCount: 0,
              createdAt: u.createdAt,
              updatedAt: '',
            },
            profile: u.firestoreProfile || null,
            cvs: fsDetails.cvs,
            trackedApplications: fsDetails.trackedApplications,
            submittedApplications: submissions.filter(
              (s) => s.candidateEmail.toLowerCase() === u.email.toLowerCase()
            ),
            notificationsCount: 0,
          };
        }
      }

      if (resolvedDossier) {
        setDossierMap((prev) => ({ ...prev, [u.key]: resolvedDossier! }));
      }
    } catch (err) {
      setEngineError(
        err instanceof Error ? err.message : 'Impossible de charger le dossier complet.'
      );
    } finally {
      setDossierLoadingKey(null);
    }
  };

  const handleModerateSubmission = async (
    submissionId: string,
    status: 'approved' | 'rejected'
  ) => {
    setBusyId(`sub_${submissionId}`);
    try {
      await adminModerateSubmission(submissionId, { status });
      onNotify(
        status === 'approved'
          ? lang === 'fr'
            ? 'Candidature validée.'
            : 'Application approved.'
          : lang === 'fr'
            ? 'Candidature refusée.'
            : 'Application rejected.'
      );
      await loadEngineOverview();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Erreur de modération.');
    } finally {
      setBusyId(null);
    }
  };

  // ---------------- Engine / Companies / Signals / Contacts / Cloud Handlers ----------------

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
            ? 'Signal refusé et masqué.'
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
            ? 'Contact RH refusé.'
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

  const handleCompanyVerification = async (
    companyId: string,
    verificationStatus: 'Verified' | 'Unverified'
  ) => {
    setBusyId(companyId);
    try {
      await updateIntelligenceCompany(companyId, { verificationStatus });
      onNotify(
        verificationStatus === 'Verified'
          ? lang === 'fr'
            ? 'Entreprise validée & certifiée.'
            : 'Company verified.'
          : lang === 'fr'
            ? 'Certification retirée (marquée non vérifiée).'
            : 'Company marked unverified.'
      );
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

  const handleModerateEmployerJob = async (
    jobId: string,
    updates: Partial<Pick<CompanyJobDoc, 'verificationStatus' | 'status'>>
  ) => {
    setBusyId(jobId);
    try {
      await adminUpdateCompanyJob(jobId, updates);
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

  const renderModerationBadge = (status: UserModerationStatus) => {
    if (status === 'approved') {
      return (
        <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          {lang === 'fr' ? 'Validé' : 'Approved'}
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          {lang === 'fr' ? 'En attente' : 'Pending'}
        </span>
      );
    }
    if (status === 'suspended') {
      return (
        <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          {lang === 'fr' ? 'Suspendu' : 'Suspended'}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300">
        {lang === 'fr' ? 'Refusé' : 'Rejected'}
      </span>
    );
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
              ? 'Tableau de Bord d’Administration & Modération Complète'
              : 'Admin Control Dashboard & Full Moderation'}
          </h1>
          <p className="text-sm text-jf-soft/90 max-w-3xl">
            {lang === 'fr'
              ? 'Visualisez toutes les informations des utilisateurs, nommez ou retirez des comptes administrateurs, et validez ou refusez les comptes, candidatures, entreprises, signaux, contacts RH et offres.'
              : 'Inspect complete user dossiers, grant or revoke admin roles, and approve or reject accounts, applications, companies, signals, HR contacts, and employer job postings.'}
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
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm font-medium text-rose-800"
        >
          {engineError}
        </div>
      )}

      {/* Real Operational KPI Grid */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: lang === 'fr' ? 'Utilisateurs / Admins' : 'Users / Admins',
            value: `${unifiedUsers.length} / ${adminRoles.length}`,
            icon: Users,
          },
          {
            label: lang === 'fr' ? 'Candidatures soumises' : 'Submitted Apps',
            value: `${submissions.length}`,
            icon: FileCheck2,
          },
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
            label: lang === 'fr' ? 'Signaux / Contacts RH' : 'Signals / HR Contacts',
            value: m ? `${m.signalsTotal} / ${m.contactsTotal}` : '—',
            icon: Radar,
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
                ['users', `${lang === 'fr' ? 'Utilisateurs & Admins' : 'Users & Admins'} (${unifiedUsers.length})`],
                ['submissions', `${lang === 'fr' ? 'Candidatures' : 'Applications'} (${submissions.length})`],
                ['companies', `${lang === 'fr' ? 'Entreprises' : 'Companies'} (${engineData?.companies.length ?? 0})`],
                ['signals', `${lang === 'fr' ? 'Signaux' : 'Signals'} (${engineData?.signals.length ?? 0})`],
                ['contacts', `${lang === 'fr' ? 'Contacts RH' : 'HR Contacts'} (${engineData?.contacts.length ?? 0})`],
                ['cloud', `${lang === 'fr' ? 'Offres Employeurs' : 'Employer Jobs'} (${allJobs.length})`],
                ['engine', lang === 'fr' ? 'Sources & IA' : 'Sources & AI'],
                ['jobs_logs', `${lang === 'fr' ? 'Tâches & Audit' : 'Queue & Audit'} (${engineData?.backgroundJobs.length ?? 0})`],
                ['deploy', lang === 'fr' ? 'Hostinger' : 'Hostinger'],
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
          {(activeSubTab === 'users' || activeSubTab === 'cloud') && (
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                lang === 'fr' ? 'Rechercher nom, e-mail, pays…' : 'Search name, email, country…'
              }
              className="px-3 py-1.5 text-xs border border-jf-border rounded-lg w-60"
            />
          )}
        </div>

        {/* TAB 0: USERS, FULL DOSSIERS & ADMIN ROLE MANAGEMENT */}
        {activeSubTab === 'users' && (
          <div className="space-y-6">
            {/* Promote Any Account to Admin Card */}
            <div className="p-4 bg-jf-ice border border-jf-border rounded-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-jf-navy inline-flex items-center gap-1.5">
                    <ShieldPlus className="w-4 h-4 text-jf-blue" />
                    <span>
                      {lang === 'fr'
                        ? 'Nommer un compte Administrateur'
                        : 'Promote Account to Administrator'}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-600">
                    {lang === 'fr'
                      ? 'Saisissez l’adresse e-mail d’un compte (Google ou E-mail/Mot de passe) pour lui donner immédiatement tous les droits d’administration et de modération.'
                      : 'Enter any account email (Google or Email/Password) to immediately grant full admin visibility and moderation rights.'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleGrantAdminSubmit} className="flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  required
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="nouveau.admin@domaine.com"
                  className="px-3 py-2 text-xs bg-white border border-jf-border rounded-lg min-w-[240px] flex-1"
                />
                <input
                  type="text"
                  value={newAdminNote}
                  onChange={(e) => setNewAdminNote(e.target.value)}
                  placeholder={lang === 'fr' ? 'Note / fonction (optionnel)' : 'Role / note (optional)'}
                  className="px-3 py-2 text-xs bg-white border border-jf-border rounded-lg min-w-[180px]"
                />
                <button
                  type="submit"
                  disabled={busyId === 'grant_admin_form'}
                  className="px-4 py-2 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                >
                  {busyId === 'grant_admin_form' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>{lang === 'fr' ? 'Nommer Administrateur' : 'Grant Admin'}</span>
                </button>
              </form>

              {/* Active Admin Accounts List */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {lang === 'fr'
                    ? `Administrateurs actifs (${adminRoles.length})`
                    : `Active Administrators (${adminRoles.length})`}
                </div>
                <div className="flex flex-wrap gap-2">
                  {adminRoles.map((adm) => {
                    const isSelf = adm.email.toLowerCase() === selfEmailLower;
                    return (
                      <div
                        key={adm.email}
                        className="px-3 py-1.5 bg-white border border-jf-border rounded-lg text-xs inline-flex items-center gap-2"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-jf-blue shrink-0" />
                        <span className="font-mono font-semibold text-jf-navy">{adm.email}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-jf-ice text-slate-600">
                          {adm.source === 'bootstrap'
                            ? lang === 'fr'
                              ? 'Propriétaire'
                              : 'Owner'
                            : adm.source === 'env'
                              ? 'ENV'
                              : lang === 'fr'
                                ? 'Délégué'
                                : 'Delegated'}
                        </span>
                        {adm.removable && !isSelf && (
                          <button
                            type="button"
                            disabled={busyId === `revoke_${adm.email}`}
                            onClick={() => void handleRevokeAdminEmail(adm.email)}
                            className="text-rose-600 hover:text-rose-800 font-semibold text-[11px] ml-1"
                            title={lang === 'fr' ? 'Retirer les droits admin' : 'Revoke admin'}
                          >
                            {lang === 'fr' ? 'Retirer' : 'Revoke'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Filter Bar + Optional Moderation Note */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(
                  [
                    ['all', `${lang === 'fr' ? 'Tous' : 'All'} (${unifiedUsers.length})`],
                    [
                      'pending',
                      `${lang === 'fr' ? 'À vérifier' : 'Pending'} (${unifiedUsers.filter((u) => u.moderationStatus === 'pending' || !u.emailVerified).length})`,
                    ],
                    [
                      'approved',
                      `${lang === 'fr' ? 'Validés' : 'Approved'} (${unifiedUsers.filter((u) => u.moderationStatus === 'approved').length})`,
                    ],
                    [
                      'blocked',
                      `${lang === 'fr' ? 'Refusés / Suspendus' : 'Blocked'} (${unifiedUsers.filter((u) => u.moderationStatus === 'rejected' || u.moderationStatus === 'suspended').length})`,
                    ],
                    [
                      'admins',
                      `Admins (${unifiedUsers.filter((u) => u.isAdmin).length})`,
                    ],
                  ] as Array<[UserFilterMode, string]>
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setUserFilter(k)}
                    className={`px-2.5 py-1 rounded-md font-semibold border transition-colors ${
                      userFilter === k
                        ? 'bg-jf-navy text-white border-jf-navy'
                        : 'bg-white text-slate-600 border-jf-border hover:text-jf-navy'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={moderationNoteInput}
                onChange={(e) => setModerationNoteInput(e.target.value)}
                placeholder={
                  lang === 'fr'
                    ? 'Motif / note pour la prochaine action (optionnel)…'
                    : 'Optional moderation note for next action…'
                }
                className="px-3 py-1.5 text-xs border border-jf-border rounded-lg w-72"
              />
            </div>

            {/* Unified Users Table with Expandable Full Dossier */}
            <div className="space-y-3">
              {filteredUnifiedUsers.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-xl">
                  {lang === 'fr'
                    ? 'Aucun compte utilisateur trouvé pour ce filtre.'
                    : 'No user accounts match this filter.'}
                </div>
              ) : (
                filteredUnifiedUsers.map((u) => {
                  const isExpanded = expandedUserKey === u.key;
                  const dossier = dossierMap[u.key];
                  const isOwner = u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
                  const isSelf = u.email.toLowerCase() === selfEmailLower;
                  const isBusy =
                    busyId === `mod_${u.key}` || busyId === `admin_toggle_${u.key}`;

                  return (
                    <div
                      key={u.key}
                      className="border border-jf-border rounded-xl bg-white overflow-hidden"
                    >
                      <div className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 text-xs">
                        {/* Identity & Status */}
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-jf-navy">
                              {u.fullName}
                            </span>
                            <span className="font-mono text-slate-600">{u.email}</span>
                            {u.isAdmin && (
                              <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-jf-navy text-jf-sky inline-flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                <span>ADMIN</span>
                              </span>
                            )}
                            {renderModerationBadge(u.moderationStatus)}
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                                u.emailVerified
                                  ? 'bg-jf-ice text-jf-dark border border-jf-border'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {u.emailVerified
                                ? lang === 'fr'
                                  ? 'E-mail vérifié'
                                  : 'Email verified'
                                : lang === 'fr'
                                  ? 'Code non validé'
                                  : 'Unverified'}
                            </span>
                            <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-100 text-slate-700">
                              {u.accountRole === 'recruiter'
                                ? lang === 'fr'
                                  ? 'Recruteur'
                                  : 'Recruiter'
                                : lang === 'fr'
                                  ? 'Candidat'
                                  : 'Candidate'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded font-mono text-[10px] uppercase bg-jf-ice text-slate-500">
                              {u.provider === 'both'
                                ? 'E-mail + Google'
                                : u.provider === 'password'
                                  ? 'E-mail'
                                  : 'Google'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                            {u.currentTitle && <span>Poste : {u.currentTitle}</span>}
                            {u.originCountry && <span>Pays : {u.originCountry}</span>}
                            {u.companyName && <span>Entreprise : {u.companyName}</span>}
                            <span className="font-mono text-[11px] text-slate-500">
                              CVs: {u.cvsCount} · CRM: {u.trackedAppsCount} · Envois:{' '}
                              {u.submittedAppsCount}
                            </span>
                            {u.createdAt && (
                              <span className="font-mono text-[11px] text-slate-400">
                                Inscrit : {u.createdAt.slice(0, 10)}
                              </span>
                            )}
                          </div>

                          {u.moderationNote && (
                            <div className="text-[11px] text-slate-500 italic">
                              Note admin : {u.moderationNote}
                            </div>
                          )}
                        </div>

                        {/* Actions: View Full Info, Validate, Reject, Suspend, Role, Admin */}
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleUserDossier(u)}
                            className="px-2.5 py-1.5 font-semibold text-jf-navy bg-jf-ice hover:bg-jf-soft border border-jf-border rounded-lg inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{lang === 'fr' ? 'Voir infos' : 'Inspect'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>

                          {!isOwner && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleModerateUnifiedUser(u, {
                                    moderationStatus: 'approved',
                                    emailVerified: true,
                                  })
                                }
                                className="px-2.5 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{lang === 'fr' ? 'Valider' : 'Approve'}</span>
                              </button>

                              {!isSelf && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleModerateUnifiedUser(u, {
                                        moderationStatus: 'rejected',
                                      })
                                    }
                                    className="px-2.5 py-1.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>{lang === 'fr' ? 'Refuser' : 'Reject'}</span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleModerateUnifiedUser(u, {
                                        moderationStatus: 'suspended',
                                      })
                                    }
                                    className="px-2.5 py-1.5 font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-1"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    <span>{lang === 'fr' ? 'Suspendre' : 'Suspend'}</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleModerateUnifiedUser(u, {
                                accountRole:
                                  u.accountRole === 'recruiter' ? 'candidate' : 'recruiter',
                              })
                            }
                            className="px-2.5 py-1.5 font-semibold text-jf-dark bg-white hover:bg-jf-ice border border-jf-border disabled:opacity-50 rounded-lg"
                          >
                            {u.accountRole === 'recruiter'
                              ? lang === 'fr'
                                ? '→ Candidat'
                                : '→ Candidate'
                              : lang === 'fr'
                                ? '→ Recruteur'
                                : '→ Recruiter'}
                          </button>

                          {!isOwner && !isSelf && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleUserAdmin(u)}
                              className={`px-2.5 py-1.5 font-semibold rounded-lg inline-flex items-center gap-1 disabled:opacity-50 ${
                                u.isAdmin
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                                  : 'bg-jf-navy text-white hover:bg-jf-dark'
                              }`}
                            >
                              {u.isAdmin ? (
                                <>
                                  <ShieldOff className="w-3.5 h-3.5" />
                                  <span>{lang === 'fr' ? 'Retirer Admin' : 'Revoke Admin'}</span>
                                </>
                              ) : (
                                <>
                                  <ShieldPlus className="w-3.5 h-3.5" />
                                  <span>{lang === 'fr' ? 'Passer Admin' : 'Make Admin'}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Complete User Dossier */}
                      {isExpanded && (
                        <div className="border-t border-jf-border bg-jf-ice/50 p-4 space-y-4 text-xs">
                          {dossierLoadingKey === u.key ? (
                            <div className="flex items-center gap-2 text-slate-500">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>
                                {lang === 'fr'
                                  ? 'Chargement du dossier complet…'
                                  : 'Loading complete user dossier…'}
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                              {/* Profile Details */}
                              <div className="bg-white border border-jf-border rounded-lg p-3.5 space-y-2">
                                <div className="font-semibold text-jf-navy">
                                  {lang === 'fr' ? 'Informations complètes du profil' : 'Complete Profile Info'}
                                </div>
                                <dl className="space-y-1 text-[11px]">
                                  <div>
                                    <dt className="inline text-slate-500">UID : </dt>
                                    <dd className="inline font-mono text-jf-navy">{u.uid}</dd>
                                  </div>
                                  <div>
                                    <dt className="inline text-slate-500">Langue / RGPD : </dt>
                                    <dd className="inline">
                                      {u.lang.toUpperCase()} · {u.gdprConsent ? 'Consentement OK' : 'Non'} ·{' '}
                                      {u.discoverable ? 'Visible recruteurs' : 'Privé'}
                                    </dd>
                                  </div>
                                  {dossier?.profile?.highestDegree && (
                                    <div>
                                      <dt className="inline text-slate-500">Diplôme : </dt>
                                      <dd className="inline">{String(dossier.profile.highestDegree)}</dd>
                                    </div>
                                  )}
                                  {dossier?.profile?.yearsExperience !== undefined && (
                                    <div>
                                      <dt className="inline text-slate-500">Expérience : </dt>
                                      <dd className="inline">{String(dossier.profile.yearsExperience)} ans</dd>
                                    </div>
                                  )}
                                  {dossier?.profile?.workAuthorization && (
                                    <div>
                                      <dt className="inline text-slate-500">Visa / Autorisation : </dt>
                                      <dd className="inline">{String(dossier.profile.workAuthorization)}</dd>
                                    </div>
                                  )}
                                  {dossier?.profile?.availability && (
                                    <div>
                                      <dt className="inline text-slate-500">Disponibilité : </dt>
                                      <dd className="inline">{String(dossier.profile.availability)}</dd>
                                    </div>
                                  )}
                                  {dossier?.profile?.salaryExpectation && (
                                    <div>
                                      <dt className="inline text-slate-500">Salaire souhaité : </dt>
                                      <dd className="inline">{String(dossier.profile.salaryExpectation)}</dd>
                                    </div>
                                  )}
                                  {u.preferredCountries.length > 0 && (
                                    <div>
                                      <dt className="inline text-slate-500">Pays ciblés : </dt>
                                      <dd className="inline">{u.preferredCountries.join(', ')}</dd>
                                    </div>
                                  )}
                                  {u.languages.length > 0 && (
                                    <div>
                                      <dt className="inline text-slate-500">Langues : </dt>
                                      <dd className="inline">{u.languages.join(', ')}</dd>
                                    </div>
                                  )}
                                  {u.skills.length > 0 && (
                                    <div>
                                      <dt className="inline text-slate-500">Compétences : </dt>
                                      <dd className="inline">{u.skills.join(', ')}</dd>
                                    </div>
                                  )}
                                  {u.companyWebsite && (
                                    <div>
                                      <dt className="inline text-slate-500">Site entreprise : </dt>
                                      <dd className="inline font-mono">{u.companyWebsite}</dd>
                                    </div>
                                  )}
                                </dl>
                              </div>

                              {/* CVs */}
                              <div className="bg-white border border-jf-border rounded-lg p-3.5 space-y-2">
                                <div className="font-semibold text-jf-navy">
                                  CVs enregistrés ({dossier?.cvs.length ?? u.cvsCount})
                                </div>
                                {(dossier?.cvs || []).length === 0 ? (
                                  <p className="text-[11px] text-slate-500">Aucun CV enregistré.</p>
                                ) : (
                                  <ul className="space-y-1.5 text-[11px]">
                                    {dossier?.cvs.map((cv) => (
                                      <li key={cv.id} className="border-b border-jf-border/60 pb-1 last:border-0">
                                        <div className="font-semibold text-jf-navy">{cv.versionName}</div>
                                        <div className="text-slate-500">
                                          {cv.headline || cv.fullName} · {cv.skillsCount} compétences
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {/* Applications (CRM + Real Submissions) */}
                              <div className="bg-white border border-jf-border rounded-lg p-3.5 space-y-2">
                                <div className="font-semibold text-jf-navy">
                                  Candidatures ({dossier?.submittedApplications.length ?? u.submittedAppsCount} réelles ·{' '}
                                  {dossier?.trackedApplications.length ?? u.trackedAppsCount} CRM)
                                </div>
                                {(dossier?.submittedApplications || []).length === 0 &&
                                (dossier?.trackedApplications || []).length === 0 ? (
                                  <p className="text-[11px] text-slate-500">
                                    Aucune candidature enregistrée.
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5 text-[11px] max-h-40 overflow-y-auto">
                                    {(dossier?.submittedApplications || []).map((sub) => (
                                      <li key={sub.id} className="border-b border-jf-border/60 pb-1">
                                        <div className="font-semibold text-jf-navy">
                                          {sub.roleTitle} — {sub.companyName}
                                        </div>
                                        <div className="text-slate-500 font-mono">
                                          {sub.deliveryStatus} · Admin: {sub.adminModerationStatus}
                                        </div>
                                      </li>
                                    ))}
                                    {(dossier?.trackedApplications || []).slice(0, 8).map((app) => (
                                      <li key={app.id} className="border-b border-jf-border/60 pb-1 last:border-0">
                                        <div className="font-medium text-jf-dark">
                                          {app.role} — {app.company}
                                        </div>
                                        <div className="text-slate-500">{app.stage}</div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 1: SUBMITTED APPLICATIONS MODERATION */}
        {activeSubTab === 'submissions' && (
          <div className="space-y-3">
            {submissions.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-xl">
                {lang === 'fr'
                  ? 'Aucune candidature soumise enregistrée pour le moment.'
                  : 'No submitted applications recorded yet.'}
              </div>
            ) : (
              submissions.map((sub) => (
                <div
                  key={sub.id}
                  className="p-4 border border-jf-border rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-jf-navy">
                        {sub.roleTitle} — {sub.companyName}
                      </span>
                      <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-jf-ice border border-jf-border">
                        {sub.channel} · {sub.deliveryStatus}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                          sub.adminModerationStatus === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : sub.adminModerationStatus === 'rejected'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        Admin : {sub.adminModerationStatus}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Candidat : <span className="font-semibold">{sub.candidateName || '—'}</span> (
                      <span className="font-mono">{sub.candidateEmail || sub.userId}</span>) · Pièces jointes :{' '}
                      {sub.attachmentsCount} · Employeur : {sub.employerStatus}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {sub.recipientEmail ? `Destinataire : ${sub.recipientEmail} · ` : ''}
                      {sub.createdAt.slice(0, 16).replace('T', ' ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === `sub_${sub.id}`}
                      onClick={() => void handleModerateSubmission(sub.id, 'approved')}
                      className="px-3 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{lang === 'fr' ? 'Valider' : 'Approve'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === `sub_${sub.id}`}
                      onClick={() => void handleModerateSubmission(sub.id, 'rejected')}
                      className="px-3 py-1.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg inline-flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{lang === 'fr' ? 'Refuser' : 'Reject'}</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: SOURCES GOVERNANCE & AI CONSUMPTION */}
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

        {/* TAB 3: COMPANIES & DUPLICATE MERGE */}
        {activeSubTab === 'companies' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                {lang === 'fr'
                  ? 'Validez ou retirez la certification des entreprises et lancez une synchronisation ATS.'
                  : 'Verify or revoke company certification and refresh ATS career boards.'}
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
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                        {c.verificationStatus !== 'Verified' && (
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => void handleCompanyVerification(c.id, 'Verified')}
                            className="px-2.5 py-1 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
                          >
                            {lang === 'fr' ? 'Valider' : 'Verify'}
                          </button>
                        )}
                        {c.verificationStatus !== 'Unverified' && (
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => void handleCompanyVerification(c.id, 'Unverified')}
                            className="px-2.5 py-1 font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md"
                          >
                            {lang === 'fr' ? 'Refuser' : 'Unverify'}
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

        {/* TAB 4: SIGNALS & PROOFS MODERATION */}
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
                        className="px-3 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        {lang === 'fr' ? 'Valider' : 'Verify'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === sig.id}
                        onClick={() => void handleReviewSignal(sig.id, 'rejected')}
                        className="px-3 py-1.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                      >
                        {lang === 'fr' ? 'Refuser' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 5: HR CONTACTS MODERATION */}
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
                        className="px-3 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        {lang === 'fr' ? 'Valider' : 'Verify'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === ct.id}
                        onClick={() => void handleReviewContact(ct.id, 'rejected')}
                        className="px-3 py-1.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                      >
                        {lang === 'fr' ? 'Refuser' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 6: EMPLOYER JOBS & CLOUD CONVERSATIONS MODERATION */}
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

            {!auth.currentUser && (
              <div className="p-3 bg-jf-ice border border-jf-border rounded-lg text-xs text-slate-600">
                {lang === 'fr'
                  ? 'Note : Les offres employeurs Cloud (Firestore) s’affichent lorsque vous êtes connecté avec un compte Google administrateur.'
                  : 'Note: Cloud Firestore employer jobs load when signed in with a Google administrator account.'}
              </div>
            )}

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
                            {job.companyName} · {job.city}, {job.country} ·{' '}
                            <span className="font-mono uppercase">{job.status}</span>
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
                              void handleModerateEmployerJob(job.id, {
                                verificationStatus: 'Verified',
                                status: 'open',
                              })
                            }
                            className="px-2.5 py-1 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
                          >
                            {lang === 'fr' ? 'Valider' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() =>
                              void handleModerateEmployerJob(job.id, {
                                verificationStatus: 'Unverified',
                                status: 'closed',
                              })
                            }
                            className="px-2.5 py-1 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md"
                          >
                            {lang === 'fr' ? 'Refuser' : 'Reject'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => void handleDeleteEmployerJob(job.id)}
                            className="p-1 text-slate-500 hover:text-rose-700"
                            title={lang === 'fr' ? 'Supprimer définitivement' : 'Delete permanently'}
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredJobs.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-500">
                          {lang === 'fr' ? 'Aucune offre employeur publiée.' : 'No employer jobs posted.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: BACKGROUND JOBS QUEUE & AUDIT LOGS */}
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

        {/* TAB 8: HOSTINGER PRODUCTION DEPLOYMENT CENTER */}
        {activeSubTab === 'deploy' && (
          <HostingerDeployPanel lang={lang} onNotify={onNotify} />
        )}
      </section>
    </div>
  );
}
