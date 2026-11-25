import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Lang, OpportunityClassification, VerificationStatus } from '../types';
import { t } from '../i18n';

/**
 * Strictly monochromatic Deep Navy / Dark Blue / Interactive Blue / Steel Navy status indicators.
 * Zero green, amber, orange, yellow, or red — semantic meaning is always carried by icon + explicit label.
 */
export function VerificationStatusText({
  status,
  lang,
}: {
  status: VerificationStatus;
  lang: Lang;
}) {
  const label = t(lang).statusLabels[status];

  const config: Record<
    VerificationStatus,
    { color: string; Icon: typeof ShieldCheck }
  > = {
    Verified: { color: 'text-jf-blue', Icon: ShieldCheck },
    'Partially Verified': { color: 'text-jf-dark', Icon: CheckCircle2 },
    Unverified: { color: 'text-slate-500', Icon: HelpCircle },
    Suspicious: { color: 'text-jf-navy', Icon: ShieldAlert },
    Expired: { color: 'text-slate-400', Icon: Clock },
  };

  const { color, Icon } = config[status] || config.Unverified;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color} whitespace-nowrap`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function ClassificationText({
  classification,
  lang,
}: {
  classification: OpportunityClassification;
  lang: Lang;
}) {
  const label = t(lang).classificationLabels[classification];

  const config: Record<
    OpportunityClassification,
    { color: string; Icon: typeof CheckCircle2 }
  > = {
    'Confirmed Job': { color: 'text-jf-navy', Icon: CheckCircle2 },
    'Active Hiring Signal': { color: 'text-jf-blue', Icon: Radar },
    'Potential Hiring Opportunity': { color: 'text-jf-dark', Icon: Sparkles },
  };

  const { color, Icon } = config[classification] || config['Potential Hiring Opportunity'];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color} whitespace-nowrap`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function CheckResultText({
  result,
  lang,
}: {
  result: 'Pass' | 'Warning' | 'Fail' | 'Insufficient Data';
  lang: Lang;
}) {
  const labels = {
    Pass: lang === 'fr' ? 'Conforme' : 'Pass',
    Warning: lang === 'fr' ? 'À vérifier' : 'Warning',
    Fail: lang === 'fr' ? 'Alerte critique' : 'Critical Alert',
    'Insufficient Data': lang === 'fr' ? 'Preuves insuffisantes' : 'Insufficient Data',
  };

  const styles = {
    Pass: 'text-jf-blue',
    Warning: 'text-jf-dark',
    Fail: 'text-jf-navy underline decoration-jf-sky decoration-2 underline-offset-4',
    'Insufficient Data': 'text-slate-500',
  };

  const Icon =
    result === 'Pass'
      ? CheckCircle2
      : result === 'Fail'
        ? ShieldAlert
        : result === 'Warning'
          ? AlertTriangle
          : HelpCircle;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${styles[result]} whitespace-nowrap`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{labels[result]}</span>
    </span>
  );
}
