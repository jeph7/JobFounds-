import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  CopyPlus,
  Download,
  FileText,
  FileUp,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CvDocument,
  CvTemplateId,
  JobListing,
  Lang,
} from '../types';
import { t } from '../i18n';
import { importCvFile, optimizeCv } from '../utils/api';
import { exportCvAsPdf, exportCvAsWord } from '../utils/exportCv';

interface CvBuilderProps {
  lang: Lang;
  versions: CvDocument[];
  activeVersionId: string;
  onSelectVersion: (id: string) => void;
  onUpdateVersions: (versions: CvDocument[]) => void;
  targetJobPrefill: JobListing | null;
}

export function CvBuilder({
  lang,
  versions,
  activeVersionId,
  onSelectVersion,
  onUpdateVersions,
  targetJobPrefill,
}: CvBuilderProps) {
  const tr = t(lang);
  const currentCv = versions.find((v) => v.id === activeVersionId) ?? versions[0];

  const [targetJobText, setTargetJobText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [changeLog, setChangeLog] = useState<string[]>([]);
  const [honestGaps, setHonestGaps] = useState<string[]>([]);
  const [coverLetter, setCoverLetter] = useState<{ subject: string; letter: string } | null>(null);
  const [copiedLetter, setCopiedLetter] = useState(false);

  useEffect(() => {
    if (targetJobPrefill) {
      setTargetJobText(
        `${targetJobPrefill.title} — ${targetJobPrefill.company} (${targetJobPrefill.city}, ${targetJobPrefill.country})\n${targetJobPrefill.description}\nSkills: ${targetJobPrefill.skills.join(', ')}`
      );
    }
  }, [targetJobPrefill]);

  const updateCurrent = (updater: (cv: CvDocument) => CvDocument) => {
    const today = new Date().toISOString().slice(0, 10);
    onUpdateVersions(
      versions.map((v) =>
        v.id === currentCv.id ? { ...updater(v), updatedAt: today } : v
      )
    );
  };

  const handleDuplicateVersion = () => {
    const newId = `cv-${Date.now()}`;
    const copyDoc: CvDocument = {
      ...currentCv,
      id: newId,
      versionName: `${currentCv.versionName} (${lang === 'fr' ? 'Copie' : 'Copy'})`,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    onUpdateVersions([...versions, copyDoc]);
    onSelectVersion(newId);
  };

  const handleDeleteVersion = (id: string) => {
    if (versions.length <= 1) return;
    const remaining = versions.filter((v) => v.id !== id);
    onUpdateVersions(remaining);
    if (activeVersionId === id) {
      onSelectVersion(remaining[0].id);
    }
  };

  const handleAiAction = async (action: 'correct' | 'optimize' | 'tailor' | 'cover_letter') => {
    setAiLoading(action);
    setAiError(null);
    try {
      const res = await optimizeCv({
        action,
        cvData: currentCv,
        targetJob: targetJobText,
        lang,
      });

      if (action === 'cover_letter') {
        setCoverLetter({ subject: res.subject, letter: res.letter });
        setHonestGaps(res.honestGapNotes || []);
      } else {
        updateCurrent((cv) => ({
          ...cv,
          headline: res.headline || cv.headline,
          summary: res.summary || cv.summary,
          experiences: Array.isArray(res.experiences) && res.experiences.length > 0 ? res.experiences : cv.experiences,
          skills: Array.isArray(res.skills) && res.skills.length > 0 ? res.skills : cv.skills,
        }));
        setChangeLog(res.changeLog || []);
        setHonestGaps(res.honestGapNotes || []);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI CV operation failed.');
    } finally {
      setAiLoading(null);
    }
  };

  const handleImportParse = async () => {
    if (!importRawText.trim()) return;
    setAiLoading('import_parse');
    setAiError(null);
    try {
      const parsed = await optimizeCv({
        action: 'import_parse',
        rawText: importRawText,
        lang,
      });
      const newId = `cv-import-${Date.now()}`;
      const importedDoc: CvDocument = {
        id: newId,
        versionName:
          lang === 'fr'
            ? `CV Importé — ${new Date().toISOString().slice(0, 10)}`
            : `Imported CV — ${new Date().toISOString().slice(0, 10)}`,
        updatedAt: new Date().toISOString().slice(0, 10),
        template: 'executive',
        fullName: parsed.fullName || currentCv.fullName,
        headline: parsed.headline || '',
        email: parsed.email || '',
        phone: parsed.phone || '',
        location: parsed.location || '',
        linkedin: parsed.linkedin || '',
        summary: parsed.summary || '',
        experiences: Array.isArray(parsed.experiences) ? parsed.experiences : [],
        education: Array.isArray(parsed.education) ? parsed.education : [],
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      };
      onUpdateVersions([...versions, importedDoc]);
      onSelectVersion(newId);
      setImportRawText('');
      setImportOpen(false);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to parse imported CV.');
    } finally {
      setAiLoading(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.toLowerCase().split('.').pop() || '';
    const isBinaryDoc =
      ext === 'pdf' ||
      ext === 'docx' ||
      file.type === 'application/pdf' ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isBinaryDoc) {
      if (file.size > 10 * 1024 * 1024) {
        setAiError(
          lang === 'fr'
            ? 'Le fichier dépasse la limite de 10 Mo.'
            : 'File exceeds the 10 MB upload limit.'
        );
        return;
      }
      setAiLoading('import_file');
      setAiError(null);
      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = typeof reader.result === 'string' ? reader.result : '';
            const idx = raw.indexOf(',');
            resolve(idx >= 0 ? raw.slice(idx + 1) : raw);
          };
          reader.onerror = () => reject(new Error('Failed to read file.'));
          reader.readAsDataURL(file);
        });

        const parsed = await importCvFile({
          fileName: file.name,
          mimeType:
            file.type ||
            (ext === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
          base64Data,
          lang,
        });

        const newId = `cv-file-${Date.now()}`;
        const baseLabel = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
        const importedDoc: CvDocument = {
          id: newId,
          versionName: `${baseLabel} (${ext.toUpperCase()})`,
          updatedAt: new Date().toISOString().slice(0, 10),
          template: 'executive',
          fullName: parsed.fullName || currentCv.fullName,
          headline: parsed.headline || '',
          email: parsed.email || '',
          phone: parsed.phone || '',
          location: parsed.location || '',
          linkedin: parsed.linkedin || '',
          summary: parsed.summary || '',
          experiences: Array.isArray(parsed.experiences) ? parsed.experiences : [],
          education: Array.isArray(parsed.education) ? parsed.education : [],
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
          languages: Array.isArray(parsed.languages) ? parsed.languages : [],
        };
        onUpdateVersions([...versions, importedDoc]);
        onSelectVersion(newId);
        setImportRawText('');
        setImportOpen(false);
      } catch (err) {
        setAiError(
          err instanceof Error
            ? err.message
            : 'Unable to parse PDF or Word (.docx) CV file.'
        );
      } finally {
        setAiLoading(null);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportRawText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const templates: Array<{ id: CvTemplateId; label: string }> = [
    { id: 'executive', label: lang === 'fr' ? 'Exécutif' : 'Executive' },
    { id: 'structured', label: lang === 'fr' ? 'Moderne Structuré' : 'Structured Cobalt' },
    { id: 'international', label: lang === 'fr' ? 'International Sobre' : 'International Minimal' },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Version Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold text-slate-900">
              {lang === 'fr' ? 'Générateur & éditeur de CV IA' : 'AI Resume Builder & Tailoring Studio'}
            </h1>
            <p className="text-sm text-slate-600">
              {lang === 'fr'
                ? 'Créez, importez (PDF, Word .docx ou texte), optimisez et exportez plusieurs versions de votre CV sans jamais fabriquer de fausses qualifications.'
                : 'Build, import (PDF, Word .docx, or text), optimize, and export multiple CV versions with strict factual fidelity.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Importer PDF / DOCX' : 'Import PDF / DOCX'}</span>
            </button>
            <button
              type="button"
              onClick={() => void exportCvAsWord(currentCv, lang)}
              className="px-3.5 py-2 text-xs font-medium text-jf-dark bg-white border border-jf-border hover:bg-jf-ice rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Exporter Word (.docx)' : 'Export Word (.docx)'}</span>
            </button>
            <button
              type="button"
              onClick={() => exportCvAsPdf(currentCv, lang)}
              className="px-3.5 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Exporter PDF' : 'Export PDF'}</span>
            </button>
          </div>
        </div>

        {/* Version Switcher & Template Selector */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              {lang === 'fr' ? 'Version active :' : 'Active version:'}
            </span>
            <select
              value={currentCv.id}
              onChange={(e) => onSelectVersion(e.target.value)}
              aria-label="CV Version"
              className="px-3 py-1.5 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.versionName} ({v.updatedAt})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDuplicateVersion}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
            >
              <CopyPlus className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Dupliquer' : 'Duplicate'}</span>
            </button>
            {versions.length > 1 && (
              <button
                type="button"
                onClick={() => handleDeleteVersion(currentCv.id)}
                className="px-2.5 py-1.5 text-xs font-medium text-jf-dark hover:bg-jf-soft rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'fr' ? 'Supprimer' : 'Delete'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => updateCurrent((cv) => ({ ...cv, template: tpl.id }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  currentCv.template === tpl.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Import Panel */}
        {importOpen && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-800 block">
                  {lang === 'fr'
                    ? 'Importer un CV existant (.pdf, .docx, .txt, .md ou copier-coller)'
                    : 'Import existing resume (.pdf, .docx, .txt, .md or paste raw text)'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  {lang === 'fr'
                    ? 'Extraction native PDF (multimodale IA) et Word (.docx) sans invention de données.'
                    : 'Native multimodal PDF and Word (.docx) parsing with strict factual extraction.'}
                </span>
              </div>
              <label className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
                {aiLoading === 'import_file' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileUp className="w-3.5 h-3.5" />
                )}
                <span>
                  {aiLoading === 'import_file'
                    ? lang === 'fr'
                      ? 'Extraction en cours…'
                      : 'Extracting…'
                    : lang === 'fr'
                      ? 'Importer .PDF / .DOCX / .TXT'
                      : 'Upload .PDF / .DOCX / .TXT'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileUpload}
                  disabled={aiLoading === 'import_file'}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={5}
              value={importRawText}
              onChange={(e) => setImportRawText(e.target.value)}
              placeholder={
                lang === 'fr'
                  ? 'Ou collez directement le contenu texte de votre CV ici…'
                  : 'Or paste your full existing CV text here…'
              }
              className="w-full p-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
            {aiError && (
              <p role="alert" className="text-xs font-medium text-jf-navy bg-jf-soft/75 border border-jf-dark/25 rounded-md px-3 py-2">
                {aiError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                {tr.common.close}
              </button>
              <button
                type="button"
                onClick={handleImportParse}
                disabled={aiLoading === 'import_parse' || aiLoading === 'import_file' || !importRawText.trim()}
                className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
              >
                {aiLoading === 'import_parse' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{lang === 'fr' ? 'Structurer le texte collé' : 'Parse Pasted Text'}</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* AI Optimization Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-jf-blue shrink-0" />
            <span>
              {lang === 'fr'
                ? 'Garantie d’intégrité : l’IA reformule uniquement vos faits réels et n’invente jamais de diplômes, d’expériences ou de compétences.'
                : 'Integrity Guardrail: AI refines only your real background and never invents degrees, employers, or skills.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAiAction('correct')}
              disabled={!!aiLoading}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {aiLoading === 'correct' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{lang === 'fr' ? 'Corriger la grammaire' : 'Fix Grammar'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAiAction('optimize')}
              disabled={!!aiLoading}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {aiLoading === 'optimize' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-blue-700" />
              )}
              <span>{lang === 'fr' ? 'Optimiser le CV' : 'Optimize Impact'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAiAction('tailor')}
              disabled={!!aiLoading || !targetJobText.trim()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {aiLoading === 'tailor' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{lang === 'fr' ? 'Adapter au poste ciblé' : 'Tailor to Target Job'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAiAction('cover_letter')}
              disabled={!!aiLoading || !targetJobText.trim()}
              className="px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 border border-blue-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {aiLoading === 'cover_letter' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              <span>{lang === 'fr' ? 'Générer lettre de motivation' : 'Generate Cover Letter'}</span>
            </button>
          </div>
        </div>

        <textarea
          rows={2}
          value={targetJobText}
          onChange={(e) => setTargetJobText(e.target.value)}
          placeholder={
            lang === 'fr'
              ? 'Collez ici le poste ciblé (ou sélectionnez une offre depuis Recherche d’Emplois) pour adapter le CV et générer une lettre de motivation…'
              : 'Paste target job description (or pick a job from Global Search) to tailor this CV or generate a cover letter…'
          }
          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
        />

        {aiError && (
          <div role="alert" className="p-3 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-xs font-medium text-jf-navy">
            {aiError}
          </div>
        )}

        {(changeLog.length > 0 || honestGaps.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs">
            {changeLog.length > 0 && (
              <div className="space-y-1">
                <div className="font-semibold text-jf-blue">
                  {lang === 'fr' ? 'Améliorations appliquées' : 'Applied Refinements'}
                </div>
                <ul className="space-y-1 text-slate-600">
                  {changeLog.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
            {honestGaps.length > 0 && (
              <div className="space-y-1">
                <div className="font-semibold text-jf-dark">
                  {lang === 'fr'
                    ? 'Écarts identifiés (non ajoutés au CV par intégrité)'
                    : 'Honest Qualification Gaps (Not Fabricated)'}
                </div>
                <ul className="space-y-1 text-slate-600">
                  {honestGaps.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {coverLetter && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                {lang === 'fr' ? 'Lettre de motivation générée — ' : 'Generated Cover Letter — '}
                {coverLetter.subject}
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${coverLetter.subject}\n\n${coverLetter.letter}`);
                  setCopiedLetter(true);
                  setTimeout(() => setCopiedLetter(false), 1800);
                }}
                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                {copiedLetter ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLetter ? tr.common.copied : tr.common.copy}</span>
              </button>
            </div>
            <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
              {coverLetter.letter}
            </p>
          </div>
        )}
      </section>

      {/* Split Editor & Live A4 Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Structured Form Editor */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Nom de cette version' : 'Version Label'}
              </span>
              <input
                type="text"
                value={currentCv.versionName}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, versionName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Nom complet' : 'Full Name'}
              </span>
              <input
                type="text"
                value={currentCv.fullName}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, fullName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Localisation' : 'Location'}
              </span>
              <input
                type="text"
                value={currentCv.location}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, location: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Titre professionnel' : 'Headline'}
              </span>
              <input
                type="text"
                value={currentCv.headline}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, headline: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">E-mail</span>
              <input
                type="email"
                value={currentCv.email}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Téléphone' : 'Phone'}
              </span>
              <input
                type="text"
                value={currentCv.phone}
                onChange={(e) => updateCurrent((cv) => ({ ...cv, phone: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">
              {lang === 'fr' ? 'Synthèse professionnelle' : 'Professional Summary'}
            </span>
            <textarea
              rows={3}
              value={currentCv.summary}
              onChange={(e) => updateCurrent((cv) => ({ ...cv, summary: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </label>

          {/* Experiences */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Expériences' : 'Experience'}
              </h3>
              <button
                type="button"
                onClick={() =>
                  updateCurrent((cv) => ({
                    ...cv,
                    experiences: [
                      ...cv.experiences,
                      {
                        id: `exp-${Date.now()}`,
                        role: '',
                        company: '',
                        location: '',
                        period: '',
                        highlights: [''],
                      },
                    ],
                  }))
                }
                className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'fr' ? 'Ajouter' : 'Add role'}</span>
              </button>
            </div>

            {currentCv.experiences.map((exp, idx) => (
              <div key={exp.id} className="space-y-3 pb-4 border-b border-slate-100 last:border-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={exp.role}
                    placeholder={lang === 'fr' ? 'Poste' : 'Role'}
                    onChange={(e) =>
                      updateCurrent((cv) => ({
                        ...cv,
                        experiences: cv.experiences.map((item, i) =>
                          i === idx ? { ...item, role: e.target.value } : item
                        ),
                      }))
                    }
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    value={exp.company}
                    placeholder={lang === 'fr' ? 'Entreprise' : 'Company'}
                    onChange={(e) =>
                      updateCurrent((cv) => ({
                        ...cv,
                        experiences: cv.experiences.map((item, i) =>
                          i === idx ? { ...item, company: e.target.value } : item
                        ),
                      }))
                    }
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    value={exp.location}
                    placeholder={lang === 'fr' ? 'Ville, Pays' : 'City, Country'}
                    onChange={(e) =>
                      updateCurrent((cv) => ({
                        ...cv,
                        experiences: cv.experiences.map((item, i) =>
                          i === idx ? { ...item, location: e.target.value } : item
                        ),
                      }))
                    }
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={exp.period}
                      placeholder="2023 – Présent"
                      onChange={(e) =>
                        updateCurrent((cv) => ({
                          ...cv,
                          experiences: cv.experiences.map((item, i) =>
                            i === idx ? { ...item, period: e.target.value } : item
                          ),
                        }))
                      }
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateCurrent((cv) => ({
                          ...cv,
                          experiences: cv.experiences.filter((_, i) => i !== idx),
                        }))
                      }
                      aria-label="Remove experience"
                      className="p-1.5 text-slate-400 hover:text-jf-navy"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <textarea
                  rows={3}
                  value={exp.highlights.join('\n')}
                  onChange={(e) =>
                    updateCurrent((cv) => ({
                      ...cv,
                      experiences: cv.experiences.map((item, i) =>
                        i === idx
                          ? { ...item, highlights: e.target.value.split('\n') }
                          : item
                      ),
                    }))
                  }
                  placeholder={
                    lang === 'fr'
                      ? 'Une réalisation clé par ligne…'
                      : 'One factual accomplishment per line…'
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            ))}
          </div>

          {/* Education, Skills & Languages */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {lang === 'fr' ? 'Formation' : 'Education'}
              </h3>
              <button
                type="button"
                onClick={() =>
                  updateCurrent((cv) => ({
                    ...cv,
                    education: [
                      ...cv.education,
                      { id: `edu-${Date.now()}`, degree: '', institution: '', year: '' },
                    ],
                  }))
                }
                className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'fr' ? 'Ajouter' : 'Add degree'}</span>
              </button>
            </div>
            {currentCv.education.map((edu, idx) => (
              <div key={edu.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  value={edu.degree}
                  placeholder={lang === 'fr' ? 'Diplôme' : 'Degree'}
                  onChange={(e) =>
                    updateCurrent((cv) => ({
                      ...cv,
                      education: cv.education.map((item, i) =>
                        i === idx ? { ...item, degree: e.target.value } : item
                      ),
                    }))
                  }
                  className="sm:col-span-5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="text"
                  value={edu.institution}
                  placeholder={lang === 'fr' ? 'Établissement' : 'Institution'}
                  onChange={(e) =>
                    updateCurrent((cv) => ({
                      ...cv,
                      education: cv.education.map((item, i) =>
                        i === idx ? { ...item, institution: e.target.value } : item
                      ),
                    }))
                  }
                  className="sm:col-span-5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="text"
                  value={edu.year}
                  placeholder="2020"
                  onChange={(e) =>
                    updateCurrent((cv) => ({
                      ...cv,
                      education: cv.education.map((item, i) =>
                        i === idx ? { ...item, year: e.target.value } : item
                      ),
                    }))
                  }
                  className="sm:col-span-2 px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
            ))}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Compétences (séparées par des virgules)' : 'Skills (comma-separated)'}
              </span>
              <input
                type="text"
                value={currentCv.skills.join(', ')}
                onChange={(e) =>
                  updateCurrent((cv) => ({
                    ...cv,
                    skills: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">
                {lang === 'fr' ? 'Langues (séparées par des virgules)' : 'Languages (comma-separated)'}
              </span>
              <input
                type="text"
                value={currentCv.languages.join(', ')}
                onChange={(e) =>
                  updateCurrent((cv) => ({
                    ...cv,
                    languages: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </label>
          </div>
        </div>

        {/* Live Document Preview */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-8 sm:p-10 space-y-6">
          <div
            className={`pb-5 border-b ${
              currentCv.template === 'structured'
                ? 'border-blue-700'
                : currentCv.template === 'executive'
                  ? 'border-slate-900'
                  : 'border-slate-200'
            }`}
          >
            <h2
              className={`font-display text-2xl font-bold ${
                currentCv.template === 'structured' ? 'text-blue-800' : 'text-slate-900'
              }`}
            >
              {currentCv.fullName}
            </h2>
            <p className="text-sm font-medium text-slate-600 mt-1">{currentCv.headline}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              <span>{currentCv.location}</span>
              <span aria-hidden="true">·</span>
              <span>{currentCv.email}</span>
              <span aria-hidden="true">·</span>
              <span>{currentCv.phone}</span>
              {currentCv.linkedin && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{currentCv.linkedin}</span>
                </>
              )}
            </div>
          </div>

          {currentCv.summary && (
            <div className="space-y-1.5">
              <h3
                className={`text-xs font-bold tracking-wider uppercase ${
                  currentCv.template === 'structured' ? 'text-blue-700' : 'text-slate-900'
                }`}
              >
                {lang === 'fr' ? 'Synthèse' : 'Summary'}
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">{currentCv.summary}</p>
            </div>
          )}

          <div className="space-y-4">
            <h3
              className={`text-xs font-bold tracking-wider uppercase pb-1 border-b border-slate-200 ${
                currentCv.template === 'structured' ? 'text-blue-700' : 'text-slate-900'
              }`}
            >
              {lang === 'fr' ? 'Expériences professionnelles' : 'Professional Experience'}
            </h3>
            {currentCv.experiences.map((exp) => (
              <div key={exp.id} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {exp.role}{' '}
                    <span className="font-normal text-slate-600">— {exp.company}</span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500">
                    {exp.period}
                  </div>
                </div>
                {exp.location && <div className="text-xs text-slate-500">{exp.location}</div>}
                <ul className="mt-1.5 space-y-1 text-xs text-slate-700 leading-relaxed">
                  {exp.highlights.filter(Boolean).map((h, i) => (
                    <li key={i}>• {h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="space-y-2.5">
            <h3
              className={`text-xs font-bold tracking-wider uppercase pb-1 border-b border-slate-200 ${
                currentCv.template === 'structured' ? 'text-blue-700' : 'text-slate-900'
              }`}
            >
              {lang === 'fr' ? 'Formation' : 'Education'}
            </h3>
            {currentCv.education.map((edu) => (
              <div key={edu.id} className="flex items-baseline justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{edu.degree}</span>
                  <span className="text-slate-600"> — {edu.institution}</span>
                </div>
                <span className="font-mono tabular-nums text-slate-500">{edu.year}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 text-xs">
            <div className="space-y-1">
              <h3 className="font-bold uppercase tracking-wider text-slate-900">
                {lang === 'fr' ? 'Compétences' : 'Skills'}
              </h3>
              <p className="text-slate-700 leading-relaxed">{currentCv.skills.join(' · ')}</p>
            </div>
            <div className="space-y-1">
              <h3 className="font-bold uppercase tracking-wider text-slate-900">
                {lang === 'fr' ? 'Langues' : 'Languages'}
              </h3>
              <p className="text-slate-700 leading-relaxed">{currentCv.languages.join(' · ')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
