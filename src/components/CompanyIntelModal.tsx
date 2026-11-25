import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  Radar,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { CompanyIntelligenceReport, Lang } from '../types';
import { pickLang, t } from '../i18n';
import { fetchCompanyIntelligence } from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';

interface CompanyIntelModalProps {
  companyName: string | null;
  country?: string;
  lang: Lang;
  onClose: () => void;
  onAddToWatchlist: (companyName: string, country: string, sector: string) => void;
  onVerifyCompany: (companyName: string, website: string) => void;
}

export function CompanyIntelModal({
  companyName,
  country = '',
  lang,
  onClose,
  onAddToWatchlist,
  onVerifyCompany,
}: CompanyIntelModalProps) {
  const tr = t(lang);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CompanyIntelligenceReport | null>(null);

  useEffect(() => {
    if (!companyName) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);

    fetchCompanyIntelligence({ companyName, country, lang })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load company intelligence.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyName, country, lang]);

  if (!companyName) return null;

  const labels = pickLang(lang, {
    fr: {
      subtitle: 'Fiche Entreprise & Signaux de Recrutement',
      hq: 'Siège social',
      sector: 'Secteur',
      size: 'Taille estimée',
      velocity: 'Rythme de recrutement',
      signals: 'Signaux de croissance & expansion vérifiés',
      roles: 'Métiers fréquemment recrutés',
      website: 'Site officiel',
      careers: 'Portail carrières',
      watch: 'Ajouter à la veille',
      verify: 'Vérifier le domaine',
    },
    en: {
      subtitle: 'Company Intelligence & Hiring Signals',
      hq: 'Headquarters',
      sector: 'Sector',
      size: 'Estimated Size',
      velocity: 'Hiring Velocity',
      signals: 'Verified Growth & Expansion Signals',
      roles: 'Frequently Hired Roles',
      website: 'Official Website',
      careers: 'Careers Portal',
      watch: 'Add to Watchlist',
      verify: 'Verify Domain',
    },
    es: {
      subtitle: 'Ficha Empresarial y Señales de Contratación',
      hq: 'Sede central',
      sector: 'Sector',
      size: 'Tamaño estimado',
      velocity: 'Ritmo de contratación',
      signals: 'Señales verificadas de crecimiento y expansión',
      roles: 'Perfiles contratados habitualmente',
      website: 'Sitio oficial',
      careers: 'Portal de empleo',
      watch: 'Añadir a vigilancia',
      verify: 'Verificar dominio',
    },
    de: {
      subtitle: 'Unternehmensprofil & Einstellungssignale',
      hq: 'Hauptsitz',
      sector: 'Branche',
      size: 'Geschätzte Größe',
      velocity: 'Einstellungsdynamik',
      signals: 'Verifizierte Wachstums- & Expansionssignale',
      roles: 'Häufig gesuchte Rollen',
      website: 'Offizielle Website',
      careers: 'Karriereportal',
      watch: 'Zur Watchlist',
      verify: 'Domain prüfen',
    },
    pt: {
      subtitle: 'Inteligência Empresarial e Sinais de Contratação',
      hq: 'Sede',
      sector: 'Setor',
      size: 'Porte estimado',
      velocity: 'Ritmo de contratação',
      signals: 'Sinais verificados de crescimento e expansão',
      roles: 'Cargos frequentemente contratados',
      website: 'Site oficial',
      careers: 'Portal de carreiras',
      watch: 'Adicionar ao monitoramento',
      verify: 'Verificar domínio',
    },
    ar: {
      subtitle: 'ملف الشركة وإشارات التوظيف',
      hq: 'المقر الرئيسي',
      sector: 'القطاع',
      size: 'الحجم التقديري',
      velocity: 'وتيرة التوظيف',
      signals: 'إشارات النمو والتوسع الموثقة',
      roles: 'الوظائف الأكثر طلباً',
      website: 'الموقع الرسمي',
      careers: 'بوابة الوظائف',
      watch: 'إضافة للمراقبة',
      verify: 'التحقق من النطاق',
    },
  });

  const officialUrl = safeExternalUrl(report?.officialWebsite);
  const careersUrl = safeExternalUrl(report?.careersPortalUrl);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-jf-navy/60"
      role="dialog"
      aria-modal="true"
      aria-label={companyName}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl bg-white h-full overflow-y-auto border-l border-jf-border flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-jf-navy text-white px-6 py-5 flex items-start justify-between gap-4 border-b border-jf-dark">
          <div className="space-y-1 min-w-0">
            <div className="text-xs text-jf-sky font-medium">{labels.subtitle}</div>
            <h2 className="font-display text-xl font-semibold text-white truncate flex items-center gap-2">
              <Building2 className="w-5 h-5 text-jf-sky shrink-0" />
              <span className="truncate">{companyName}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr.common.close}
            className="p-1.5 text-jf-sky hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 flex-1">
          {loading && (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-jf-dark">
              <Loader2 className="w-6 h-6 animate-spin text-jf-blue" />
              <span className="text-sm font-medium">{tr.common.loading}</span>
            </div>
          )}

          {error && (
            <div className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm text-jf-navy">
              {error}
            </div>
          )}

          {report && !loading && (
            <>
              <p className="text-sm text-slate-700 leading-relaxed">{report.overview}</p>

              {/* Key Facts Grid */}
              <div className="grid grid-cols-2 gap-4 py-4 border-y border-jf-border text-sm">
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-jf-blue" />
                    <span>{labels.hq}</span>
                  </div>
                  <div className="mt-1 font-medium text-jf-navy">{report.headquarters}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{labels.sector}</div>
                  <div className="mt-1 font-medium text-jf-navy">{report.sector}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-jf-blue" />
                    <span>{labels.size}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs font-semibold tabular-nums text-jf-navy">
                    {report.estimatedSize}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-jf-blue" />
                    <span>{labels.velocity}</span>
                  </div>
                  <div className="mt-1 font-semibold text-jf-blue">{report.hiringVelocity}</div>
                </div>
              </div>

              {/* Growth Signals */}
              {report.growthSignals?.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-jf-navy">{labels.signals}</h3>
                  <ul className="space-y-2">
                    {report.growthSignals.map((sig, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed"
                      >
                        <CheckCircle2 className="w-4 h-4 text-jf-blue shrink-0 mt-0.5" />
                        <span>{sig}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Typical Roles */}
              {report.typicalRolesHired?.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-jf-navy">{labels.roles}</h3>
                  <p className="text-sm text-slate-700">
                    {report.typicalRolesHired.join(' · ')}
                  </p>
                </div>
              )}

              {/* Verification Note */}
              {report.verificationNote && (
                <div className="p-4 bg-jf-ice border border-jf-border rounded-lg text-xs text-jf-dark leading-relaxed">
                  {report.verificationNote}
                </div>
              )}

              {/* Action Strip */}
              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onAddToWatchlist(report.companyName, report.headquarters, report.sector);
                    onClose();
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Radar className="w-3.5 h-3.5" />
                  <span>{labels.watch}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onVerifyCompany(report.companyName, officialUrl || '');
                    onClose();
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-jf-navy bg-jf-soft/75 hover:bg-jf-soft rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{labels.verify}</span>
                </button>
                {careersUrl && (
                  <a
                    href={careersUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 text-xs font-medium text-jf-dark border border-jf-border hover:bg-jf-ice rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>{labels.careers}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
                {officialUrl && (
                  <a
                    href={officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 text-xs font-medium text-jf-dark border border-jf-border hover:bg-jf-ice rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>{labels.website}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Grounded Sources */}
              {report.groundingSources && report.groundingSources.length > 0 && (
                <div className="pt-4 border-t border-jf-border flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="font-medium text-jf-navy">{tr.common.groundingSources}:</span>
                  {report.groundingSources.slice(0, 5).map((src) => {
                    const href = safeExternalUrl(src.uri);
                    if (!href) return null;
                    return (
                      <a
                        key={href}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-jf-blue hover:underline inline-flex items-center gap-1"
                      >
                        <span className="truncate max-w-xs">{src.title}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
