import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  Loader2,
  LogIn,
  MailCheck,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  CareerChangeRecord,
  CareerJobRecord,
  CompanyRecord,
  CompanySignalRecord,
  ContactConfidenceLevel,
  HrContactRecord,
  Lang,
  NeedClassification,
  TrackedApplication,
} from '../types';
import {
  discoverMultiCountryCompanies,
  fetchIntelligenceCompanies,
  fetchIntelligenceCompanyDetail,
  registerIntelligenceCompany,
  triggerCareerPageMonitor,
  triggerCompanySignalScan,
  triggerHrContactDiscovery,
  updateIntelligenceCompany,
} from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import { CareerLocationMapHub } from './CareerLocationMapHub';
import type { ApplicationModalTarget } from './ApplicationSubmissionModal';

interface CompanyIntelligenceHubProps {
  lang: Lang;
  signedIn: boolean;
  onRequireSignIn: () => void;
  onCreateCrmApplication: (app: TrackedApplication) => void;
  onOpenApplyModal?: (target: ApplicationModalTarget) => void;
  onNotify: (msg: string) => void;
}

function classificationLabel(c: NeedClassification, lang: Lang): { label: string; style: string } {
  switch (c) {
    case 'confirmed_job':
      return {
        label: lang === 'fr' ? 'Offre confirmée' : 'Confirmed Job',
        style: 'bg-jf-navy text-white',
      };
    case 'confirmed_hiring_need':
      return {
        label: lang === 'fr' ? 'Besoin de recrutement confirmé' : 'Confirmed Hiring Need',
        style: 'bg-jf-blue text-white',
      };
    case 'probable_hiring_signal':
      return {
        label: lang === 'fr' ? 'Signal probable de recrutement' : 'Probable Hiring Signal',
        style: 'bg-jf-soft text-jf-navy border border-jf-sky',
      };
    default:
      return {
        label: lang === 'fr' ? 'Opportunité potentielle' : 'Potential Opportunity',
        style: 'bg-jf-ice text-jf-dark border border-jf-border',
      };
  }
}

function confidenceLabel(level: ContactConfidenceLevel, lang: Lang): { label: string; style: string } {
  if (level === 'confirmed') {
    return {
      label: lang === 'fr' ? 'Confirmé (source publique)' : 'Confirmed',
      style: 'bg-jf-navy text-jf-sky',
    };
  }
  if (level === 'probable') {
    return {
      label: lang === 'fr' ? 'Probable (à vérifier)' : 'Probable',
      style: 'bg-jf-soft text-jf-navy',
    };
  }
  return {
    label: lang === 'fr' ? 'Non vérifié' : 'Unverified',
    style: 'bg-jf-ice text-slate-600 border border-jf-border',
  };
}

export function CompanyIntelligenceHub({
  lang,
  signedIn,
  onRequireSignIn,
  onCreateCrmApplication,
  onOpenApplyModal,
  onNotify,
}: CompanyIntelligenceHubProps) {
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [atsFilter, setAtsFilter] = useState<string>('ALL');
  const [monitoredOnly, setMonitoredOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected company detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{
    company: CompanyRecord;
    careerJobs: CareerJobRecord[];
    careerChanges: CareerChangeRecord[];
    signals: CompanySignalRecord[];
    contacts: HrContactRecord[];
  } | null>(null);
  const [detailTab, setDetailTab] = useState<'careers' | 'signals' | 'contacts' | 'map'>('careers');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [contactDept, setContactDept] = useState('Talent Acquisition');

  // Register company form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWebsite, setNewWebsite] = useState('');
  const [newCareersUrl, setNewCareersUrl] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newSector, setNewSector] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newInterval, setNewInterval] = useState(360);
  const [autoCheckNow, setAutoCheckNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Multi-country automated discovery form (Module 1)
  const [showDiscoverForm, setShowDiscoverForm] = useState(false);
  const [discoverCountries, setDiscoverCountries] = useState('');
  const [discoverSector, setDiscoverSector] = useState('');
  const [discoverKeywords, setDiscoverKeywords] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverSummary, setDiscoverSummary] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    if (!signedIn) return;
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetchIntelligenceCompanies({
        search: searchQuery.trim() || undefined,
        country: countryFilter.trim() || undefined,
        monitored: monitoredOnly || undefined,
        limit: 100,
      });
      setCompanies(res.companies);
      if (res.companies.length > 0 && !selectedId) {
        setSelectedId(res.companies[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load companies.');
    } finally {
      setLoadingList(false);
    }
  }, [signedIn, searchQuery, countryFilter, monitoredOnly, selectedId]);

  const loadDetail = useCallback(
    async (companyId: string) => {
      if (!signedIn) return;
      setDetailLoading(true);
      try {
        const res = await fetchIntelligenceCompanyDetail(companyId);
        setDetail(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load company intelligence.');
      } finally {
        setDetailLoading(false);
      }
    },
    [signedIn]
  );

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (selectedId && signedIn) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, signedIn, loadDetail]);

  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await registerIntelligenceCompany({
        officialName: newName.trim(),
        officialWebsite: newWebsite.trim(),
        careersUrl: newCareersUrl.trim(),
        country: newCountry.trim(),
        sector: newSector.trim(),
        estimatedSize: newSize.trim(),
        monitored: true,
        monitorIntervalMinutes: newInterval,
        autoCheckNow,
      });
      onNotify(
        res.merged
          ? lang === 'fr'
            ? `${res.company.officialName} fusionnée automatiquement avec la fiche existante (anti-doublon).`
            : `${res.company.officialName} merged automatically with existing record.`
          : lang === 'fr'
            ? `${res.company.officialName} enregistrée dans la base intelligente.`
            : `${res.company.officialName} registered in the intelligence database.`
      );
      setNewName('');
      setNewWebsite('');
      setNewCareersUrl('');
      setNewCountry('');
      setNewSector('');
      setNewSize('');
      setShowAddForm(false);
      setSelectedId(res.company.id);
      await loadCompanies();
      await loadDetail(res.company.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMonitorCareer = async (mode: 'sync' | 'queue') => {
    if (!detail) return;
    setActionBusy(`career_${mode}`);
    setError(null);
    try {
      const res = await triggerCareerPageMonitor(detail.company.id, mode);
      if (mode === 'queue') {
        onNotify(
          lang === 'fr'
            ? 'Vérification de la page carrières placée dans la file d’arrière-plan.'
            : 'Career page check queued for background worker.'
        );
      } else {
        const r = res.result;
        onNotify(
          lang === 'fr'
            ? `Page carrières vérifiée : ${r?.fetchedCount ?? 0} offres lues (+${r?.addedCount ?? 0} ajoutées, ${r?.removedCount ?? 0} expirées).`
            : `Career page checked: ${r?.fetchedCount ?? 0} fetched (+${r?.addedCount ?? 0} added, ${r?.removedCount ?? 0} expired).`
        );
        await loadDetail(detail.company.id);
        await loadCompanies();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Career monitoring failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleScanSignals = async (mode: 'sync' | 'queue') => {
    if (!detail) return;
    setActionBusy(`signals_${mode}`);
    setError(null);
    try {
      const res = await triggerCompanySignalScan(detail.company.id, mode);
      if (mode === 'queue') {
        onNotify(
          lang === 'fr'
            ? 'Scan des signaux de croissance planifié en arrière-plan.'
            : 'Growth signal scan queued in background worker.'
        );
      } else {
        onNotify(
          lang === 'fr'
            ? `${res.result?.insertedSignals ?? 0} nouveaux signaux publics vérifiés enregistrés.`
            : `${res.result?.insertedSignals ?? 0} new verified public signals recorded.`
        );
        await loadDetail(detail.company.id);
        await loadCompanies();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signal scan failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleDiscoverContacts = async (mode: 'sync' | 'queue') => {
    if (!detail) return;
    setActionBusy(`contacts_${mode}`);
    setError(null);
    try {
      const res = await triggerHrContactDiscovery(detail.company.id, contactDept, mode);
      if (mode === 'queue') {
        onNotify(
          lang === 'fr'
            ? 'Recherche de contacts RH planifiée en arrière-plan.'
            : 'HR contact discovery queued in background worker.'
        );
      } else {
        onNotify(
          lang === 'fr'
            ? `${res.result?.insertedCount ?? 0} contacts/canaux enregistrés · Domaine MX ${res.result?.mxVerified ? 'vérifié' : 'non confirmé'}.`
            : `${res.result?.insertedCount ?? 0} contacts recorded · Domain MX ${res.result?.mxVerified ? 'verified' : 'unconfirmed'}.`
        );
        await loadDetail(detail.company.id);
        await loadCompanies();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contact discovery failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleToggleMonitored = async (company: CompanyRecord) => {
    setActionBusy('toggle_monitor');
    try {
      await updateIntelligenceCompany(company.id, { monitored: !company.monitored });
      await loadDetail(company.id);
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleMultiCountryDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedCountries = discoverCountries
      .split(/[,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (parsedCountries.length === 0) return;
    setDiscovering(true);
    setError(null);
    setDiscoverSummary(null);
    try {
      const res = await discoverMultiCountryCompanies({
        countries: parsedCountries,
        sector: discoverSector.trim(),
        keywords: discoverKeywords.trim(),
        lang,
      });
      const summaryText =
        lang === 'fr'
          ? `${res.companiesDiscovered} entreprise(s) détectée(s) (${res.companiesCreated} nouvelle(s)), ${res.signalsRecorded} signal(ux) sourcés enregistrés et ${res.backgroundJobsQueued} tâche(s) de surveillance planifiée(s) en arrière-plan.`
          : `${res.companiesDiscovered} companies discovered (${res.companiesCreated} new), ${res.signalsRecorded} sourced signals recorded, and ${res.backgroundJobsQueued} background monitoring jobs queued.`;
      setDiscoverSummary(summaryText);
      onNotify(summaryText);
      await loadCompanies();
      if (res.companies[0]?.company?.id) {
        setSelectedId(res.companies[0].company.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Multi-country discovery failed.');
    } finally {
      setDiscovering(false);
    }
  };

  const handlePrepareCrmFromJob = (job: CareerJobRecord, company: CompanyRecord) => {
    const primaryContact = detail?.contacts.find((c) => c.confidenceLevel !== 'unverified') || detail?.contacts[0];
    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    onCreateCrmApplication({
      id: `app_career_${Date.now()}`,
      role: job.title,
      company: company.officialName,
      companyId: company.id,
      location: job.location || company.location || company.country || 'International',
      type: 'Confirmed Job',
      stage: 'Opportunity Identified',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: followDate,
      sourceUrl: job.applyUrl || company.careersUrl,
      salaryRange: job.salaryRange || '',
      contactName: primaryContact?.fullName || '',
      contactRole: primaryContact?.roleTitle || '',
      contactChannel: primaryContact?.contactChannel || '',
      approvalStatus: 'not_required',
      responseReceived: false,
      responseSource: 'none',
      nextAction: lang === 'fr' ? 'Adapter le CV et vérifier les prérequis' : 'Tailor CV and review requirements',
      notes: `${lang === 'fr' ? 'Détectée sur page carrières officielle' : 'Detected on official careers page'} (${company.atsProvider})`,
    });
    onNotify(
      lang === 'fr'
        ? `Offre « ${job.title} » ajoutée au CRM (Opportunité identifiée).`
        : `Job "${job.title}" added to CRM (Opportunity Identified).`
    );
  };

  const handlePrepareSpontaneous = (company: CompanyRecord, signal?: CompanySignalRecord) => {
    const primaryContact = detail?.contacts.find((c) => c.confidenceLevel === 'confirmed') || detail?.contacts[0];
    const inferredRole = signal?.inferredRoles?.[0] || `${company.sector || 'International'} Specialist`;

    if (onOpenApplyModal) {
      onOpenApplyModal({
        companyId: company.id,
        companyName: company.officialName,
        roleTitle: inferredRole,
        location: company.location || company.country || 'International',
        sector: company.sector,
        opportunityType: 'hidden_opportunity',
        classification: signal?.classification || 'potential_opportunity',
        officialUrl: company.careersUrl || company.officialWebsite,
        sourceName: signal?.sourceName || company.officialName,
        publishedDate: signal?.detectedDate,
        inferredSkills: company.frequentSkills,
        signalReason: signal?.title || signal?.summary,
        signalEvidence: signal?.evidenceText || signal?.summary,
        recommendedContactName: primaryContact?.fullName,
        recommendedContactRole: primaryContact?.roleTitle,
        recommendedContactEmail: primaryContact?.corporateEmail,
        recommendedContactUrl: primaryContact?.publicUrl || company.careersUrl || company.officialWebsite,
      });
      return;
    }

    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    onCreateCrmApplication({
      id: `app_spont_${Date.now()}`,
      role: inferredRole,
      company: company.officialName,
      companyId: company.id,
      location: company.location || company.country || 'International',
      type: 'Spontaneous',
      stage: 'Awaiting Authorization',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: followDate,
      sourceUrl: signal?.sourceUrl || company.careersUrl || company.officialWebsite,
      contactName: primaryContact?.fullName || '',
      contactRole: primaryContact?.roleTitle || '',
      contactChannel: primaryContact?.corporateEmail || primaryContact?.contactChannel || '',
      approvalStatus: 'pending_user_approval',
      responseReceived: false,
      responseSource: 'none',
      nextAction:
        lang === 'fr'
          ? 'Valider explicitement le message avant envoi dans le CRM'
          : 'Explicitly authorize outreach in CRM before sending',
      notes: signal
        ? `[${signal.classification}] ${signal.title} — ${signal.summary}`
        : `${lang === 'fr' ? 'Candidature spontanée préparée depuis Intelligence Entreprises' : 'Spontaneous outreach prepared from Company Intelligence'}`,
    });
    onNotify(
      lang === 'fr'
        ? `Candidature spontanée préparée pour ${company.officialName} — En attente de votre autorisation explicite dans le CRM.`
        : `Spontaneous outreach prepared for ${company.officialName} — Awaiting your explicit authorization in CRM.`
    );
  };

  if (!signedIn) {
    return (
      <section className="bg-white border border-jf-border rounded-xl p-10 text-center space-y-4 max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-xl bg-jf-navy text-jf-sky flex items-center justify-center mx-auto">
          <Database className="w-6 h-6" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-jf-navy">
          {lang === 'fr'
            ? 'Base Intelligente d’Entreprises, Pages Carrières & Contacts RH'
            : 'Company Intelligence Database, Career Monitor & Verified HR Contacts'}
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          {lang === 'fr'
            ? 'Connectez-vous avec votre compte JOBFOUNDS pour surveiller automatiquement les pages carrières officielles (Greenhouse, Lever, Ashby, JSON-LD), détecter les signaux d’expansion et vérifier les contacts RH avec contrôle DNS MX.'
            : 'Sign in with your JOBFOUNDS account to monitor official careers pages (Greenhouse, Lever, Ashby, JSON-LD), detect expansion signals, and verify HR contacts with live DNS MX checks.'}
        </p>
        <button
          type="button"
          onClick={onRequireSignIn}
          className="px-5 py-2.5 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-2"
        >
          <LogIn className="w-4 h-4" />
          <span>{lang === 'fr' ? 'Se connecter avec Google' : 'Sign in with Google'}</span>
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <section className="bg-jf-navy text-white border border-jf-dark rounded-xl p-6 sm:p-7 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-jf-sky">
              <Database className="w-4 h-4" />
              <span>
                {lang === 'fr'
                  ? 'Moteur de surveillance continue & base centralisée dédupliquée'
                  : 'Continuous Monitoring Engine & Deduplicated Company Registry'}
              </span>
            </div>
            <h1 className="font-display text-2xl font-semibold text-white">
              {lang === 'fr'
                ? 'Intelligence Entreprises, Pages Carrières & Décideurs RH'
                : 'Company Intelligence, Career Pages & HR Decision-Makers'}
            </h1>
            <p className="text-sm text-jf-soft/85 max-w-3xl">
              {lang === 'fr'
                ? 'Enregistrez des entreprises cibles pour suivre automatiquement leurs pages carrières officielles (Greenhouse, Lever, Ashby, JSON-LD), capter leurs signaux de croissance sourcés et vérifier leurs canaux RH sans aucune donnée fabriquée.'
                : 'Register target employers to automatically track official careers pages (Greenhouse, Lever, Ashby, JSON-LD), capture sourced expansion signals, and verify HR channels with zero fabricated data.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
            <button
              type="button"
              onClick={() => {
                setShowDiscoverForm((v) => !v);
                setShowAddForm(false);
              }}
              className="px-4 py-2.5 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Globe className="w-4 h-4" />
              <span>{lang === 'fr' ? 'Découverte multi-pays' : 'Multi-Country Discovery'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm((v) => !v);
                setShowDiscoverForm(false);
              }}
              className="px-4 py-2.5 text-xs font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-lg inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'fr' ? 'Surveiller une entreprise' : 'Monitor a Company'}</span>
            </button>
          </div>
        </div>

        {/* Multi-Country Automated Company Discovery Form (Module 1) */}
        {showDiscoverForm && (
          <form
            onSubmit={handleMultiCountryDiscover}
            className="p-5 bg-jf-dark/90 border border-jf-sky/25 rounded-xl space-y-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-jf-sky flex items-center gap-2">
                <Radar className="w-4 h-4" />
                <span>
                  {lang === 'fr'
                    ? 'Recherche & surveillance multi-pays des entreprises en expansion (même sans offre publiée)'
                    : 'Multi-country discovery of expanding companies (even without published job ads)'}
                </span>
              </div>
              <span className="text-[11px] text-jf-soft/80">
                {lang === 'fr'
                  ? 'Enregistrement DB + file d’attente Carrières & RH automatique'
                  : 'Auto DB registration + Careers & HR background queue'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-jf-soft font-medium">
                  {lang === 'fr' ? 'Pays cibles (séparés par virgule) *' : 'Target Countries (comma-separated) *'}
                </span>
                <input
                  type="text"
                  required
                  value={discoverCountries}
                  onChange={(e) => setDiscoverCountries(e.target.value)}
                  placeholder="France, Canada, Allemagne, Suisse"
                  className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-jf-soft font-medium">
                  {lang === 'fr' ? 'Secteur(s)' : 'Sector(s)'}
                </span>
                <input
                  type="text"
                  value={discoverSector}
                  onChange={(e) => setDiscoverSector(e.target.value)}
                  placeholder="FinTech, IA, Santé, Énergie..."
                  className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-jf-soft font-medium">
                  {lang === 'fr' ? 'Signaux recherchés' : 'Target Signals'}
                </span>
                <input
                  type="text"
                  value={discoverKeywords}
                  onChange={(e) => setDiscoverKeywords(e.target.value)}
                  placeholder="expansion, nouveau bureau, contrat..."
                  className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-jf-soft/80">
                {lang === 'fr'
                  ? 'Chaque signal est classé comme Signal probable ou Opportunité potentielle (jamais présenté comme une offre confirmée).'
                  : 'Every signal is strictly classified as Probable Signal or Potential Opportunity (never as a confirmed job ad).'}
              </p>
              <button
                type="submit"
                disabled={discovering}
                className="px-4 py-2 text-xs font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
              >
                {discovering ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Radar className="w-3.5 h-3.5" />
                )}
                <span>
                  {discovering
                    ? lang === 'fr'
                      ? 'Découverte multi-pays en cours...'
                      : 'Discovering across countries...'
                    : lang === 'fr'
                    ? 'Lancer la découverte multi-pays'
                    : 'Run Multi-Country Discovery'}
                </span>
              </button>
            </div>
            {discoverSummary && (
              <div className="p-3 bg-jf-navy/80 border border-jf-sky/40 rounded-lg text-jf-sky">
                {discoverSummary}
              </div>
            )}
          </form>
        )}

        {/* Register / Monitor New Company Form */}
        {showAddForm && (
          <form
            onSubmit={handleRegisterCompany}
            className="p-5 bg-jf-dark/90 border border-jf-sky/25 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"
          >
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Nom officiel *' : 'Official Name *'}
              </span>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex. Stripe, Mistral AI, Linear…"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Site officiel (HTTPS)' : 'Official Website'}
              </span>
              <input
                type="url"
                value={newWebsite}
                onChange={(e) => setNewWebsite(e.target.value)}
                placeholder="https://company.com"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1 lg:col-span-2">
              <span className="text-jf-soft font-medium">
                {lang === 'fr'
                  ? 'URL Page Carrières / ATS (Greenhouse, Lever, Ashby, JSON-LD)'
                  : 'Official Careers / ATS URL'}
              </span>
              <input
                type="url"
                value={newCareersUrl}
                onChange={(e) => setNewCareersUrl(e.target.value)}
                placeholder="https://boards.greenhouse.io/stripe ou https://jobs.ashbyhq.com/linear"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">{lang === 'fr' ? 'Pays' : 'Country'}</span>
              <input
                type="text"
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value)}
                placeholder="France, USA, Suisse…"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">{lang === 'fr' ? 'Secteur' : 'Sector'}</span>
              <input
                type="text"
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                placeholder="FinTech, IA, Énergie…"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Fréquence (minutes)' : 'Check Interval (min)'}
              </span>
              <select
                value={newInterval}
                onChange={(e) => setNewInterval(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              >
                <option value={60}>60 min</option>
                <option value={180}>3 h</option>
                <option value={360}>6 h</option>
                <option value={720}>12 h</option>
                <option value={1440}>24 h</option>
              </select>
            </label>
            <div className="flex flex-col justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-jf-soft pt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCheckNow}
                  onChange={(e) => setAutoCheckNow(e.target.checked)}
                  className="rounded"
                />
                <span>
                  {lang === 'fr' ? 'Vérifier la page carrières immédiatement' : 'Check careers page now'}
                </span>
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{lang === 'fr' ? 'Enregistrer & Surveiller' : 'Register & Monitor'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-xl text-sm font-medium text-jf-navy"
        >
          {error}
        </div>
      )}

      {/* Main Master-Detail Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Company Registry List */}
        <section className="xl:col-span-4 bg-white border border-jf-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-jf-border space-y-3 bg-jf-ice/60">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-jf-navy">
                  {lang === 'fr' ? 'Entreprises enregistrées' : 'Registered Companies'} (
                  {companies.filter((c) => atsFilter === 'ALL' || c.atsProvider === atsFilter).length})
                </h2>
                <div className="text-[11px] font-mono text-jf-blue tabular-nums">
                  {companies
                    .filter((c) => atsFilter === 'ALL' || c.atsProvider === atsFilter)
                    .reduce((sum, c) => sum + (c.activeJobsCount || 0), 0)}{' '}
                  {lang === 'fr' ? 'offres ATS actives indexées' : 'active ATS jobs indexed'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadCompanies()}
                className="p-1.5 text-jf-dark hover:text-jf-blue rounded-md"
                aria-label="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'fr' ? 'Filtrer par nom, domaine, secteur…' : 'Search name, domain, sector…'}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-jf-border rounded-lg focus:outline-none focus:ring-2 focus:ring-jf-blue"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                placeholder={lang === 'fr' ? 'Pays' : 'Country'}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-jf-border rounded-lg"
              />
              <select
                value={atsFilter}
                onChange={(e) => setAtsFilter(e.target.value)}
                aria-label="ATS filter"
                className="px-2 py-1.5 text-xs bg-white border border-jf-border rounded-lg text-jf-navy"
              >
                <option value="ALL">{lang === 'fr' ? 'Tous ATS' : 'All ATS'}</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="ashby">Ashby</option>
                <option value="lever">Lever</option>
                <option value="custom_jsonld">JSON-LD</option>
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs text-jf-dark cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={monitoredOnly}
                  onChange={(e) => setMonitoredOnly(e.target.checked)}
                />
                <span>{lang === 'fr' ? 'Suivies' : 'Tracked'}</span>
              </label>
            </div>
          </div>

          {loadingList && companies.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-jf-blue" />
              <span>{lang === 'fr' ? 'Chargement de la base…' : 'Loading database…'}</span>
            </div>
          ) : companies.filter((c) => atsFilter === 'ALL' || c.atsProvider === atsFilter).length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Building2 className="w-7 h-7 text-jf-sky mx-auto" />
              <p className="text-xs font-medium text-jf-navy">
                {lang === 'fr'
                  ? 'Aucune entreprise trouvée pour ce filtre.'
                  : 'No companies found for this filter.'}
              </p>
              <p className="text-xs text-slate-500">
                {lang === 'fr'
                  ? 'Cliquez sur « Surveiller une entreprise » (ex. https://boards.greenhouse.io/stripe ou https://jobs.ashbyhq.com/linear) pour démarrer la surveillance réelle.'
                  : 'Click "Monitor a Company" (e.g. https://boards.greenhouse.io/stripe or https://jobs.ashbyhq.com/linear) to start real monitoring.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-jf-border max-h-[680px] overflow-y-auto">
              {companies
                .filter((c) => atsFilter === 'ALL' || c.atsProvider === atsFilter)
                .map((c) => {
                const isSelected = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left p-4 transition-colors space-y-1.5 ${
                      isSelected ? 'bg-jf-soft/75 border-l-4 border-jf-blue' : 'hover:bg-jf-ice/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-jf-navy truncate">
                        {c.officialName}
                      </div>
                      <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-jf-navy text-jf-sky shrink-0">
                        {c.atsProvider === 'none' ? 'WEB' : c.atsProvider}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {c.country || 'International'} {c.sector ? `· ${c.sector}` : ''}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-jf-dark">
                      <span>{c.activeJobsCount} {lang === 'fr' ? 'offres' : 'jobs'}</span>
                      <span>{c.signalsCount} {lang === 'fr' ? 'signaux' : 'signals'}</span>
                      <span>{c.contactsCount} RH</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Detailed Intelligence Workspace */}
        <section className="xl:col-span-8 bg-white border border-jf-border rounded-xl p-6 space-y-6">
          {detailLoading ? (
            <div className="py-16 text-center text-xs text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-jf-blue" />
              <span>{lang === 'fr' ? 'Chargement de la fiche entreprise…' : 'Loading company profile…'}</span>
            </div>
          ) : !detail ? (
            <div className="py-16 text-center space-y-2">
              <Radar className="w-8 h-8 text-jf-sky mx-auto" />
              <p className="text-sm font-semibold text-jf-navy">
                {lang === 'fr'
                  ? 'Sélectionnez ou ajoutez une entreprise pour afficher son intelligence complète'
                  : 'Select or register a company to inspect full recruitment intelligence'}
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {lang === 'fr'
                  ? 'Toutes les données affichées ici proviennent exclusivement de pages carrières officielles, de recherches publiques sourcées et de vérifications DNS MX réelles.'
                  : 'All data displayed here originates strictly from official career pages, sourced public web checks, and real DNS MX verification.'}
              </p>
            </div>
          ) : (
            <>
              {/* Company Header */}
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-5 border-b border-jf-border">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-semibold text-jf-navy">
                      {detail.company.officialName}
                    </h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-jf-soft text-jf-navy">
                      {detail.company.verificationStatus}
                    </span>
                    <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-jf-navy text-jf-sky">
                      ATS: {detail.company.atsProvider}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{detail.company.location || detail.company.country || 'International'}</span>
                    {detail.company.sector && <span>· {detail.company.sector}</span>}
                    {detail.company.estimatedSize && <span>· {detail.company.estimatedSize}</span>}
                    {detail.company.officialDomain && (
                      <span className="font-mono text-jf-blue">· {detail.company.officialDomain}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                    {safeExternalUrl(detail.company.officialWebsite) && (
                      <a
                        href={safeExternalUrl(detail.company.officialWebsite)!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-jf-blue hover:underline inline-flex items-center gap-1"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>{lang === 'fr' ? 'Site officiel' : 'Official Website'}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                    {safeExternalUrl(detail.company.careersUrl) && (
                      <a
                        href={safeExternalUrl(detail.company.careersUrl)!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-jf-blue hover:underline inline-flex items-center gap-1"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>{lang === 'fr' ? 'Page Carrières' : 'Careers Page'}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                    {detail.company.lastMonitoredAt && (
                      <span className="text-slate-500 inline-flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          {lang === 'fr' ? 'Vérifié :' : 'Checked:'}{' '}
                          {detail.company.lastMonitoredAt.slice(0, 16).replace('T', ' ')}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={actionBusy !== null}
                    onClick={() => void handleToggleMonitored(detail.company)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      detail.company.monitored
                        ? 'bg-jf-soft border-jf-sky text-jf-navy'
                        : 'bg-white border-jf-border text-slate-600'
                    }`}
                  >
                    {detail.company.monitored
                      ? lang === 'fr'
                        ? 'Surveillance auto : ACTIVE'
                        : 'Auto Monitor: ON'
                      : lang === 'fr'
                        ? 'Surveillance auto : PAUSE'
                        : 'Auto Monitor: OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrepareSpontaneous(detail.company, detail.signals[0])}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {lang === 'fr' ? 'Préparer candidature spontanée' : 'Prepare Spontaneous'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Frequent Skills Extracted */}
              {detail.company.frequentSkills.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-jf-navy mr-1">
                    {lang === 'fr' ? 'Compétences recherchées :' : 'Frequent Skills:'}
                  </span>
                  {detail.company.frequentSkills.slice(0, 12).map((sk) => (
                    <span
                      key={sk}
                      className="px-2 py-0.5 rounded bg-jf-ice border border-jf-border text-jf-dark font-medium"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              )}

              {/* Detail Sub-tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-jf-ice rounded-lg border border-jf-border w-fit">
                <button
                  type="button"
                  onClick={() => setDetailTab('careers')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'careers' ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                  }`}
                >
                  {lang === 'fr' ? 'Page Carrières' : 'Career Page'} ({detail.careerJobs.filter((j) => j.status === 'active').length})
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('signals')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'signals' ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                  }`}
                >
                  {lang === 'fr' ? 'Signaux & Croissance' : 'Signals & Growth'} ({detail.signals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('contacts')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'contacts' ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                  }`}
                >
                  {lang === 'fr' ? 'Contacts RH & Décideurs' : 'HR & Decision-Makers'} ({detail.contacts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('map')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    detailTab === 'map' ? 'bg-jf-navy text-white' : 'text-jf-dark hover:text-jf-navy'
                  }`}
                >
                  {lang === 'fr' ? 'Localisation & Carte (OSM)' : 'Location & Map (OSM)'}
                </button>
              </div>

              {/* SUBTAB 1: CAREER PAGE MONITOR & DIFF HISTORY */}
              {detailTab === 'careers' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-jf-ice/70 border border-jf-border rounded-xl">
                    <div className="text-xs text-jf-dark space-y-0.5">
                      <div className="font-semibold text-jf-navy">
                        {lang === 'fr'
                          ? 'Surveillance automatisée de la page carrières officielle'
                          : 'Automated Official Career Page Monitor'}
                      </div>
                      <p className="text-slate-600">
                        {lang === 'fr'
                          ? 'Connecteurs officiels Greenhouse, Lever, Ashby et lecteur JSON-LD respectueux de robots.txt.'
                          : 'Official Greenhouse, Lever, Ashby API connectors and robots.txt-compliant JSON-LD reader.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void handleMonitorCareer('sync')}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                      >
                        {actionBusy === 'career_sync' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>{lang === 'fr' ? 'Vérifier maintenant' : 'Check Now'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void handleMonitorCareer('queue')}
                        className="px-3 py-2 text-xs font-medium text-jf-navy bg-white border border-jf-border hover:bg-jf-soft rounded-lg"
                      >
                        {lang === 'fr' ? 'Mettre en file' : 'Queue Job'}
                      </button>
                    </div>
                  </div>

                  {/* Active & Expired Career Jobs */}
                  {detail.careerJobs.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-xl">
                      {lang === 'fr'
                        ? 'Aucune offre extraite pour cette entreprise. Cliquez sur « Vérifier maintenant » si une page carrières officielle est configurée.'
                        : 'No career jobs extracted yet. Click "Check Now" once an official careers URL is configured.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-jf-border border border-jf-border rounded-xl overflow-hidden">
                      {detail.careerJobs.slice(0, 40).map((job) => {
                        const applyHref = safeExternalUrl(job.applyUrl);
                        return (
                          <div
                            key={job.id}
                            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-jf-ice/40"
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-jf-navy truncate">
                                  {job.title}
                                </span>
                                <span
                                  className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                                    job.status === 'active'
                                      ? 'bg-jf-soft text-jf-navy'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}
                                >
                                  {job.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600">
                                {job.department ? `${job.department} · ` : ''}
                                {job.location || job.country || 'Remote / International'} · {job.workMode}
                              </div>
                              {job.skills.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {job.skills.slice(0, 6).map((sk) => (
                                    <span
                                      key={sk}
                                      className="text-[11px] px-1.5 py-0.5 rounded bg-jf-ice text-jf-dark"
                                    >
                                      {sk}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {applyHref && (
                                <a
                                  href={applyHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2.5 py-1.5 text-xs font-medium text-jf-blue hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{lang === 'fr' ? 'Poste officiel' : 'Official Post'}</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </a>
                              )}
                              {onOpenApplyModal && job.status === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const primaryContact =
                                      detail.contacts.find((c) => c.confidenceLevel !== 'unverified') ||
                                      detail.contacts[0];
                                    onOpenApplyModal({
                                      companyId: detail.company.id,
                                      companyName: detail.company.officialName,
                                      roleTitle: job.title,
                                      location:
                                        job.location ||
                                        detail.company.location ||
                                        detail.company.country ||
                                        'International',
                                      sector: detail.company.sector,
                                      opportunityType: 'published_job',
                                      classification: 'confirmed_job',
                                      officialUrl: job.applyUrl || detail.company.careersUrl,
                                      sourceName: `${detail.company.officialName} (${detail.company.atsProvider})`,
                                      publishedDate: job.firstSeenAt?.slice(0, 10),
                                      applicationDeadline: job.applicationDeadline,
                                      salaryRange: job.salaryRange,
                                      description: [job.department, job.workMode, job.contractType]
                                        .filter(Boolean)
                                        .join(' · '),
                                      inferredSkills: job.skills,
                                      recommendedContactName: primaryContact?.fullName,
                                      recommendedContactRole: primaryContact?.roleTitle,
                                      recommendedContactEmail: primaryContact?.corporateEmail,
                                      recommendedContactUrl: primaryContact?.publicUrl,
                                    });
                                  }}
                                  className="px-3 py-1.5 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>{lang === 'fr' ? 'Postuler' : 'Apply'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handlePrepareCrmFromJob(job, detail.company)}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-jf-navy hover:bg-jf-dark rounded-lg"
                              >
                                {lang === 'fr' ? 'Suivre CRM' : 'Track in CRM'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Career Page Change Log */}
                  {detail.careerChanges.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <h3 className="text-xs font-semibold text-jf-navy">
                        {lang === 'fr'
                          ? 'Historique des changements détectés (ajouts / modifications / expirations)'
                          : 'Detected Career Page Change History'}
                      </h3>
                      <div className="divide-y divide-jf-border border border-jf-border rounded-lg text-xs">
                        {detail.careerChanges.slice(0, 15).map((ch) => (
                          <div key={ch.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="font-mono uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded bg-jf-soft text-jf-navy mr-2">
                                {ch.changeType}
                              </span>
                              <span className="font-medium text-jf-navy">{ch.jobTitle}</span>
                              {ch.details && <span className="text-slate-500"> — {ch.details}</span>}
                            </div>
                            <span className="font-mono text-[11px] text-slate-400 shrink-0">
                              {ch.detectedAt.slice(0, 10)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SUBTAB 2: GROWTH & HIRING SIGNALS */}
              {detailTab === 'signals' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-jf-ice/70 border border-jf-border rounded-xl">
                    <div className="text-xs text-jf-dark space-y-0.5">
                      <div className="font-semibold text-jf-navy">
                        {lang === 'fr'
                          ? 'Détection sourcée des signaux d’expansion et de recrutement'
                          : 'Sourced Expansion & Hiring Signal Scanner'}
                      </div>
                      <p className="text-slate-600">
                        {lang === 'fr'
                          ? 'Chaque signal est classé rigoureusement selon ses preuves publiques — jamais présenté comme un besoin confirmé sans preuve.'
                          : 'Every signal is strictly classified by verifiable public proof — never presented as a confirmed hiring need without evidence.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void handleScanSignals('sync')}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                      >
                        {actionBusy === 'signals_sync' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Radar className="w-3.5 h-3.5" />
                        )}
                        <span>{lang === 'fr' ? 'Scanner les signaux publics' : 'Scan Public Signals'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void handleScanSignals('queue')}
                        className="px-3 py-2 text-xs font-medium text-jf-navy bg-white border border-jf-border hover:bg-jf-soft rounded-lg"
                      >
                        {lang === 'fr' ? 'Mettre en file' : 'Queue'}
                      </button>
                    </div>
                  </div>

                  {detail.signals.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-xl">
                      {lang === 'fr'
                        ? 'Aucun signal enregistré pour cette entreprise. Lancez un scan public vérifié.'
                        : 'No signals recorded yet. Run a verified public scan.'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {detail.signals.map((sig) => {
                        const cls = classificationLabel(sig.classification, lang);
                        const proofUrl = safeExternalUrl(sig.sourceUrl);
                        return (
                          <article
                            key={sig.id}
                            className="p-4 border border-jf-border rounded-xl space-y-2.5 bg-white"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${cls.style}`}>
                                  {cls.label}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 uppercase">
                                  {sig.signalType}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-jf-dark">
                                <span>
                                  {lang === 'fr' ? 'Fiabilité' : 'Reliability'}: {sig.reliabilityScore}%
                                </span>
                                <span>
                                  {lang === 'fr' ? 'Pertinence' : 'Relevance'}: {sig.relevanceScore}%
                                </span>
                              </div>
                            </div>
                            <h3 className="text-sm font-semibold text-jf-navy">{sig.title}</h3>
                            <p className="text-xs text-slate-700 leading-relaxed">{sig.summary}</p>
                            {sig.evidenceText && (
                              <p className="text-xs text-slate-600 bg-jf-ice/80 border border-jf-border rounded-lg p-2.5">
                                <strong className="text-jf-navy">
                                  {lang === 'fr' ? 'Preuve publique : ' : 'Public Evidence: '}
                                </strong>
                                {sig.evidenceText}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                              <div className="flex flex-wrap items-center gap-3 text-slate-500">
                                <span className="font-mono">{sig.detectedDate}</span>
                                <span>{sig.sourceName}</span>
                                {proofUrl && (
                                  <a
                                    href={proofUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-jf-blue hover:underline inline-flex items-center gap-1"
                                  >
                                    <span>{lang === 'fr' ? 'Voir la preuve' : 'Inspect Source'}</span>
                                    <ArrowUpRight className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handlePrepareSpontaneous(detail.company, sig)}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg"
                              >
                                {lang === 'fr'
                                  ? 'Préparer candidature spontanée'
                                  : 'Prepare Spontaneous Outreach'}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SUBTAB 3: VERIFIED HR CONTACTS & DECISION-MAKERS */}
              {detailTab === 'contacts' && (
                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-jf-ice/70 border border-jf-border rounded-xl">
                    <div className="text-xs text-jf-dark space-y-0.5">
                      <div className="font-semibold text-jf-navy">
                        {lang === 'fr'
                          ? 'Identification & vérification des responsables RH et décideurs'
                          : 'HR & Hiring Decision-Maker Identification & Verification'}
                      </div>
                      <p className="text-slate-600">
                        {lang === 'fr'
                          ? 'Vérification DNS MX réelle du domaine + sources publiques vérifiables. Aucun nom ni e-mail n’est jamais inventé.'
                          : 'Live corporate domain DNS MX check + verifiable public sources. No name or email is ever fabricated.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={contactDept}
                        onChange={(e) => setContactDept(e.target.value)}
                        placeholder={lang === 'fr' ? 'Département (ex. Engineering, RH)' : 'Department'}
                        className="px-2.5 py-1.5 text-xs bg-white border border-jf-border rounded-lg w-44"
                      />
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void handleDiscoverContacts('sync')}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                      >
                        {actionBusy === 'contacts_sync' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                        <span>{lang === 'fr' ? 'Identifier & vérifier' : 'Discover & Verify'}</span>
                      </button>
                    </div>
                  </div>

                  {detail.contacts.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-xl">
                      {lang === 'fr'
                        ? 'Aucun contact RH public enregistré pour cette entreprise. JOBFOUNDS n’invente jamais de contact.'
                        : 'No public HR contacts recorded yet. JOBFOUNDS never invents contacts.'}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3 text-xs px-3.5 py-2 rounded-lg bg-white border border-jf-border">
                        <span className="font-semibold text-jf-navy">
                          {detail.contacts.length} {lang === 'fr' ? 'contact(s) identifié(s)' : 'identified contact(s)'}
                        </span>
                        <span className="text-emerald-700 font-medium">
                          ✓ {detail.contacts.filter((c) => c.confidenceLevel === 'confirmed' || (c.domainMxVerified && Boolean(c.corporateEmail))).length}{' '}
                          {lang === 'fr' ? 'vérifié(s) (source publique / MX)' : 'verified (public / MX)'}
                        </span>
                        <span className="text-amber-700 font-medium">
                          • {detail.contacts.filter((c) => !(c.confidenceLevel === 'confirmed' || (c.domainMxVerified && Boolean(c.corporateEmail)))).length}{' '}
                          {lang === 'fr' ? 'non vérifié(s) / à confirmer' : 'unverified / to confirm'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {detail.contacts.map((ct) => {
                        const conf = confidenceLabel(ct.confidenceLevel, lang);
                        const pubHref = safeExternalUrl(ct.publicUrl || ct.sourceUrl);
                        return (
                          <div
                            key={ct.id}
                            className="p-4 border border-jf-border rounded-xl space-y-2 bg-white"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-jf-navy">{ct.fullName}</div>
                                <div className="text-xs text-slate-600">
                                  {ct.roleTitle} {ct.department ? `· ${ct.department}` : ''}
                                </div>
                              </div>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${conf.style}`}>
                                {conf.label}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600 space-y-1">
                              <div>
                                <strong className="text-jf-navy">
                                  {lang === 'fr' ? 'Canal : ' : 'Channel: '}
                                </strong>
                                {ct.contactChannel}
                              </div>
                              {ct.corporateEmail && (
                                <div className="font-mono text-jf-blue">{ct.corporateEmail}</div>
                              )}
                              <div className="flex items-center gap-2 pt-0.5">
                                {ct.domainMxVerified ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-jf-blue">
                                    <MailCheck className="w-3.5 h-3.5" />
                                    <span>DNS MX OK</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    <span>DNS MX non confirmé</span>
                                  </span>
                                )}
                                {ct.adminStatus === 'verified' && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-jf-navy">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-jf-blue" />
                                    <span>Validé Admin</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-jf-border/70 text-xs">
                              <span className="text-slate-500 truncate">{ct.sourceName}</span>
                              {pubHref && (
                                <a
                                  href={pubHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-jf-blue hover:underline inline-flex items-center gap-1 shrink-0"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>{lang === 'fr' ? 'Source' : 'Source'}</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* SUBTAB 4: COMPANY LOCATION & OPENSTREETMAP INTERACTIVE MAP */}
              {detailTab === 'map' && (
                <CareerLocationMapHub
                  key={detail.company.id}
                  lang={lang}
                  defaultCompany={detail.company.officialName}
                  defaultCity={
                    (detail.company.location || '').split('·')[0]?.trim() || ''
                  }
                  defaultCountry={detail.company.country || ''}
                  companies={companies.slice(0, 20).map((c) => ({
                    id: c.id,
                    name: c.officialName,
                    location: c.location || c.country || '',
                    country: c.country || '',
                    sector: c.sector,
                    activeJobs: c.activeJobsCount,
                    website: c.officialWebsite,
                  }))}
                  jobs={detail.careerJobs
                    .filter((j) => j.status === 'active')
                    .slice(0, 20)
                    .map((cj) => ({
                      id: cj.id,
                      title: cj.title,
                      company: detail.company.officialName,
                      country: cj.country || detail.company.country || '',
                      city: cj.location || detail.company.location || '',
                      workMode:
                        cj.workMode === 'Remote' ||
                        cj.workMode === 'Hybrid' ||
                        cj.workMode === 'On-site'
                          ? cj.workMode
                          : 'Hybrid',
                      contractType: 'Full-time',
                      experienceLevel: 'All levels',
                      degreeRequired: 'Not specified',
                      salaryRange: cj.salaryRange || 'Not specified',
                      languages: ['English'],
                      skills: cj.skills || [],
                      publishedDate: cj.firstSeenAt.slice(0, 10),
                      sourceName: detail.company.officialName,
                      sourceUrl: cj.applyUrl || detail.company.careersUrl || '',
                      verificationStatus: detail.company.verificationStatus,
                      verificationSummary: '',
                      description: cj.department || '',
                    }))}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
