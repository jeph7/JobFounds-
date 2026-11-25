import React, { useState } from 'react';

export const OFFICIAL_LOGO_URL = '/assets/aistudio/image_f81c99a6.png';

/**
 * Displays the official JOBFOUNDS logo without altering its graphic proportions or colors.
 * Always sits on a pure white surface plate to preserve exact brand contrast.
 */
export function BrandLogo({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const heightClass =
    size === 'sm' ? 'h-7' : size === 'lg' ? 'h-12' : 'h-9';

  if (failed) {
    return (
      <span className={`font-display font-bold tracking-tight text-jf-navy whitespace-nowrap ${className}`}>
        JOB<span className="text-jf-blue">FOUNDS</span>
      </span>
    );
  }

  return (
    <img
      src={OFFICIAL_LOGO_URL}
      alt="JOBFOUNDS — Powered by VADIVAN"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${heightClass} w-auto object-contain select-none ${className}`}
    />
  );
}

/**
 * Standardized surface card following JOBFOUNDS single-elevation depth & Ice-Blue hairline borders.
 */
export function JfCard({
  children,
  className = '',
  tone = 'white',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'white' | 'soft' | 'navy';
}) {
  const toneClass =
    tone === 'navy'
      ? 'bg-jf-navy text-white border border-jf-dark'
      : tone === 'soft'
        ? 'bg-jf-soft/45 text-jf-navy border border-jf-sky/70'
        : 'bg-white text-jf-navy border border-jf-border';

  return <section className={`rounded-xl ${toneClass} ${className}`}>{children}</section>;
}

/**
 * Standardized horizontal progress / compatibility indicator strictly in Interactive Blue & Sky Blue.
 */
export function JfProgressBar({
  value,
  max = 100,
  emphasis = 'primary',
}: {
  value: number;
  max?: number;
  emphasis?: 'primary' | 'secondary' | 'muted';
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const barClass =
    emphasis === 'primary'
      ? 'bg-jf-blue'
      : emphasis === 'secondary'
        ? 'bg-jf-dark'
        : 'bg-jf-sky';

  return (
    <div className="w-full h-1.5 bg-jf-soft rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-200 ${barClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Unified alert/notice callout strictly within the Deep Navy & Soft Blue identity (zero red/orange/yellow).
 */
export function JfNotice({
  children,
  tone = 'info',
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'alert';
  className?: string;
}) {
  const style =
    tone === 'alert'
      ? 'bg-jf-soft/75 border-jf-dark/35 text-jf-navy font-medium'
      : 'bg-jf-ice border-jf-border text-slate-700';

  return (
    <div role={tone === 'alert' ? 'alert' : 'status'} className={`p-4 border rounded-lg text-sm ${style} ${className}`}>
      {children}
    </div>
  );
}
