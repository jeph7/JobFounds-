import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  Globe,
  Mail,
  MapPin,
  MessageSquareText,
  Radar,
} from 'lucide-react';
import { Lang, WorkspaceTab } from '../../types';
import { pickLang } from '../../i18n';

interface ShowcaseProps {
  lang: Lang;
  onNavigate: (tab: WorkspaceTab, careerSubTab?: 'tracker' | 'interview' | 'mobility') => void;
}

type SignalLayer = 'all' | 'published' | 'identified' | 'signals' | 'verify';

interface DemoOpportunity {
  id: string;
  company: string;
  city: string;
  country: string;
  layer: Exclude<SignalLayer, 'all'>;
  categoryLabelFr: string;
  categoryLabelEn: string;
  signalFr: string;
  signalEn: string;
  roles: string[];
  mapX: number;
  mapY: number;
}

const DEMO_OPPORTUNITIES: DemoOpportunity[] = [
  {
    id: 'demo-1',
    company: 'Qonto',
    city: 'Paris',
    country: 'France',
    layer: 'published',
    categoryLabelFr: 'Offre publiée',
    categoryLabelEn: 'Published Job',
    signalFr: 'Poste officiellement ouvert sur le portail carrières européen',
    signalEn: 'Officially published on European corporate careers portal',
    roles: ['Senior Product Manager', 'Staff Frontend Engineer'],
    mapX: 47,
    mapY: 36,
  },
  {
    id: 'demo-2',
    company: 'Helvetia Tech',
    city: 'Zurich',
    country: 'Suisse',
    layer: 'identified',
    categoryLabelFr: 'Opportunité identifiée',
    categoryLabelEn: 'Identified Opportunity',
    signalFr: 'Création annoncée d’un pôle Data & IA (18 recrutements prévus)',
    signalEn: 'Announced Data & AI hub launch (18 planned hires)',
    roles: ['Data Architect', 'AI Product Lead'],
    mapX: 52,
    mapY: 40,
  },
  {
    id: 'demo-3',
    company: 'NordGrid Energy',
    city: 'Berlin',
    country: 'Allemagne',
    layer: 'signals',
    categoryLabelFr: 'Signal de recrutement',
    categoryLabelEn: 'Hiring Signal',
    signalFr: 'Série B clôturée + ouverture de nouveaux bureaux DACH',
    signalEn: 'Series B closed + new DACH office expansion',
    roles: ['Operations Manager', 'Full-Stack Engineer'],
    mapX: 54,
    mapY: 32,
  },
  {
    id: 'demo-4',
    company: 'Atlas Cloud Systems',
    city: 'Montréal',
    country: 'Canada',
    layer: 'verify',
    categoryLabelFr: 'Potentielle · À vérifier',
    categoryLabelEn: 'Potential · Verify',
    signalFr: 'Nouveau contrat d’infrastructure — besoin RH à confirmer',
    signalEn: 'New infrastructure contract — staffing needs to be verified',
    roles: ['Cloud Consultant', 'Delivery Lead'],
    mapX: 25,
    mapY: 35,
  },
  {
    id: 'demo-5',
    company: 'Meridian FinOps',
    city: 'Londres',
    country: 'Royaume-Uni',
    layer: 'signals',
    categoryLabelFr: 'Signal de recrutement',
    categoryLabelEn: 'Hiring Signal',
    signalFr: 'Croissance de l’équipe commerciale Europe (+22 % en 6 mois)',
    signalEn: 'European commercial team growth (+22% in 6 months)',
    roles: ['Account Executive', 'Solutions Architect'],
    mapX: 44,
    mapY: 31,
  },
  {
    id: 'demo-6',
    company: 'Pacific Robotics',
    city: 'Singapour',
    country: 'Singapour',
    layer: 'identified',
    categoryLabelFr: 'Opportunité identifiée',
    categoryLabelEn: 'Identified Opportunity',
    signalFr: 'Déploiement d’une nouvelle ligne produit APAC',
    signalEn: 'New APAC product line rollout',
    roles: ['Embedded Systems Lead', 'Supply Chain Analyst'],
    mapX: 79,
    mapY: 60,
  },
];

export function HiddenMarketShowcase({ lang, onNavigate }: ShowcaseProps) {
  const [activePreview, setActivePreview] = useState<'hidden' | 'cv' | 'interview'>('hidden');
  const [layerFilter, setLayerFilter] = useState<SignalLayer>('all');
  const [selectedHubId, setSelectedHubId] = useState<string>('demo-2');

  const isFr = lang === 'fr';

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
        fr: 'Marché caché',
        en: 'Hidden Market',
        es: 'Mercado oculto',
        de: 'Verdeckter Markt',
        pt: 'Mercado oculto',
        ar: 'السوق المخفي',
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

  const layerOptions: Array<{ id: SignalLayer; label: string }> = [
    { id: 'all', label: isFr ? 'Tous (4 niveaux)' : 'All (4 levels)' },
    { id: 'published', label: isFr ? '1. Offres publiées' : '1. Published' },
    { id: 'identified', label: isFr ? '2. Opportunités identifiées' : '2. Identified' },
    { id: 'signals', label: isFr ? '3. Signaux d’activité' : '3. Signals' },
    { id: 'verify', label: isFr ? '4. À vérifier' : '4. Verify' },
  ];

  const visibleOpps =
    layerFilter === 'all'
      ? DEMO_OPPORTUNITIES
      : DEMO_OPPORTUNITIES.filter((o) => o.layer === layerFilter);

  const selectedOpp =
    visibleOpps.find((o) => o.id === selectedHubId) ?? visibleOpps[0] ?? DEMO_OPPORTUNITIES[0];

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
                    ? 'Radar International · Démonstration interactive (exemples illustratifs)'
                    : 'International Radar · Interactive Demo (Illustrative Examples)'}
                </div>
                <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-jf-navy tracking-tight">
                  {isFr
                    ? 'Les opportunités ne sont pas toujours publiées. Nous allons les chercher.'
                    : 'Opportunities are not always posted. We go find them.'}
                </h2>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                  {isFr
                    ? 'Certaines entreprises recherchent de nouveaux collaborateurs sans publier d’annonce. JOBFOUNDS analyse les signaux de recrutement, identifie les entreprises susceptibles de recruter et vous aide à découvrir des opportunités avant leur publication officielle.'
                    : 'Some companies look for new talent before posting publicly. JOBFOUNDS analyzes hiring signals, surfaces expanding organizations, and helps you discover opportunities ahead of public listings.'}
                </p>
              </div>

              {/* 4-Level Transparency Filter */}
              <div className="flex flex-wrap items-center gap-1.5">
                {layerOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLayerFilter(opt.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      layerFilter === opt.id
                        ? 'bg-jf-navy text-white border-jf-navy'
                        : 'bg-jf-ice text-jf-dark border-jf-border hover:bg-jf-soft'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
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

                {/* Interactive Geo Pins */}
                <div className="relative z-10 flex-1 my-4">
                  {DEMO_OPPORTUNITIES.map((hub) => {
                    const isSelected = selectedOpp.id === hub.id;
                    const isDimmed = layerFilter !== 'all' && hub.layer !== layerFilter;
                    return (
                      <button
                        key={hub.id}
                        type="button"
                        onClick={() => setSelectedHubId(hub.id)}
                        style={{ left: `${hub.mapX}%`, top: `${hub.mapY}%` }}
                        aria-label={`${hub.company} - ${hub.city}`}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue rounded-full ${
                          isDimmed ? 'opacity-25 scale-90' : 'opacity-100'
                        }`}
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
                          <span className="whitespace-nowrap">{hub.city}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Bottom Selected Signal Spotlight Bar */}
                <div className="relative z-10 bg-white/95 backdrop-blur-xs border border-jf-border rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-jf-navy">{selectedOpp.company}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">
                        {selectedOpp.city}, {selectedOpp.country}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-jf-blue">
                        {isFr ? selectedOpp.categoryLabelFr : selectedOpp.categoryLabelEn}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {isFr ? selectedOpp.signalFr : selectedOpp.signalEn}
                    </p>
                  </div>
                  <div className="text-[11px] font-mono text-jf-dark shrink-0">
                    {selectedOpp.roles.join(' · ')}
                  </div>
                </div>
              </div>

              {/* Right: Companies to Contact & Strict 4-Tier Classification List */}
              <div className="lg:col-span-5 rounded-2xl bg-jf-ice/70 border border-jf-border p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-jf-border">
                    <span className="text-xs font-semibold text-jf-navy">
                      {isFr
                        ? 'Entreprises & opportunités détectées'
                        : 'Detected Companies & Signals'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {isFr ? 'Exemples' : 'Examples'}
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[295px] overflow-y-auto pr-1">
                    {visibleOpps.map((item) => {
                      const active = selectedOpp.id === item.id;
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
                            <span className="text-sm font-semibold text-jf-navy">
                              {item.company}
                            </span>
                            <span className="text-[11px] font-semibold text-jf-blue whitespace-nowrap">
                              {isFr ? item.categoryLabelFr : item.categoryLabelEn}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600 leading-snug">
                            {isFr ? item.signalFr : item.signalEn}
                          </p>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="truncate">{item.roles.join(' · ')}</span>
                            <span className="shrink-0 font-medium text-jf-dark ml-2">
                              {item.city}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Honesty & Transparency Safeguard Note */}
                <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-jf-border">
                  {isFr
                    ? 'Transparence JOBFOUNDS : chaque signal distingue clairement une annonce publiée d’une opportunité potentielle à vérifier. Aucune hypothèse n’est présentée comme offre confirmée.'
                    : 'JOBFOUNDS Transparency: every signal strictly separates verified job postings from potential opportunities requiring human verification.'}
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

  const sampleThreads = [
    {
      title: isFr
        ? 'Candidature spontanée — Direction Produit'
        : 'Spontaneous Outreach — Product Leadership',
      sender: isFr ? 'Exemple · Responsable Recrutement · Paris' : 'Example · Head of Talent · Paris',
      status: isFr ? 'Échange planifié' : 'Call scheduled',
    },
    {
      title: isFr
        ? 'Réponse recruteur — Ingénierie Plateforme'
        : 'Recruiter Reply — Platform Engineering',
      sender: isFr ? 'Exemple · Directeur Technique · Zurich' : 'Example · Engineering Director · Zurich',
      status: isFr ? 'Entretien proposé' : 'Interview invited',
    },
    {
      title: isFr
        ? 'Prise de contact directe — Expansion Europe'
        : 'Direct Outreach — Europe Expansion',
      sender: isFr ? 'Exemple · Talent Partner · Berlin' : 'Example · Talent Partner · Berlin',
      status: isFr ? 'Profil retenu' : 'Shortlisted',
    },
  ];

  return (
    <div className="relative pb-6">
      <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] border border-jf-sky/30 space-y-6">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-jf-border">
          <div className="text-sm font-bold text-jf-navy">
            {isFr ? 'Boîte de réception professionnelle' : 'Professional Outreach Inbox'}
          </div>
          <span className="text-[11px] font-medium text-jf-blue">
            {isFr ? 'Exemple illustratif' : 'Illustrative example'}
          </span>
        </div>

        {/* Center Visual Emblem */}
        <div className="flex flex-col items-center text-center space-y-2 py-1">
          <div className="relative w-14 h-14 rounded-2xl bg-jf-navy flex items-center justify-center shadow-md">
            <Mail className="w-6 h-6 text-jf-sky" />
            <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-jf-blue text-white text-xs font-mono font-bold flex items-center justify-center border-2 border-white">
              3
            </span>
          </div>
          <div className="text-sm font-semibold text-jf-navy">
            {isFr ? 'Suivi des réponses & entretiens' : 'Replies & Interview Invitations'}
          </div>
        </div>

        {/* Sample Interactive Rows */}
        <div className="space-y-3">
          {sampleThreads.map((row, idx) => {
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

      {/* Floating Bottom-Right Confirmation Card (Inspired by Reference #3) */}
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
            {isFr ? 'Invitation entretien (exemple)' : 'Interview invite (example)'}
          </div>
          <div className="text-[11px] text-slate-500">
            {isFr ? 'Envoi validé par le candidat' : 'Candidate-approved outreach'}
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
          {isFr ? 'Aperçu interactif · Exemple de CV' : 'Interactive Preview · Sample Resume'}
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

      {/* Main Crisp CV Sheet (Inspired by Reference #4) */}
      <div className="relative z-10 mx-auto max-w-[440px] rounded-2xl overflow-hidden bg-white border border-jf-border shadow-[0_24px_55px_-22px_rgba(6,19,47,0.28)] grid grid-cols-12">
        {/* CV Left Column */}
        <div className={`col-span-5 p-4 sm:p-5 space-y-4 ${sidebarBg} transition-colors`}>
          <div className="w-12 h-12 rounded-full bg-jf-blue/25 border-2 border-jf-sky flex items-center justify-center font-display font-bold text-sm">
            CL
          </div>
          <div className="space-y-1">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Coordonnées' : 'Contact'}
            </div>
            <div className="text-[11px] opacity-85 space-y-0.5">
              <div>Paris · Genève</div>
              <div>FR · EN · DE</div>
            </div>
          </div>
          <div className="space-y-2">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Compétences clés' : 'Core Skills'}
            </div>
            {[
              { label: 'Product Strategy', pct: '92%' },
              { label: 'Data & SQL', pct: '85%' },
              { label: 'International Scale', pct: '88%' },
            ].map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="text-[10px] opacity-90">{s.label}</div>
                <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-jf-sky"
                    style={{ width: s.pct }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 pt-1">
            <div className={`text-[10px] font-bold tracking-wider uppercase ${sidebarAccent}`}>
              {isFr ? 'Langues' : 'Languages'}
            </div>
            <div className="text-[10px] opacity-85 space-y-0.5">
              <div>Français — Natif</div>
              <div>English — C1</div>
            </div>
          </div>
        </div>

        {/* CV Right Column */}
        <div className="col-span-7 p-4 sm:p-5 space-y-3.5 text-jf-navy">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-jf-border">
            <div>
              <div className="font-display text-base font-bold leading-tight">
                Camille Laurent
              </div>
              <div className="text-xs font-medium text-jf-blue">
                Senior Product Manager
              </div>
            </div>
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-jf-soft text-jf-navy">
              ATS 94%
            </span>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Profil' : 'Summary'}
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              {isFr
                ? '7 ans d’expérience dans le pilotage de produits SaaS B2B européens, structuration de roadmaps data-driven et coordination multi-pays.'
                : '7 years leading European B2B SaaS products, data-driven roadmaps, and cross-border launches.'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Expériences' : 'Experience'}
            </div>
            <div>
              <div className="text-[11px] font-bold text-jf-navy">Lead Product Manager</div>
              <div className="text-[10px] text-slate-500">FinTech Europe · 2023 – 2026</div>
              <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
                {isFr
                  ? '• Lancement de 3 marchés européens et amélioration de la conversion onboarding.'
                  : '• Launched 3 European markets and improved onboarding activation.'}
              </p>
            </div>
            <div>
              <div className="text-[11px] font-bold text-jf-navy">Product Manager</div>
              <div className="text-[10px] text-slate-500">CloudPay Studio · 2020 – 2023</div>
              <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
                {isFr
                  ? '• Pilotage de la plateforme API et des intégrations partenaires.'
                  : '• Led core API platform and enterprise partner integrations.'}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-jf-border">
            <div className="text-[10px] font-bold tracking-wider uppercase text-jf-blue">
              {isFr ? 'Formation' : 'Education'}
            </div>
            <div className="text-[10px] text-slate-700 mt-0.5">
              Master Management & Technologies Digitales
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
  const [sampleIdx, setSampleIdx] = useState(0);

  const samples = [
    {
      label: isFr ? 'Question comportementale' : 'Behavioral Question',
      question: isFr
        ? '« Parlez-moi d’un lancement international complexe dont vous avez piloté la coordination. »'
        : '“Tell me about a complex international launch you coordinated end-to-end.”',
      answer: isFr
        ? '« Sur notre déploiement DACH, j’ai aligné produit, conformité et ventes autour d’un jalon de 10 semaines, réduisant les délais d’intégration de 30 %. »'
        : '“During our DACH expansion, I aligned product, compliance, and sales around a 10-week plan, cutting onboarding time by 30%.”',
      score: 86,
      tip: isFr
        ? 'Structure STAR solide. Précisez votre arbitrage face au principal risque réglementaire pour atteindre 95/100.'
        : 'Strong STAR structure. Add one detail on how you resolved the main compliance trade-off to reach 95/100.',
    },
    {
      label: isFr ? 'Question stratégique' : 'Strategy Question',
      question: isFr
        ? '« Comment priorisez-vous votre feuille de route face à deux demandes clients majeures ? »'
        : '“How do you prioritize your roadmap when two enterprise clients have conflicting needs?”',
      answer: isFr
        ? '« J’évalue l’impact revenu récurrent, la réutilisabilité plateforme et le coût d’opportunité avant de proposer un phasage transparent. »'
        : '“I score recurring revenue impact, platform reusability, and engineering opportunity cost before proposing a transparent phased plan.”',
      score: 90,
      tip: isFr
        ? 'Excellente clarté décisionnelle. Ajoutez un indicateur chiffré de résultat post-lancement.'
        : 'Clear decision framework. Include one measurable post-launch metric to reinforce authority.',
    },
  ];

  const activeSample = samples[sampleIdx];

  return (
    <div className="bg-white rounded-3xl border border-jf-border shadow-[0_24px_60px_-24px_rgba(6,19,47,0.16)] p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-wide uppercase text-jf-blue">
          {isFr ? 'Progression (exemple illustratif)' : 'Progress (illustrative example)'}
        </span>
        <span className="text-xs font-semibold text-jf-navy font-mono tabular-nums">
          {isFr ? '4 entretiens blancs' : '4 mock sessions'}
        </span>
      </div>

      {/* Progression Line Chart SVG (Inspired by Reference #5, strictly Deep Navy + Sky Blue) */}
      <div className="rounded-2xl bg-jf-ice border border-jf-border p-4">
        <svg
          viewBox="0 0 380 140"
          className="w-full h-36 overflow-visible"
          role="img"
          aria-label="Interview preparation score progression chart"
        >
          {/* Ready Zone Band */}
          <rect x="10" y="10" width="360" height="44" rx="10" fill="#D5EBFA" fillOpacity="0.65" />
          <line
            x1="10"
            y1="54"
            x2="370"
            y2="54"
            stroke="#287BC7"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
          <text
            x="362"
            y="68"
            textAnchor="end"
            fill="#287BC7"
            fontSize="10"
            fontWeight="700"
          >
            {isFr ? 'PRÊT' : 'READY'}
          </text>

          {/* Subtle Area Fill under curve */}
          <defs>
            <linearGradient id="jfCoachArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#287BC7" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#A9D8F5" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path
            d="M 42 108 L 136 86 L 234 74 L 336 36 L 336 126 L 42 126 Z"
            fill="url(#jfCoachArea)"
          />

          {/* Progression Polyline */}
          <motion.path
            d="M 42 108 L 136 86 L 234 74 L 336 36"
            fill="none"
            stroke="#06132F"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Data Nodes */}
          {[
            { x: 42, y: 108, val: '42', highlight: false },
            { x: 136, y: 86, val: '58', highlight: false },
            { x: 234, y: 74, val: '71', highlight: false },
            { x: 336, y: 36, val: String(activeSample.score), highlight: true },
          ].map((pt) => (
            <g key={pt.x}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.highlight ? 7 : 5}
                fill={pt.highlight ? '#287BC7' : '#FFFFFF'}
                stroke={pt.highlight ? '#A9D8F5' : '#06132F'}
                strokeWidth={pt.highlight ? 3 : 2}
              />
              <text
                x={pt.x}
                y={pt.highlight ? pt.y - 14 : pt.y + 18}
                textAnchor="middle"
                fill={pt.highlight ? '#06132F' : '#556E91'}
                fontSize={pt.highlight ? '13' : '11'}
                fontWeight="700"
                className="font-mono"
              >
                {pt.val}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Interactive Question & AI Feedback Switcher */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-1.5">
          {samples.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setSampleIdx(idx)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                sampleIdx === idx
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
            {activeSample.question}
          </div>
          <p className="text-slate-600 italic leading-relaxed">{activeSample.answer}</p>
          <div className="pt-2 border-t border-jf-border flex items-start justify-between gap-3">
            <p className="text-jf-dark leading-relaxed">
              <strong className="text-jf-blue">
                {isFr ? 'Conseil IA : ' : 'AI Coaching: '}
              </strong>
              {activeSample.tip}
            </p>
            <span className="font-mono font-bold text-jf-navy tabular-nums shrink-0">
              {activeSample.score}/100
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Summary Strip */}
      <div className="flex items-center justify-between pt-2 border-t border-jf-border text-xs">
        <span className="font-mono font-semibold text-jf-navy tabular-nums">
          {isFr ? `Session 4 : ${activeSample.score}/100` : `Session 4: ${activeSample.score}/100`}
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-jf-blue">
          <CheckCircle2 className="w-4 h-4" />
          <span>{isFr ? 'Prêt pour le vrai entretien' : 'Ready for the real interview'}</span>
        </span>
      </div>
    </div>
  );
}
