import { useState } from 'react';
import {
  Cloud,
  Download,
  Globe,
  LogIn,
  LogOut,
  Shield,
  Trash2,
} from 'lucide-react';
import {
  AccountRole,
  CandidateProfile,
  CvDocument,
  Lang,
  TrackedApplication,
  WatchlistItem,
} from '../types';
import { L, SUPPORTED_LANGUAGES, t } from '../i18n';
import { PWAInstallButton } from './PWAInstallButton';

interface AccountPrivacyHubProps {
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  user: { uid: string; email: string; displayName: string } | null;
  accountRole: AccountRole;
  onChangeRole: (role: AccountRole) => void;
  discoverable: boolean;
  onToggleDiscoverable: (val: boolean) => void;
  gdprConsent: boolean;
  onToggleGdpr: (val: boolean) => void;
  companyName: string;
  companyWebsite: string;
  onSaveCompanyInfo: (name: string, website: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onDeleteAllData: () => Promise<void>;
  exportPayload: {
    profile: CandidateProfile;
    cvVersions: CvDocument[];
    applications: TrackedApplication[];
    watchlist: WatchlistItem[];
  };
}

export function AccountPrivacyHub({
  lang,
  onChangeLang,
  user,
  accountRole,
  onChangeRole,
  discoverable,
  onToggleDiscoverable,
  gdprConsent,
  onToggleGdpr,
  companyName,
  companyWebsite,
  onSaveCompanyInfo,
  onSignIn,
  onSignOut,
  onDeleteAllData,
  exportPayload,
}: AccountPrivacyHubProps) {
  const tr = t(lang);
  const [compNameDraft, setCompNameDraft] = useState(companyName);
  const [compWebDraft, setCompWebDraft] = useState(companyWebsite);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleExportGdprJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            platform: 'JOBFOUNDS',
            account: user ? { email: user.email, displayName: user.displayName, accountRole } : 'Local Session',
            ...exportPayload,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JOB_FONDS_Personal_Data_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteAllData();
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-jf-border rounded-xl p-6 space-y-2">
        <h1 className="font-display text-2xl font-semibold text-jf-navy">
          {L(
            lang,
            'Compte Cloud, Confidentialité RGPD, Langues & Application Mobile (PWA)',
            'Cloud Account, GDPR Privacy, Languages & Mobile PWA'
          )}
        </h1>
        <p className="text-sm text-slate-600">
          {L(
            lang,
            'Synchronisez vos CV, candidatures et alertes sur tous vos appareils via Firebase, gérez votre visibilité recruteur sans exposition de données personnelles, et installez JOBFOUNDS sur mobile ou ordinateur.',
            'Sync CVs, applications, and alerts across devices with Firebase, manage PII-safe recruiter visibility, and install JOBFOUNDS as a PWA.'
          )}
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cloud Authentication & Role */}
        <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-jf-navy">
              <Cloud className="w-4 h-4 text-jf-blue" />
              <span>{L(lang, 'Synchronisation Cloud Firebase', 'Firebase Cloud Sync')}</span>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {user ? tr.common.cloudSynced : tr.common.localMode}
            </span>
          </div>

          {user ? (
            <div className="space-y-4">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-jf-navy">{user.displayName}</div>
                <div className="text-xs text-slate-500">{user.email}</div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-600 block">
                  {L(lang, 'Espace actif', 'Active Workspace Persona')}
                </span>
                <div className="flex items-center gap-1 p-1 bg-jf-ice rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() => onChangeRole('candidate')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                      accountRole === 'candidate'
                        ? 'bg-white text-jf-navy shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    {L(lang, 'Candidat', 'Candidate')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRole('recruiter')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                      accountRole === 'recruiter'
                        ? 'bg-white text-jf-navy shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    {L(lang, 'Recruteur / Entreprise', 'Recruiter / Employer')}
                  </button>
                </div>
              </div>

              {accountRole === 'recruiter' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <input
                    type="text"
                    value={compNameDraft}
                    onChange={(e) => setCompNameDraft(e.target.value)}
                    placeholder={lang === 'fr' ? 'Nom de l’entreprise' : 'Company name'}
                    className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  <input
                    type="url"
                    value={compWebDraft}
                    onChange={(e) => setCompWebDraft(e.target.value)}
                    placeholder="https://company.com"
                    className="px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => onSaveCompanyInfo(compNameDraft, compWebDraft)}
                    className="sm:col-span-2 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200/80 rounded-lg"
                  >
                    {lang === 'fr' ? 'Enregistrer les informations entreprise' : 'Save Company Details'}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onSignOut}
                className="px-4 py-2 text-xs font-medium text-jf-dark border border-jf-border hover:bg-jf-ice rounded-lg inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{tr.common.signOut}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                {L(
                  lang,
                  'Connectez-vous avec Google pour sauvegarder automatiquement votre profil, vos versions de CV, vos candidatures, vos alertes de veille et accéder à la messagerie directe.',
                  'Sign in with Google to automatically sync your profile, CV versions, applications, watchlist alerts, and direct recruiter messaging.'
                )}
              </p>
              <button
                type="button"
                onClick={onSignIn}
                className="px-4 py-2.5 text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                <span>{tr.common.signInGoogle}</span>
              </button>
            </div>
          )}
        </section>

        {/* Languages & Installable PWA */}
        <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-jf-navy pb-4 border-b border-slate-100 w-full">
            <Globe className="w-4 h-4 text-jf-blue" />
            <span>
              {L(
                lang,
                'Langue internationale (6 langues + RTL arabe)',
                'Global Language (6 Languages + Arabic RTL)'
              )}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SUPPORTED_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => onChangeLang(l.code)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-left ${
                  lang === l.code
                    ? 'bg-jf-soft border-jf-sky text-jf-navy font-semibold'
                    : 'bg-white border-jf-border text-slate-700 hover:bg-jf-ice'
                }`}
              >
                <span className="font-mono font-semibold mr-1.5">{l.label}</span>
                <span>{l.native}</span>
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-2">
            <div className="text-xs font-semibold text-slate-800">
              {lang === 'fr' ? 'Application Web Progressive (PWA)' : 'Progressive Web App (PWA)'}
            </div>
            <p className="text-xs text-slate-500">
              {lang === 'fr'
                ? 'Installez JOBFOUNDS sur votre écran d’accueil mobile ou bureau avec mode hors ligne.'
                : 'Install JOBFOUNDS directly on mobile or desktop home screen with offline support.'}
            </p>
            <div className="max-w-xs pt-1">
              <PWAInstallButton lang={lang} />
            </div>
          </div>
        </section>

        {/* GDPR & Privacy Controls */}
        <section className="lg:col-span-2 bg-white border border-jf-border rounded-xl p-6 space-y-5">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-jf-navy pb-4 border-b border-slate-100 w-full">
            <Shield className="w-4 h-4 text-jf-blue" />
            <span>
              {L(
                lang,
                'Contrôle de confidentialité, visibilité & droits RGPD',
                'Privacy Controls, Recruiter Discovery & GDPR Rights'
              )}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={discoverable}
                disabled={!user}
                onChange={(e) => onToggleDiscoverable(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-jf-blue focus:ring-jf-blue"
              />
              <span className="space-y-0.5">
                <span className="text-sm font-medium text-slate-900 block">
                  {lang === 'fr'
                    ? 'Rendre mon profil visible dans l’annuaire recruteurs (opt-in)'
                    : 'Allow verified recruiters to discover my profile (opt-in)'}
                </span>
                <span className="text-xs text-slate-500 block leading-relaxed">
                  {lang === 'fr'
                    ? 'Isolation stricte des données : seuls votre titre, années d’expérience, compétences et pays souhaités sont partagés. Votre e-mail et téléphone ne sont jamais exposés.'
                    : 'Strict PII isolation: only your headline, years of experience, skills, and target countries are listed. Email and phone are never exposed.'}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={gdprConsent}
                onChange={(e) => onToggleGdpr(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
              />
              <span className="space-y-0.5">
                <span className="text-sm font-medium text-slate-900 block">
                  {lang === 'fr'
                    ? 'Consentement au traitement IA de mes candidatures (RGPD)'
                    : 'Consent to AI career processing (GDPR)'}
                </span>
                <span className="text-xs text-slate-500 block leading-relaxed">
                  {lang === 'fr'
                    ? 'Vous gardez la propriété intégrale de vos CV et données, exportables ou supprimables à tout moment.'
                    : 'You retain full ownership of all resumes and career data, exportable or erasable at any time.'}
                </span>
              </span>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleExportGdprJson}
              className="px-4 py-2 text-xs font-medium text-jf-dark bg-jf-ice hover:bg-jf-soft rounded-lg inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {L(
                  lang,
                  'Exporter toutes mes données (JSON RGPD)',
                  'Export All Personal Data (GDPR JSON)'
                )}
              </span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-2 text-xs font-medium text-jf-navy bg-jf-soft/75 hover:bg-jf-soft border border-jf-dark/30 rounded-lg inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {L(lang, 'Supprimer mes données personnelles', 'Erase My Personal Data')}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-jf-navy">
                  {L(lang, 'Confirmer la suppression définitive ?', 'Confirm permanent erasure?')}
                </span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-jf-navy hover:bg-jf-dark rounded-lg"
                >
                  {L(lang, 'Supprimer', 'Confirm Erase')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-jf-navy"
                >
                  {L(lang, 'Annuler', 'Cancel')}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
