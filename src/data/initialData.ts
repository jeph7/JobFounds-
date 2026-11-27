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

// Zero hardcoded/fictitious candidate profiles, CVs, jobs, hidden opportunities, applications, or watchlist items.
// Every profile and CV is created or imported authentically by the user.
export const initialCandidateProfile: CandidateProfile = {
  fullName: '',
  currentTitle: '',
  yearsExperience: 0,
  highestDegree: '',
  skills: [],
  languages: [],
  preferredCountries: [],
  preferredCities: [],
  minSalaryAnnualUsd: 0,
  salaryCurrency: 'EUR',
  availability: '',
  preferredWorkModes: [],
  preferredContracts: [],
  originCountry: '',
  workAuthorization: '',
  relocationReady: false,
  targetSectors: [],
};

export const initialCvDocuments: CvDocument[] = [];

export const initialJobs: JobListing[] = [];

export const initialHiddenOpportunities: HiddenOpportunity[] = [];

export const initialApplications: TrackedApplication[] = [];

export const initialWatchlist: WatchlistItem[] = [];

export function isLegacyDemoProfile(p: CandidateProfile | null | undefined): boolean {
  if (!p) return false;
  return (
    p.fullName === 'Candidat JOBFOUNDS' &&
    p.currentTitle === 'Senior Full-Stack & Product Engineer' &&
    p.yearsExperience === 6 &&
    p.originCountry === 'France'
  );
}

export function isLegacyDemoCv(cv: CvDocument | null | undefined): boolean {
  if (!cv) return false;
  return (
    cv.id === 'cv-primary-1' &&
    cv.email === 'contact@jobfounds.com' &&
    cv.phone === '+33 6 00 00 00 00'
  );
}

export interface NineCriteriaBreakdown {
  skills: number;
  experience: number;
  education: number;
  languages: number;
  locationAndMobility: number;
  workAuthorization: number;
  availability: number;
  salary: number;
  sourceReliability: number;
}

export function computeBaselineMatch(
  profile: CandidateProfile,
  job: JobListing
): {
  score: number;
  skillsRatio: string;
  locationAligned: boolean;
  breakdown: NineCriteriaBreakdown;
} {
  // 1. Skills
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
  const skills =
    profileSkills.size === 0
      ? 50
      : jobSkills.length > 0
        ? Math.round((matchedSkillsCount / jobSkills.length) * 100)
        : 65;

  // 2. Professional Experience
  const yrs = Number(profile.yearsExperience) || 0;
  const lvl = `${job.experienceLevel || ''} ${job.title || ''}`.toLowerCase();
  const isSenior = /\b(senior|staff|lead|principal|director|head|vp)\b/.test(lvl);
  const isJunior = /\b(junior|entry|intern|stage|graduate)\b/.test(lvl);
  const experience =
    yrs === 0 && !profile.currentTitle
      ? 50
      : isSenior
        ? yrs >= 5
          ? 94
          : yrs >= 3
            ? 74
            : 45
        : isJunior
          ? yrs <= 3
            ? 92
            : 82
          : yrs >= 2
            ? 88
            : 68;

  // 3. Education & Degrees
  const deg = (profile.highestDegree || '').toLowerCase();
  const reqDeg = (job.degreeRequired || '').toLowerCase();
  const education = !deg
    ? 60
    : /\b(phd|doctorat|doctorate)\b/.test(deg)
      ? 96
      : /\b(master|mba|msc|ing[eé]nieur|bac\+5)\b/.test(deg)
        ? 92
        : /\b(bachelor|licence|bac\+3|bac\+4|bsc)\b/.test(deg)
          ? /\b(phd|master)\b/.test(reqDeg)
            ? 72
            : 88
          : 74;

  // 4. Languages
  const profileLangs = new Set(
    (profile.languages || []).map((l) => l.toLowerCase().split(/[\s(]/)[0]).filter(Boolean)
  );
  const jobLangs = (job.languages || [])
    .map((l) => l.toLowerCase().split(/[\s(]/)[0])
    .filter(Boolean);
  const langAligned =
    jobLangs.length === 0 ||
    profileLangs.size === 0 ||
    jobLangs.some((l) => profileLangs.has(l));
  const languages =
    profileLangs.size === 0 ? 60 : langAligned ? 92 : 45;

  // 5. Location, Mobility & Work Mode
  const prefCountries = (profile.preferredCountries || []).map((c) => c.toLowerCase());
  const prefCities = (profile.preferredCities || []).map((c) => c.toLowerCase());
  const jobCountry = (job.country || '').toLowerCase();
  const jobCity = (job.city || '').toLowerCase();
  const locationAligned =
    job.workMode === 'Remote' ||
    prefCountries.length === 0 ||
    prefCountries.some((c) => c && (jobCountry.includes(c) || c.includes(jobCountry))) ||
    prefCities.some((c) => c && (jobCity.includes(c) || c.includes(jobCity)));
  const workModeAligned =
    !profile.preferredWorkModes?.length ||
    profile.preferredWorkModes.includes(job.workMode);
  const locationAndMobility = locationAligned
    ? workModeAligned
      ? 94
      : 78
    : profile.relocationReady
      ? 72
      : 42;

  // 6. Work Authorization & Visa
  const authText = (profile.workAuthorization || '').toLowerCase();
  const visaText = (job.visaSponsorship || '').toLowerCase();
  const workAuthorization =
    job.workMode === 'Remote'
      ? 88
      : !authText
        ? 65
        : /\b(available|yes|oui|sponsorship)\b/.test(visaText) ||
            /\b(citizen|citoyen|permanent|authorized|autoris|permis|eu|ue)\b/.test(authText)
          ? 90
          : 68;

  // 7. Availability
  const avail = (profile.availability || '').toLowerCase();
  const availability = !avail
    ? 70
    : /\b(imm[eé]diat|immediate|asap|now|1 month|1 mois|2 weeks)\b/.test(avail)
      ? 95
      : 78;

  // 8. Salary Expectations
  const salaryAligned =
    !job.salaryMinAnnualUsd ||
    !profile.minSalaryAnnualUsd ||
    job.salaryMinAnnualUsd >= profile.minSalaryAnnualUsd * 0.85;
  const salary =
    !profile.minSalaryAnnualUsd || !job.salaryMinAnnualUsd
      ? 75
      : salaryAligned
        ? 92
        : 52;

  // 9. Source Reliability
  const sourceReliability =
    job.verificationStatus === 'Verified'
      ? 96
      : job.verificationStatus === 'Partially Verified'
        ? 76
        : job.verificationStatus === 'Suspicious' || job.verificationStatus === 'Expired'
          ? 20
          : 52;

  const weighted = Math.round(
    skills * 0.28 +
      experience * 0.16 +
      education * 0.08 +
      languages * 0.09 +
      locationAndMobility * 0.14 +
      workAuthorization * 0.08 +
      availability * 0.05 +
      salary * 0.05 +
      sourceReliability * 0.07
  );

  return {
    score: Math.max(15, Math.min(99, weighted)),
    skillsRatio: `${matchedSkillsCount}/${jobSkills.length || 0}`,
    locationAligned,
    breakdown: {
      skills,
      experience,
      education,
      languages,
      locationAndMobility,
      workAuthorization,
      availability,
      salary,
      sourceReliability,
    },
  };
}
