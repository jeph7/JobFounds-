import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  AccountRole,
  CandidateProfile,
  CompanyJobDoc,
  ConversationDoc,
  CvDocument,
  HiddenOpportunity,
  JobListing,
  Lang,
  PublicCandidateDoc,
  TrackedApplication,
  WatchlistItem,
  WorkspaceTab,
} from './types';
import {
  initialApplications,
  initialCandidateProfile,
  initialCvDocuments,
  initialHiddenOpportunities,
  initialJobs,
  initialWatchlist,
} from './data/initialData';
import { isRtlLang, t } from './i18n';
import { auth, signInWithGooglePopup, signOutUser } from './firebase';
import {
  checkIsAdminUser,
  deleteAllUserCloudData,
  deleteUserApplication,
  deleteUserCv,
  deleteWatchlistItem,
  ensureUserAccount,
  saveUserApplication,
  saveUserCv,
  saveWatchlistItem,
  subscribeOpenCompanyJobs,
  subscribePublicCandidates,
  subscribeUserApplications,
  subscribeUserConversations,
  subscribeUserCvs,
  subscribeUserWatchlist,
  syncPublicCandidateDirectory,
  updateUserAccount,
} from './utils/firestoreService';
import { fetchUserNotifications } from './utils/api';
import { MobileBottomNav, Sidebar, TopHeader } from './components/Sidebar';
import { BrandLogo } from './components/ui';
import { OfflineIndicator } from './components/PWAInstallButton';
import { LandingPage } from './components/LandingPage';

// Code-split workspace modules for fast initial paint and isolated vendor chunks
const GlobalJobSearch = lazy(() =>
  import('./components/GlobalJobSearch').then((m) => ({ default: m.GlobalJobSearch }))
);
const CompanyIntelligenceHub = lazy(() =>
  import('./components/CompanyIntelligenceHub').then((m) => ({ default: m.CompanyIntelligenceHub }))
);
const HiddenOpportunities = lazy(() =>
  import('./components/HiddenOpportunities').then((m) => ({ default: m.HiddenOpportunities }))
);
const VerificationEngine = lazy(() =>
  import('./components/VerificationEngine').then((m) => ({ default: m.VerificationEngine }))
);
const CvBuilder = lazy(() =>
  import('./components/CvBuilder').then((m) => ({ default: m.CvBuilder }))
);
const AtsAnalyzer = lazy(() =>
  import('./components/AtsAnalyzer').then((m) => ({ default: m.AtsAnalyzer }))
);
const SmartMatching = lazy(() =>
  import('./components/SmartMatching').then((m) => ({ default: m.SmartMatching }))
);
const CareerHub = lazy(() =>
  import('./components/CareerHub').then((m) => ({ default: m.CareerHub }))
);
const RecruiterHub = lazy(() =>
  import('./components/RecruiterHub').then((m) => ({ default: m.RecruiterHub }))
);
const WatchlistAlerts = lazy(() =>
  import('./components/WatchlistAlerts').then((m) => ({ default: m.WatchlistAlerts }))
);
const AccountPrivacyHub = lazy(() =>
  import('./components/AccountPrivacyHub').then((m) => ({ default: m.AccountPrivacyHub }))
);
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const CompanyIntelModal = lazy(() =>
  import('./components/CompanyIntelModal').then((m) => ({ default: m.CompanyIntelModal }))
);

const STORAGE_KEYS = {
  profile: 'jobfonds_profile_v1',
  cvs: 'jobfonds_cvs_v1',
  apps: 'jobfonds_apps_v1',
  watchlist: 'jobfonds_watchlist_v1',
  lang: 'jobfonds_lang_v1',
  role: 'jobfonds_role_v1',
};

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapCompanyJobToListing(cj: CompanyJobDoc): JobListing {
  return {
    id: `employer-${cj.id}`,
    title: cj.title,
    company: cj.companyName,
    country: cj.country,
    city: cj.city,
    workMode: cj.workMode,
    contractType: cj.contractType,
    experienceLevel: cj.experienceLevel || 'Mid-level',
    degreeRequired: cj.degreeRequired || 'Not specified',
    salaryRange: cj.salaryRange || 'Disclosed on application',
    languages: cj.languages?.length ? cj.languages : ['English'],
    skills: cj.skills?.length ? cj.skills : [],
    publishedDate: new Date().toISOString().slice(0, 10),
    sourceName: 'JOBFOUNDS Employer Portal',
    sourceUrl: cj.companyWebsite || '',
    verificationStatus: cj.verificationStatus,
    verificationSummary:
      cj.verificationStatus === 'Partially Verified'
        ? 'Direct employer posting with official corporate website URL provided.'
        : 'Direct employer posting — independent domain verification recommended.',
    description: cj.description,
    recruiterHint: `Direct Employer Posting · ${cj.companyName}`,
    visaSponsorship: cj.visaSponsorship || 'Not specified',
    isEmployerDirect: true,
    recruiterId: cj.recruiterId,
  };
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => loadStored<Lang>(STORAGE_KEYS.lang, 'fr'));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firebase Auth, Admin & Cloud Account State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accountRole, setAccountRole] = useState<AccountRole>(() =>
    loadStored<AccountRole>(STORAGE_KEYS.role, 'candidate')
  );
  const [discoverable, setDiscoverable] = useState(false);
  const [gdprConsent, setGdprConsent] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');

  // Workspace Data State
  const [jobs, setJobs] = useState<JobListing[]>(initialJobs);
  const [opportunities, setOpportunities] = useState<HiddenOpportunity[]>(
    initialHiddenOpportunities
  );
  const [profile, setProfile] = useState<CandidateProfile>(() =>
    loadStored<CandidateProfile>(STORAGE_KEYS.profile, initialCandidateProfile)
  );
  const [cvVersions, setCvVersions] = useState<CvDocument[]>(() =>
    loadStored<CvDocument[]>(STORAGE_KEYS.cvs, initialCvDocuments)
  );
  const [activeCvId, setActiveCvId] = useState<string>(cvVersions[0]?.id ?? 'cv-master-v1');
  const [applications, setApplications] = useState<TrackedApplication[]>(() =>
    loadStored<TrackedApplication[]>(STORAGE_KEYS.apps, initialApplications)
  );
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() =>
    loadStored<WatchlistItem[]>(STORAGE_KEYS.watchlist, initialWatchlist)
  );

  // Live Multi-User Cloud Collections (Firestore) & Server Engine Notifications
  const [companyJobs, setCompanyJobs] = useState<CompanyJobDoc[]>([]);
  const [publicCandidates, setPublicCandidates] = useState<PublicCandidateDoc[]>([]);
  const [conversations, setConversations] = useState<ConversationDoc[]>([]);
  const [serverUnreadNotifs, setServerUnreadNotifs] = useState(0);

  // Cross-module handoff states
  const [careerSubTab, setCareerSubTab] = useState<'tracker' | 'interview' | 'mobility'>('tracker');
  const [careerSubTabSeq, setCareerSubTabSeq] = useState(0);
  const [verifyJobPrefill, setVerifyJobPrefill] = useState<JobListing | null>(null);
  const [tailorJobPrefill, setTailorJobPrefill] = useState<JobListing | null>(null);
  const [atsJobPrefill, setAtsJobPrefill] = useState<JobListing | null>(null);
  const [matchFocusedJob, setMatchFocusedJob] = useState<JobListing | null>(null);
  const [inspectedCompany, setInspectedCompany] = useState<{
    name: string;
    country?: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const seededRef = useRef<Record<string, boolean>>({});
  const cvVersionsRef = useRef(cvVersions);
  const profileRef = useRef(profile);
  const langRef = useRef(lang);

  cvVersionsRef.current = cvVersions;
  profileRef.current = profile;
  langRef.current = lang;

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  // Document language + RTL sync
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.lang, JSON.stringify(lang));
      document.documentElement.lang = lang;
      document.documentElement.dir = isRtlLang(lang) ? 'rtl' : 'ltr';
    } catch {
      // ignore storage quota errors
    }
  }, [lang]);

  // LocalStorage mirror for offline/guest resilience
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.cvs, JSON.stringify(cvVersions));
    } catch {
      // ignore
    }
  }, [cvVersions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.apps, JSON.stringify(applications));
    } catch {
      // ignore
    }
  }, [applications]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify(watchlist));
    } catch {
      // ignore
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.role, JSON.stringify(accountRole));
    } catch {
      // ignore
    }
  }, [accountRole]);

  // Firebase Auth listener & Cloud Firestore subscriptions
  useEffect(() => {
    let unsubs: Array<() => void> = [];

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      unsubs.forEach((fn) => fn());
      unsubs = [];
      setAuthUser(user);

      if (!user) {
        setIsAdmin(false);
        setCompanyJobs([]);
        setPublicCandidates([]);
        setConversations([]);
        setServerUnreadNotifs(0);
        return;
      }

      try {
        const [account, adminFlag] = await Promise.all([
          ensureUserAccount({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || profileRef.current.fullName,
            lang: langRef.current,
            defaultProfile: profileRef.current,
          }),
          checkIsAdminUser(user.uid, user.email),
        ]);

        setIsAdmin(adminFlag);
        setAccountRole(account.accountRole);
        setDiscoverable(account.discoverable);
        setGdprConsent(account.gdprConsent);
        setCompanyName(account.companyName || '');
        setCompanyWebsite(account.companyWebsite || '');
        if (account.profile) {
          setProfile(account.profile);
        }

        const unsubCvs = subscribeUserCvs(user.uid, (cloudCvs) => {
          if (cloudCvs.length === 0 && !seededRef.current[`cvs_${user.uid}`]) {
            seededRef.current[`cvs_${user.uid}`] = true;
            const localCvs = cvVersionsRef.current;
            localCvs.forEach((cv) => {
              saveUserCv(user.uid, cv).catch(() => {});
            });
            return;
          }
          if (cloudCvs.length > 0) {
            setCvVersions(cloudCvs);
            setActiveCvId((curr) =>
              cloudCvs.some((c) => c.id === curr) ? curr : cloudCvs[0].id
            );
          }
        });

        const unsubApps = subscribeUserApplications(user.uid, (cloudApps) => {
          setApplications(cloudApps);
        });

        const unsubWatch = subscribeUserWatchlist(user.uid, (cloudWatch) => {
          setWatchlist(cloudWatch);
        });

        fetchUserNotifications()
          .then((res) => setServerUnreadNotifs(res.unreadCount || 0))
          .catch(() => {});

        const unsubCompanyJobs = subscribeOpenCompanyJobs((items) => {
          setCompanyJobs(items);
        });

        const unsubPublicCands = subscribePublicCandidates((items) => {
          setPublicCandidates(items);
        });

        const unsubConvs = subscribeUserConversations(user.uid, (items) => {
          setConversations(items);
        });

        unsubs = [
          unsubCvs,
          unsubApps,
          unsubWatch,
          unsubCompanyJobs,
          unsubPublicCands,
          unsubConvs,
        ];
      } catch (err) {
        console.error('Cloud sync setup error:', err);
      }
    });

    return () => {
      unsubs.forEach((fn) => fn());
      unsubAuth();
    };
  }, []);

  // Merge live employer postings from Firestore with search jobs
  const mergedJobs = useMemo(() => {
    const employerListings = companyJobs.map(mapCompanyJobToListing);
    const seenIds = new Set(employerListings.map((j) => j.id));
    return [...employerListings, ...jobs.filter((j) => !seenIds.has(j.id))];
  }, [companyJobs, jobs]);

  const trackedKeys = useMemo(
    () =>
      new Set(
        applications.map((a) => `${a.company.toLowerCase()}::${a.role.toLowerCase()}`)
      ),
    [applications]
  );

  const alertCount = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const watchUnread = watchlist.reduce((sum, w) => sum + (w.unreadAlerts || 0), 0);
    const closedStages = new Set(['Archived', 'Offer', 'Offer Received', 'Rejected', 'Completed']);
    const dueCount = applications.filter(
      (a) => a.followUpDate && a.followUpDate <= todayStr && !closedStages.has(a.stage)
    ).length;
    return serverUnreadNotifs + watchUnread + dueCount;
  }, [serverUnreadNotifs, watchlist, applications]);

  // Auth Actions
  const handleSignIn = async () => {
    try {
      await signInWithGooglePopup();
      showNotice(
        lang === 'fr'
          ? 'Connecté à votre espace cloud JOBFOUNDS.'
          : 'Signed in to your JOBFOUNDS cloud workspace.'
      );
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Unable to complete Google sign-in.'
      );
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      showNotice(
        lang === 'fr'
          ? 'Session cloud fermée (mode local actif).'
          : 'Signed out (local mode active).'
      );
    } catch {
      // ignore
    }
  };

  // Persisted Mutations (Local + Firestore when authenticated)
  const handleChangeLang = (nextLang: Lang) => {
    setLang(nextLang);
    if (authUser) {
      updateUserAccount(authUser.uid, { lang: nextLang }).catch(() => {});
    }
  };

  const handleSaveProfile = (nextProfile: CandidateProfile) => {
    setProfile(nextProfile);
    if (authUser) {
      updateUserAccount(authUser.uid, {
        fullName: nextProfile.fullName,
        profile: nextProfile,
      }).catch(() => {});
      if (discoverable) {
        syncPublicCandidateDirectory(authUser.uid, nextProfile, true).catch(() => {});
      }
    }
  };

  const handleUpdateCvVersions = (nextVersions: CvDocument[]) => {
    const prevMap = new Map(cvVersions.map((c) => [c.id, c]));
    const nextIds = new Set(nextVersions.map((c) => c.id));
    setCvVersions(nextVersions);

    if (authUser) {
      nextVersions.forEach((cv) => {
        const prev = prevMap.get(cv.id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(cv)) {
          saveUserCv(authUser.uid, cv).catch(() => {});
        }
      });
      cvVersions.forEach((oldCv) => {
        if (!nextIds.has(oldCv.id)) {
          deleteUserCv(authUser.uid, oldCv.id).catch(() => {});
        }
      });
    }
  };

  const handleSaveApplication = (app: TrackedApplication) => {
    setApplications((prev) => {
      const exists = prev.some((a) => a.id === app.id);
      return exists ? prev.map((a) => (a.id === app.id ? app : a)) : [app, ...prev];
    });
    if (authUser) {
      saveUserApplication(authUser.uid, app).catch(() => {});
    }
  };

  const handleDeleteApplication = (id: string) => {
    setApplications((prev) => prev.filter((a) => a.id !== id));
    if (authUser) {
      deleteUserApplication(authUser.uid, id).catch(() => {});
    }
  };

  const handleSaveWatchItem = (item: WatchlistItem) => {
    setWatchlist((prev) => {
      const exists = prev.some((w) => w.id === item.id);
      return exists ? prev.map((w) => (w.id === item.id ? item : w)) : [item, ...prev];
    });
    if (authUser) {
      saveWatchlistItem(authUser.uid, item).catch(() => {});
    }
  };

  const handleDeleteWatchItem = (id: string) => {
    setWatchlist((prev) => prev.filter((w) => w.id !== id));
    if (authUser) {
      deleteWatchlistItem(authUser.uid, id).catch(() => {});
    }
  };

  const handleTrackJob = (job: JobListing) => {
    const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
    if (trackedKeys.has(key)) {
      setActiveTab('career');
      return;
    }
    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const newEntry: TrackedApplication = {
      id: `app_${Date.now()}`,
      role: job.title,
      company: job.company,
      location: `${job.city}, ${job.country}`,
      type: 'Confirmed Job',
      stage: 'Opportunity Identified',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: followDate,
      sourceUrl: job.sourceUrl,
      salaryRange: job.salaryRange,
      notes: job.recruiterHint || '',
      approvalStatus: 'not_required',
    };
    handleSaveApplication(newEntry);
    showNotice(
      lang === 'fr'
        ? `Ajouté au CRM : ${job.company} — ${job.title}`
        : `Tracked in CRM: ${job.company} — ${job.title}`
    );
  };

  const handleTrackSpontaneous = (opp: HiddenOpportunity) => {
    const roleLabel = opp.potentialRoles[0] || profile.currentTitle;
    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const newEntry: TrackedApplication = {
      id: `app_spont_${Date.now()}`,
      role: roleLabel,
      company: opp.company,
      location: opp.location,
      type: 'Spontaneous',
      stage: 'Awaiting Authorization',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: followDate,
      sourceUrl: opp.professionalContact.url || opp.sourceUrl,
      contactName: opp.professionalContact.nameOrDepartment,
      contactChannel: opp.professionalContact.channel,
      approvalStatus: 'pending_user_approval',
      notes: `${opp.classification} — ${opp.detectionReason}`,
    };
    handleSaveApplication(newEntry);
    showNotice(
      lang === 'fr'
        ? `Candidature spontanée préparée pour ${opp.company} (en attente de votre autorisation dans le CRM).`
        : `Spontaneous application prepared for ${opp.company} (awaiting your authorization in CRM).`
    );
  };

  // Account & GDPR handlers
  const handleChangeRole = (nextRole: AccountRole) => {
    setAccountRole(nextRole);
    if (authUser) {
      updateUserAccount(authUser.uid, { accountRole: nextRole }).catch(() => {});
    }
    showNotice(
      lang === 'fr' ? 'Rôle du compte mis à jour.' : 'Account role updated.'
    );
  };

  const handleToggleDiscoverable = (val: boolean) => {
    setDiscoverable(val);
    if (authUser) {
      updateUserAccount(authUser.uid, { discoverable: val }).catch(() => {});
      syncPublicCandidateDirectory(authUser.uid, profile, val)
        .then(() => {
          showNotice(
            val
              ? lang === 'fr'
                ? 'Profil anonymisé visible aux recruteurs.'
                : 'PII-safe profile published to recruiter directory.'
              : lang === 'fr'
                ? 'Profil retiré de l’annuaire recruteurs.'
                : 'Profile removed from recruiter directory.'
          );
        })
        .catch(() => {});
    }
  };

  const handleToggleGdpr = (val: boolean) => {
    setGdprConsent(val);
    if (authUser) {
      updateUserAccount(authUser.uid, { gdprConsent: val }).catch(() => {});
    }
  };

  const handleSaveCompanyInfo = (name: string, website: string) => {
    setCompanyName(name);
    setCompanyWebsite(website);
    if (authUser) {
      updateUserAccount(authUser.uid, {
        companyName: name,
        companyWebsite: website,
      }).catch(() => {});
    }
    showNotice(
      lang === 'fr' ? 'Informations entreprise enregistrées.' : 'Company details saved.'
    );
  };

  const handleDeleteAllData = async () => {
    if (authUser) {
      await deleteAllUserCloudData(authUser.uid);
      await signOutUser();
    }
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    });
    setProfile(initialCandidateProfile);
    setCvVersions(initialCvDocuments);
    setActiveCvId(initialCvDocuments[0].id);
    setApplications(initialApplications);
    setWatchlist(initialWatchlist);
    setDiscoverable(false);
    setCompanyName('');
    setCompanyWebsite('');
    showNotice(
      lang === 'fr'
        ? 'Toutes vos données personnelles ont été effacées (RGPD).'
        : 'All personal data erased in accordance with GDPR.'
    );
  };

  const tr = t(lang);

  const handleTopPrimaryAction = async () => {
    if (activeTab === 'home') {
      setActiveTab('jobs');
      return;
    }
    if (activeTab === 'cv') {
      const currentCv = cvVersions.find((v) => v.id === activeCvId) ?? cvVersions[0];
      if (currentCv) {
        const { exportCvAsPdf } = await import('./utils/exportCv');
        exportCvAsPdf(currentCv, lang);
        showNotice(lang === 'fr' ? 'Export PDF téléchargé.' : 'PDF exported.');
      }
      return;
    }
    if (activeTab === 'companies') {
      setActiveTab('matching');
      return;
    }
    if (activeTab === 'jobs') {
      setActiveTab('companies');
      return;
    }
    if (activeTab === 'hidden') {
      setActiveTab('verify');
      return;
    }
    if (activeTab === 'verify') {
      setActiveTab('ats');
      return;
    }
    if (activeTab === 'ats') {
      setActiveTab('cv');
      return;
    }
    if (activeTab === 'watchlist') {
      setActiveTab('companies');
      return;
    }
    setActiveTab('jobs');
  };

  const handleNavigateFromLanding = (
    tab: WorkspaceTab,
    subTab?: 'tracker' | 'interview' | 'mobility'
  ) => {
    if (tab === 'career' && subTab) {
      setCareerSubTab(subTab);
      setCareerSubTabSeq((s) => s + 1);
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectPersonaFromHome = (role: AccountRole, targetTab: WorkspaceTab) => {
    handleChangeRole(role);
    setActiveTab(targetTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddCompanyToWatchlist = (
    compName: string,
    compCountry: string,
    sector: string
  ) => {
    const newItem: WatchlistItem = {
      id: `watch_${Date.now()}`,
      kind: 'company',
      label: compName,
      country: compCountry || 'International',
      sector: sector || 'Technology',
      unreadAlerts: 0,
      lastChecked: new Date().toISOString().slice(0, 10),
      lastSignalSummary:
        lang === 'fr'
          ? 'Ajouté depuis la fiche d’intelligence entreprise.'
          : 'Added from Company Intelligence brief.',
    };
    handleSaveWatchItem(newItem);
    showNotice(
      lang === 'fr'
        ? `${compName} ajouté à votre veille stratégique.`
        : `${compName} added to your strategic watchlist.`
    );
  };

  const handleVerifyCompanyFromModal = (compName: string, website: string) => {
    setVerifyJobPrefill({
      id: `verify-comp-${Date.now()}`,
      title: 'Corporate Domain & Recruiting Verification',
      company: compName,
      country: inspectedCompany?.country || 'International',
      city: '',
      workMode: 'Hybrid',
      contractType: 'Full-time',
      experienceLevel: 'All levels',
      degreeRequired: 'Not specified',
      salaryRange: 'Not specified',
      languages: ['English'],
      skills: [],
      publishedDate: new Date().toISOString().slice(0, 10),
      sourceName: compName,
      sourceUrl: website,
      verificationStatus: 'Unverified',
      verificationSummary: '',
      description: `Independent corporate authenticity check for ${compName} (${website}).`,
    });
    setInspectedCompany(null);
    setActiveTab('verify');
  };

  const workspaceFallback = (
    <div className="bg-white border border-jf-border rounded-xl p-8 space-y-4 animate-pulse">
      <div className="h-6 bg-jf-soft rounded w-1/3" />
      <div className="h-4 bg-jf-ice rounded w-2/3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
        <div className="h-28 bg-jf-ice rounded-lg" />
        <div className="h-28 bg-jf-ice rounded-lg" />
        <div className="h-28 bg-jf-ice rounded-lg" />
      </div>
    </div>
  );

  // Full-Bleed Public Commercial Landing Page Mode (no SaaS dashboard sidebar)
  if (activeTab === 'home') {
    return (
      <>
        <LandingPage
          lang={lang}
          onChangeLang={handleChangeLang}
          jobsCount={mergedJobs.length}
          hiddenCount={opportunities.length}
          trackedCount={applications.length}
          signedInEmail={authUser?.email ?? null}
          onNavigate={handleNavigateFromLanding}
          onSelectPersona={handleSelectPersonaFromHome}
          onSignIn={handleSignIn}
        />

        <OfflineIndicator lang={lang} />

        {toastMessage && (
          <div
            role="status"
            className="fixed bottom-5 right-5 z-50 px-4 py-2.5 bg-jf-navy border border-jf-sky/40 text-white text-xs font-medium rounded-lg shadow-md"
          >
            {toastMessage}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-jf-ice text-jf-navy flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        lang={lang}
        onToggleLang={handleChangeLang}
        profile={profile}
        trackedCount={applications.length}
        alertCount={alertCount}
        messageCount={conversations.length}
        signedInEmail={authUser?.email ?? null}
        isAdmin={isAdmin}
        onSignIn={handleSignIn}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen pb-14 lg:pb-0">
        <TopHeader
          activeTab={activeTab}
          lang={lang}
          onOpenMobile={() => setMobileMenuOpen(true)}
          primaryActionLabel={tr.topActions[activeTab]}
          onPrimaryAction={() => void handleTopPrimaryAction()}
        />

        <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-6 sm:py-8">
          <Suspense fallback={workspaceFallback}>
            {activeTab === 'jobs' && (
              <GlobalJobSearch
                lang={lang}
                jobs={mergedJobs}
                onJobsUpdate={setJobs}
                profile={profile}
                trackedKeys={trackedKeys}
                onTrackJob={handleTrackJob}
                onVerifyJob={(job) => {
                  setVerifyJobPrefill(job);
                  setActiveTab('verify');
                }}
                onTailorCvForJob={(job) => {
                  setTailorJobPrefill(job);
                  setActiveTab('cv');
                }}
                onAnalyzeAtsForJob={(job) => {
                  setAtsJobPrefill(job);
                  setActiveTab('ats');
                }}
                onOpenMatchForJob={(job) => {
                  setMatchFocusedJob(job);
                  setActiveTab('matching');
                }}
                onOpenCompanyIntel={(compName, compCountry) =>
                  setInspectedCompany({ name: compName, country: compCountry })
                }
                externalSearchTrigger={0}
              />
            )}

            {activeTab === 'companies' && (
              <CompanyIntelligenceHub
                lang={lang}
                signedIn={Boolean(authUser)}
                onRequireSignIn={handleSignIn}
                onCreateCrmApplication={handleSaveApplication}
                onNotify={showNotice}
              />
            )}

            {activeTab === 'hidden' && (
              <HiddenOpportunities
                lang={lang}
                opportunities={opportunities}
                onOpportunitiesUpdate={setOpportunities}
                profile={profile}
                onTrackSpontaneous={handleTrackSpontaneous}
              />
            )}

            {activeTab === 'verify' && (
              <VerificationEngine
                lang={lang}
                prefillJob={verifyJobPrefill}
                jobs={mergedJobs}
              />
            )}

            {activeTab === 'cv' && (
              <CvBuilder
                lang={lang}
                versions={cvVersions}
                activeVersionId={activeCvId}
                onSelectVersion={setActiveCvId}
                onUpdateVersions={handleUpdateCvVersions}
                targetJobPrefill={tailorJobPrefill}
              />
            )}

            {activeTab === 'ats' && (
              <AtsAnalyzer
                lang={lang}
                cvVersions={cvVersions}
                jobs={mergedJobs}
                prefillJob={atsJobPrefill}
              />
            )}

            {activeTab === 'matching' && (
              <SmartMatching
                lang={lang}
                profile={profile}
                onSaveProfile={handleSaveProfile}
                jobs={mergedJobs}
                focusedJob={matchFocusedJob}
                signedIn={Boolean(authUser)}
                onRequireSignIn={handleSignIn}
                onCreateCrmApplication={handleSaveApplication}
                onNotify={showNotice}
              />
            )}

            {activeTab === 'career' && (
              <CareerHub
                lang={lang}
                profile={profile}
                cvVersions={cvVersions}
                applications={applications}
                onSaveApplication={handleSaveApplication}
                onDeleteApplication={handleDeleteApplication}
                openAddFormSignal={0}
                initialSubTab={careerSubTab}
                subTabTrigger={careerSubTabSeq}
              />
            )}

            {activeTab === 'watchlist' && (
              <WatchlistAlerts
                lang={lang}
                signedIn={Boolean(authUser)}
                profile={profile}
                watchlist={watchlist}
                onSaveWatchItem={handleSaveWatchItem}
                onDeleteWatchItem={handleDeleteWatchItem}
                applications={applications}
                onJumpToTracker={() => setActiveTab('career')}
                onRequireSignIn={handleSignIn}
                onUnreadCountChange={setServerUnreadNotifs}
                onNotify={showNotice}
              />
            )}

            {activeTab === 'recruiters' && (
              <RecruiterHub
                lang={lang}
                uid={authUser?.uid ?? null}
                userDisplayName={authUser?.displayName || profile.fullName}
                accountRole={accountRole}
                companyNameDefault={companyName}
                companyWebsiteDefault={companyWebsite}
                companyJobs={companyJobs}
                publicCandidates={publicCandidates}
                conversations={conversations}
                onRequireSignIn={handleSignIn}
                onNotify={showNotice}
              />
            )}

            {activeTab === 'account' && (
              <AccountPrivacyHub
                lang={lang}
                onChangeLang={handleChangeLang}
                user={
                  authUser
                    ? {
                        uid: authUser.uid,
                        email: authUser.email || '',
                        displayName: authUser.displayName || profile.fullName,
                      }
                    : null
                }
                accountRole={accountRole}
                onChangeRole={handleChangeRole}
                discoverable={discoverable}
                onToggleDiscoverable={handleToggleDiscoverable}
                gdprConsent={gdprConsent}
                onToggleGdpr={handleToggleGdpr}
                companyName={companyName}
                companyWebsite={companyWebsite}
                onSaveCompanyInfo={handleSaveCompanyInfo}
                onSignIn={handleSignIn}
                onSignOut={handleSignOut}
                onDeleteAllData={handleDeleteAllData}
                exportPayload={{
                  profile,
                  cvVersions,
                  applications,
                  watchlist,
                }}
              />
            )}

            {activeTab === 'admin' && (
              <AdminDashboard
                lang={lang}
                isAdmin={isAdmin}
                adminEmail={authUser?.email ?? null}
                onNotify={showNotice}
              />
            )}
          </Suspense>
        </main>

        <footer className="border-t border-jf-dark bg-jf-navy text-jf-sky px-4 sm:px-8 py-5 text-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-md px-2.5 py-1 inline-flex items-center shrink-0">
              <BrandLogo size="sm" className="h-5" />
            </div>
            <span className="text-white/90">
              © {new Date().getFullYear()} JOBFOUNDS — Global AI Career & Recruitment Intelligence Platform
            </span>
          </div>
          <span className="text-jf-sky/90">{tr.slogan}</span>
        </footer>
      </div>

      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenMenu={() => setMobileMenuOpen(true)}
        lang={lang}
      />

      <OfflineIndicator lang={lang} />

      {inspectedCompany && (
        <Suspense fallback={null}>
          <CompanyIntelModal
            companyName={inspectedCompany.name}
            country={inspectedCompany.country}
            lang={lang}
            onClose={() => setInspectedCompany(null)}
            onAddToWatchlist={handleAddCompanyToWatchlist}
            onVerifyCompany={handleVerifyCompanyFromModal}
          />
        </Suspense>
      )}

      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-16 lg:bottom-5 right-5 z-50 px-4 py-2.5 bg-jf-navy border border-jf-sky/40 text-white text-xs font-medium rounded-lg shadow-md"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
