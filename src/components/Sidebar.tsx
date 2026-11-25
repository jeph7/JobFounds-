import { useState } from 'react';
import {
  Bell,
  Briefcase,
  Building2,
  Cloud,
  Database,
  FileCheck2,
  FileText,
  Globe,
  Home,
  Lock,
  LogIn,
  Menu,
  Radar,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { CandidateProfile, Lang, WorkspaceTab } from '../types';
import { SUPPORTED_LANGUAGES, t } from '../i18n';
import { CANDIDATE_AVATAR_URL } from '../data/initialData';
import { PWAInstallButton } from './PWAInstallButton';
import { BrandLogo } from './ui';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  lang: Lang;
  onToggleLang: (lang: Lang) => void;
  profile: CandidateProfile;
  trackedCount: number;
  alertCount: number;
  messageCount: number;
  signedInEmail: string | null;
  isAdmin: boolean;
  onSignIn: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  lang,
  onToggleLang,
  profile,
  trackedCount,
  alertCount,
  messageCount,
  signedInEmail,
  isAdmin,
  onSignIn,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [imgError, setImgError] = useState(false);
  const tr = t(lang);

  const networkItems: Array<{
    id: WorkspaceTab;
    label: string;
    icon: typeof Globe;
    count?: number;
  }> = [
    { id: 'recruiters', label: tr.nav.recruiters, icon: Building2, count: messageCount },
    { id: 'account', label: tr.nav.account, icon: Shield },
  ];
  if (isAdmin) {
    networkItems.push({ id: 'admin', label: tr.nav.admin, icon: Lock });
  }

  const groups: Array<{
    label: string;
    items: Array<{
      id: WorkspaceTab;
      label: string;
      icon: typeof Globe;
      count?: number;
    }>;
  }> = [
    {
      label: tr.navGroups.overview,
      items: [{ id: 'home', label: tr.nav.home, icon: Home }],
    },
    {
      label: tr.navGroups.intelligence,
      items: [
        { id: 'jobs', label: tr.nav.jobs, icon: Globe },
        { id: 'companies', label: tr.nav.companies, icon: Database },
        { id: 'hidden', label: tr.nav.hidden, icon: Radar },
        { id: 'verify', label: tr.nav.verify, icon: ShieldCheck },
      ],
    },
    {
      label: tr.navGroups.preparation,
      items: [
        { id: 'cv', label: tr.nav.cv, icon: FileText },
        { id: 'ats', label: tr.nav.ats, icon: FileCheck2 },
        { id: 'matching', label: tr.nav.matching, icon: SlidersHorizontal },
      ],
    },
    {
      label: tr.navGroups.execution,
      items: [
        { id: 'career', label: tr.nav.career, icon: Briefcase, count: trackedCount },
        { id: 'watchlist', label: tr.nav.watchlist, icon: Bell, count: alertCount },
      ],
    },
    {
      label: tr.navGroups.network,
      items: networkItems,
    },
  ];

  const handleNav = (id: WorkspaceTab) => {
    onSelectTab(id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex flex-col h-full bg-jf-navy text-white border-r border-jf-dark w-64">
      {/* Official Logo Plate — Pure White backdrop preserves exact untouched JOBFOUNDS logo */}
      <div className="h-16 px-4 bg-white border-b border-jf-border flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue rounded"
          aria-label="JOBFOUNDS Home"
        >
          <BrandLogo size="md" />
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 text-jf-dark hover:text-jf-navy rounded"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Deep Navy Navigation Modules */}
      <nav className="flex-1 overflow-y-auto px-3.5 py-5 space-y-5" aria-label="Primary modules">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-1.5 text-[11px] font-medium text-jf-sky/75 tracking-wide">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleNav(item.id)}
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-sky ${
                        isActive
                          ? 'bg-jf-blue text-white font-semibold'
                          : 'text-jf-soft/90 hover:bg-jf-dark hover:text-white font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-white' : 'text-jf-sky'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {typeof item.count === 'number' && item.count > 0 && (
                        <span
                          className={`font-mono text-xs tabular-nums shrink-0 ${
                            isActive ? 'text-white' : 'text-jf-sky'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Account, PWA Install & 6-Language Switcher */}
      <div className="p-4 border-t border-jf-dark space-y-3 shrink-0 bg-jf-navy">
        {signedInEmail ? (
          <button
            type="button"
            onClick={() => handleNav('account')}
            className="w-full flex items-center gap-3 p-2 rounded-lg bg-jf-dark/70 hover:bg-jf-dark transition-colors text-left"
          >
            {!imgError ? (
              <img
                src={CANDIDATE_AVATAR_URL}
                alt={profile.fullName}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-9 h-9 rounded-full object-cover border border-jf-sky/40 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-jf-dark border border-jf-sky/40 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-jf-sky" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">
                {profile.fullName}
              </div>
              <div className="text-[11px] text-jf-sky inline-flex items-center gap-1 truncate">
                <Cloud className="w-3 h-3 shrink-0" />
                <span className="truncate">{tr.common.cloudSynced}</span>
              </div>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg transition-colors whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            <span>{tr.common.signInGoogle}</span>
          </button>
        )}

        <PWAInstallButton lang={lang} variant="dark" />

        <div className="pt-2 border-t border-jf-dark">
          <select
            value={lang}
            onChange={(e) => onToggleLang(e.target.value as Lang)}
            aria-label="Language"
            className="w-full text-xs font-medium text-white bg-jf-dark border border-jf-sky/25 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-jf-sky"
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
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-jf-navy/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}

export function TopHeader({
  activeTab,
  lang,
  onOpenMobile,
  primaryActionLabel,
  onPrimaryAction,
}: {
  activeTab: WorkspaceTab;
  lang: Lang;
  onOpenMobile: () => void;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
}) {
  const tr = t(lang);

  return (
    <header className="h-14 sm:h-16 bg-white border-b border-jf-border px-4 sm:px-8 flex items-center justify-between gap-4 sm:gap-6 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label="Open navigation"
          className="lg:hidden p-2 -ml-2 text-jf-navy hover:bg-jf-ice rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile Official Brand Logo */}
        <div className="lg:hidden flex items-center shrink-0">
          <BrandLogo size="sm" />
        </div>

        {/* Desktop Breadcrumb */}
        <div className="hidden lg:flex items-center gap-2 text-sm min-w-0">
          <span className="font-display font-semibold text-slate-500 whitespace-nowrap shrink-0">
            JOBFOUNDS
          </span>
          <span className="text-jf-sky shrink-0" aria-hidden="true">
            /
          </span>
          <span className="font-semibold text-jf-navy truncate">
            {tr.nav[activeTab]}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onPrimaryAction}
        className="px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jf-blue focus-visible:ring-offset-2"
      >
        {primaryActionLabel}
      </button>
    </header>
  );
}

/**
 * Native-grade Mobile Bottom Navigation (< lg) designed for thumb reach and future Android/iOS parity.
 * Height 56px keeps combined sticky chrome under the 15% mobile viewport cap.
 */
export function MobileBottomNav({
  activeTab,
  onSelectTab,
  onOpenMenu,
  lang,
}: {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenMenu: () => void;
  lang: Lang;
}) {
  const tr = t(lang);
  const items: Array<{ id: WorkspaceTab | 'menu'; label: string; icon: typeof Globe }> = [
    { id: 'home', label: tr.mobileNav.home, icon: Home },
    { id: 'jobs', label: tr.mobileNav.jobs, icon: Globe },
    { id: 'hidden', label: tr.mobileNav.hidden, icon: Radar },
    { id: 'career', label: tr.mobileNav.career, icon: Briefcase },
    { id: 'menu', label: tr.common.all, icon: Menu },
  ];

  return (
    <nav
      aria-label="Mobile quick navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-jf-navy border-t border-jf-dark grid grid-cols-5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.id !== 'menu' && activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => (item.id === 'menu' ? onOpenMenu() : onSelectTab(item.id))}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              isActive ? 'text-white bg-jf-dark' : 'text-jf-sky/85 hover:text-white'
            }`}
          >
            <Icon
              className={`w-4 h-4 ${isActive ? 'text-jf-sky' : 'text-jf-sky/80'}`}
              aria-hidden="true"
            />
            <span className="truncate max-w-[64px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
