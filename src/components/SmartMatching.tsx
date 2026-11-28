import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Database,
  Info,
  Loader2,
  PlusCircle,
  Send,
  SlidersHorizontal,
  UserCheck,
} from 'lucide-react';
import {
  CandidateProfile,
  ContractType,
  IntelligenceMatchItem,
  JobListing,
  Lang,
  NeedClassification,
  SmartMatchReport,
  TrackedApplication,
  WorkMode,
} from '../types';
import { computeBaselineMatch } from '../data/initialData';
import { computeIntelligenceMatches, evaluateSmartMatch } from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import type { ApplicationModalTarget } from './ApplicationSubmissionModal';

interface SmartMatchingProps {
  lang: Lang;
  profile: CandidateProfile;
  onSaveProfile: (profile: CandidateProfile) => void;
  jobs: JobListing[];
  focusedJob: JobListing | null;
  signedIn?: boolean;
  onRequireSignIn?: () => void;
  onCreateCrmApplication?: (app: TrackedApplication) => void;
  onOpenApplyModal?: (target: ApplicationModalTarget) => void;
  onNotify?: (msg: string) => void;
}

function tierBadge(c: NeedClassification, lang: Lang): { label: string; style: string } {
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

export function SmartMatching({
  lang,
  profile,
  onSaveProfile,
  jobs,
  focusedJob,
  signedIn = false,
  onRequireSignIn,
  onCreateCrmApplication,
  onOpenApplyModal,
  onNotify,
}: SmartMatchingProps) {
  const [draft, setDraft] = useState<CandidateProfile>(profile);
  const [savedNotice, setSavedNotice] = useState(false);

  const [matchMode, setMatchMode] = useState<'central' | 'single_job'>('central');
  const [selectedJobId, setSelectedJobId] = useState<string>(
    focusedJob?.id ?? jobs[0]?.id ?? ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchReport, setMatchReport] = useState<SmartMatchReport | null>(null);

  // Central Intelligence Matching state (Companies + Published Career Jobs + Non-Published Signals)
  const [centralLoading, setCentralLoading] = useState(false);
  const [centralError, setCentralError] = useState<string | null>(null);
  const [centralMatches, setCentralMatches] = useState<IntelligenceMatchItem[]>([]);
  const [centralCounts, setCentralCounts] = useState<{
    total: number;
    confirmedJobs: number;
    confirmedNeeds: number;
    probableSignals: number;
    potentialOpportunities: number;
  } | null>(null);
  const [tierFilter, setTierFilter] = useState<'ALL' | NeedClassification>('ALL');

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    if (focusedJob) {
      setSelectedJobId(focusedJob.id);
      setMatchMode('single_job');
    }
  }, [focusedJob]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null;

  const toggleWorkMode = (mode: WorkMode) => {
    setDraft((prev) => ({
      ...prev,
      preferredWorkModes: prev.preferredWorkModes.includes(mode)
        ? prev.preferredWorkModes.filter((m) => m !== mode)
        : [...prev.preferredWorkModes, mode],
    }));
  };

  const toggleContract = (ct: ContractType) => {
    setDraft((prev) => ({
      ...prev,
      preferredContracts: prev.preferredContracts.includes(ct)
        ? prev.preferredContracts.filter((c) => c !== ct)
        : [...prev.preferredContracts, ct],
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleRunCentralMatching = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    onSaveProfile(draft);
    setCentralLoading(true);
    setCentralError(null);
    try {
      const res = await computeIntelligenceMatches(draft);
      setCentralMatches(res.matches);
      setCentralCounts(res.counts);
    } catch (err) {
      setCentralError(err instanceof Error ? err.message : 'Central matching failed.');
    } finally {
      setCentralLoading(false);
    }
  };

  const handleRunDeepMatch = async () => {
    if (!selectedJob) return;
    onSaveProfile(draft);
    setLoading(true);
    setError(null);
    try {
      const res = await evaluateSmartMatch({
        profile: draft,
        job: selectedJob,
        lang,
      });
      setMatchReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smart match evaluation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMatchToCrm = (item: IntelligenceMatchItem) => {
    if (!onCreateCrmApplication) return;
    const isConfirmed = item.classification === 'confirmed_job';
    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    onCreateCrmApplication({
      id: `app_match_${Date.now()}`,
      role: item.title,
      company: item.companyName,
      companyId: item.companyId,
      location: item.location || item.country || 'International',
      type: isConfirmed ? 'Confirmed Job' : 'Spontaneous',
      stage: isConfirmed ? 'Opportunity Identified' : 'Awaiting Authorization',
      dateAdded: new Date().toISOString().slice(0, 10),
      followUpDate: followDate,
      sourceUrl: item.applyUrl || item.proofs[0]?.url || '',
      contactName: item.recommendedContact?.fullName || '',
      contactRole: item.recommendedContact?.roleTitle || '',
      contactChannel: item.recommendedContact?.channel || '',
      approvalStatus: isConfirmed ? 'not_required' : 'pending_user_approval',
      responseReceived: false,
      responseSource: 'none',
      nextAction: isConfirmed
        ? lang === 'fr'
          ? 'Adapter le CV et vérifier l’offre'
          : 'Tailor CV and review offer'
        : lang === 'fr'
          ? 'Autoriser explicitement la candidature spontanée dans le CRM'
          : 'Authorize spontaneous outreach in CRM',
      notes: `[Score ${item.overallScore}/100 · ${item.classification}] ${item.explanation}`,
    });
    onNotify?.(
      lang === 'fr'
        ? `${item.companyName} — ${item.title} ajouté au CRM.`
        : `${item.companyName} — ${item.title} added to CRM.`
    );
  };

  const visibleCentralMatches = centralMatches.filter(
    (m) => tierFilter === 'ALL' || m.classification === tierFilter
  );

  return (
    <div className="space-y-6">
      <section className="bg-white border border-jf-border rounded-xl p-6 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold text-jf-navy">
              {lang === 'fr'
                ? 'Moteur Central de Matching Explicable (Offres & Besoins Non Publiés)'
                : 'Central Explainable Matching Engine (Jobs & Unpublished Needs)'}
            </h1>
            <p className="text-sm text-slate-600">
              {lang === 'fr'
                ? 'Reliez votre profil complet (compétences, mobilité, autorisation de travail, langues, secteurs) aux entreprises surveillées, pages carrières et signaux de recrutement avec preuves.'
                : 'Connect your full profile (skills, mobility, work authorization, languages, sectors) to monitored companies, career pages, and hiring signals with verifiable proof.'}
            </p>
          </div>
          <div className="flex items-start gap-2 max-w-md text-xs text-jf-dark bg-jf-ice border border-jf-border rounded-lg p-3">
            <Info className="w-4 h-4 text-jf-blue shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {lang === 'fr'
                ? 'Éthique IA : chaque score est explicable, basé sur des preuves sourcées, et ne constitue jamais une décision automatique.'
                : 'AI Ethics Standard: every score is explainable, backed by sourced proofs, and is never used as an automated hiring decision.'}
            </span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Candidate Profile Editor */}
        <form
          onSubmit={handleSave}
          className="xl:col-span-5 bg-white border border-jf-border rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-jf-border">
            <h2 className="text-sm font-semibold text-jf-navy">
              {lang === 'fr'
                ? 'Profil candidat & mobilité internationale'
                : 'Candidate Profile & Global Mobility'}
            </h2>
            {savedNotice && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-jf-blue">
                <Check className="w-3.5 h-3.5" />
                <span>{lang === 'fr' ? 'Enregistré' : 'Saved'}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Nom complet' : 'Full Name'}
              </span>
              <input
                type="text"
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Années d’expérience' : 'Years Experience'}
              </span>
              <input
                type="number"
                min={0}
                max={45}
                value={draft.yearsExperience}
                onChange={(e) => setDraft({ ...draft, yearsExperience: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Poste actuel / cible' : 'Current / Target Title'}
              </span>
              <input
                type="text"
                value={draft.currentTitle}
                onChange={(e) => setDraft({ ...draft, currentTitle: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Diplôme principal' : 'Highest Degree'}
              </span>
              <input
                type="text"
                value={draft.highestDegree}
                onChange={(e) => setDraft({ ...draft, highestDegree: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Compétences clés (virgules)' : 'Skills (comma-separated)'}
              </span>
              <input
                type="text"
                value={draft.skills.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    skills: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Secteurs cibles (virgules)' : 'Target Sectors (comma-separated)'}
              </span>
              <input
                type="text"
                value={(draft.targetSectors || []).join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    targetSectors: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="FinTech, IA, Énergie, Cloud…"
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Langues parlées' : 'Languages'}
              </span>
              <input
                type="text"
                value={draft.languages.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    languages: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Pays de résidence actuel' : 'Current Country'}
              </span>
              <input
                type="text"
                value={draft.originCountry || ''}
                onChange={(e) => setDraft({ ...draft, originCountry: e.target.value })}
                placeholder={lang === 'fr' ? 'Ex. Haïti, France, Canada…' : 'e.g. Haiti, France, Canada…'}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Pays souhaités' : 'Preferred Countries'}
              </span>
              <input
                type="text"
                value={draft.preferredCountries.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    preferredCountries: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Villes souhaitées (virgules)' : 'Preferred Cities (comma-separated)'}
              </span>
              <input
                type="text"
                value={(draft.preferredCities || []).join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    preferredCities: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder={lang === 'fr' ? 'Ex. Montréal, Paris, Dakar…' : 'e.g. Montreal, Paris, Dakar…'}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Prétentions min. (USD/an)' : 'Min Salary (USD/yr)'}
              </span>
              <input
                type="number"
                value={draft.minSalaryAnnualUsd}
                onChange={(e) => setDraft({ ...draft, minSalaryAnnualUsd: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Autorisation de travail / Visa' : 'Work Authorization / Visa'}
              </span>
              <input
                type="text"
                value={draft.workAuthorization || ''}
                onChange={(e) => setDraft({ ...draft, workAuthorization: e.target.value })}
                placeholder="Ex. Citoyen UE, Visa requis…"
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Disponibilité / Préavis' : 'Availability / Notice'}
              </span>
              <input
                type="text"
                value={draft.availability}
                onChange={(e) => setDraft({ ...draft, availability: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-jf-border rounded-lg"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-jf-navy cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(draft.relocationReady)}
              onChange={(e) => setDraft({ ...draft, relocationReady: e.target.checked })}
            />
            <span>
              {lang === 'fr'
                ? 'Mobile à l’international (prêt à relocaliser)'
                : 'Open to international relocation'}
            </span>
          </label>

          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-600 block">
              {lang === 'fr' ? 'Modes de travail acceptés' : 'Preferred Work Modes'}
            </span>
            <div className="flex flex-wrap gap-2">
              {(['Remote', 'Hybrid', 'On-site'] as WorkMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleWorkMode(m)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    draft.preferredWorkModes.includes(m)
                      ? 'bg-jf-soft border-jf-blue text-jf-navy'
                      : 'bg-white border-jf-border text-slate-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-600 block">
              {lang === 'fr' ? 'Types de contrats souhaités' : 'Preferred Contract Types'}
            </span>
            <div className="flex flex-wrap gap-2">
              {(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'] as ContractType[]).map(
                (ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => toggleContract(ct)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      draft.preferredContracts.includes(ct)
                        ? 'bg-jf-soft border-jf-blue text-jf-navy'
                        : 'bg-white border-jf-border text-slate-600'
                    }`}
                  >
                    {ct}
                  </button>
                )
              )}
            </div>
          </div>

          <button
            type="submit"
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-jf-navy hover:bg-jf-dark rounded-lg transition-colors"
          >
            {lang === 'fr' ? 'Enregistrer mon profil' : 'Save Profile Preferences'}
          </button>
        </form>

        {/* Right: Dual-Mode Matching Engine */}
        <div className="xl:col-span-7 bg-white border border-jf-border rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-jf-border">
            <div className="flex items-center gap-1 p-1 bg-jf-ice rounded-lg border border-jf-border">
              <button
                type="button"
                onClick={() => setMatchMode('central')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  matchMode === 'central'
                    ? 'bg-jf-navy text-white'
                    : 'text-jf-dark hover:text-jf-navy'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>
                  {lang === 'fr'
                    ? 'Base Entreprises & Marché Caché'
                    : 'Companies & Hidden Needs'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMatchMode('single_job')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  matchMode === 'single_job'
                    ? 'bg-jf-navy text-white'
                    : 'text-jf-dark hover:text-jf-navy'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>
                  {lang === 'fr' ? 'Audit IA 9 critères (1 offre)' : '9-Criteria AI Audit (1 Job)'}
                </span>
              </button>
            </div>

            {matchMode === 'central' && (
              <button
                type="button"
                onClick={() => void handleRunCentralMatching()}
                disabled={centralLoading}
                className="px-4 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-2"
              >
                {centralLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Database className="w-3.5 h-3.5" />
                )}
                <span>
                  {lang === 'fr'
                    ? 'Calculer mes correspondances'
                    : 'Compute Central Matches'}
                </span>
              </button>
            )}
          </div>

          {/* MODE 1: CENTRAL INTELLIGENCE MATCHING (4-TIER CLASSIFICATION) */}
          {matchMode === 'central' && (
            <div className="space-y-4">
              {centralError && (
                <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-xs font-medium text-jf-navy">
                  {centralError}
                </div>
              )}

              {centralCounts && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['ALL', lang === 'fr' ? `Tout (${centralCounts.total})` : `All (${centralCounts.total})`],
                      ['confirmed_job', `${lang === 'fr' ? 'Offres confirmées' : 'Confirmed Jobs'} (${centralCounts.confirmedJobs})`],
                      ['confirmed_hiring_need', `${lang === 'fr' ? 'Besoins confirmés' : 'Confirmed Needs'} (${centralCounts.confirmedNeeds})`],
                      ['probable_hiring_signal', `${lang === 'fr' ? 'Signaux probables' : 'Probable Signals'} (${centralCounts.probableSignals})`],
                      ['potential_opportunity', `${lang === 'fr' ? 'Opportunités potentielles' : 'Potential'} (${centralCounts.potentialOpportunities})`],
                    ] as Array<['ALL' | NeedClassification, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTierFilter(key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        tierFilter === key
                          ? 'bg-jf-navy text-white border-jf-navy'
                          : 'bg-jf-ice text-jf-dark border-jf-border hover:bg-jf-soft'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {centralLoading ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-jf-blue" />
                  <span>
                    {lang === 'fr'
                      ? 'Croisement de votre profil avec la base entreprises, pages carrières et signaux…'
                      : 'Matching your profile against monitored companies, career pages, and signals…'}
                  </span>
                </div>
              ) : visibleCentralMatches.length === 0 ? (
                <div className="p-8 text-center space-y-2 border border-dashed border-jf-border rounded-xl">
                  <p className="text-sm font-semibold text-jf-navy">
                    {centralCounts
                      ? lang === 'fr'
                        ? 'Aucune correspondance dans cette catégorie.'
                        : 'No matches in this tier.'
                      : lang === 'fr'
                        ? 'Lancez le matching central pour analyser toutes les entreprises surveillées'
                        : 'Run central matching to score all monitored companies & opportunities'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {lang === 'fr'
                      ? 'Ajoutez d’abord des entreprises cibles dans « Intelligence Entreprises » si la base est encore vide, puis cliquez sur « Calculer mes correspondances ».'
                      : 'Register target companies in "Company Intelligence" first if the database is empty, then click "Compute Central Matches".'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleCentralMatches.map((item) => {
                    const badge = tierBadge(item.classification, lang);
                    const applyHref = safeExternalUrl(item.applyUrl);
                    return (
                      <article
                        key={item.id}
                        className="p-5 border border-jf-border rounded-xl space-y-3 bg-white hover:border-jf-blue/50 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${badge.style}`}>
                                {badge.label}
                              </span>
                              <span className="text-xs text-slate-500">
                                {item.companyName} · {item.location || item.country}
                              </span>
                            </div>
                            <h3 className="text-base font-semibold text-jf-navy">{item.title}</h3>
                          </div>
                          <div className="text-left sm:text-right shrink-0">
                            <div className="font-mono text-2xl font-semibold tabular-nums text-jf-blue">
                              {item.overallScore}
                              <span className="text-xs text-slate-400">/100</span>
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-slate-700 leading-relaxed">{item.explanation}</p>

                        {/* Exact 9-Criteria Official Breakdown */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px] font-mono tabular-nums">
                          {[
                            [lang === 'fr' ? '1. Compétences' : '1. Skills', item.breakdown.skills],
                            [lang === 'fr' ? '2. Expérience' : '2. Experience', item.breakdown.experience],
                            [lang === 'fr' ? '3. Formation' : '3. Education', item.breakdown.education],
                            [lang === 'fr' ? '4. Langues' : '4. Languages', item.breakdown.languages],
                            [
                              lang === 'fr' ? '5. Localisation' : '5. Location & Mobility',
                              item.breakdown.locationAndMobility,
                            ],
                            [
                              lang === 'fr' ? '6. Autorisation / Visa' : '6. Work Auth & Visa',
                              item.breakdown.workAuthorization,
                            ],
                            [
                              lang === 'fr' ? '7. Disponibilité' : '7. Availability',
                              item.breakdown.availability,
                            ],
                            [
                              lang === 'fr' ? '8. Salaire' : '8. Salary',
                              item.breakdown.salary,
                            ],
                            [
                              lang === 'fr' ? '9. Fiabilité source' : '9. Source Reliability',
                              item.breakdown.sourceReliability ?? item.breakdown.signalReliability ?? 0,
                            ],
                          ].map(([lbl, val]) => (
                            <div
                              key={String(lbl)}
                              className="px-2.5 py-1.5 rounded-lg bg-jf-ice border border-jf-border flex items-center justify-between"
                            >
                              <span className="text-slate-500 font-sans truncate pr-1">{lbl}</span>
                              <span className="font-semibold text-jf-navy">{val}%</span>
                            </div>
                          ))}
                        </div>

                        {/* Matched / Missing Skills */}
                        {(item.matchedSkills.length > 0 || item.missingSkills.length > 0) && (
                          <div className="flex flex-wrap gap-1.5 text-[11px]">
                            {item.matchedSkills.map((sk) => (
                              <span key={sk} className="px-2 py-0.5 rounded bg-jf-soft text-jf-navy font-medium">
                                ✓ {sk}
                              </span>
                            ))}
                            {item.missingSkills.slice(0, 4).map((sk) => (
                              <span key={sk} className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                Δ {sk}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Recommended Contact & Proofs */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-jf-border/70 text-xs">
                          <div className="flex flex-wrap items-center gap-3">
                            {item.recommendedContact && (
                              <span className="inline-flex items-center gap-1.5 text-jf-dark">
                                <UserCheck className="w-3.5 h-3.5 text-jf-blue" />
                                <span>
                                  {item.recommendedContact.fullName} ({item.recommendedContact.roleTitle})
                                </span>
                              </span>
                            )}
                            {item.proofs.slice(0, 2).map((p, idx) => {
                              const href = safeExternalUrl(p.url);
                              return href ? (
                                <a
                                  key={idx}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-jf-blue hover:underline inline-flex items-center gap-0.5"
                                >
                                  <span>{p.label}</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </a>
                              ) : (
                                <span key={idx} className="text-slate-500">
                                  {p.label}
                                </span>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {applyHref && (
                              <a
                                href={applyHref}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1.5 text-xs font-medium text-jf-blue hover:underline inline-flex items-center gap-1"
                              >
                                <span>{lang === 'fr' ? 'Ouvrir' : 'Open'}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}
                            {onOpenApplyModal && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenApplyModal({
                                    companyId: item.companyId,
                                    companyName: item.companyName,
                                    roleTitle: item.title,
                                    location: item.location || item.country || 'International',
                                    opportunityType:
                                      item.classification === 'confirmed_job'
                                        ? 'published_job'
                                        : 'hidden_opportunity',
                                    classification: item.classification,
                                    officialUrl: item.applyUrl || item.proofs[0]?.url || '',
                                    sourceName: item.proofs[0]?.label || item.companyName,
                                    inferredSkills: [...item.matchedSkills, ...item.missingSkills],
                                    signalReason:
                                      item.classification !== 'confirmed_job' ? item.explanation : undefined,
                                    recommendedContactName: item.recommendedContact?.fullName,
                                    recommendedContactRole: item.recommendedContact?.roleTitle,
                                    recommendedContactEmail: item.recommendedContact?.corporateEmail,
                                    recommendedContactUrl: item.recommendedContact?.publicUrl,
                                  })
                                }
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1.5"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>
                                  {item.classification === 'confirmed_job'
                                    ? lang === 'fr'
                                      ? 'Postuler'
                                      : 'Apply'
                                    : lang === 'fr'
                                      ? 'Candidature spontanée'
                                      : 'Spontaneous Apply'}
                                </span>
                              </button>
                            )}
                            {onCreateCrmApplication && (
                              <button
                                type="button"
                                onClick={() => handleAddMatchToCrm(item)}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg inline-flex items-center gap-1.5"
                              >
                                <PlusCircle className="w-3.5 h-3.5" />
                                <span>{lang === 'fr' ? 'Ajouter au CRM' : 'Add to CRM'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* MODE 2: SINGLE JOB 9-CRITERIA AI AUDIT */}
          {matchMode === 'single_job' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-jf-navy">
                  {lang === 'fr'
                    ? 'Évaluer la compatibilité sur 9 critères avec une offre'
                    : 'Evaluate 9-Criteria Job Compatibility'}
                </h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={selectedJob?.id ?? ''}
                    onChange={(e) => {
                      setSelectedJobId(e.target.value);
                      setMatchReport(null);
                    }}
                    className="flex-1 px-3 py-2 text-sm border border-jf-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-jf-blue"
                  >
                    {jobs.length === 0 ? (
                      <option value="">
                        {lang === 'fr'
                          ? 'Aucune offre chargée — lancez une recherche d’emplois'
                          : 'No listings loaded — run a job search first'}
                      </option>
                    ) : (
                      jobs.map((job) => {
                        const base = computeBaselineMatch(draft, job);
                        return (
                          <option key={job.id} value={job.id}>
                            [{base.score}%] {job.company} — {job.title} ({job.city})
                          </option>
                        );
                      })
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={handleRunDeepMatch}
                    disabled={loading || !selectedJob}
                    className="px-4 py-2 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <SlidersHorizontal className="w-4 h-4" />
                    )}
                    <span>
                      {lang === 'fr' ? 'Audit IA (9 critères)' : 'Explain 9-Criteria Fit'}
                    </span>
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="space-y-4 py-6 animate-pulse">
                  <div className="h-6 bg-jf-soft rounded w-1/3" />
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div key={n} className="h-10 bg-jf-ice rounded" />
                  ))}
                </div>
              ) : matchReport ? (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-jf-border">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-500">
                        {selectedJob?.company} · {selectedJob?.city}, {selectedJob?.country}
                      </div>
                      <h3 className="font-display text-lg font-semibold text-jf-navy">
                        {selectedJob?.title}
                      </h3>
                      <p className="text-sm text-slate-600">{matchReport.summary}</p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <div className="text-xs text-slate-500">
                        {lang === 'fr' ? 'Compatibilité explicable' : 'Explainable Match'}
                      </div>
                      <div className="font-mono text-3xl font-semibold tabular-nums text-jf-blue">
                        {matchReport.overallScore}
                        <span className="text-base text-slate-400">/100</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {matchReport.dimensions.map((dim, i) => (
                      <div key={i} className="space-y-1.5 pb-3 border-b border-jf-border/60 last:border-0">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-semibold text-jf-navy">{dim.name}</span>
                          <span className="font-mono text-xs font-semibold tabular-nums text-jf-dark">
                            {dim.score}/100
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-jf-soft rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              dim.score >= 75
                                ? 'bg-jf-blue'
                                : dim.score >= 50
                                  ? 'bg-jf-dark'
                                  : 'bg-jf-sky'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }}
                          />
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{dim.explanation}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-jf-border text-xs">
                    <div className="space-y-1.5">
                      <div className="font-semibold text-jf-blue">
                        {lang === 'fr' ? 'Points forts alignés' : 'Key Aligned Strengths'}
                      </div>
                      <ul className="space-y-1 text-slate-700">
                        {matchReport.strengths.map((s, i) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-1.5">
                      <div className="font-semibold text-jf-dark">
                        {lang === 'fr' ? 'Écarts ou points à clarifier' : 'Gaps & Points to Clarify'}
                      </div>
                      <ul className="space-y-1 text-slate-700">
                        {matchReport.gapsToAddress.map((g, i) => (
                          <li key={i}>• {g}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 pt-3 border-t border-jf-border/60">
                    {matchReport.advisoryNotice}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">
                    {lang === 'fr'
                      ? 'Classement indicatif rapide sur les 9 critères officiels — cliquez sur « Audit IA (9 critères) » pour l’évaluation détaillée avec explications.'
                      : 'Quick indicative ranking across all 9 official criteria — click "Explain 9-Criteria Fit" for a full AI breakdown.'}
                  </div>
                  {jobs.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-jf-border rounded-lg">
                      {lang === 'fr'
                        ? 'Aucune offre chargée dans votre session. Ouvrez « Recherche d’Emplois » pour récupérer des offres réelles.'
                        : 'No job listings loaded yet. Open "Global Job Search" to fetch real openings.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-jf-border border border-jf-border rounded-lg">
                      {jobs.map((job) => {
                        const base = computeBaselineMatch(draft, job);
                        const bd = base.breakdown;
                        return (
                          <div
                            key={job.id}
                            className="p-4 space-y-2.5 hover:bg-jf-ice/50"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-jf-navy truncate">
                                  {job.title}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {job.company} · {job.city}, {job.country} · {lang === 'fr' ? 'Compétences' : 'Skills'}{' '}
                                  <span className="font-mono tabular-nums">{base.skillsRatio}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 shrink-0">
                                <span className="font-mono text-sm font-semibold tabular-nums text-jf-blue">
                                  {base.score}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedJobId(job.id);
                                    setMatchReport(null);
                                  }}
                                  className="text-xs font-medium text-jf-dark hover:text-jf-blue hover:underline whitespace-nowrap"
                                >
                                  {lang === 'fr' ? 'Sélectionner' : 'Select'}
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-[10px] font-mono tabular-nums">
                              {[
                                [lang === 'fr' ? '1. Compétences' : '1. Skills', bd.skills],
                                [lang === 'fr' ? '2. Expérience' : '2. Experience', bd.experience],
                                [lang === 'fr' ? '3. Formation' : '3. Education', bd.education],
                                [lang === 'fr' ? '4. Langues' : '4. Languages', bd.languages],
                                [lang === 'fr' ? '5. Localisation' : '5. Location', bd.locationAndMobility],
                                [lang === 'fr' ? '6. Visa / Droit' : '6. Work Auth', bd.workAuthorization],
                                [lang === 'fr' ? '7. Disponibilité' : '7. Availability', bd.availability],
                                [lang === 'fr' ? '8. Salaire' : '8. Salary', bd.salary],
                                [lang === 'fr' ? '9. Fiabilité source' : '9. Source', bd.sourceReliability],
                              ].map(([lbl, val]) => (
                                <span
                                  key={String(lbl)}
                                  className="px-2 py-0.5 rounded bg-jf-ice border border-jf-border text-jf-dark flex items-center justify-between gap-1"
                                >
                                  <span className="font-sans text-slate-500 truncate">{lbl}</span>
                                  <span className="font-semibold text-jf-navy">{val}%</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
