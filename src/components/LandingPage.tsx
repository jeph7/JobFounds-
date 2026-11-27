import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  FileCheck2,
  FileText,
  Globe,
  Menu,
  MessageSquareText,
  Radar,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AccountRole, Lang, WorkspaceTab } from '../types';
import { pickLang, SUPPORTED_LANGUAGES } from '../i18n';
import { BrandLogo } from './ui';
import {
  CvStudioDemo,
  DecisionMakerInboxDemo,
  HiddenMarketShowcase,
  InterviewCoachDemo,
} from './landing/LandingDemos';

export type CareerSubTab = 'tracker' | 'interview' | 'mobility';

interface LandingPageProps {
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  jobsCount: number;
  hiddenCount: number;
  trackedCount: number;
  signedInEmail: string | null;
  onNavigate: (tab: WorkspaceTab, careerSubTab?: CareerSubTab) => void;
  onSelectPersona: (role: AccountRole, targetTab: WorkspaceTab) => void;
  onSignIn: () => void;
  onStartRegister: () => void;
}

type InfoModalKey = 'about' | 'help' | 'terms' | 'contact' | null;

const REVEAL = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
};

export function LandingPage({
  lang,
  onChangeLang,
  jobsCount,
  hiddenCount,
  signedInEmail,
  onNavigate,
  onSignIn,
  onStartRegister,
}: LandingPageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<InfoModalKey>(null);

  const isFr = lang === 'fr';

  const copy = pickLang(lang, {
    fr: {
      navJobs: 'Trouver un emploi',
      navHidden: 'Opportunités cachées',
      navCv: 'CV & ATS',
      navApps: 'Candidatures',
      navInterview: 'Préparation aux entretiens',
      navLogin: 'Se connecter',
      navWorkspace: 'Mon espace',
      navStart: 'Commencer gratuitement',
      heroKicker: 'Votre carrière mérite de meilleures opportunités',
      heroTitle1: 'Ne cherchez plus seulement un emploi.',
      heroTitle2Prefix: 'Découvrez ',
      heroTitle2Highlight: 'les opportunités qui vous attendent.',
      heroSub:
        'JOBFOUNDS utilise l’intelligence artificielle pour rechercher des emplois dans le monde entier, découvrir les opportunités non publiées, identifier les entreprises qui recrutent et vous accompagner jusqu’à votre prochain emploi.',
      heroCtaPrimary: 'Découvrir les opportunités',
      heroCtaSecondary: 'Créer mon profil gratuitement',
      dmKicker: 'Candidatures spontanées & Décideurs',
      dmTitle:
        'Ne laissez pas passer une opportunité simplement parce qu’elle n’a pas été publiée.',
      dmDesc:
        'JOBFOUNDS vous aide à identifier les entreprises pertinentes, découvrir les bons interlocuteurs professionnels et préparer des candidatures spontanées personnalisées.',
      dmCta: 'Accéder aux recruteurs & décideurs',
      cvKicker: 'AI CV Builder & Analyseur ATS',
      cvTitle: 'Un CV professionnel conçu pour attirer l’attention des recruteurs.',
      cvDesc:
        'Créez un CV professionnel avec l’intelligence artificielle, optimisé pour les systèmes ATS et adapté aux exigences de chaque poste.',
      cvCta: 'Créer mon CV avec l’IA',
      cvSecondary: 'Analyser un CV existant (ATS)',
      intKicker: 'AI Interview Coach',
      intTitle: 'Préparez-vous avant le véritable entretien.',
      intDesc:
        'Entraînez-vous avec un recruteur IA qui adapte ses questions au poste visé, analyse vos réponses et vous aide à améliorer vos performances.',
      intCta: 'Commencer une simulation',
      servicesEyebrow: 'Suite complète JOBFOUNDS',
      servicesTitle: 'Chaque étape de votre recherche, réunie dans une plateforme intelligente.',
      servicesSubtitle:
        'Passez de la découverte d’offres mondiales jusqu’à la préparation de l’entretien final sans disperser vos outils.',
      whyTitle: 'Votre recherche d’emploi mérite une intelligence supérieure.',
      whySubtitle:
        'Contrairement aux sites d’annonces classiques qui se contentent d’agréger des offres déjà saturées, JOBFOUNDS agit comme un copilote international de veille, de vérification et de préparation.',
      howTitle: 'Comment ça fonctionne ?',
      howSubtitle: 'Un parcours structuré en quatre étapes claires pour accélérer votre recrutement.',
      finalTitle: 'Votre prochaine opportunité commence ici.',
      finalDesc:
        'Ne vous limitez plus aux annonces que vous trouvez. Découvrez ce que le marché du travail peut réellement vous offrir.',
      finalCta: 'Commencer avec JOBFOUNDS',
    },
    en: {
      navJobs: 'Find a Job',
      navHidden: 'Hidden Opportunities',
      navCv: 'CV & ATS',
      navApps: 'Applications',
      navInterview: 'Interview Prep',
      navLogin: 'Sign in',
      navWorkspace: 'My Workspace',
      navStart: 'Start Free',
      heroKicker: 'Your career deserves better opportunities',
      heroTitle1: 'Stop only searching for jobs.',
      heroTitle2Prefix: 'Discover ',
      heroTitle2Highlight: 'the opportunities waiting for you.',
      heroSub:
        'JOBFOUNDS uses artificial intelligence to search jobs worldwide, uncover unpublished opportunities, identify hiring companies, and guide you all the way to your next role.',
      heroCtaPrimary: 'Discover Opportunities',
      heroCtaSecondary: 'Create My Free Profile',
      dmKicker: 'Spontaneous Outreach & Decision-Makers',
      dmTitle: 'Never miss an opportunity simply because it was never posted publicly.',
      dmDesc:
        'JOBFOUNDS helps you identify relevant companies, find the right hiring contacts, and craft tailored spontaneous applications.',
      dmCta: 'Explore Recruiters & Decision-Makers',
      cvKicker: 'AI CV Builder & ATS Analyzer',
      cvTitle: 'A professional resume engineered to capture recruiter attention.',
      cvDesc:
        'Build an AI-assisted professional CV, optimized for ATS screening systems and tailored to the requirements of every role.',
      cvCta: 'Build My AI CV',
      cvSecondary: 'Audit an Existing CV (ATS)',
      intKicker: 'AI Interview Coach',
      intTitle: 'Prepare before the real interview.',
      intDesc:
        'Practice with an AI interviewer that adapts questions to your target role, scores your answers, and helps sharpen your delivery.',
      intCta: 'Start a Simulation',
      servicesEyebrow: 'Complete JOBFOUNDS Suite',
      servicesTitle: 'Every stage of your global career search in one intelligent platform.',
      servicesSubtitle:
        'Move seamlessly from international job discovery and authenticity verification to tailored applications and interview mastery.',
      whyTitle: 'Your job search deserves superior intelligence.',
      whySubtitle:
        'Unlike passive job boards recycling crowded listings, JOBFOUNDS combines live global feeds, proactive signal detection, verification, and AI preparation.',
      howTitle: 'How it works',
      howSubtitle: 'Four structured steps from profile setup to job offer.',
      finalTitle: 'Your next opportunity starts here.',
      finalDesc:
        'Stop limiting yourself to the listings you happen to see. Discover what the global job market can truly offer you.',
      finalCta: 'Get Started with JOBFOUNDS',
    },
    es: {
      navJobs: 'Buscar empleo',
      navHidden: 'Oportunidades ocultas',
      navCv: 'CV y ATS',
      navApps: 'Candidaturas',
      navInterview: 'Entrevistas',
      navLogin: 'Iniciar sesión',
      navWorkspace: 'Mi espacio',
      navStart: 'Empezar gratis',
      heroKicker: 'Tu carrera merece mejores oportunidades',
      heroTitle1: 'No busques solo un empleo.',
      heroTitle2Prefix: 'Descubre ',
      heroTitle2Highlight: 'las oportunidades que te esperan.',
      heroSub:
        'JOBFOUNDS utiliza inteligencia artificial para buscar empleos en todo el mundo, descubrir oportunidades no publicadas, identificar empresas que contratan y acompañarte hasta tu próximo puesto.',
      heroCtaPrimary: 'Descubrir oportunidades',
      heroCtaSecondary: 'Crear mi perfil gratis',
      dmKicker: 'Candidaturas espontáneas y decisores',
      dmTitle: 'No dejes pasar una oportunidad solo porque no fue publicada.',
      dmDesc:
        'JOBFOUNDS te ayuda a identificar empresas relevantes, encontrar a los interlocutores adecuados y preparar candidaturas espontáneas personalizadas.',
      dmCta: 'Explorar reclutadores',
      cvKicker: 'AI CV Builder y Analizador ATS',
      cvTitle: 'Un CV profesional diseñado para captar la atención de los reclutadores.',
      cvDesc:
        'Crea un CV profesional con IA, optimizado para filtros ATS y adaptado a cada oferta.',
      cvCta: 'Crear mi CV con IA',
      cvSecondary: 'Analizar un CV (ATS)',
      intKicker: 'AI Interview Coach',
      intTitle: 'Prepárate antes de la entrevista real.',
      intDesc:
        'Entrena con un entrevistador IA que adapta sus preguntas al puesto, evalúa tus respuestas y te ayuda a mejorar.',
      intCta: 'Comenzar simulación',
      servicesEyebrow: 'Plataforma completa JOBFOUNDS',
      servicesTitle: 'Cada etapa de tu búsqueda en una sola plataforma inteligente.',
      servicesSubtitle: 'Desde el mercado global hasta la entrevista final.',
      whyTitle: 'Tu búsqueda de empleo merece una inteligencia superior.',
      whySubtitle:
        'Más allá de un portal de anuncios clásico: búsqueda global, señales tempranas, IA y verificación de fuentes.',
      howTitle: '¿Cómo funciona?',
      howSubtitle: 'Cuatro pasos simples para avanzar hacia tu próximo puesto.',
      finalTitle: 'Tu próxima oportunidad comienza aquí.',
      finalDesc:
        'No te limites a las ofertas públicas. Descubre todo lo que el mercado laboral puede ofrecerte.',
      finalCta: 'Empezar con JOBFOUNDS',
    },
    de: {
      navJobs: 'Jobs finden',
      navHidden: 'Verdeckte Chancen',
      navCv: 'CV & ATS',
      navApps: 'Bewerbungen',
      navInterview: 'Interview-Training',
      navLogin: 'Anmelden',
      navWorkspace: 'Mein Bereich',
      navStart: 'Kostenlos starten',
      heroKicker: 'Ihre Karriere verdient bessere Chancen',
      heroTitle1: 'Suchen Sie nicht nur nach Stellen.',
      heroTitle2Prefix: 'Entdecken Sie ',
      heroTitle2Highlight: 'die Chancen, die auf Sie warten.',
      heroSub:
        'JOBFOUNDS nutzt künstliche Intelligenz für weltweite Jobsuche, verdeckte Stellenangebote, Unternehmenssignale und persönliche Begleitung bis zum nächsten Karriereschritt.',
      heroCtaPrimary: 'Chancen entdecken',
      heroCtaSecondary: 'Profil kostenlos erstellen',
      dmKicker: 'Initiativbewerbungen & Entscheider',
      dmTitle: 'Verpassen Sie keine Chance, nur weil sie nicht öffentlich ausgeschrieben wurde.',
      dmDesc:
        'JOBFOUNDS hilft Ihnen, relevante Unternehmen und Ansprechpartner zu finden und gezielte Initiativbewerbungen vorzubereiten.',
      dmCta: 'Recruiter & Entscheider entdecken',
      cvKicker: 'AI CV Builder & ATS-Analyse',
      cvTitle: 'Ein professioneller Lebenslauf, der Recruiter überzeugt.',
      cvDesc:
        'Erstellen Sie mit KI einen ATS-optimierten Lebenslauf, exakt angepasst an jede Zielposition.',
      cvCta: 'Lebenslauf mit KI erstellen',
      cvSecondary: 'ATS-Prüfung starten',
      intKicker: 'AI Interview Coach',
      intTitle: 'Trainieren Sie vor dem echten Vorstellungsgespräch.',
      intDesc:
        'Üben Sie mit einem KI-Recruiter, erhalten Sie fundiertes Feedback und steigern Sie Ihre Sicherheit.',
      intCta: 'Simulation starten',
      servicesEyebrow: 'Die komplette JOBFOUNDS Plattform',
      servicesTitle: 'Alle Schritte Ihrer Jobsuche vereint in einem intelligenten System.',
      servicesSubtitle: 'Weltweite Suche, verdeckter Markt, CV-Studio und Interview-Coach.',
      whyTitle: 'Ihre Jobsuche verdient überlegene Intelligenz.',
      whySubtitle:
        'Mehr als eine klassische Stellenbörse: proaktive Marktsignale, KI-Begleitung und transparente Verifizierung.',
      howTitle: 'Wie funktioniert es?',
      howSubtitle: 'In vier klaren Schritten zur nächsten Position.',
      finalTitle: 'Ihre nächste Chance beginnt hier.',
      finalDesc:
        'Beschränken Sie sich nicht auf sichtbare Anzeigen. Entdecken Sie den gesamten Arbeitsmarkt.',
      finalCta: 'Mit JOBFOUNDS starten',
    },
    pt: {
      navJobs: 'Encontrar vagas',
      navHidden: 'Vagas ocultas',
      navCv: 'CV e ATS',
      navApps: 'Candidaturas',
      navInterview: 'Entrevistas',
      navLogin: 'Entrar',
      navWorkspace: 'Meu espaço',
      navStart: 'Começar grátis',
      heroKicker: 'Sua carreira merece oportunidades melhores',
      heroTitle1: 'Não procure apenas um emprego.',
      heroTitle2Prefix: 'Descubra ',
      heroTitle2Highlight: 'as oportunidades que esperam por você.',
      heroSub:
        'JOBFOUNDS usa inteligência artificial para buscar vagas no mundo todo, revelar oportunidades não publicadas, identificar empresas contratando e acompanhar você até sua próxima vaga.',
      heroCtaPrimary: 'Descobrir oportunidades',
      heroCtaSecondary: 'Criar meu perfil grátis',
      dmKicker: 'Candidaturas espontâneas e decisores',
      dmTitle: 'Não perca uma oportunidade apenas porque ela não foi publicada.',
      dmDesc:
        'JOBFOUNDS ajuda você a encontrar empresas relevantes, identificar contatos profissionais e preparar abordagens personalizadas.',
      dmCta: 'Explorar recrutadores',
      cvKicker: 'AI CV Builder e Analisador ATS',
      cvTitle: 'Um currículo profissional feito para chamar a atenção dos recrutadores.',
      cvDesc:
        'Crie um currículo com IA otimizado para sistemas ATS e adaptado a cada vaga.',
      cvCta: 'Criar meu CV com IA',
      cvSecondary: 'Analisar CV existente (ATS)',
      intKicker: 'AI Interview Coach',
      intTitle: 'Prepare-se antes da entrevista real.',
      intDesc:
        'Treine com um entrevistador IA que adapta perguntas à vaga e avalia suas respostas em tempo real.',
      intCta: 'Iniciar simulação',
      servicesEyebrow: 'Plataforma completa JOBFOUNDS',
      servicesTitle: 'Cada etapa da sua busca em uma única plataforma inteligente.',
      servicesSubtitle: 'Da descoberta global até a aprovação na entrevista.',
      whyTitle: 'Sua busca de emprego merece inteligência superior.',
      whySubtitle:
        'Muito além de um mural de vagas: alcance internacional, sinais proativos, IA e transparência.',
      howTitle: 'Como funciona?',
      howSubtitle: 'Quatro etapas simples para acelerar sua carreira.',
      finalTitle: 'Sua próxima oportunidade começa aqui.',
      finalDesc:
        'Não se limite às vagas públicas. Descubra o que o mercado de trabalho realmente oferece.',
      finalCta: 'Começar com JOBFOUNDS',
    },
    ar: {
      navJobs: 'البحث عن وظيفة',
      navHidden: 'الفرص المخفية',
      navCv: 'السيرة و ATS',
      navApps: 'التقديمات',
      navInterview: 'التحضير للمقابلات',
      navLogin: 'تسجيل الدخول',
      navWorkspace: 'مساحة عملي',
      navStart: 'ابدأ مجاناً',
      heroKicker: 'مسيرتك المهنية تستحق فرصاً أفضل',
      heroTitle1: 'لا تبحث فقط عن وظيفة.',
      heroTitle2Prefix: 'اكتشف ',
      heroTitle2Highlight: 'الفرص التي تنتظرك.',
      heroSub:
        'تستخدم منصة JOBFOUNDS الذكاء الاصطناعي للبحث عن الوظائف حول العالم، واكتشاف الفرص غير المعلنة، وتحديد الشركات التي توظف ومرافقتك حتى وظيفتك القادمة.',
      heroCtaPrimary: 'اكتشف الفرص',
      heroCtaSecondary: 'أنشئ ملفك مجاناً',
      dmKicker: 'التواصل المباشر مع صناع القرار',
      dmTitle: 'لا تفوّت فرصة لمجرد أنها لم تُنشر علناً.',
      dmDesc:
        'تساعدك JOBFOUNDS على تحديد الشركات المناسبة، والوصول إلى جهات التوظيف، وإعداد طلبات تقديم مخصصة.',
      dmCta: 'استكشاف المجندين',
      cvKicker: 'منشئ السيرة الذاتية ومحلل ATS',
      cvTitle: 'سيرة ذاتية احترافية مصممة لجذب انتباه مسؤولي التوظيف.',
      cvDesc:
        'أنشئ سيرة ذاتية احترافية بالذكاء الاصطناعي ومتوافقة مع أنظمة ATS ومخصصة لكل وظيفة.',
      cvCta: 'أنشئ سيرتي بالذكاء الاصطناعي',
      cvSecondary: 'فحص سيرة حالية (ATS)',
      intKicker: 'مدرب المقابلات بالذكاء الاصطناعي',
      intTitle: 'تدرّب قبل المقابلة الحقيقية.',
      intDesc:
        'تدرّب مع محاور ذكي يكيّف الأسئلة حسب الوظيفة ويقيّم إجاباتك لتعزيز أدائك.',
      intCta: 'بدء محاكاة مقابلة',
      servicesEyebrow: 'منظومة JOBFOUNDS الكاملة',
      servicesTitle: 'كل مراحل بحثك الوظيفي في منصة ذكية واحدة.',
      servicesSubtitle: 'من البحث العالمي والتحقق حتى التدريب على المقابلات.',
      whyTitle: 'بحثك عن عمل يستحق ذكاءً أعلى.',
      whySubtitle: 'بحث عالمي، اكتشاف استباقي، ذكاء اصطناعي وشفافية كاملة في التحقق من المصادر.',
      howTitle: 'كيف تعمل المنصة؟',
      howSubtitle: 'أربع خطوات واضحة نحو فرصتك القادمة.',
      finalTitle: 'فرصتك القادمة تبدأ هنا.',
      finalDesc: 'لا تكتفِ بالإعلانات المنشورة فقط. اكتشف ما يقدمه سوق العمل العالمي فعلياً.',
      finalCta: 'ابدأ مع JOBFOUNDS',
    },
  });

  const navLinks: Array<{
    label: string;
    tab: WorkspaceTab;
    subTab?: CareerSubTab;
  }> = [
    { label: copy.navJobs, tab: 'jobs' },
    { label: copy.navHidden, tab: 'hidden' },
    { label: copy.navCv, tab: 'cv' },
    { label: copy.navApps, tab: 'career', subTab: 'tracker' },
    { label: copy.navInterview, tab: 'career', subTab: 'interview' },
  ];

  const cvFeatures = isFr
    ? [
        'Création de CV avec IA',
        'Importation de CV existant (PDF & .docx)',
        'Analyse ATS détaillée',
        'Détection des compétences manquantes',
        'Optimisation par rapport à une offre',
        'Génération de lettres de motivation',
        'Exportation professionnelle (PDF & Word .docx)',
      ]
    : [
        'AI-assisted resume creation',
        'Import existing PDF & Word (.docx) CVs',
        'Full ATS compatibility audit',
        'Missing skills & keyword gap detection',
        'Role-by-role resume tailoring',
        'Targeted cover letter generation',
        'Professional PDF & native .docx export',
      ];

  const serviceCards: Array<{
    key: string;
    eyebrow: string;
    title: string;
    desc: string;
    cta: string;
    featured?: boolean;
    icon: typeof Globe;
    previewLines: string[];
    action: () => void;
  }> = [
    {
      key: 'discovery',
      eyebrow: 'JOB DISCOVERY',
      title: isFr
        ? 'Découvrez des emplois dans le monde entier.'
        : 'Discover jobs across the globe.',
      desc: isFr
        ? 'Recherche internationale, 16 filtres avancés, emplois à distance et flux API directs (Arbeitnow, Remotive, The Muse).'
        : 'International search, 16 advanced filters, remote roles, and direct live API feeds.',
      cta: isFr ? 'Explorer les offres' : 'Explore jobs',
      icon: Globe,
      previewLines: [
        isFr ? '16 filtres · Pays, salaire, visa, mode' : '16 filters · Country, salary, visa',
        isFr ? 'Flux API en direct + Recherche IA' : 'Live API feeds + AI Web Search',
      ],
      action: () => onNavigate('jobs'),
    },
    {
      key: 'hidden',
      eyebrow: 'HIDDEN OPPORTUNITIES',
      title: isFr
        ? 'Découvrez les entreprises qui pourraient recruter.'
        : 'Uncover companies likely to hire.',
      desc: isFr
        ? 'Identification des signaux de recrutement, expansions, levées de fonds et opportunités non publiées avec transparence.'
        : 'Hiring signal detection, expansion tracking, and unpublished opportunities with full verification clarity.',
      cta: isFr ? 'Ouvrir le radar caché' : 'Open hidden radar',
      featured: true,
      icon: Radar,
      previewLines: [
        isFr ? 'Classification stricte en 4 niveaux' : 'Strict 4-tier transparency classification',
        isFr ? 'Candidatures spontanées assistées' : 'Guided spontaneous outreach',
      ],
      action: () => onNavigate('hidden'),
    },
    {
      key: 'cv',
      eyebrow: 'AI CV BUILDER',
      title: isFr
        ? 'Construisez un CV qui correspond aux exigences des recruteurs.'
        : 'Build a CV aligned with recruiter expectations.',
      desc: isFr
        ? 'Création, importation PDF/DOCX, optimisation fidèle aux faits et analyse ATS par offre.'
        : 'Creation, PDF/DOCX import, factual tailoring, and per-offer ATS scoring.',
      cta: isFr ? 'Créer mon CV' : 'Build my CV',
      icon: FileText,
      previewLines: [
        isFr ? '3 modèles pro · Export PDF & .docx' : '3 executive templates · PDF & .docx',
        isFr ? 'Détection des mots-clés manquants' : 'Missing keyword detection',
      ],
      action: () => onNavigate('cv'),
    },
    {
      key: 'applications',
      eyebrow: 'SMART APPLICATIONS',
      title: isFr
        ? 'Préparez et gérez vos candidatures intelligemment.'
        : 'Prepare and track applications intelligently.',
      desc: isFr
        ? 'Personnalisation des candidatures, suivi du pipeline par étape et rappels de relance sous contrôle total du candidat.'
        : 'Tailored outreach, visual pipeline stages, and follow-up reminders always under your approval.',
      cta: isFr ? 'Gérer mes candidatures' : 'Open tracker',
      icon: Briefcase,
      previewLines: [
        isFr ? 'Pipeline visuel & graphiques de suivi' : 'Visual pipeline & progress charts',
        isFr ? 'Validation humaine systématique' : 'Candidate-approved workflow',
      ],
      action: () => onNavigate('career', 'tracker'),
    },
    {
      key: 'intel',
      eyebrow: 'COMPANY INTELLIGENCE',
      title: isFr
        ? 'Apprenez à connaître les entreprises avant de postuler.'
        : 'Know companies deeply before applying.',
      desc: isFr
        ? 'Fiches entreprises détaillées, vérification d’authenticité des offres en 10 points, salaires et visas.'
        : 'Company intelligence briefs, 10-point offer verification, compensation bands, and visa guidance.',
      cta: isFr ? 'Vérifier une entreprise' : 'Verify a company',
      icon: ShieldCheck,
      previewLines: [
        isFr ? 'Audit d’authenticité & anti-arnaques' : 'Authenticity & scam-risk audit',
        isFr ? 'Veille stratégique & alertes' : 'Strategic watchlist & alerts',
      ],
      action: () => onNavigate('verify'),
    },
    {
      key: 'interview',
      eyebrow: 'INTERVIEW COACH',
      title: isFr ? 'Soyez prêt avant votre entretien.' : 'Be ready before your interview.',
      desc: isFr
        ? 'Simulations interactives adaptées au poste, notation STAR en temps réel et dossiers de préparation.'
        : 'Interactive role-specific simulations, live STAR scoring, and structured prep briefs.',
      cta: isFr ? 'Lancer une simulation' : 'Start simulation',
      icon: MessageSquareText,
      previewLines: [
        isFr ? 'Score clarté · STAR · Pertinence' : 'Clarity · STAR · Relevance scoring',
        isFr ? 'Débriefing complet après simulation' : 'Actionable post-session debrief',
      ],
      action: () => onNavigate('career', 'interview'),
    },
  ];

  const whyPillars = [
    {
      num: '01',
      title: isFr ? 'Recherche internationale' : 'International Reach',
      desc: isFr
        ? 'Des opportunités dans différents pays et secteurs, réunissant des flux d’offres API directs et la recherche web IA.'
        : 'Opportunities across countries and industries, combining direct public job feeds and AI web search.',
    },
    {
      num: '02',
      title: isFr ? 'Découverte proactive' : 'Proactive Discovery',
      desc: isFr
        ? 'Recherche simultanée d’offres officiellement publiées et de signaux de croissance annonçant des besoins avant publication.'
        : 'Discover both confirmed postings and early expansion signals before roles saturate public boards.',
    },
    {
      num: '03',
      title: isFr ? 'Intelligence artificielle' : 'Targeted AI Coaching',
      desc: isFr
        ? 'Accompagnement personnalisé sur le CV, l’analyse ATS, la compatibilité en 9 critères et l’entraînement aux entretiens.'
        : 'Personalized guidance across resume tailoring, ATS analysis, 9-dimension matching, and interview coaching.',
    },
    {
      num: '04',
      title: isFr ? 'Protection & Transparence' : 'Protection & Transparency',
      desc: isFr
        ? 'Clarté totale sur la source de chaque offre, le niveau de vérification d’authenticité et les signaux de risque potentiels.'
        : 'Full transparency on every listing source, authenticity status, and potential scam or risk indicators.',
    },
  ];

  const howSteps = [
    {
      step: '01',
      title: isFr ? 'Créez votre profil professionnel' : 'Create your professional profile',
      desc: isFr
        ? 'Renseignez votre parcours, vos compétences, vos langues et vos pays cibles — ou importez directement votre CV.'
        : 'Set your experience, skills, languages, and target regions — or import an existing PDF/DOCX CV.',
    },
    {
      step: '02',
      title: isFr
        ? 'Laissez JOBFOUNDS rechercher les opportunités adaptées'
        : 'Let JOBFOUNDS surface matching opportunities',
      desc: isFr
        ? 'Explorez les offres internationales vérifiées et les entreprises qui affichent des signaux de recrutement.'
        : 'Review verified international openings alongside companies showing early hiring signals.',
    },
    {
      step: '03',
      title: isFr
        ? 'Préparez vos candidatures avec l’intelligence artificielle'
        : 'Prepare tailored applications with AI',
      desc: isFr
        ? 'Adaptez votre CV au poste, vérifiez votre score ATS et rédigez une prise de contact sur mesure.'
        : 'Tailor your CV per role, audit ATS alignment, and draft targeted outreach messages.',
    },
    {
      step: '04',
      title: isFr
        ? 'Suivez vos candidatures et préparez vos entretiens'
        : 'Track applications and master interviews',
      desc: isFr
        ? 'Pilotez vos relances, comparez les salaires et visas, et entraînez-vous avec le simulateur d’entretien IA.'
        : 'Manage follow-ups, benchmark salaries and visas, and practice with the AI Interview Coach.',
    },
  ];

  const infoModalContent: Record<
    Exclude<InfoModalKey, null>,
    { title: string; body: string; actionLabel: string; onAction: () => void }
  > = {
    about: {
      title: isFr ? 'À propos de JOBFOUNDS' : 'About JOBFOUNDS',
      body: isFr
        ? 'JOBFOUNDS (Powered by VADIVAN) est une plateforme internationale d’intelligence carrière et recrutement assistée par l’intelligence artificielle. Elle réunit recherche mondiale d’emplois, détection transparente d’opportunités cachées, vérification d’offres, création de CV ATS, suivi de candidatures et simulateur d’entretien.'
        : 'JOBFOUNDS (Powered by VADIVAN) is a global AI career and recruitment intelligence platform combining international job discovery, transparent hidden opportunity detection, offer verification, AI CV/ATS tools, and interview coaching.',
      actionLabel: isFr ? 'Explorer la plateforme' : 'Explore Platform',
      onAction: () => {
        setInfoModal(null);
        onNavigate('jobs');
      },
    },
    help: {
      title: isFr ? 'Centre d’aide JOBFOUNDS' : 'JOBFOUNDS Help Center',
      body: isFr
        ? 'Vous pouvez utiliser JOBFOUNDS immédiatement en session locale ou synchroniser vos CV, candidatures et alertes sur tous vos appareils via Google. Chaque module distingue clairement les offres publiées des signaux potentiels à vérifier.'
        : 'You can explore JOBFOUNDS immediately in local mode or sign in with Google to sync CVs, tracked applications, and alerts across devices. Every module distinguishes verified listings from potential signals.',
      actionLabel: isFr ? 'Gérer mon compte & RGPD' : 'Open Account & Privacy',
      onAction: () => {
        setInfoModal(null);
        onNavigate('account');
      },
    },
    terms: {
      title: isFr ? 'Conditions d’utilisation' : 'Terms of Use',
      body: isFr
        ? 'JOBFOUNDS fournit des outils d’aide à la recherche, à la vérification d’offres et à la préparation de candidatures. Les informations sur les salaires, visas et signaux de recrutement sont fournies à titre indicatif et doivent être confirmées auprès des employeurs ou autorités compétentes. Vos données restent votre propriété intégrale et sont exportables ou supprimables à tout moment.'
        : 'JOBFOUNDS provides career research, offer verification, and application preparation tools. Salary, visa, and hiring signal insights are informational and should be confirmed directly with employers or official authorities. You retain full ownership of your data.',
      actionLabel: isFr ? 'Voir mes droits RGPD' : 'Review GDPR Rights',
      onAction: () => {
        setInfoModal(null);
        onNavigate('account');
      },
    },
    contact: {
      title: isFr ? 'Contacter l’équipe JOBFOUNDS' : 'Contact JOBFOUNDS',
      body: isFr
        ? 'Recruteurs, entreprises ou candidats : accédez directement au portail Recruteurs & Messagerie pour publier une offre ou échanger de façon sécurisée sur la plateforme, ou gérez vos paramètres de compte.'
        : 'Employers, recruiters, and candidates can access the Recruiters & Messaging portal directly to publish verified postings or communicate securely on the platform.',
      actionLabel: isFr ? 'Ouvrir Recruteurs & Messagerie' : 'Open Recruiters & Messaging',
      onAction: () => {
        setInfoModal(null);
        onNavigate('recruiters');
      },
    },
  };

  return (
    <div className="min-h-screen bg-white text-jf-navy flex flex-col overflow-x-clip">
      {/* 1. STICKY WHITE COMMERCIAL NAVBAR */}
      <header className="sticky top-0 z-40 h-16 sm:h-[72px] bg-white/95 backdrop-blur-md border-b border-jf-border">
        <div className="max-w-[1280px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
          {/* Left: Official Untouched JOBFOUNDS Logo */}
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue rounded"
            aria-label="JOBFOUNDS"
          >
            <BrandLogo size="md" />
          </button>

          {/* Center: 5 Clean Single-Line Nav Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden lg:flex items-center gap-6 xl:gap-7 text-sm font-medium text-jf-dark"
          >
            {navLinks.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate(item.tab, item.subTab)}
                className="hover:text-jf-blue transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-jf-sky"
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right: Login + Primary CTA */}
          <div className="hidden lg:flex items-center gap-4 shrink-0">
            {signedInEmail ? (
              <button
                type="button"
                onClick={() => onNavigate('account')}
                className="text-sm font-medium text-jf-dark hover:text-jf-blue transition-colors whitespace-nowrap"
              >
                {copy.navWorkspace}
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="text-sm font-medium text-jf-dark hover:text-jf-blue transition-colors whitespace-nowrap"
              >
                {copy.navLogin}
              </button>
            )}
            <button
              type="button"
              onClick={() => (signedInEmail ? onNavigate('jobs') : onStartRegister())}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full transition-all shadow-sm hover:shadow-md whitespace-nowrap"
            >
              {copy.navStart}
            </button>
          </div>

          {/* Mobile Hamburger Trigger */}
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden p-2 rounded-lg text-jf-navy hover:bg-jf-ice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue"
          >
            {mobileNavOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="lg:hidden bg-white border-b border-jf-border px-4 py-5 space-y-4 shadow-xl">
            <nav className="flex flex-col space-y-1">
              {navLinks.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    onNavigate(item.tab, item.subTab);
                  }}
                  className="text-left px-3 py-2.5 text-sm font-semibold text-jf-navy hover:bg-jf-ice rounded-lg"
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="pt-3 border-t border-jf-border flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  if (signedInEmail) {
                    onNavigate('account');
                  } else {
                    onSignIn();
                  }
                }}
                className="w-full px-4 py-2.5 text-sm font-semibold text-jf-navy border border-jf-border rounded-full hover:bg-jf-ice"
              >
                {signedInEmail ? copy.navWorkspace : copy.navLogin}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  if (signedInEmail) {
                    onNavigate('jobs');
                  } else {
                    onStartRegister();
                  }
                }}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full"
              >
                {copy.navStart}
              </button>

              <div className="pt-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Language</span>
                <select
                  value={lang}
                  onChange={(e) => onChangeLang(e.target.value as Lang)}
                  aria-label="Language"
                  className="text-xs font-semibold text-jf-navy bg-jf-ice border border-jf-border rounded-lg px-2.5 py-1.5"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} — {l.native}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* 2. HERO SECTION — PREMIÈRE IMPRESSION (Inspired by Reference #1) */}
        <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#F4F8FC]/65 to-[#F4F8FC] pt-14 sm:pt-20 lg:pt-24 pb-16 sm:pb-24">
          {/* Subtle Architectural Soft Sky Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[820px] h-[360px] rounded-full bg-jf-sky/25 blur-3xl"
          />

          <div className="relative max-w-[1040px] mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
            {/* Editorial Top Kicker */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex justify-center"
            >
              <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-white border border-jf-border shadow-xs text-xs sm:text-sm font-semibold text-jf-dark">
                {copy.heroKicker}
              </span>
            </motion.div>

            {/* Monumental Hero Headline with Signature Sky Blue Highlight Brush */}
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="font-display font-extrabold text-jf-navy tracking-tight leading-[1.06] text-[clamp(2.25rem,5.1vw,4.25rem)] max-w-4xl mx-auto"
            >
              <span className="block">{copy.heroTitle1}</span>
              <span className="block mt-2">
                {copy.heroTitle2Prefix}
                <span className="relative inline-block px-1.5">
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-1 sm:bottom-2 h-[42%] bg-jf-sky/75 -z-10 rounded-sm"
                  />
                  <span className="text-jf-navy">{copy.heroTitle2Highlight}</span>
                </span>
              </span>
            </motion.h1>

            {/* Secondary Description */}
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-2xl mx-auto text-base sm:text-lg text-slate-600 leading-relaxed"
            >
              {copy.heroSub}
            </motion.p>

            {/* Primary & Secondary Strategic CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2"
            >
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="group w-full sm:w-auto px-8 py-4 text-sm sm:text-base font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-full shadow-[0_14px_34px_-10px_rgba(40,123,199,0.6)] transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>{copy.heroCtaPrimary}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (signedInEmail) {
                    onNavigate('matching');
                  } else {
                    onStartRegister();
                  }
                }}
                className="w-full sm:w-auto px-8 py-4 text-sm sm:text-base font-semibold text-jf-navy bg-white hover:bg-jf-soft/50 border border-jf-border-strong rounded-full transition-colors whitespace-nowrap"
              >
                {copy.heroCtaSecondary}
              </button>
            </motion.div>

            {/* Real, Verifiable Platform Trust Facts (Zero Invented User Numbers or Fake Reviews) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.55, delay: 0.22 }}
              className="pt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-600"
            >
              <span className="font-medium text-jf-dark">
                {isFr
                  ? 'Sources API en direct (Arbeitnow · Remotive · The Muse)'
                  : 'Live Public APIs (Arbeitnow · Remotive · The Muse)'}
              </span>
              <span aria-hidden="true" className="text-jf-blue">
                ·
              </span>
              <span className="font-medium text-jf-dark">
                {isFr ? 'Vérification d’authenticité en 10 points' : '10-Point Offer Verification'}
              </span>
              <span aria-hidden="true" className="text-jf-blue">
                ·
              </span>
              <span className="font-medium text-jf-dark">
                {isFr ? '6 langues + support RTL' : '6 Languages + Arabic RTL'}
              </span>
              <span aria-hidden="true" className="text-jf-blue">
                ·
              </span>
              <span className="font-mono text-xs tabular-nums text-jf-blue font-semibold">
                {jobsCount} {isFr ? 'offres chargées' : 'listings ready'} · {hiddenCount}{' '}
                {isFr ? 'signaux actifs' : 'active signals'}
              </span>
            </motion.div>
          </div>
        </section>

        {/* 3. SECTION — LE MARCHÉ CACHÉ DE L'EMPLOI (Inspired by Reference #2) */}
        <section className="bg-[#F4F8FC] pb-20 sm:pb-28 pt-4">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8"
          >
            <HiddenMarketShowcase lang={lang} onNavigate={onNavigate} />
          </motion.div>
        </section>

        {/* 4. SECTION — CANDIDATER DIRECTEMENT AUPRÈS DES DÉCIDEURS (Full-Bleed Deep Navy, Reference #3) */}
        <section className="bg-jf-navy text-white py-20 sm:py-28">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center"
          >
            {/* Left: Interactive Professional Inbox Demo */}
            <div className="lg:col-span-6">
              <DecisionMakerInboxDemo lang={lang} />
            </div>

            {/* Right: Headline, Narrative & CTA */}
            <div className="lg:col-span-6 space-y-6">
              <div className="text-xs font-bold tracking-wider uppercase text-jf-sky">
                {copy.dmKicker}
              </div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-white leading-[1.12] tracking-tight">
                {copy.dmTitle}
              </h2>
              <p className="text-base text-jf-soft/90 leading-relaxed">
                {copy.dmDesc}
              </p>

              <ul className="space-y-3.5 pt-2 text-sm text-white/95">
                {(isFr
                  ? [
                      'Identification des bons interlocuteurs RH et décideurs à partir de sources professionnelles publiques.',
                      'Préparation assistée par IA de candidatures spontanées personnalisées, toujours soumises à votre validation.',
                      'Suivi centralisé des prises de contact, relances et invitations aux entretiens.',
                    ]
                  : [
                      'Identify relevant HR leads and hiring managers from verifiable public corporate sources.',
                      'AI-assisted drafting of personalized spontaneous outreach, always reviewed and approved by you.',
                      'Centralized tracking for outreach, follow-up dates, and interview invitations.',
                    ]
                ).map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-jf-dark border border-jf-sky/50 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-jf-sky" />
                    </span>
                    <span className="leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => onNavigate('recruiters')}
                  className="group px-7 py-3.5 text-sm font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-full transition-all shadow-lg inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <span>{copy.dmCta}</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </section>

        {/* 5. SECTION — AI CV BUILDER & ATS (Crisp White Split, Reference #4) */}
        <section className="bg-white py-20 sm:py-28">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center"
          >
            {/* Left: Narrative & 7 Capabilities */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-block">
                <span className="text-xs font-bold tracking-wider uppercase text-jf-navy relative">
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-2 bg-jf-sky/75 -z-10"
                  />
                  {copy.cvKicker}
                </span>
              </div>

              <h2 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-jf-navy leading-[1.12] tracking-tight">
                {copy.cvTitle}
              </h2>
              <p className="text-base text-slate-600 leading-relaxed">{copy.cvDesc}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {cvFeatures.map((feat) => (
                  <div key={feat} className="flex items-start gap-2.5 text-sm text-jf-dark">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-jf-soft flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-jf-blue" />
                    </span>
                    <span className="font-medium leading-snug">{feat}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-3">
                <button
                  type="button"
                  onClick={() => onNavigate('cv')}
                  className="group px-7 py-3.5 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full transition-all shadow-md inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <span>{copy.cvCta}</span>
                  <ArrowRight className="w-4 h-4 text-jf-sky transition-transform group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('ats')}
                  className="text-sm font-semibold text-jf-blue hover:text-jf-navy transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{copy.cvSecondary}</span>
                </button>
              </div>
            </div>

            {/* Right: Interactive Live CV Sheet Mockup */}
            <div className="lg:col-span-6">
              <CvStudioDemo lang={lang} />
            </div>
          </motion.div>
        </section>

        {/* 6. SECTION — AI INTERVIEW COACH (Soft Sky Blue Full-Bleed Band, Reference #5) */}
        <section className="bg-jf-soft/45 border-y border-jf-border py-20 sm:py-28">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center"
          >
            {/* Left: Interactive Progression Chart & Q&A Evaluation Demo */}
            <div className="lg:col-span-6 order-2 lg:order-1">
              <InterviewCoachDemo lang={lang} />
            </div>

            {/* Right: Headline, Benefits & CTA */}
            <div className="lg:col-span-6 order-1 lg:order-2 space-y-6">
              <div className="inline-block">
                <span className="text-xs font-bold tracking-wider uppercase text-jf-navy relative">
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-2 bg-jf-sky -z-10"
                  />
                  {copy.intKicker}
                </span>
              </div>

              <h2 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-jf-navy leading-[1.12] tracking-tight">
                {copy.intTitle}
              </h2>
              <p className="text-base text-jf-dark/85 leading-relaxed">{copy.intDesc}</p>

              <ul className="space-y-3 pt-1 text-sm text-jf-navy">
                {(isFr
                  ? [
                      'Questions ciblées générées selon le poste et l’entreprise que vous visez.',
                      'Évaluation sur 100 (clarté, structure STAR, pertinence) après chaque réponse.',
                      'Conseils concrets d’amélioration et dossier de préparation complet.',
                    ]
                  : [
                      'Targeted questions tailored to your exact role and target company.',
                      '0–100 scoring across clarity, STAR structure, and relevance after every answer.',
                      'Concrete improvement advice plus a downloadable structured prep brief.',
                    ]
                ).map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-white border border-jf-sky flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-jf-blue" />
                    </span>
                    <span className="font-medium leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => onNavigate('career', 'interview')}
                  className="group px-7 py-3.5 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-full transition-all shadow-md inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <span>{copy.intCta}</span>
                  <ArrowRight className="w-4 h-4 text-jf-sky transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </section>

        {/* 7. SECTION — PRÉSENTATION DES 6 SERVICES (Inspired by Reference #6) */}
        <section className="bg-jf-ice py-20 sm:py-28">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <motion.div {...REVEAL} className="text-center max-w-3xl mx-auto space-y-3">
              <div className="text-xs font-bold tracking-wider uppercase text-jf-blue">
                {copy.servicesEyebrow}
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-jf-navy tracking-tight">
                {copy.servicesTitle}
              </h2>
              <p className="text-base text-slate-600 leading-relaxed">{copy.servicesSubtitle}</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              {serviceCards.map((card, index) => {
                const Icon = card.icon;
                const isDark = Boolean(card.featured);
                return (
                  <motion.article
                    key={card.key}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{
                      duration: 0.45,
                      delay: index * 0.05,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className={`rounded-3xl p-7 flex flex-col justify-between gap-6 transition-transform hover:-translate-y-1 ${
                      isDark
                        ? 'bg-jf-navy text-white border border-jf-dark shadow-[0_24px_55px_-20px_rgba(6,19,47,0.45)]'
                        : 'bg-white text-jf-navy border border-jf-border shadow-xs hover:shadow-md'
                    }`}
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[11px] font-bold tracking-wider uppercase ${
                            isDark ? 'text-jf-sky' : 'text-jf-blue'
                          }`}
                        >
                          {card.eyebrow}
                        </span>
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            isDark ? 'bg-jf-dark text-jf-sky' : 'bg-jf-ice text-jf-blue'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                      </div>

                      <h3
                        className={`font-display text-xl font-bold leading-snug ${
                          isDark ? 'text-white' : 'text-jf-navy'
                        }`}
                      >
                        {card.title}
                      </h3>

                      <p
                        className={`text-sm leading-relaxed ${
                          isDark ? 'text-jf-soft/90' : 'text-slate-600'
                        }`}
                      >
                        {card.desc}
                      </p>

                      {/* Crisp Mini Visual Feature Preview */}
                      <div
                        className={`p-3.5 rounded-2xl space-y-2 text-xs ${
                          isDark
                            ? 'bg-jf-dark/80 border border-jf-sky/20 text-jf-soft'
                            : 'bg-jf-ice border border-jf-border text-jf-dark'
                        }`}
                      >
                        {card.previewLines.map((line) => (
                          <div key={line} className="flex items-center gap-2">
                            <Check
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isDark ? 'text-jf-sky' : 'text-jf-blue'
                              }`}
                            />
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={card.action}
                      className={`group w-full py-3 px-4 rounded-full text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 ${
                        isDark
                          ? 'bg-jf-sky hover:bg-white text-jf-navy'
                          : 'bg-white hover:bg-jf-navy text-jf-navy hover:text-white border border-jf-border-strong hover:border-jf-navy'
                      }`}
                    >
                      <span>{card.cta}</span>
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </section>

        {/* 8. SECTION — POURQUOI JOBFOUNDS ? */}
        <section className="bg-white py-20 sm:py-28 border-t border-jf-border">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12"
          >
            <div className="max-w-3xl space-y-3">
              <div className="text-xs font-bold tracking-wider uppercase text-jf-blue">
                {isFr ? 'Pourquoi JOBFOUNDS ?' : 'Why JOBFOUNDS?'}
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-jf-navy tracking-tight">
                {copy.whyTitle}
              </h2>
              <p className="text-base text-slate-600 leading-relaxed">{copy.whySubtitle}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {whyPillars.map((item) => (
                <div
                  key={item.num}
                  className="p-6 rounded-2xl bg-jf-ice/70 border border-jf-border space-y-3"
                >
                  <div className="font-mono text-sm font-bold text-jf-blue tabular-nums">
                    {item.num}
                  </div>
                  <h3 className="font-display text-lg font-bold text-jf-navy">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* 9. SECTION — COMMENT ÇA FONCTIONNE ? (4-Step Visual Progression) */}
        <section className="bg-jf-ice py-20 sm:py-28 border-t border-jf-border">
          <motion.div
            {...REVEAL}
            className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12"
          >
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-jf-navy tracking-tight">
                {copy.howTitle}
              </h2>
              <p className="text-base text-slate-600">{copy.howSubtitle}</p>
            </div>

            <div className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Desktop Horizontal Connector Track */}
              <div
                aria-hidden="true"
                className="hidden lg:block absolute top-8 left-[12%] right-[12%] h-0.5 bg-jf-sky/70"
              />

              {howSteps.map((s) => (
                <div
                  key={s.step}
                  className="relative bg-white border border-jf-border rounded-2xl p-6 space-y-4 shadow-xs"
                >
                  <div className="w-12 h-12 rounded-2xl bg-jf-navy text-jf-sky font-mono text-sm font-bold flex items-center justify-center shadow-sm">
                    {s.step}
                  </div>
                  <h3 className="font-display text-base font-bold text-jf-navy leading-snug">
                    {s.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* 10. SECTION — APPEL À L'ACTION FINAL (Full-Bleed Deep Navy) */}
        <section className="relative overflow-hidden bg-jf-navy text-white py-20 sm:py-28">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[720px] h-[280px] rounded-full bg-jf-blue/25 blur-3xl"
          />
          <motion.div
            {...REVEAL}
            className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6"
          >
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-[1.1]">
              {copy.finalTitle}
            </h2>
            <p className="text-base sm:text-lg text-jf-soft/90 leading-relaxed max-w-2xl mx-auto">
              {copy.finalDesc}
            </p>
            <div className="pt-3 flex justify-center">
              <button
                type="button"
                onClick={() => (signedInEmail ? onNavigate('jobs') : onStartRegister())}
                className="group px-8 py-4 text-sm sm:text-base font-bold text-jf-navy bg-jf-sky hover:bg-white rounded-full shadow-[0_16px_38px_-12px_rgba(169,216,245,0.45)] transition-all inline-flex items-center gap-2.5 whitespace-nowrap"
              >
                <span>{copy.finalCta}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </motion.div>
        </section>
      </main>

      {/* 11. PROFESSIONAL FOOTER */}
      <footer className="bg-jf-navy text-jf-soft border-t border-jf-dark">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 md:grid-cols-12 gap-10">
          {/* Brand Column */}
          <div className="md:col-span-5 space-y-4">
            <div className="inline-flex items-center bg-white rounded-xl px-3.5 py-2">
              <BrandLogo size="md" />
            </div>
            <p className="text-sm text-jf-soft/80 leading-relaxed max-w-sm">
              {isFr
                ? 'Plateforme internationale d’intelligence professionnelle et de recrutement assistée par l’IA : emplois mondiaux, opportunités cachées, CV ATS et préparation aux entretiens.'
                : 'Global AI Career & Recruitment Intelligence Platform: international job search, hidden opportunity discovery, ATS resume studio, and interview preparation.'}
            </p>
            <div className="text-[11px] text-jf-sky/75 font-medium">Powered by VADIVAN</div>
          </div>

          {/* Platform Links */}
          <div className="md:col-span-3 space-y-3">
            <div className="text-xs font-bold tracking-wider uppercase text-jf-sky">
              {isFr ? 'Plateforme' : 'Platform'}
            </div>
            <ul className="space-y-2.5 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('jobs')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Recherche d’emploi' : 'Global Job Search'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('hidden')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Opportunités cachées' : 'Hidden Opportunities'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('cv')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'CV & ATS' : 'CV & ATS'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('recruiters')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Entreprises' : 'Companies & Recruiters'}
                </button>
              </li>
            </ul>
          </div>

          {/* Governance & Support Links */}
          <div className="md:col-span-4 space-y-3">
            <div className="text-xs font-bold tracking-wider uppercase text-jf-sky">
              {isFr ? 'Ressources & Confiance' : 'Resources & Trust'}
            </div>
            <ul className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => setInfoModal('about')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'À propos' : 'About'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setInfoModal('help')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Centre d’aide' : 'Help Center'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('account')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Confidentialité' : 'Privacy (GDPR)'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setInfoModal('terms')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Conditions d’utilisation' : 'Terms of Use'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setInfoModal('contact')}
                  className="text-jf-soft/85 hover:text-white transition-colors"
                >
                  {isFr ? 'Contact' : 'Contact'}
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright & 6-Language Switcher Bar */}
        <div className="border-t border-jf-dark">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-jf-sky/80">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>© {new Date().getFullYear()} JOBFOUNDS</span>
              <span aria-hidden="true">·</span>
              <span>Powered by VADIVAN</span>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="landing-lang-select" className="sr-only">
                Language
              </label>
              <select
                id="landing-lang-select"
                value={lang}
                onChange={(e) => onChangeLang(e.target.value as Lang)}
                className="text-xs font-medium text-white bg-jf-dark border border-jf-sky/25 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-jf-sky"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="bg-jf-navy text-white">
                    {l.label} — {l.native}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </footer>

      {/* Functional Footer Info Modal (About, Help Center, Terms, Contact) */}
      {infoModal && (
        <div
          className="fixed inset-0 z-50 bg-jf-navy/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInfoModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="jf-info-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white border border-jf-border rounded-2xl p-6 sm:p-7 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-jf-border">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-jf-blue" />
                <h3
                  id="jf-info-modal-title"
                  className="font-display text-lg font-bold text-jf-navy"
                >
                  {infoModalContent[infoModal].title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-jf-ice hover:text-jf-navy"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              {infoModalContent[infoModal].body}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="px-4 py-2 text-xs font-semibold text-jf-dark hover:bg-jf-ice rounded-lg"
              >
                {isFr ? 'Fermer' : 'Close'}
              </button>
              <button
                type="button"
                onClick={infoModalContent[infoModal].onAction}
                className="px-4 py-2 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg"
              >
                {infoModalContent[infoModal].actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
