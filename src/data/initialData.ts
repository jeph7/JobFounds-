import {
  CandidateProfile,
  CvDocument,
  HiddenOpportunity,
  JobListing,
  TrackedApplication,
  WatchlistItem,
} from '../types';

export const GLOBAL_BANNER_URL = '/src/assets/images/banner_global_hub_1795459371734.jpg';
export const CANDIDATE_AVATAR_URL = '/src/assets/images/avatar_candidate_profile_1795459370931.jpg';

export const initialCandidateProfile: CandidateProfile = {
  fullName: 'Candidat JOBFOUNDS',
  currentTitle: 'Senior Full-Stack & Product Engineer',
  yearsExperience: 6,
  highestDegree: 'Master (MSc / Ingénieur)',
  skills: [
    'TypeScript',
    'React',
    'Node.js',
    'SQL',
    'Cloud Architecture',
    'Product Strategy',
    'API Design',
  ],
  languages: ['French', 'English'],
  preferredCountries: ['France', 'Canada', 'Switzerland', 'Germany', 'United Kingdom'],
  preferredCities: ['Paris', 'Montreal', 'Zurich', 'Berlin', 'London'],
  minSalaryAnnualUsd: 70000,
  salaryCurrency: 'EUR',
  availability: 'Immediate / 1 month notice',
  preferredWorkModes: ['Remote', 'Hybrid'],
  preferredContracts: ['Full-time', 'Contract'],
  originCountry: 'France',
  workAuthorization: 'EU / International Sponsorship Ready',
  relocationReady: true,
  targetSectors: ['FinTech', 'Cloud & AI SaaS', 'Enterprise Software'],
};

export const initialCvDocuments: CvDocument[] = [
  {
    id: 'cv-primary-1',
    versionName: 'CV Principal — International',
    updatedAt: '2026-11-20',
    template: 'executive',
    fullName: initialCandidateProfile.fullName,
    headline: 'Senior Full-Stack & Product Engineer · SaaS & Cloud',
    email: 'contact@jobfounds.com',
    phone: '+33 6 00 00 00 00',
    location: 'Paris, France (Open to Remote / Relocation)',
    linkedin: 'https://linkedin.com',
    summary:
      'Ingénieur produit et architectures web distribuées avec 6 ans d’expérience dans la conception de plateformes SaaS internationales, APIs critiques et expériences utilisateurs haute performance.',
    experiences: [
      {
        id: 'exp-1',
        role: 'Lead Full-Stack Engineer',
        company: 'Plateforme SaaS Internationale',
        location: 'Paris / Remote',
        period: '2023 – Présent',
        highlights: [
          'Conception d’une architecture TypeScript / Node.js / React servant des équipes dans 12 pays.',
          'Réduction de 42 % de la latence API grâce à la mise en cache structurée et au découpage de services.',
          'Collaboration étroite avec les équipes Produit, Sécurité et Recrutement technique.',
        ],
      },
      {
        id: 'exp-2',
        role: 'Software Engineer',
        company: 'Enterprise Cloud Systems',
        location: 'Lyon, France',
        period: '2020 – 2023',
        highlights: [
          'Développement de tableaux de bord analytiques et connecteurs de données temps réel.',
          'Mise en place de pipelines CI/CD et de tests automatisés de bout en bout.',
        ],
      },
    ],
    education: [
      {
        id: 'edu-1',
        degree: 'Master en Informatique & Systèmes Distribués',
        institution: 'Université / École d’Ingénieurs',
        year: '2020',
      },
    ],
    skills: [...initialCandidateProfile.skills],
    languages: ['Français (Natif)', 'Anglais (C1 — Professionnel)'],
  },
];

export const initialJobs: JobListing[] = [
  {
    id: 'starter-stripe-staff-fe',
    title: 'Senior Full-Stack Engineer, Payments Infrastructure',
    company: 'Stripe',
    country: 'Ireland',
    city: 'Dublin',
    workMode: 'Hybrid',
    contractType: 'Full-time',
    experienceLevel: 'Senior',
    degreeRequired: "Bachelor's / Master's",
    salaryRange: '95,000 – 125,000 EUR',
    salaryMinAnnualUsd: 102000,
    languages: ['English'],
    skills: ['TypeScript', 'React', 'Node.js', 'API Design', 'SQL'],
    publishedDate: '2026-11-22',
    sourceName: 'Greenhouse Official ATS',
    sourceUrl: 'https://boards.greenhouse.io/stripe',
    verificationStatus: 'Verified',
    verificationSummary:
      'Portail carrière ATS officiel Greenhouse vérifié pour le domaine stripe.com.',
    description:
      'Conception et fiabilisation des interfaces marchands et APIs de paiement multi-devises pour l’Europe et l’international.',
    recruiterHint: 'Stripe EMEA Talent Acquisition',
    visaSponsorship: 'Available',
  },
  {
    id: 'starter-datadog-paris',
    title: 'Senior Product Engineer — Cloud Observability',
    company: 'Datadog',
    country: 'France',
    city: 'Paris',
    workMode: 'Hybrid',
    contractType: 'Full-time',
    experienceLevel: 'Senior',
    degreeRequired: "Master's / Equivalent",
    salaryRange: '80,000 – 105,000 EUR',
    salaryMinAnnualUsd: 86000,
    languages: ['French', 'English'],
    skills: ['TypeScript', 'React', 'Cloud Architecture', 'SQL', 'Product Strategy'],
    publishedDate: '2026-11-21',
    sourceName: 'Greenhouse Official ATS',
    sourceUrl: 'https://boards.greenhouse.io/datadog',
    verificationStatus: 'Verified',
    verificationSummary:
      'Annonce rattachée au portail ATS officiel Greenhouse de Datadog (centre R&D Paris).',
    description:
      'Développement d’interfaces d’observabilité temps réel à grande échelle au sein du pôle R&D de Paris.',
    recruiterHint: 'Datadog Paris Engineering Recruiting',
    visaSponsorship: 'Available',
  },
  {
    id: 'starter-alan-remote',
    title: 'Staff Full-Stack Software Engineer',
    company: 'Alan',
    country: 'France',
    city: 'Paris',
    workMode: 'Remote',
    contractType: 'Full-time',
    experienceLevel: 'Senior',
    degreeRequired: 'Not specified',
    salaryRange: '82,000 – 102,000 EUR',
    salaryMinAnnualUsd: 88000,
    languages: ['French', 'English'],
    skills: ['TypeScript', 'React', 'Node.js', 'SQL', 'Product Strategy'],
    publishedDate: '2026-11-20',
    sourceName: 'Ashby Official ATS',
    sourceUrl: 'https://jobs.ashbyhq.com/alan',
    verificationStatus: 'Verified',
    verificationSummary:
      'Portail officiel Ashby vérifié pour Alan (Politique Work From Anywhere en Europe).',
    description:
      'Construction des nouveaux parcours santé et assurance digitale en environnement remote-first asynchrone.',
    recruiterHint: 'Alan Talent Team',
    visaSponsorship: 'Case-by-case',
  },
  {
    id: 'starter-adyen-amsterdam',
    title: 'Platform Engineer — Global Financial APIs',
    company: 'Adyen',
    country: 'Netherlands',
    city: 'Amsterdam',
    workMode: 'Hybrid',
    contractType: 'Full-time',
    experienceLevel: 'Mid-level',
    degreeRequired: "Bachelor's / Master's",
    salaryRange: '78,000 – 98,000 EUR',
    salaryMinAnnualUsd: 84000,
    languages: ['English'],
    skills: ['Node.js', 'API Design', 'SQL', 'Cloud Architecture'],
    publishedDate: '2026-11-19',
    sourceName: 'Greenhouse Official ATS',
    sourceUrl: 'https://boards.greenhouse.io/adyen',
    verificationStatus: 'Partially Verified',
    verificationSummary:
      'Portail carrière officiel identifié ; vérifiez la disponibilité exacte du poste avant candidature.',
    description:
      'Déploiement de connecteurs financiers haute disponibilité et intégration de nouveaux moyens de paiement internationaux.',
    recruiterHint: 'Adyen Global Tech Hiring',
    visaSponsorship: 'Available',
  },
];

export const initialHiddenOpportunities: HiddenOpportunity[] = [
  {
    id: 'hidden-algolia-eu',
    company: 'Algolia',
    country: 'France',
    location: 'Paris, France',
    sector: 'AI Search & Developer SaaS',
    classification: 'Active Hiring Signal',
    potentialRoles: ['Senior Frontend Engineer', 'AI Solutions Architect', 'Product Manager'],
    detectionReason: 'Accélération des recrutements techniques détectée sur le portail carrière officiel',
    signalEvidence:
      'Plusieurs ouvertures simultanées sur les équipes AI Retrieval & Developer Experience à Paris et en télétravail Europe.',
    sourceName: 'Official Corporate ATS Portal',
    sourceUrl: 'https://boards.greenhouse.io/algolia',
    detectedDate: '2026-11-21',
    confidenceScore: 84,
    confidenceJustification:
      'Volume d’offres actives vérifié sur le portail officiel ATS, indiquant des besoins adjacents en ingénierie produit.',
    professionalContact: {
      nameOrDepartment: 'Algolia EMEA Talent Acquisition',
      channel: 'Official Careers Portal',
      url: 'https://www.algolia.com/careers/',
    },
    spontaneousOutreachAngle:
      'Mettre en avant une expérience concrète sur la latence API, React/TypeScript et la recherche temps réel.',
  },
  {
    id: 'hidden-celonis-munich',
    company: 'Celonis',
    country: 'Germany',
    location: 'Munich, Germany',
    sector: 'Enterprise AI & Process Intelligence',
    classification: 'Potential Hiring Opportunity',
    potentialRoles: ['Full-Stack Engineer', 'Data Platform Engineer', 'Forward Deployed Engineer'],
    detectionReason: 'Expansion continue des équipes européennes Process Intelligence & AI',
    signalEvidence:
      'Présence active sur les hubs de Munich, Madrid et Londres avec recrutement régulier de profils multilingues.',
    sourceName: 'Official Corporate ATS Portal',
    sourceUrl: 'https://boards.greenhouse.io/celonis',
    detectedDate: '2026-11-20',
    confidenceScore: 76,
    confidenceJustification:
      'Signal basé sur la récurrence des recrutements européens observés sur le portail carrière public.',
    professionalContact: {
      nameOrDepartment: 'Celonis European Talent Desk',
      channel: 'Official Careers Portal',
      url: 'https://www.celonis.com/careers/',
    },
    spontaneousOutreachAngle:
      'Proposer une candidature ciblée bilingue FR/EN orientée déploiement d’applications analytiques complexes.',
  },
];

export const initialApplications: TrackedApplication[] = [];

export const initialWatchlist: WatchlistItem[] = [
  {
    id: 'watch-datadog',
    kind: 'company',
    label: 'Datadog',
    country: 'France',
    sector: 'Cloud Observability & Security SaaS',
    lastChecked: '2026-11-22',
    lastSignalSummary: 'Surveillance active du portail officiel Greenhouse (hub R&D Paris).',
    unreadAlerts: 1,
  },
  {
    id: 'watch-alan',
    kind: 'company',
    label: 'Alan',
    country: 'France',
    sector: 'InsurTech & Digital Health',
    lastChecked: '2026-11-22',
    lastSignalSummary: 'Surveillance active du portail officiel Ashby (postes Remote Europe).',
    unreadAlerts: 0,
  },
];

export function computeBaselineMatch(
  profile: CandidateProfile,
  job: JobListing
): { score: number; skillsRatio: string; locationAligned: boolean } {
  const profileSkills = new Set(
    (profile.skills || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const jobSkills = (job.skills || []).map((s) => s.trim().toLowerCase()).filter(Boolean);

  let matchedSkillsCount = 0;
  for (const skill of jobSkills) {
    if (
      profileSkills.has(skill) ||
      Array.from(profileSkills).some((ps) => ps.includes(skill) || skill.includes(ps))
    ) {
      matchedSkillsCount += 1;
    }
  }

  const skillsPct =
    jobSkills.length > 0 ? matchedSkillsCount / jobSkills.length : 0.6;

  const prefCountries = (profile.preferredCountries || []).map((c) => c.toLowerCase());
  const prefCities = (profile.preferredCities || []).map((c) => c.toLowerCase());
  const jobCountry = (job.country || '').toLowerCase();
  const jobCity = (job.city || '').toLowerCase();

  const locationAligned =
    job.workMode === 'Remote' ||
    prefCountries.some((c) => c && (jobCountry.includes(c) || c.includes(jobCountry))) ||
    prefCities.some((c) => c && (jobCity.includes(c) || c.includes(jobCity)));

  const workModeAligned =
    !profile.preferredWorkModes?.length ||
    profile.preferredWorkModes.includes(job.workMode);

  const contractAligned =
    !profile.preferredContracts?.length ||
    profile.preferredContracts.includes(job.contractType);

  const profileLangs = new Set(
    (profile.languages || []).map((l) => l.toLowerCase().split(/[\s(]/)[0])
  );
  const jobLangs = (job.languages || []).map((l) => l.toLowerCase().split(/[\s(]/)[0]);
  const langAligned =
    jobLangs.length === 0 || jobLangs.some((l) => profileLangs.has(l));

  const salaryAligned =
    !job.salaryMinAnnualUsd ||
    !profile.minSalaryAnnualUsd ||
    job.salaryMinAnnualUsd >= profile.minSalaryAnnualUsd * 0.85;

  const rawScore =
    skillsPct * 50 +
    (locationAligned ? 18 : 6) +
    (workModeAligned ? 10 : 3) +
    (contractAligned ? 7 : 2) +
    (langAligned ? 8 : 2) +
    (salaryAligned ? 7 : 2);

  return {
    score: Math.max(15, Math.min(99, Math.round(rawScore))),
    skillsRatio: `${matchedSkillsCount}/${jobSkills.length || 0}`,
    locationAligned,
  };
}
