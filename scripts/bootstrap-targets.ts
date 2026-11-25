import {
  getCompanyById,
  recordCompanySignal,
  upsertCompany,
  upsertHrContact,
} from '../serverEngineDb.ts';
import { monitorCompanyCareerPage } from '../serverCareerMonitor.ts';
import { verifyCorporateDomainMx } from '../serverWorkerEngine.ts';

interface TargetCompanySeed {
  officialName: string;
  officialWebsite: string;
  careersUrl: string;
  country: string;
  location: string;
  sector: string;
  estimatedSize: string;
}

const TARGET_COMPANIES: TargetCompanySeed[] = [
  {
    officialName: 'Stripe',
    officialWebsite: 'https://stripe.com',
    careersUrl: 'https://boards.greenhouse.io/stripe',
    country: 'Ireland / United States',
    location: 'Dublin · San Francisco · Paris · Remote',
    sector: 'FinTech & Payments Infrastructure',
    estimatedSize: '5000+',
  },
  {
    officialName: 'Datadog',
    officialWebsite: 'https://www.datadoghq.com',
    careersUrl: 'https://boards.greenhouse.io/datadog',
    country: 'France / United States',
    location: 'Paris · New York · Madrid · Remote',
    sector: 'Cloud Observability & Security SaaS',
    estimatedSize: '5000+',
  },
  {
    officialName: 'Celonis',
    officialWebsite: 'https://www.celonis.com',
    careersUrl: 'https://boards.greenhouse.io/celonis',
    country: 'Germany',
    location: 'Munich · Madrid · London · New York',
    sector: 'Enterprise AI & Process Intelligence',
    estimatedSize: '1000-5000',
  },
  {
    officialName: 'Adyen',
    officialWebsite: 'https://www.adyen.com',
    careersUrl: 'https://boards.greenhouse.io/adyen',
    country: 'Netherlands',
    location: 'Amsterdam · Paris · London · Singapore',
    sector: 'FinTech & Global Payments',
    estimatedSize: '1000-5000',
  },
  {
    officialName: 'Algolia',
    officialWebsite: 'https://www.algolia.com',
    careersUrl: 'https://boards.greenhouse.io/algolia',
    country: 'France / United States',
    location: 'Paris · London · San Francisco · Remote',
    sector: 'AI Search & Developer SaaS',
    estimatedSize: '500-1000',
  },
  {
    officialName: 'Alan',
    officialWebsite: 'https://alan.com',
    careersUrl: 'https://jobs.ashbyhq.com/alan',
    country: 'France',
    location: 'Paris · Brussels · Madrid · Remote',
    sector: 'InsurTech & Digital Health',
    estimatedSize: '500-1000',
  },
  {
    officialName: 'Linear',
    officialWebsite: 'https://linear.app',
    careersUrl: 'https://jobs.ashbyhq.com/linear',
    country: 'United States / Europe',
    location: 'Remote (Europe & North America)',
    sector: 'Developer Tools & Productivity SaaS',
    estimatedSize: '50-200',
  },
  {
    officialName: 'Spotify',
    officialWebsite: 'https://www.spotify.com',
    careersUrl: 'https://jobs.lever.co/spotify',
    country: 'Sweden / Global',
    location: 'Stockholm · London · New York · Remote',
    sector: 'Audio Streaming & Consumer Tech',
    estimatedSize: '5000+',
  },
];

async function bootstrapAndScan() {
  console.log('=== JOBFOUNDS — Initial Target Companies Registration & Live ATS/DNS Scan ===\n');

  let totalJobsActive = 0;
  let totalAdded = 0;
  let mxVerifiedCount = 0;

  for (const target of TARGET_COMPANIES) {
    const { company, created } = upsertCompany({
      officialName: target.officialName,
      officialWebsite: target.officialWebsite,
      careersUrl: target.careersUrl,
      country: target.country,
      location: target.location,
      sector: target.sector,
      estimatedSize: target.estimatedSize,
      monitored: true,
      monitorIntervalMinutes: Number(process.env.ENGINE_DEFAULT_MONITOR_MINUTES) || 720,
      verificationStatus: 'Partially Verified',
      sourceName: 'Official Corporate ATS Portal',
    });

    const careerResult = await monitorCompanyCareerPage(company.id);
    totalJobsActive += careerResult.activeCount;
    totalAdded += careerResult.addedCount;

    const domain = company.domain || new URL(target.officialWebsite).hostname.replace(/^www\./, '');
    const mx = await verifyCorporateDomainMx(domain);
    if (mx.verified) mxVerifiedCount++;

    // Record official verified recruiting portal channel (zero fabricated personal emails)
    upsertHrContact({
      companyId: company.id,
      fullName: `${target.officialName} Talent Acquisition Portal`,
      roleTitle: 'Official Recruiting & Careers Channel',
      department: 'Talent Acquisition / HR',
      roleCategory: 'hr_talent',
      publicProfileUrl: target.careersUrl,
      publicChannel: `Official ${careerResult.atsProvider.toUpperCase()} Careers Portal`,
      emailDomainVerified: mx.verified,
      mxVerified: mx.verified,
      sourceName: `Official ${careerResult.atsProvider.toUpperCase()} ATS + Live DNS MX`,
      sourceUrl: target.careersUrl,
      confidenceLevel: mx.verified && careerResult.activeCount > 0 ? 'confirmed' : 'probable',
      confidenceScore: mx.verified && careerResult.activeCount > 0 ? 92 : 70,
      verificationNote: mx.verified
        ? `Corporate domain ${domain} verified via live DNS MX (${mx.mxHosts[0]}). Official ATS portal active with ${careerResult.activeCount} open roles.`
        : `Official ATS portal active with ${careerResult.activeCount} open roles.`,
    });

    // Record factual ATS-grounded hiring velocity signal (strictly grounded in real active job count)
    if (careerResult.activeCount >= 20) {
      recordCompanySignal({
        companyId: company.id,
        signalType: 'frequent_hiring',
        classification: 'confirmed_hiring_need',
        title: `${careerResult.activeCount} postes actifs confirmés sur le portail ${careerResult.atsProvider.toUpperCase()}`,
        summary: `Surveillance directe du portail carrières officiel de ${target.officialName} : ${careerResult.activeCount} offres actives détectées${
          careerResult.extractedSkills.length
            ? ` (compétences récurrentes : ${careerResult.extractedSkills.slice(0, 6).join(', ')})`
            : ''
        }.`,
        evidenceQuote: `Official ${careerResult.atsProvider} board returned ${careerResult.activeCount} active postings on ${careerResult.checkedAt.slice(0, 10)}.`,
        skillsInferred: careerResult.extractedSkills.slice(0, 10),
        sourceName: `Official ${careerResult.atsProvider.toUpperCase()} Careers API`,
        sourceUrl: target.careersUrl,
        detectedAt: careerResult.checkedAt,
        reliabilityScore: 96,
        relevanceScore: 90,
      });
    }

    const updated = getCompanyById(company.id);
    console.log(
      `[OK] ${target.officialName.padEnd(10)} | ${created ? 'NEW' : 'UPD'} | ATS: ${careerResult.atsProvider.padEnd(10)} | Active jobs: ${String(careerResult.activeCount).padStart(4)} (+${careerResult.addedCount} added) | MX(${domain}): ${mx.verified ? mx.mxHosts[0] : 'unverified'} | Skills: ${(updated?.frequentSkills || []).slice(0, 4).join(', ')}`
    );
  }

  console.log('\n=== Bootstrap Summary ===');
  console.log(`Companies registered & monitored : ${TARGET_COMPANIES.length} (Greenhouse, Ashby, Lever)`);
  console.log(`Total live official jobs indexed : ${totalJobsActive} (+${totalAdded} newly added)`);
  console.log(`Corporate domains DNS MX verified: ${mxVerifiedCount}/${TARGET_COMPANIES.length}`);
}

bootstrapAndScan().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
