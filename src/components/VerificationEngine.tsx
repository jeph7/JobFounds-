import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { JobListing, Lang, VerificationReport } from '../types';
import { t } from '../i18n';
import { verifyJobOffer } from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';
import { CheckResultText, VerificationStatusText } from './StatusText';

interface VerificationEngineProps {
  lang: Lang;
  prefillJob: JobListing | null;
  jobs: JobListing[];
}

export function VerificationEngine({ lang, prefillJob, jobs }: VerificationEngineProps) {
  const tr = t(lang);

  const [companyName, setCompanyName] = useState(prefillJob?.company ?? '');
  const [jobTitle, setJobTitle] = useState(prefillJob?.title ?? '');
  const [jobUrl, setJobUrl] = useState(prefillJob?.sourceUrl ?? '');
  const [contactEmail, setContactEmail] = useState('');
  const [salaryOffered, setSalaryOffered] = useState(prefillJob?.salaryRange ?? '');
  const [jobText, setJobText] = useState(prefillJob?.description ?? '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);

  useEffect(() => {
    if (prefillJob) {
      setCompanyName(prefillJob.company);
      setJobTitle(prefillJob.title);
      setJobUrl(prefillJob.sourceUrl);
      setSalaryOffered(prefillJob.salaryRange);
      setJobText(prefillJob.description);
      setContactEmail('');
    }
  }, [prefillJob]);

  const loadSuspiciousSample = () => {
    setCompanyName('Global Apex Ventures Logistics Ltd');
    setJobTitle('Remote Data Entry & Payment Coordinator');
    setJobUrl('https://apex-ventures-careers-apply.freehost.example');
    setContactEmail('hr.recruiting.apex2026@gmail.com');
    setSalaryOffered('9 500 EUR / mois (2h par jour, sans expérience)');
    setJobText(
      'Recrutement urgent sans entretien vidéo. Contactez notre responsable RH sur Telegram immédiatement. Une avance de 280 EUR remboursable est demandée pour le matériel informatique et la vérification de passeport.'
    );
  };

  const loadJobSample = (job: JobListing) => {
    setCompanyName(job.company);
    setJobTitle(job.title);
    setJobUrl(job.sourceUrl);
    setSalaryOffered(job.salaryRange);
    setJobText(job.description);
    setContactEmail('');
  };

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await verifyJobOffer({
        companyName,
        jobTitle,
        jobUrl,
        contactEmail,
        salaryOffered,
        jobText,
        lang,
      });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification audit failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="max-w-3xl space-y-1.5">
            <h1 className="font-display text-2xl font-semibold text-slate-900">
              {lang === 'fr'
                ? 'Moteur de vérification et d’authenticité des offres'
                : 'Job Authenticity & Anti-Fraud Verification Engine'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {lang === 'fr'
                ? 'Vérifiez l’existence réelle de l’entreprise, la correspondance du domaine officiel, la cohérence de l’annonce et les signaux d’escroquerie avant de partager vos données.'
                : 'Audit real corporate existence, official domain alignment, listing consistency, expiration, and scam indicators before sharing personal documents.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {jobs[0] && (
              <button
                type="button"
                onClick={() => loadJobSample(jobs[0])}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap"
              >
                {lang === 'fr' ? `Tester : ${jobs[0].company}` : `Test: ${jobs[0].company}`}
              </button>
            )}
            <button
              type="button"
              onClick={loadSuspiciousSample}
              className="px-3 py-1.5 text-xs font-medium text-jf-navy bg-jf-soft hover:bg-jf-sky/70 border border-jf-sky rounded-lg transition-colors whitespace-nowrap"
            >
              {lang === 'fr' ? 'Tester un cas suspect' : 'Load Suspicious Test Case'}
            </button>
          </div>
        </div>

        <form onSubmit={handleAudit} className="space-y-4 pt-2 border-t border-slate-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Nom de l’entreprise' : 'Company Name'}
              </span>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="ex. Qonto, ABB, Celonis…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Intitulé du poste' : 'Job Title'}
              </span>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="ex. Senior Product Manager"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'URL de l’offre ou du site' : 'Offer URL or Website'}
              </span>
              <input
                type="text"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://company.com/careers/..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'E-mail du recruteur (optionnel)' : 'Recruiter Email (optional)'}
              </span>
              <input
                type="text"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="talent@company.com"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Salaire ou promesse affichée' : 'Offered Salary / Terms'}
              </span>
              <input
                type="text"
                value={salaryOffered}
                onChange={(e) => setSalaryOffered(e.target.value)}
                placeholder="ex. 75 000 EUR / an"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">
              {lang === 'fr' ? 'Texte complet de l’annonce ou message reçu' : 'Full Listing Text or Recruiter Message'}
            </span>
            <textarea
              rows={4}
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
              placeholder={
                lang === 'fr'
                  ? 'Collez ici le texte de l’offre, le message WhatsApp/e-mail ou les conditions proposées…'
                  : 'Paste the full offer text, recruiter email, or proposed terms…'
              }
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {lang === 'fr'
                ? 'JOBFOUNDS ne garantit jamais une authenticité lorsque les preuves publiques sont insuffisantes.'
                : 'JOBFOUNDS never guarantees authenticity when public verification evidence is insufficient.'}
            </p>
            <button
              type="submit"
              disabled={loading || (!companyName && !jobUrl && !jobText)}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>{lang === 'fr' ? 'Lancer la vérification en 10 points' : 'Run 10-Point Verification'}</span>
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div role="alert" className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy">
          {error}
        </div>
      )}

      {loading && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4 animate-pulse">
          <div className="h-5 bg-slate-200 rounded w-1/3" />
          <div className="h-4 bg-slate-100 rounded w-2/3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="h-12 bg-slate-100 rounded" />
            ))}
          </div>
        </div>
      )}

      {report && !loading && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          {/* Verdict Summary */}
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pb-6 border-b border-slate-200">
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-3">
                <VerificationStatusText status={report.status} lang={lang} />
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="text-xs text-slate-500">
                  {lang === 'fr' ? 'Domaine officiel' : 'Official domain'}:{' '}
                  <span className="font-mono text-slate-800">{report.officialDomain}</span>
                </span>
              </div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {report.verdictHeadline}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {report.verdictExplanation}
              </p>
              {report.urlInspected && report.liveUrlFindings && (
                <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-700">
                  <span className="font-semibold text-blue-800">
                    {lang === 'fr' ? 'Inspection directe de la page URL : ' : 'Live URL Page Inspection: '}
                  </span>
                  <span>{report.liveUrlFindings}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 text-left md:text-right">
              <div className="text-xs text-slate-500">
                {lang === 'fr' ? 'Indice de confiance' : 'Trust Index'}
              </div>
              <div className="font-mono text-3xl font-semibold tabular-nums text-slate-900">
                {report.trustScore}
                <span className="text-base text-slate-400">/100</span>
              </div>
              {safeExternalUrl(report.officialWebsite) && (
                <a
                  href={safeExternalUrl(report.officialWebsite)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  <span>{lang === 'fr' ? 'Site officiel' : 'Official website'}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {/* 10-Point Audit Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Grille de contrôle d’authenticité' : 'Forensic Verification Matrix'}
            </h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-4 font-medium">
                      {lang === 'fr' ? 'Critère analysé' : 'Verification Criterion'}
                    </th>
                    <th className="py-2.5 px-4 font-medium">
                      {lang === 'fr' ? 'Statut' : 'Result'}
                    </th>
                    <th className="py-2.5 px-4 font-medium">
                      {lang === 'fr' ? 'Observation' : 'Finding'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.checks.map((chk, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {chk.criterion}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <CheckResultText result={chk.result} lang={lang} />
                      </td>
                      <td className="py-3 px-4 text-slate-600">{chk.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Flags & Protective Guidance */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-jf-blue">
                <CheckCircle2 className="w-4 h-4" />
                <span>{lang === 'fr' ? 'Éléments corroborés' : 'Corroborated Signals'}</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                {report.greenFlags.length > 0 ? (
                  report.greenFlags.map((flag, idx) => <li key={idx}>• {flag}</li>)
                ) : (
                  <li className="text-slate-400">
                    {lang === 'fr' ? 'Aucun élément positif confirmé.' : 'No corroborated positive signals.'}
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-jf-navy">
                <ShieldAlert className="w-4 h-4 text-jf-dark" />
                <span>{lang === 'fr' ? 'Signaux d’alerte & zones d’ombre' : 'Risk & Missing Evidence Flags'}</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                {report.redFlags.length > 0 ? (
                  report.redFlags.map((flag, idx) => <li key={idx}>• {flag}</li>)
                ) : (
                  <li className="text-slate-400">
                    {lang === 'fr' ? 'Aucun signal d’escroquerie détecté.' : 'No fraud indicators detected.'}
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-jf-dark">
                <AlertTriangle className="w-4 h-4 text-jf-blue" />
                <span>{lang === 'fr' ? 'Actions recommandées' : 'Recommended Next Steps'}</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                {report.recommendedNextSteps.map((step, idx) => (
                  <li key={idx}>• {step}</li>
                ))}
              </ul>
            </div>
          </div>

          {report.groundingSources && report.groundingSources.length > 0 && (
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{tr.common.groundingSources}:</span>
              {report.groundingSources.slice(0, 6).map((src) => {
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
        </section>
      )}
    </div>
  );
}
