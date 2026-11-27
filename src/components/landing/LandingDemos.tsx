import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  Globe,
  Loader2,
  Mail,
  MapPin,
  MessageSquareText,
  Radar,
} from 'lucide-react';
import { JobListing, Lang, WorkspaceTab } from '../../types';
import { pickLang } from '../../i18n';
import { fetchLiveJobFeeds } from '../../utils/api';
import { safeExternalUrl } from '../../utils/safeUrl';

interface ShowcaseProps {
  lang: Lang;
  onNavigate: (tab: WorkspaceTab, careerSubTab?: 'tracker' | 'interview' | 'mobility') => void;
}

interface LiveRadarOpportunity {
  id: string;
  company: string;
  title: string;
  city: string;
  country: string;
  sourceName: string;
  sourceUrl: string;
  workMode: string;
  publishedDate: string;
  mapX: number;
  mapY: number;
}

function approximateWorldMapCoords(country: string, city: string, idx: number): { mapX: number; mapY: number } {
  const hay = `${country} ${city}`.toLowerCase();
  if (/united states|usa|new york|san francisco|austin|seattle|boston|canada|toronto|montreal|mexico/.test(hay)) {
    return { mapX: 22 + (idx % 3) * 4, mapY: 36 + (idx % 2) * 6 };
  }
  if (/caribbean|caraibes|haiti|haïti|port-au-prince|jamaica|dominican|puerto rico|barbados|bahamas|trinidad|cuba|guadeloupe|martinique/.test(hay)) {
    return { mapX: 25 + (idx % 2) * 3, mapY: 51 + (idx % 2) * 3 };
  }
  if (/brazil|brasil|argentina|colombia|chile|peru|uruguay|ecuador|latam|latin america/.test(hay)) {
    return { mapX: 30 + (idx % 3) * 3, mapY: 66 + (idx % 2) * 7 };
  }
  if (/africa|south africa|kenya|nigeria|morocco|senegal|egypt|tunisia|ghana|rwanda/.test(hay)) {
    return { mapX: 52 + (idx % 3) * 4, mapY: 62 + (idx % 2) * 8 };
  }
  if (/australia|new zealand|sydney|melbourne|auckland|oceania/.test(hay)) {
    return { mapX: 84 + (idx % 2) * 4, mapY: 74 };
  }
  if (/japan|singapore|india|korea|vietnam|philippines|indonesia|malaysia|thailand|dubai|uae|asia|apac|tokyo/.test(hay)) {
    return { mapX: 73 + (idx % 3) * 4, mapY: 44 + (idx % 2) * 8 };
  }
  if (/france|germany|uk|united kingdom|switzerland|netherlands|spain|italy|poland|ireland|sweden|portugal|belgium|europe|berlin|paris|london|amsterdam|zurich/.test(hay)) {
    return { mapX: 48 + (idx % 3) * 4, mapY: 32 + (idx % 2) * 6 };
  }
  // Worldwide remote spread across hubs
  const presets = [
    { mapX: 25, mapY: 37 },
    { mapX: 49, mapY: 34 },
    { mapX: 32, mapY: 64 },
    { mapX: 53, mapY: 60 },
    { mapX: 76, mapY: 46 },
    { mapX: 85, mapY: 74 },
  ];
  return presets[idx % presets.length];
}

export function HiddenMarketShowcase({ lang, onNavigate }: ShowcaseProps) {
  const [activePreview, setActivePreview] = useState<'hidden' | 'cv' | 'interview'>('hidden');
  const [liveJobs, setLiveJobs] = useState<LiveRadarOpportunity[]>([]);
  const [loadingLive, setLoadingLive] = useState(true);
  const [selectedHubId, setSelectedHubId] = useState<string>('');

  const isFr = lang === 'fr';

  useEffect(() => {
    let active = true;
    setLoadingLive(true);
    fetchLiveJobFeeds({ country: '' })
      .then((res) => {
        if (!active) return;
        const picked: LiveRadarOpportunity[] = [];
        const seenCompanies = new Set<string>();
        for (const job of (res.jobs || []) as JobListing[]) {
          const key = job.company.toLowerCase();
          if (seenCompanies.has(key) || !job.sourceUrl) continue;
          seenCompanies.add(key);
          const coords = approximateWorldMapCoords(job.country, job.city, picked.length);
          picked.push({
            id: job.id,
            company: job.company,
            title: job.title,
            city: job.city || 'Remote',
            country: job.country || 'International',
            sourceName: job.sourceName,
            sourceUrl: job.sourceUrl,
            workMode: job.workMode,
            publishedDate: job.publishedDate,
            ...coords,
          });
          if (picked.length >= 6) break;
        }
        setLiveJobs(picked);
        if (picked[0]) setSelectedHubId(picked[0].id);
      })
      .catch(() => {
        if (active) setLiveJobs([]);
      })
      .finally(() => {
        if (active) setLoadingLive(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const tabs = [
    {
      id: 'cv' as const,
      icon: FileText,
      label: pickLang(lang, {
        fr: 'CV & ATS',
        en: 'CV & ATS',
        es: 'CV y ATS',
        de: 'CV & ATS',
        pt: 'CV e ATS',
        ar: 'السيرة و ATS',
      }),
    },
    {
      id: 'hidden' as const,
      icon: Radar,
      label: pickLang(lang, {
        fr: 'Offres & Radar mondial',
        en: 'Live Global Radar',
        es: 'Radar Global',
        de: 'Globales Radar',
        pt: 'Radar Global',
        ar: 'الرادار العالمي',
      }),
    },
    {
      id: 'interview' as const,
      icon: MessageSquareText,
      label: pickLang(lang, {
        fr: 'Entretien IA',
        en: 'AI Interview',
        es: 'Entrevista IA',
        de: 'KI-Interview',
        pt: 'Entrevista IA',
        ar: 'مقابلة ذكية',
      }),
    },
  ];

  const selectedOpp =
    liveJobs.find((o) => o.id === selectedHubId) ?? liveJobs[0] ?? null;

  return (
    <div className="space-y-8">
      {/* Interactive 3-Mode Selector Switch (Inspired by Reference #2) */}
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Platform module showcase"
          className="inline-flex items-center gap-1.5 p-1.5 bg-white border border-jf-border rounded-full shadow-sm"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activePreview === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActivePreview(tab.id)}
                className={`px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-full transition-all inline-flex items-center gap-2 whitespace-nowrap ${
                  active
                    ? 'bg-jf-navy text-white shadow-sm'
                    : 'text-jf-dark hover:bg-jf-ice hover:text-jf-navy'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-jf-sky' : 'text-jf-blue'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Showcase Stage Frame */}
      <div className="relative rounded-3xl bg-white border-2 border-jf-sky/70 shadow-[0_24px_60px_-24px_rgba(6,19,47,0.18)] p-5 sm:p-8 lg:p-10 overflow-hidden">
        {activePreview === 'hidden' && (
          <div className="space-y-6">
            {/* Stage Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <div className="text-xs font-semibold text-jf-blue">
                  {isFr
                    ? 'Radar International · Flux en direct vérifiés (zéro donnée fictive)'
                    : 'International Radar · Verified Live Feeds (Zero Mock Data)'}
                </div>
                <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-jf-navy tracking-tight">
                  {isFr
                    ? 'Offres réelles sur 7 zones mondiales et détection d’opportunités cachées.'
                    : 'Real opportunities across 7 global regions & hidden market discovery.'}
                </h2>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                  {isFr
                    ? 'JOBFOUNDS agrège des offres vérifiées depuis les portails ATS officiels et les flux internationaux publics, puis analyse les signaux publics des entreprises qui recrutent.'
                    : 'JOBFOUNDS aggregates verified listings from official ATS portals and global public feeds, while detecting public hiring signals from expanding organizations.'}
                </p>
              </div>
              <div className="text-xs font-mono text-jf-dark bg-jf-ice border border-jf-border rounded-lg px-3 py-1.5">
                {loadingLive
                  ? isFr
                    ? 'Chargement des flux réels…'
                    : 'Loading live feeds…'
                  : `${liveJobs.length} ${isFr ? 'offres réelles chargées' : 'live verified roles'}`}
              </div>
            </div>

            {/* Map + Live Detected Opportunities Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left: International Vector Radar Map */}
              <div className="lg:col-span-7 relative rounded-2xl bg-jf-ice border border-jf-border min-h-[340px] sm:min-h-[390px] overflow-hidden p-4 flex flex-col justify-between">
                {/* Subtle Coordinate Grid & Stylized World Continents SVG */}
                <svg
                  viewBox="0 0 800 420"
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
                >
                  <defs>
                    <pattern id="jfMapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path
                        d="M 40 0 L 0 0 0 40"
                        fill="none"
                        stroke="#D5EBFA"
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>
                  <rect width="800" height="420" fill="url(#jfMapGrid)" />
                  {/* Stylized minimal continent silhouettes in Soft Blue */}
                  <g fill="#D5EBFA" opacity="0.85">
                    {/* North America */}
                    <path d="M 85 95 C 120 75, 210 75, 255 110 C 265 145, 235 190, 195 205 C 165 215, 130 195, 105 160 Z" />
                    {/* South America */}
                    <path d="M 215 235 C 245 235, 285 265, 275 315 C 265 355, 235 385, 218 375 C 205 340, 195 280, 215 235 Z" />
                    {/* Europe */}
                    <path d="M 355 95 C 405 78, 470 85, 490 120 C 482 155, 435 170, 385 168 C 355 160, 342 128, 355 95 Z" />
                    {/* Africa */}
                    <path d="M 375 185 C 425 182, 475 205, 482 255 C 470 310, 442 355, 415 350 C 392 325, 362 255, 375 185 Z" />
                    {/* Asia */}
                    <path d="M 495 90 C 575 75, 675 95, 705 150 C 710 205, 660 250, 595 245 C 545 235, 505 190, 495 90 Z" />
                    {/* Oceania */}
                    <path d="M 640 285 C 685 275, 730 295, 725 335 C 705 358, 655 355, 640 325 Z" />
                  </g>
                  {/* Concentric Radar Rings around Europe/Global Hub */}
                  <circle
                    cx="405"
                    cy="158"
                    r="62"
                    fill="none"
                    stroke="#287BC7"
                    strokeOpacity="0.28"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="405"
                    cy="158"
                    r="118"
                    fill="none"
                    stroke="#287BC7"
                    strokeOpacity="0.18"
                    strokeDasharray="5 5"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="405"
                    cy="158"
                    r="185"
                    fill="none"
                    stroke="#06132F"
                    strokeOpacity="0.09"
                    strokeWidth="1"
                  />
                </svg>

                {/* Top Floating Dual Comparison Callouts (Inspired by Reference #2) */}
                <div className="relative z-10 flex flex-wrap items-center gap-2.5">
                  <div className="px-3.5 py-2 bg-white border border-jf-border rounded-xl shadow-xs text-xs flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-jf-blue shrink-0" />
                    <span className="font-semibold text-jf-navy">
                      {isFr ? 'Offres publiques' : 'Public listings'}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-600">
                      {isFr ? 'Flux API & carrières' : 'API & career portals'}
                    </span>
                  </div>
                  <div className="px-3.5 py-2 bg-jf-navy text-white rounded-xl shadow-sm text-xs flex items-center gap-2">
                    <Radar className="w-3.5 h-3.5 text-jf-sky shrink-0" />
                    <span className="font-semibold text-jf-sky">
                      {isFr ? 'Signaux cachés JOBFOUNDS' : 'JOBFOUNDS Hidden Signals'}
                    </span>
                  </div>
                </div>

                {/* Interactive Geo Pins from Real Live Feeds */}
                <div className="relative z-10 flex-1 my-4">
                  {liveJobs.map((hub) => {
                    const isSelected = selectedOpp?.id === hub.id;
                    return (
                      <button
                        key={hub.id}
                        type="button"
                        onClick={() => setSelectedHubId(hub.id)}
                        style={{ left: `${hub.mapX}%`, top: `${hub.mapY}%` }}
                        aria-label={`${hub.company} - ${hub.city}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue rounded-full"
                      >
                        <span
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shadow-sm border transition-transform ${
                            isSelected
                              ? 'bg-jf-navy text-white border-jf-sky scale-105'
                              : 'bg-white text-jf-navy border-jf-border hover:border-jf-blue'
                          }`}
                        >
                          <MapPin
                            className={`w-3 h-3 shrink-0 ${
                              isSelected ? 'text-jf-sky' : 'text-jf-blue'
                            }`}
                          />
                          <span className="whitespace-nowrap max-w-[110px] truncate">{hub.company}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Bottom Selected Live Opportunity Spotlight Bar */}
                {selectedOpp ? (
                  <div className="relative z-10 bg-white/95 backdrop-blur-xs border border-jf-border rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-jf-navy">{selectedOpp.company}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600">
                          {selectedOpp.city}, {selectedOpp.country}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-jf-blue">{selectedOpp.sourceName}</span>
                      </div>
                      <p className="text-xs text-slate-700 font-medium truncate">
                        {selectedOpp.title}
                      </p>
                    </div>
                    {safeExternalUrl(selectedOpp.sourceUrl) && (
                      <a
                        href={safeExternalUrl(selectedOpp.sourceUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-jf-blue hover:underline inline-flex items-center gap-1 shrink-0"
                      >
                        <span>{isFr ? 'Source officielle' : 'Official Source'}</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="relative z-10 bg-white/95 border border-jf-border rounded-xl p-3.5 text-xs text-slate-600">
                    {loadingLive
                      ? isFr
                        ? 'Connexion aux flux publics internationaux et portails ATS…'
                        : 'Connecting to live international public feeds and ATS portals…'
                      : isFr
                        ? 'Ouvrez le moteur de recherche pour interroger les flux mondiaux en direct.'
                        : 'Open Global Job Search to query live worldwide feeds.'}
                  </div>
                )}
              </div>

              {/* Right: Live Verified Opportunities List */}
              <div className="lg:col-span-5 rounded-2xl bg-jf-ice/70 border border-jf-border p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-jf-border">
                    <span className="text-xs font-semibold text-jf-navy">
                      {isFr
                        ? 'Offres réelles en direct (sources vérifiées)'
                        : 'Live Verified Openings'}
                    </span>
                    <span className="text-[11px] font-mono text-jf-blue">
                      {isFr ? 'En direct' : 'Live'}
                    </span>
                  </div>

                  {loadingLive ? (
                    <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin text-jf-blue" />
                      <span>{isFr ? 'Récupération des offres réelles…' : 'Fetching real listings…'}</span>
                    </div>
                  ) : liveJobs.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-600 space-y-2">
                      <p>
                        {isFr
                          ? 'Aucune offre chargée dans cet aperçu. Lancez la recherche mondiale pour interroger les sources en direct.'
                          : 'No live listings loaded in this preview. Open Global Search to query live feeds.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => onNavigate('jobs')}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-jf-blue rounded-lg"
                      >
                        {isFr ? 'Ouvrir la recherche mondiale' : 'Open Global Search'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[295px] overflow-y-auto pr-1">
                      {liveJobs.map((item) => {
                        const active = selectedOpp?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedHubId(item.id)}
                            className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                              active
                                ? 'bg-white border-jf-blue shadow-sm'
                                : 'bg-white/80 border-jf-border hover:bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-jf-navy truncate">
                                {item.company}
                              </span>
                              <span className="text-[11px] font-semibold text-jf-blue whitespace-nowrap shrink-0">
                                {item.workMode}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-700 font-medium leading-snug line-clamp-1">
                              {item.title}
                            </p>
                            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                              <span className="truncate">{item.sourceName}</span>
                              <span className="shrink-0 font-medium text-jf-dark ml-2">
                                {item.country}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Honesty & Transparency Safeguard Note */}
                <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-jf-border">
                  {isFr
                    ? 'Transparence JOBFOUNDS : aucune entreprise ni offre fictive n’est affichée. Chaque carte provient d’une source publique vérifiable avec lien officiel.'
                    : 'JOBFOUNDS Transparency: zero fabricated companies or mock listings. Every item comes from a verifiable public source with an official link.'}
                </p>
              </div>
            </div>

            {/* Centered Action Button */}
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => onNavigate('hidden')}
                className="group px-7 py-3.5 text-sm font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-full shadow-[0_12px_28px_-10px_rgba(40,123,199,0.55)] transition-all inline-flex items-center gap-2 whitespace-nowrap"
              >
                <span>
                  {isFr ? 'Explorer les opportunités cachées' : 'Explore Hidden Opportunities'}
                </span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        )}

        {activePreview === 'cv' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2">
            <div className="lg:col-span-5 space-y-4">
              <div className="text-xs font-semibold text-jf-blue">
                {isFr ? 'Studio CV & Analyseur ATS' : 'AI Resume Studio & ATS Audit'}
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-jf-navy">
                {isFr
                  ? 'Importez, optimisez et exportez votre CV sans jamais inventer de fausses expériences.'
                  : 'Import, tailor, and export your resume with strict factual accuracy.'}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {isFr
                  ? 'Importez votre PDF ou Word (.docx), lancez un diagnostic ATS par rapport à l’offre visée, identifiez les mots-clés manquants et téléchargez une version prête à envoyer.'
                  : 'Upload your existing PDF or Word (.docx), run a target-job ATS audit, surface missing keywords, and export clean PDF or DOCX resumes.'}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('cv')}
                className="px-6 py-3 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full transition-colors inline-flex items-center gap-2"
              >
                <span>{isFr ? 'Ouvrir le studio CV IA' : 'Open AI CV Builder'}</span>
                <ArrowRight className="w-4 h-4 text-jf-sky" />
              </button>
            </div>
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-jf-ice border border-jf-border space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-jf-navy">
                  <span>{isFr ? 'Score ATS (exemple)' : 'ATS Score (example)'}</span>
                  <span className="font-mono text-jf-blue tabular-nums">92 / 100</span>
                </div>
                <div className="h-2 rounded-full bg-white overflow-hidden">
                  <div className="h-full w-[92%] bg-jf-blue rounded-full" />
                </div>
                <p className="text-xs text-slate-600">
                  {isFr
                    ? 'Structure lisible, mots-clés techniques alignés et verbes d’action vérifiés.'
                    : 'Clean parsing structure, aligned domain keywords, and verified impact bullets.'}
                </p>
              </div>
              <div className="p-5 rounded-2xl bg-jf-navy text-white space-y-3">
                <div className="text-xs font-semibold text-jf-sky">
                  {isFr ? 'Exports natifs inclus' : 'Native Exports Included'}
                </div>
                <div className="text-sm font-semibold">PDF · Word (.docx) · 6 langues</div>
                <p className="text-xs text-jf-soft/85">
                  {isFr
                    ? 'Trois mises en page professionnelles : Exécutif, Moderne Structuré et International.'
                    : 'Three executive layouts: Executive, Structured, and International Minimal.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {activePreview === 'interview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2">
            <div className="lg:col-span-5 space-y-4">
              <div className="text-xs font-semibold text-jf-blue">
                {isFr ? 'Simulateur interactif IA' : 'Interactive AI Interview Coach'}
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-jf-navy">
                {isFr
                  ? 'Entraînez-vous aux vraies questions du poste avec feedback STAR immédiat.'
                  : 'Rehearse role-specific questions with instant STAR feedback.'}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {isFr
                  ? 'Chaque réponse est évaluée sur la clarté, la structure STAR et la pertinence métier afin d’arriver parfaitement préparé le jour de l’entretien.'
                  : 'Every response is scored on clarity, STAR structure, and business relevance so you walk into real interviews prepared.'}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('career', 'interview')}
                className="px-6 py-3 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full transition-colors inline-flex items-center gap-2"
              >
                <span>{isFr ? 'Lancer une simulation' : 'Start Simulation'}</span>
                <ArrowRight className="w-4 h-4 text-jf-sky" />
              </button>
            </div>
            <div className="lg:col-span-7 p-5 rounded-2xl bg-jf-ice border border-jf-border space-y-3">
              <div className="text-xs font-semibold text-jf-blue">
                {isFr ? 'Question IA (exemple)' : 'AI Question (example)'}
              </div>
              <p className="text-sm font-semibold text-jf-navy">
                {isFr
                  ? '« Décrivez une situation où vous avez dû arbitrer un projet critique avec des ressources limitées. »'
                  : '“Describe a time you had to prioritize a critical project under tight constraints.”'}
              </p>
              <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                <div className="p-3 bg-white rounded-xl border border-jf-border">
                  <div className="font-mono text-base font-bold text-jf-navy tabular-nums">88%</div>
                  <div className="text-[11px] text-slate-500">{isFr ? 'Clarté' : 'Clarity'}</div>
                </div>
                <div className="p-3 bg-white rounded-xl border border-jf-border">
                  <div className="font-mono text-base font-bold text-jf-blue tabular-nums">84%</div>
                  <div className="text-[11px] text-slate-500">STAR</div>
                </div>
                <div className="p-3 bg-white rounded-xl border border-jf-border">
                  <div className="font-mono text-base font-bold text-jf-navy tabular-nums">91%</div>
                  <div className="text-[11px] text-slate-500">
                    {isFr ? 'Pertinence' : 'Relevance'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DecisionMakerInboxDemo({ lang }: { lang: Lang }) {
  const isFr = lang === 'fr';
  const [selectedRow, setSelectedRow] = useState(0);

  const workflowSteps = [
    {
      title: isFr
        ? '1. Préparation & autorisation explicite'
        : '1. Preparation & Explicit Approval',
      sender: isFr
        ? 'Adaptation du CV, lettre de motivation et vérification du canal officiel'
        : 'CV tailoring, cover letter drafting, and official channel verification',
      status: isFr ? 'Validation requise' : 'Approval required',
    },
    {
      title: isFr
        ? '2. Transmission réelle avec preuve serveur'
        : '2. Real Delivery with Server Proof',
      sender: isFr
        ? 'Envoi direct JOBFOUNDS, e-mail Resend avec pièces jointes ou portail ATS officiel'
        : 'Direct JOBFOUNDS inbox, Resend email with attachments, or official ATS portal',
      status: isFr ? 'Reçu horodaté' : 'Timestamped receipt',
    },
    {
      title: isFr
        ? '3. Suivi des réponses recruteurs (CRM & Gmail)'
        : '3. Recruiter Reply Sync (CRM & Gmail)',
      sender: isFr
        ? 'Réponses employeurs en direct et synchronisation Gmail lecture seule autorisée'
        : 'Live employer replies and user-authorized read-only Gmail synchronization',
      status: isFr ? 'Sync automatique' : 'Auto-synced',
    },
  ];

  return (
    <div className="relative pb-6">
      <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] border border-jf-sky/30 space-y-6">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-jf-border">
          <div className="text-sm font-bold text-jf-navy">
            {isFr ? 'Parcours de candidature vérifié' : 'Verified Application Workflow'}
          </div>
          <span className="text-[11px] font-medium text-jf-blue">
            {isFr ? 'Zéro simulation' : 'Zero simulation'}
          </span>
        </div>

        {/* Center Visual Emblem */}
        <div className="flex flex-col items-center text-center space-y-2 py-1">
          <div className="relative w-14 h-14 rounded-2xl bg-jf-navy flex items-center justify-center shadow-md">
            <Mail className="w-6 h-6 text-jf-sky" />
          </div>
          <div className="text-sm font-semibold text-jf-navy">
            {isFr ? 'Candidat → Employeur → Réponse → CRM' : 'Candidate → Employer → Reply → CRM'}
          </div>
        </div>

        {/* Real Workflow Rows */}
        <div className="space-y-3">
          {workflowSteps.map((row, idx) => {
            const active = selectedRow === idx;
            return (
              <button
                key={row.title}
                type="button"
                onClick={() => setSelectedRow(idx)}
                className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                  active
                    ? 'bg-jf-ice border-jf-blue'
                    : 'bg-white border-jf-border hover:bg-jf-ice/60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-jf-navy text-jf-sky flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-jf-navy truncate">
                      {row.title}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{row.sender}</div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-jf-soft text-jf-navy text-[11px] font-semibold whitespace-nowrap shrink-0">
                  {row.status}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating Bottom-Right Safeguard Callout */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="absolute -bottom-1 right-4 sm:right-6 bg-white border border-jf-sky rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded-xl bg-jf-navy flex items-center justify-center shrink-0">
          <Check className="w-4 h-4 text-jf-sky" />
        </div>
        <div>
          <div className="text-xs font-bold text-jf-navy">
            {isFr ? 'Envoi tracé & vérifié' : 'Verified delivery proof'}
          </div>
          <div className="text-[11px] text-slate-500">
            {isFr ? 'Jamais marqué envoyé sans preuve' : 'Never marked sent without proof'}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function CvStudioDemo({ lang }: { lang: Lang }) {
  const isFr = lang === 'fr';
  const [template, setTemplate] = useState<'executive' | 'structured' | 'international'>(
    'executive'
  );

  const sidebarBg =
    template === 'executive'
      ? 'bg-jf-navy text-white'
      : template === 'structured'
        ? 'bg-jf-dark text-white'
        : 'bg-jf-ice text-jf-navy border-r border-jf-border';

  const sidebarAccent = template === 'international' ? 'text-jf-blue' : 'text-jf-sky';

  return (
    <div className="relative rounded-3xl bg-jf-ice border border-jf-border p-5 sm:p-8 overflow-hidden">
      {/* Subtle architectural dot background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#A9D8F5 1.25px, transparent 1.25px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Template Interactive Switcher */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 mb-5">
        <span className="text-xs font-semibold text-jf-dark">
          {isFr ? 'Modèles de mise en page CV (structure)' : 'CV Layout Templates (Structure)'}
        </span>
        <div className="inline-flex items-center gap-1 p-1 bg-white border border-jf-border rounded-lg">
          {(
            [
              { id: 'executive', label: isFr ? 'Exécutif' : 'Executive' },
              { id: 'structured', label: isFr ? 'Structuré' : 'Structured' },
              { id: 'international', label: 'International' },
            ] as const
          ).map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setTemplate(tpl.id)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                template === tpl.id
                  ? 'bg-jf-navy text-white'
                  : 'text-jf-dark hover:bg-jf-ice'
              }`}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Structural CV Layout Preview (Zero fictional persona) */}
      <div className="relative z-10 mx-auto max-w-[440px] rounded-2xl overflow-hidden bg-white border border-jf-border shadow-[0_24px_55px_-22px_rgba(6,19,47,0.28)] grid grid-cols-12">
        {/* CV Left Column */}
        <div className={`col-span-5 p-4 sm:p-5 space-y-4 ${sidebarBg} transition-colors`}>
          <div className="w-12 h-12 rounded-full bg-jf-blue/25 border-2 border-jf-sky flex items-center justify-center font-display font-bold text-xs">
            CV
          </div>
          <div className="space-y-1">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Coordonnées' : 'Contact'}
            </div>
            <div className="text-[11px] opacity-85 space-y-0.5">
              <div>{isFr ? 'Votre ville · Pays' : 'Your City · Country'}</div>
              <div>{isFr ? 'Votre e-mail' : 'Your email'}</div>
            </div>
          </div>
          <div className="space-y-2">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Compétences clés' : 'Core Skills'}
            </div>
            {[
              isFr ? 'Compétence métier #1' : 'Core skill #1',
              isFr ? 'Compétence technique #2' : 'Technical skill #2',
              isFr ? 'Outil / Méthodologie #3' : 'Tool / Method #3',
            ].map((label) => (
              <div key={label} className="space-y-1">
                <div className="text-[10px] opacity-90">{label}</div>
                <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full rounded-full bg-jf-sky w-3/4" />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 pt-1">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Langues' : 'Languages'}
            </div>
            <div className="text-[10px] opacity-85 space-y-0.5">
              <div>{isFr ? 'Langue 1 · Niveau' : 'Language 1 · Level'}</div>
              <div>{isFr ? 'Langue 2 · Niveau' : 'Language 2 · Level'}</div>
            </div>
          </div>
        </div>

        {/* CV Right Column */}
        <div className="col-span-7 p-4 sm:p-5 space-y-3.5 text-jf-navy">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-jf-border">
            <div>
              <div className="font-display text-base font-bold leading-tight">
                {isFr ? 'Votre Nom Complet' : 'Your Full Name'}
              </div>
              <div className="text-xs font-medium text-jf-blue">
                {isFr ? 'Intitulé de poste ciblé' : 'Target Job Title'}
              </div>
            </div>
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-jf-soft text-jf-navy">
              ATS
            </span>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Synthèse' : 'Summary'}
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              {isFr
                ? 'Importez votre CV PDF ou Word (.docx) : JOBFOUNDS structure votre parcours réel sans jamais inventer d’expériences.'
                : 'Import your real PDF or Word (.docx) CV: JOBFOUNDS structures your real background without fabricating experience.'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Expériences professionnelles' : 'Professional Experience'}
            </div>
            <div>
              <div className="text-[11px] font-bold text-jf-navy">
                {isFr ? 'Poste occupé' : 'Role Title'}
              </div>
              <div className="text-[10px] text-slate-500">
                {isFr ? 'Entreprise · Période' : 'Company · Dates'}
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
                {isFr
                  ? '• Réalisations factuelles extraites de votre propre parcours.'
                  : '• Factual accomplishments extracted from your own track record.'}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-jf-border">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Formation' : 'Education'}
            </div>
            <div className="text-[10px] text-slate-700 mt-0.5">
              {isFr ? 'Diplôme · Établissement · Année' : 'Degree · Institution · Year'}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Bottom-Right Deep Navy Verification Callout (Inspired by Reference #4) */}
      <div className="relative z-20 flex justify-end mt-4">
        <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-jf-navy text-white text-xs font-semibold shadow-lg border border-jf-sky/40">
          <CheckCircle2 className="w-4 h-4 text-jf-sky shrink-0" />
          <span>
            {isFr ? 'Adapté à chaque offre · Export PDF & DOCX' : 'Tailored per role · PDF & DOCX'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function InterviewCoachDemo({ lang }: { lang: Lang }) {
  const isFr = lang === 'fr';
  const [rubricIdx, setRubricIdx] = useState(0);

  const rubrics = [
    {
      label: isFr ? 'Méthode STAR' : 'STAR Method',
      question: isFr
        ? 'Comment l’IA évalue vos vraies réponses d’entretien :'
        : 'How the AI evaluates your real interview answers:',
      criteria: isFr
        ? 'Situation · Tâche · Action concrète · Résultat mesurable — adapté au poste ciblé et à votre propre parcours.'
        : 'Situation · Task · Concrete Action · Measurable Result — tailored to the target role and your own background.',
      tip: isFr
        ? 'Ouvrez le module Préparation Entretiens pour répondre à des questions générées sur une offre réelle.'
        : 'Open Interview Prep to practice with questions generated from a real target job listing.',
    },
    {
      label: isFr ? 'Entretien vocal & texte' : 'Voice & Text Coaching',
      question: isFr
        ? 'Entraînement interactif sur vos candidatures actives :'
        : 'Interactive rehearsal on your active applications:',
      criteria: isFr
        ? 'Analyse de la clarté, de la précision métier, de la concision et des points de vigilance spécifiques à l’employeur.'
        : 'Evaluates clarity, domain precision, conciseness, and employer-specific talking points.',
      tip: isFr
        ? 'Aucune réponse fictive : votre score réel est calculé uniquement à partir de vos propres sessions enregistrées.'
        : 'Zero fabricated answers: your real readiness score is computed exclusively from your own recorded sessions.',
    },
  ];

  const activeRubric = rubrics[rubricIdx];

  return (
    <div className="bg-white rounded-3xl border border-jf-border shadow-[0_24px_60px_-24px_rgba(6,19,47,0.16)] p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-wide uppercase text-jf-blue">
          {isFr ? 'Grille d’évaluation IA réelle' : 'Real AI Evaluation Rubric'}
        </span>
        <span className="text-xs font-semibold text-jf-navy font-mono">
          {isFr ? 'STAR · Clarté · Impact' : 'STAR · Clarity · Impact'}
        </span>
      </div>

      {/* Rubric Pillars */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { code: 'S', title: isFr ? 'Situation' : 'Situation', desc: isFr ? 'Contexte précis' : 'Clear context' },
          { code: 'T', title: isFr ? 'Tâche' : 'Task', desc: isFr ? 'Objectif visé' : 'Target goal' },
          { code: 'A', title: isFr ? 'Action' : 'Action', desc: isFr ? 'Décisions clés' : 'Key decisions' },
          { code: 'R', title: isFr ? 'Résultat' : 'Result', desc: isFr ? 'Impact factuel' : 'Factual impact' },
        ].map((step) => (
          <div key={step.code} className="rounded-2xl bg-jf-ice border border-jf-border p-3 text-center space-y-1">
            <div className="w-7 h-7 mx-auto rounded-lg bg-jf-navy text-jf-sky font-mono text-xs font-bold flex items-center justify-center">
              {step.code}
            </div>
            <div className="text-xs font-semibold text-jf-navy">{step.title}</div>
            <div className="text-[11px] text-slate-500">{step.desc}</div>
          </div>
        ))}
      </div>

      {/* Interactive Mode Switcher */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-1.5">
          {rubrics.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setRubricIdx(idx)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                rubricIdx === idx
                  ? 'bg-jf-navy text-white border-jf-navy'
                  : 'bg-jf-ice text-jf-dark border-jf-border hover:bg-jf-soft'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="p-4 rounded-2xl bg-jf-ice/80 border border-jf-border space-y-2.5 text-xs">
          <div className="font-semibold text-jf-navy leading-relaxed">
            {activeRubric.question}
          </div>
          <p className="text-slate-600 leading-relaxed">{activeRubric.criteria}</p>
          <div className="pt-2 border-t border-jf-border">
            <p className="text-jf-dark leading-relaxed">
              <strong className="text-jf-blue">
                {isFr ? 'Fonctionnement réel : ' : 'How it works: '}
              </strong>
              {activeRubric.tip}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Summary Strip */}
      <div className="flex items-center justify-between pt-2 border-t border-jf-border text-xs">
        <span className="font-mono font-semibold text-jf-navy">
          {isFr ? 'Score basé sur vos sessions' : 'Score from your sessions'}
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-jf-blue">
          <CheckCircle2 className="w-4 h-4" />
          <span>{isFr ? 'Zéro donnée simulée' : 'Zero simulated data'}</span>
        </span>
      </div>
    </div>
  );
}
