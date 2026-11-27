import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Info,
  Loader2,
  Mail,
  Radar,
  Send,
  X,
} from 'lucide-react';
import {
  CandidateProfile,
  GroundingSource,
  HiddenOpportunity,
  Lang,
  NeedClassification,
  OpportunityClassification,
  OutreachDraft,
} from '../types';
import { t } from '../i18n';
import {
  discoverHiddenOpportunities,
  fetchIntelligenceCompanies,
  fetchIntelligenceContacts,
  fetchIntelligenceSignals,
  generateOutreach,
} from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import { ClassificationText } from './StatusText';
import { JfProgressBar } from './ui';
import type { ApplicationModalTarget } from './ApplicationSubmissionModal';

interface HiddenOpportunitiesProps {
  lang: Lang;
  signedIn?: boolean;
  opportunities: HiddenOpportunity[];
  onOpportunitiesUpdate: (items: HiddenOpportunity[]) => void;
  profile: CandidateProfile;
  onTrackSpontaneous: (opp: HiddenOpportunity) => void;
  onOpenApplyModal?: (target: ApplicationModalTarget) => void;
}

type EnrichedHiddenOpportunity = HiddenOpportunity & {
  companyId?: string;
  needClassification?: NeedClassification;
  inferredSkills?: string[];
  corporateEmail?: string;
  contactRole?: string;
};

export function HiddenOpportunities({
  lang,
  signedIn = false,
  opportunities,
  onOpportunitiesUpdate,
  profile,
  onTrackSpontaneous,
  onOpenApplyModal,
}: HiddenOpportunitiesProps) {
  const tr = t(lang);

  const [sector, setSector] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [roleFocus, setRoleFocus] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');
  const [filterClass, setFilterClass] = useState<'ALL' | OpportunityClassification>('ALL');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radarSummary, setRadarSummary] = useState<string | null>(null);
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);

  // Spontaneous Outreach Modal/Drawer state
  const [activeOutreachOpp, setActiveOutreachOpp] = useState<HiddenOpportunity | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [outreachDraft, setOutreachDraft] = useState<OutreachDraft | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [serverSignals, setServerSignals] = useState<EnrichedHiddenOpportunity[]>([]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    Promise.all([
      fetchIntelligenceSignals().catch(() => ({ signals: [] })),
      fetchIntelligenceCompanies({ limit: 80 }).catch(() => ({ companies: [] })),
      fetchIntelligenceContacts().catch(() => ({ contacts: [] })),
    ]).then(([sigRes, compRes, contactRes]) => {
      if (!active) return;
      const compMap = new Map(compRes.companies.map((c) => [c.id, c]));
      const contactByCompany = new Map(
        contactRes.contacts.map((c) => [c.companyId, c])
      );
      const mapped: EnrichedHiddenOpportunity[] = sigRes.signals
        .filter((s) => s.classification !== 'confirmed_job')
        .map((sig) => {
          const comp = compMap.get(sig.companyId);
          const contact = contactByCompany.get(sig.companyId);
          const uiClass: OpportunityClassification =
            sig.classification === 'confirmed_hiring_need'
              ? 'Active Hiring Signal'
              : 'Potential Hiring Opportunity';
          return {
            id: `srv_sig_${sig.id}`,
            companyId: sig.companyId,
            needClassification: sig.classification,
            company: comp?.officialName || sig.companyId,
            sector: comp?.sector || 'Technology',
            location: comp?.location || comp?.country || 'International',
            country: comp?.country || 'International',
            classification: uiClass,
            signalType: sig.signalType,
            detectionReason: sig.title,
            signalEvidence: sig.evidenceText || sig.summary,
            potentialRoles:
              sig.inferredRoles.length > 0
                ? sig.inferredRoles
                : [`${comp?.sector || 'International'} Specialist`],
            inferredSkills: comp?.frequentSkills || [],
            confidenceScore: Math.round((sig.reliabilityScore + sig.relevanceScore) / 2),
            confidenceJustification:
              lang === 'fr'
                ? `Fiabilité source ${sig.reliabilityScore}% · Pertinence ${sig.relevanceScore}% (base surveillée)`
                : `Source reliability ${sig.reliabilityScore}% · Relevance ${sig.relevanceScore}% (monitored DB)`,
            sourceName: sig.sourceName,
            sourceUrl: sig.sourceUrl || comp?.careersUrl || comp?.officialWebsite || '',
            detectedDate: sig.detectedDate || new Date().toISOString().slice(0, 10),
            corporateEmail: contact?.corporateEmail || '',
            contactRole: contact?.roleTitle || '',
            spontaneousOutreachAngle: sig.summary || sig.title,
            professionalContact: {
              nameOrDepartment:
                contact?.fullName ||
                (lang === 'fr'
                  ? 'Équipe Recrutement / Carrières officielles'
                  : 'Official Recruiting / Careers Team'),
              channel:
                contact?.corporateEmail ||
                contact?.contactChannel ||
                (comp?.careersUrl
                  ? lang === 'fr'
                    ? 'Portail carrières officiel'
                    : 'Official careers portal'
                  : lang === 'fr'
                    ? 'À vérifier dans l’assistant d’envoi'
                    : 'Verify in application assistant'),
              url: contact?.publicUrl || comp?.careersUrl || comp?.officialWebsite || '',
            },
          };
        });
      setServerSignals(mapped);
    });
    return () => {
      active = false;
    };
  }, [signedIn, lang]);

  const combinedOpportunities: EnrichedHiddenOpportunity[] = useMemo(() => {
    const seen = new Set<string>();
    const out: EnrichedHiddenOpportunity[] = [];
    for (const item of [...serverSignals, ...opportunities]) {
      const key = `${item.company.toLowerCase()}::${item.detectionReason.toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }, [serverSignals, opportunities]);

  const filtered = useMemo(() => {
    return combinedOpportunities.filter((item) => {
      if (filterClass !== 'ALL' && item.classification !== filterClass) return false;
      if (sector && !item.sector.toLowerCase().includes(sector.toLowerCase())) return false;
      if (country && !item.country.toLowerCase().includes(country.toLowerCase())) return false;
      if (city && !item.location.toLowerCase().includes(city.toLowerCase())) return false;
      if (
        companyQuery &&
        !item.company.toLowerCase().includes(companyQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [combinedOpportunities, filterClass, sector, country, city, companyQuery]);

  const counts = useMemo(() => {
    return {
      all: combinedOpportunities.length,
      confirmed: combinedOpportunities.filter((o) => o.classification === 'Confirmed Job').length,
      active: combinedOpportunities.filter((o) => o.classification === 'Active Hiring Signal')
        .length,
      potential: combinedOpportunities.filter(
        (o) => o.classification === 'Potential Hiring Opportunity'
      ).length,
    };
  }, [combinedOpportunities]);

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await discoverHiddenOpportunities({
        sector,
        country,
        city,
        roleFocus: roleFocus || profile.currentTitle,
        companyQuery,
        lang,
      });
      if (res.opportunities.length > 0) {
        onOpportunitiesUpdate(res.opportunities);
      }
      setRadarSummary(res.radarSummary || null);
      setGroundingSources(res.groundingSources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signal discovery failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenOutreach = async (opp: EnrichedHiddenOpportunity) => {
    if (onOpenApplyModal) {
      const mappedClass: NeedClassification =
        opp.needClassification ||
        (opp.classification === 'Confirmed Job'
          ? 'confirmed_job'
          : opp.classification === 'Active Hiring Signal'
            ? 'probable_hiring_signal'
            : 'potential_opportunity');
      onOpenApplyModal({
        companyId: opp.companyId,
        companyName: opp.company,
        roleTitle: opp.potentialRoles[0] || profile.currentTitle,
        location: opp.location || opp.country || 'International',
        sector: opp.sector,
        opportunityType:
          opp.classification === 'Confirmed Job' ? 'published_job' : 'hidden_opportunity',
        classification: mappedClass,
        officialUrl: opp.professionalContact.url || opp.sourceUrl,
        sourceName: opp.sourceName,
        publishedDate: opp.detectedDate,
        inferredSkills: opp.inferredSkills && opp.inferredSkills.length > 0
          ? opp.inferredSkills
          : opp.potentialRoles,
        signalReason: opp.detectionReason,
        signalEvidence: opp.signalEvidence,
        recommendedContactName: opp.professionalContact.nameOrDepartment,
        recommendedContactRole: opp.contactRole || opp.professionalContact.channel,
        recommendedContactEmail: opp.corporateEmail || '',
        recommendedContactUrl: opp.professionalContact.url,
      });
      return;
    }

    setActiveOutreachOpp(opp);
    setOutreachDraft(null);
    setOutreachError(null);
    setOutreachLoading(true);
    try {
      const draft = await generateOutreach({
        profile,
        opportunity: opp,
        lang,
      });
      setOutreachDraft(draft);
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : 'Unable to generate outreach draft.');
    } finally {
      setOutreachLoading(false);
    }
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Header & Epistemological Classification Banner */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="max-w-3xl space-y-1.5">
            <h1 className="font-display text-2xl font-semibold text-slate-900">
              {lang === 'fr'
                ? 'Découverte d’opportunités cachées & signaux de recrutement'
                : 'Hidden Job Opportunity Discovery & Hiring Signal Radar'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {lang === 'fr'
                ? 'Détectez les entreprises en expansion, ouvertures de bureaux, levées de fonds et nouveaux contrats avant la publication officielle des postes.'
                : 'Identify expanding companies, new office openings, funding rounds, and major contracts before official postings appear.'}
            </p>
          </div>
          <div className="flex items-start gap-2.5 max-w-md text-xs text-jf-navy bg-jf-soft/60 border border-jf-sky rounded-lg p-3.5">
            <Info className="w-4 h-4 text-jf-blue shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {lang === 'fr'
                ? 'Règle de rigueur JOBFOUNDS : chaque opportunité est classée en A (Offre confirmée), B (Signal actif) ou C (Opportunité potentielle). Une hypothèse n’est jamais présentée comme une offre confirmée.'
                : 'JOBFOUNDS Rigor Standard: every finding is classified as A (Confirmed Job), B (Active Hiring Signal), or C (Potential Opportunity). A hypothesis is never presented as a confirmed listing.'}
            </span>
          </div>
        </div>

        {/* Live Signal Radar Form */}
        <form onSubmit={handleDiscover} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2">
          <input
            type="text"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder={lang === 'fr' ? 'Secteur (IA, Énergie, FinTech…)' : 'Sector (AI, Energy, FinTech…)'}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder={lang === 'fr' ? 'Pays (France, Allemagne…)' : 'Country (France, Germany…)'}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={lang === 'fr' ? 'Ville / Hub' : 'City / Hub'}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <input
            type="text"
            value={roleFocus}
            onChange={(e) => setRoleFocus(e.target.value)}
            placeholder={lang === 'fr' ? 'Métiers ciblés (Product, Data…)' : 'Target Roles (Product, Data…)'}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <input
            type="text"
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            placeholder={lang === 'fr' ? 'Entreprise spécifique (opt.)' : 'Specific company (opt.)'}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            <span>{lang === 'fr' ? 'Scanner les signaux' : 'Scan Live Signals'}</span>
          </button>
        </form>

        {/* Mandatory 3-Tier Classification Segmented Filter */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { key: 'ALL', label: `${tr.common.all} (${counts.all})` },
                {
                  key: 'Confirmed Job',
                  label: `${tr.classificationLabels['Confirmed Job']} (${counts.confirmed})`,
                },
                {
                  key: 'Active Hiring Signal',
                  label: `${tr.classificationLabels['Active Hiring Signal']} (${counts.active})`,
                },
                {
                  key: 'Potential Hiring Opportunity',
                  label: `${tr.classificationLabels['Potential Hiring Opportunity']} (${counts.potential})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterClass(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterClass === tab.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
          {error}
        </div>
      )}

      {radarSummary && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
          <p className="text-sm text-slate-700">{radarSummary}</p>
          {groundingSources.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{tr.common.groundingSources}:</span>
              {groundingSources.slice(0, 6).map((src) => {
                const safeUri = safeExternalUrl(src.uri);
                if (!safeUri) return null;
                return (
                  <a
                    key={src.uri}
                    href={safeUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 hover:underline inline-flex items-center gap-1"
                  >
                    <span className="truncate max-w-xs">{src.title}</span>
                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Opportunity Intelligence Feed */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {loading ? (
          <div className="p-6 space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-3 bg-slate-100 rounded w-2/3" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              {lang === 'fr'
                ? 'Aucun signal détecté dans cette catégorie.'
                : 'No signals in this classification filter.'}
            </p>
            <p className="text-xs text-slate-500">
              {lang === 'fr'
                ? 'Modifiez le filtre ou lancez un scan IA en direct pour explorer de nouveaux marchés.'
                : 'Adjust the filter or run a live AI scan to discover fresh corporate expansion signals.'}
            </p>
          </div>
        ) : (
          filtered.map((opp) => (
            <article
              key={opp.id}
              className={`p-6 space-y-4 transition-colors ${
                opp.classification === 'Active Hiring Signal' ? 'bg-jf-soft/25' : 'bg-white'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ClassificationText classification={opp.classification} lang={lang} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs text-slate-500">{opp.sector}</span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {tr.common.detected} {opp.detectedDate}
                    </span>
                  </div>
                  <h2 className="font-display text-xl font-semibold text-jf-navy">
                    {opp.company}{' '}
                    <span className="font-sans text-sm font-normal text-slate-500">
                      — {opp.location}
                    </span>
                  </h2>
                </div>

                {/* Confidence Score (tabular + Official Blue bar) */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right min-w-[96px] space-y-1">
                    <div className="text-xs text-slate-500">{tr.common.confidence}</div>
                    <div className="font-mono text-lg font-semibold tabular-nums text-jf-navy leading-none">
                      {opp.confidenceScore}%
                    </div>
                    <JfProgressBar
                      value={opp.confidenceScore}
                      emphasis={opp.confidenceScore >= 80 ? 'primary' : 'secondary'}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenOutreach(opp)}
                    className="px-4 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{tr.common.spontaneousApply}</span>
                  </button>
                </div>
              </div>

              {/* Required 10-field structured intelligence grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700">
                    {lang === 'fr' ? 'Motif de détection & signal' : 'Detection Trigger & Evidence'}
                  </div>
                  <p className="text-sm text-slate-900 font-medium">{opp.detectionReason}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{opp.signalEvidence}</p>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700">
                    {lang === 'fr' ? 'Métiers potentiellement recherchés' : 'Likely Target Roles'}
                  </div>
                  <ul className="text-sm text-slate-800 space-y-1">
                    {opp.potentialRoles.map((role) => (
                      <li key={role} className="leading-snug">
                        {role}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500 pt-1">{opp.confidenceJustification}</p>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    {lang === 'fr' ? 'Contact professionnel & source' : 'Professional Contact & Source'}
                  </div>
                  <div className="text-sm text-slate-900 font-medium">
                    {opp.professionalContact.nameOrDepartment}
                  </div>
                  <div className="text-xs text-slate-600">{opp.professionalContact.channel}</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
                    {safeExternalUrl(opp.sourceUrl) && (
                      <a
                        href={safeExternalUrl(opp.sourceUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:underline inline-flex items-center gap-1"
                      >
                        <span>
                          {tr.common.source}: {opp.sourceName}
                        </span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                    {safeExternalUrl(opp.professionalContact.url) && (
                      <a
                        href={safeExternalUrl(opp.professionalContact.url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-700 hover:text-slate-900 hover:underline inline-flex items-center gap-1"
                      >
                        <span>{lang === 'fr' ? 'Portail entreprise' : 'Company portal'}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Spontaneous Application AI Composer Drawer */}
      {activeOutreachOpp && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-slate-200 p-6 sm:p-8 flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <ClassificationText classification={activeOutreachOpp.classification} lang={lang} />
                <h3 className="font-display text-xl font-semibold text-slate-900 mt-1">
                  {lang === 'fr'
                    ? `Candidature spontanée — ${activeOutreachOpp.company}`
                    : `Spontaneous Outreach — ${activeOutreachOpp.company}`}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {activeOutreachOpp.professionalContact.nameOrDepartment} ·{' '}
                  {activeOutreachOpp.location}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveOutreachOpp(null)}
                aria-label={tr.common.close}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {outreachLoading ? (
              <div className="py-12 flex flex-col items-center gap-3 text-slate-600">
                <Loader2 className="w-6 h-6 animate-spin text-blue-700" />
                <p className="text-sm">
                  {lang === 'fr'
                    ? 'Rédaction d’une approche personnalisée basée strictement sur votre profil…'
                    : 'Drafting tailored outreach grounded strictly in your real profile…'}
                </p>
              </div>
            ) : outreachError ? (
              <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
                {outreachError}
              </div>
            ) : outreachDraft ? (
              <div className="space-y-6 flex-1">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      {lang === 'fr' ? 'Objet de l’e-mail' : 'Email Subject'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('subject', outreachDraft.emailSubject)}
                      className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                    >
                      {copiedField === 'subject' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedField === 'subject' ? tr.common.copied : tr.common.copy}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-900">
                    {outreachDraft.emailSubject}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      {lang === 'fr' ? 'Message de candidature spontanée' : 'Spontaneous Email Body'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('body', outreachDraft.emailBody)}
                      className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                    >
                      {copiedField === 'body' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedField === 'body' ? tr.common.copied : tr.common.copy}</span>
                    </button>
                  </div>
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 whitespace-pre-line leading-relaxed">
                    {outreachDraft.emailBody}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      {lang === 'fr' ? 'Note LinkedIn directe (courte)' : 'Direct LinkedIn Note'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('li', outreachDraft.linkedinNote)}
                      className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                    >
                      {copiedField === 'li' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedField === 'li' ? tr.common.copied : tr.common.copy}</span>
                    </button>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 leading-relaxed">
                    {outreachDraft.linkedinNote}
                  </div>
                </div>

                <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <span className="font-semibold text-slate-800">
                    {lang === 'fr' ? 'Conseil de suivi : ' : 'Follow-up tip: '}
                  </span>
                  {outreachDraft.followUpTip}
                </div>

                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onTrackSpontaneous(activeOutreachOpp);
                      setActiveOutreachOpp(null);
                    }}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>
                      {lang === 'fr'
                        ? 'Enregistrer dans le suivi des candidatures'
                        : 'Log in Application Tracker'}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
