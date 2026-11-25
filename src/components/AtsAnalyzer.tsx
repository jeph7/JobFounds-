import { useEffect, useState } from 'react';
import { FileCheck2, Loader2 } from 'lucide-react';
import { AtsReport, CvDocument, JobListing, Lang } from '../types';
import { analyzeAtsResume } from '../utils/api';
import { serializeCvToPlainText } from '../utils/exportCv';
import { JfProgressBar } from './ui';

interface AtsAnalyzerProps {
  lang: Lang;
  cvVersions: CvDocument[];
  jobs: JobListing[];
  prefillJob: JobListing | null;
}

export function AtsAnalyzer({ lang, cvVersions, jobs, prefillJob }: AtsAnalyzerProps) {
  const [selectedCvId, setSelectedCvId] = useState(cvVersions[0]?.id ?? '');
  const [cvText, setCvText] = useState(
    cvVersions[0] ? serializeCvToPlainText(cvVersions[0]) : ''
  );
  const [jobDescription, setJobDescription] = useState(
    prefillJob
      ? `${prefillJob.title} — ${prefillJob.company}\n${prefillJob.description}\nCompétences: ${prefillJob.skills.join(', ')}\nLangues: ${prefillJob.languages.join(', ')}\nDiplôme: ${prefillJob.degreeRequired}`
      : jobs[0]
        ? `${jobs[0].title} — ${jobs[0].company}\n${jobs[0].description}\nCompétences: ${jobs[0].skills.join(', ')}\nLangues: ${jobs[0].languages.join(', ')}\nDiplôme: ${jobs[0].degreeRequired}`
        : ''
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AtsReport | null>(null);

  useEffect(() => {
    if (prefillJob) {
      setJobDescription(
        `${prefillJob.title} — ${prefillJob.company}\n${prefillJob.description}\nCompétences: ${prefillJob.skills.join(', ')}\nLangues: ${prefillJob.languages.join(', ')}\nDiplôme: ${prefillJob.degreeRequired}`
      );
    }
  }, [prefillJob]);

  const handleLoadCvVersion = (id: string) => {
    setSelectedCvId(id);
    const found = cvVersions.find((v) => v.id === id);
    if (found) setCvText(serializeCvToPlainText(found));
  };

  const handleLoadJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    setJobDescription(
      `${job.title} — ${job.company} (${job.city}, ${job.country})\n${job.description}\nCompétences: ${job.skills.join(', ')}\nLangues: ${job.languages.join(', ')}\nDiplôme: ${job.degreeRequired}`
    );
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeAtsResume({ cvText, jobDescription, lang });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ATS analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold text-slate-900">
            {lang === 'fr' ? 'Analyseur de CV ATS (Applicant Tracking System)' : 'ATS Resume Analyzer'}
          </h1>
          <p className="text-sm text-slate-600">
            {lang === 'fr'
              ? 'Auditez vos mots-clés, compétences, structure et informations manquantes face à une offre réelle avant de postuler.'
              : 'Audit keyword coverage, skill alignment, document structure, and missing data against any real job posting.'}
          </p>
        </div>

        <form onSubmit={handleAnalyze} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  {lang === 'fr' ? 'Contenu du CV à analyser' : 'Resume Content'}
                </label>
                <select
                  value={selectedCvId}
                  onChange={(e) => handleLoadCvVersion(e.target.value)}
                  className="text-xs px-2.5 py-1 border border-slate-200 rounded-md bg-white text-slate-700"
                >
                  {cvVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.versionName}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={8}
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
                className="w-full p-3 text-xs font-mono leading-relaxed border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  {lang === 'fr' ? 'Offre d’emploi cible' : 'Target Job Description'}
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => handleLoadJob(e.target.value)}
                  className="text-xs px-2.5 py-1 border border-slate-200 rounded-md bg-white text-slate-700 max-w-xs"
                >
                  <option value="">
                    {lang === 'fr' ? 'Charger une offre du moteur…' : 'Load from job search…'}
                  </option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.company} — {j.title}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={8}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder={
                  lang === 'fr'
                    ? 'Collez la description complète du poste…'
                    : 'Paste the full job description…'
                }
                className="w-full p-3 text-xs leading-relaxed border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !cvText.trim() || !jobDescription.trim()}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
              <span>{lang === 'fr' ? 'Analyser la compatibilité ATS' : 'Run ATS Audit'}</span>
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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-16 bg-slate-100 rounded" />
            ))}
          </div>
          <div className="h-24 bg-slate-100 rounded" />
        </div>
      )}

      {report && !loading && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-8">
          {/* Top 5 Tabular Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 pb-6 border-b border-slate-200">
            {[
              {
                label: lang === 'fr' ? 'Score ATS global' : 'Overall ATS Score',
                val: report.overallScore,
                primary: true,
              },
              {
                label: lang === 'fr' ? 'Mots-clés' : 'Keywords',
                val: report.keywordMatchScore,
              },
              {
                label: lang === 'fr' ? 'Compétences' : 'Skills',
                val: report.skillsScore,
              },
              {
                label: lang === 'fr' ? 'Structure CV' : 'Structure',
                val: report.structureScore,
              },
              {
                label: lang === 'fr' ? 'Alignement Exp.' : 'Experience Fit',
                val: report.experienceAlignmentScore,
              },
            ].map((m) => (
              <div key={m.label} className="space-y-1.5">
                <div className="text-xs text-slate-500">{m.label}</div>
                <div
                  className={`font-mono text-2xl font-semibold tabular-nums ${
                    m.primary ? 'text-jf-blue' : 'text-jf-navy'
                  }`}
                >
                  {m.val}
                  <span className="text-sm text-slate-400">/100</span>
                </div>
                <JfProgressBar value={m.val} emphasis={m.primary ? 'primary' : 'secondary'} />
              </div>
            ))}
          </div>

          {/* Keywords & Skills Matrix (Zero-pill clean editorial layout) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-6 border-b border-slate-200">
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-jf-blue mb-1.5">
                  {lang === 'fr' ? 'Mots-clés détectés' : 'Matched Keywords'}
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {report.matchedKeywords.length > 0 ? report.matchedKeywords.join(' · ') : '—'}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-jf-blue mb-1.5">
                  {lang === 'fr' ? 'Compétences alignées' : 'Matched Skills'}
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {report.matchedSkills.length > 0 ? report.matchedSkills.join(' · ') : '—'}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-jf-dark mb-1.5">
                  {lang === 'fr' ? 'Mots-clés absents de votre CV' : 'Missing Keywords'}
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {report.missingKeywords.length > 0 ? report.missingKeywords.join(' · ') : '—'}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-jf-dark mb-1.5">
                  {lang === 'fr' ? 'Compétences manquantes ou non explicitées' : 'Missing / Unstated Skills'}
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {report.missingSkills.length > 0 ? report.missingSkills.join(' · ') : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Structure Audit Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Évaluation de la structure ATS' : 'ATS Structure Evaluation'}
            </h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-4 font-medium">{lang === 'fr' ? 'Section' : 'Section'}</th>
                    <th className="py-2.5 px-4 font-medium">{lang === 'fr' ? 'Évaluation' : 'Status'}</th>
                    <th className="py-2.5 px-4 font-medium">{lang === 'fr' ? 'Analyse' : 'Feedback'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {report.structureAudit.map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {row.section}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {row.status}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{row.feedback}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Missing Info + Prioritized Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            <div className="lg:col-span-5 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Informations manquantes détectées' : 'Missing Information'}
              </h3>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {report.missingInformation.length > 0 ? (
                  report.missingInformation.map((item, i) => <li key={i}>• {item}</li>)
                ) : (
                  <li className="text-jf-blue font-medium">
                    {lang === 'fr'
                      ? 'Aucune information critique manquante.'
                      : 'No critical information missing.'}
                  </li>
                )}
              </ul>
            </div>

            <div className="lg:col-span-7 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Recommandations d’amélioration' : 'Actionable Recommendations'}
              </h3>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {report.recommendations.map((rec, i) => (
                  <div key={i} className="p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-blue-700">{rec.priority}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-semibold text-slate-900">{rec.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{rec.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed Report */}
          <div className="pt-6 border-t border-slate-200 space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'fr' ? 'Rapport détaillé' : 'Detailed Executive Report'}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {report.detailedReport}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
