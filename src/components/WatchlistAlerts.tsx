import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarClock,
  CheckCheck,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  CandidateProfile,
  Lang,
  NotificationRecord,
  TrackedApplication,
  WatchlistItem,
} from '../types';
import {
  checkWatchlistTarget,
  fetchUserNotifications,
  markUserNotificationRead,
  runCandidateNotificationMatchNow,
  saveNotificationPreferences,
} from '../utils/api';
import { safeExternalUrl } from '../utils/safeUrl';

interface WatchlistAlertsProps {
  lang: Lang;
  signedIn?: boolean;
  profile?: CandidateProfile;
  watchlist: WatchlistItem[];
  onSaveWatchItem: (item: WatchlistItem) => void;
  onDeleteWatchItem: (id: string) => void;
  applications: TrackedApplication[];
  onJumpToTracker: () => void;
  onRequireSignIn?: () => void;
  onUnreadCountChange?: (count: number) => void;
  onNotify?: (msg: string) => void;
}

export function WatchlistAlerts({
  lang,
  signedIn = false,
  profile,
  watchlist,
  onSaveWatchItem,
  onDeleteWatchItem,
  applications,
  onJumpToTracker,
  onRequireSignIn,
  onUnreadCountChange,
  onNotify,
}: WatchlistAlertsProps) {
  const [kind, setKind] = useState<'company' | 'search'>('company');
  const [label, setLabel] = useState('');
  const [country, setCountry] = useState('');
  const [sector, setSector] = useState('');
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Personalized Server Notifications & Preferences
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [runningMatch, setRunningMatch] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const [prefCountries, setPrefCountries] = useState<string>(
    (profile?.preferredCountries || []).join(', ')
  );
  const [prefSectors, setPrefSectors] = useState<string>(
    (profile?.targetSectors || []).join(', ')
  );
  const [prefFrequency, setPrefFrequency] = useState<'instant' | 'daily' | 'weekly'>('instant');
  const [chanInApp, setChanInApp] = useState(true);
  const [chanEmail, setChanEmail] = useState(false);
  const [chanPush, setChanPush] = useState(false);
  const [prefsEnabled, setPrefsEnabled] = useState(true);
  const [pushStatus, setPushStatus] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const loadNotifications = useCallback(async () => {
    if (!signedIn) return;
    setNotifLoading(true);
    try {
      const res = await fetchUserNotifications();
      setNotifications(res.notifications);
      setEmailDeliveryAvailable(res.emailDeliveryAvailable);
      onUnreadCountChange?.(res.unreadCount);
      if (res.subscription) {
        setPrefCountries(res.subscription.preferredCountries.join(', '));
        setPrefSectors(res.subscription.preferredSectors.join(', '));
        setPrefFrequency(res.subscription.frequency);
        setChanInApp(res.subscription.channels.inApp);
        setChanEmail(res.subscription.channels.email);
        setChanPush(res.subscription.channels.push);
        setPrefsEnabled(res.subscription.enabled);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch notifications.');
    } finally {
      setNotifLoading(false);
    }
  }, [signedIn, onUnreadCountChange]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const dueFollowUps = applications.filter(
    (app) =>
      app.followUpDate &&
      app.stage !== 'Archived' &&
      app.stage !== 'Completed' &&
      app.stage !== 'Rejected' &&
      app.stage !== 'Offer' &&
      app.stage !== 'Offer Received'
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setSavingPrefs(true);
    setError(null);
    try {
      const countries = prefCountries
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const sectors = prefSectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await saveNotificationPreferences({
        profile: profile || {},
        preferredCountries: countries,
        preferredSectors: sectors,
        frequency: prefFrequency,
        channels: { inApp: chanInApp, email: chanEmail, push: chanPush },
        enabled: prefsEnabled,
      });
      onNotify?.(
        lang === 'fr'
          ? 'Préférences d’alertes enregistrées (actives même hors ligne).'
          : 'Alert preferences saved (active even when disconnected).'
      );
      setShowPrefs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleEnableBrowserPush = async () => {
    if (typeof Notification === 'undefined') {
      setPushStatus('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setPushStatus(permission);
    if (permission === 'granted') {
      setChanPush(true);
      onNotify?.(
        lang === 'fr'
          ? 'Notifications navigateur autorisées.'
          : 'Browser push notifications enabled.'
      );
    }
  };

  const handleRunMatchNow = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setRunningMatch(true);
    setError(null);
    try {
      const res = await runCandidateNotificationMatchNow({
        profile: profile || {},
        preferredCountries: prefCountries
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        preferredSectors: prefSectors
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotifications(res.notifications);
      const unread = res.notifications.filter((n) => !n.read).length;
      onUnreadCountChange?.(unread);
      onNotify?.(
        lang === 'fr'
          ? `${res.created} nouvelle(s) notification(s) générée(s) depuis les entreprises surveillées.`
          : `${res.created} new notification(s) generated from monitored companies.`
      );
      if (
        res.created > 0 &&
        chanPush &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification('JOBFOUNDS', {
          body: `${res.created} nouvelle(s) opportunité(s) compatible(s) détectée(s).`,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching check failed.');
    } finally {
      setRunningMatch(false);
    }
  };

  const handleMarkRead = async (id?: string) => {
    try {
      await markUserNotificationRead(id);
      const next = notifications.map((n) => (!id || n.id === id ? { ...n, read: true } : n));
      setNotifications(next);
      onUnreadCountChange?.(next.filter((n) => !n.read).length);
    } catch {
      // ignore
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const item: WatchlistItem = {
      id: `watch_${Date.now()}`,
      kind,
      label: label.trim(),
      country: country.trim() || 'Global',
      sector: sector.trim(),
      lastChecked: '',
      lastSignalSummary: '',
      unreadAlerts: 0,
    };
    onSaveWatchItem(item);
    setLabel('');
    setCountry('');
    setSector('');
  };

  const handleCheckOne = async (item: WatchlistItem) => {
    setScanningId(item.id);
    setError(null);
    try {
      const res = await checkWatchlistTarget({
        kind: item.kind,
        label: item.label,
        country: item.country,
        sector: item.sector,
        lang,
      });
      onSaveWatchItem({
        ...item,
        lastChecked: res.checkedAt,
        lastSignalSummary: `${res.classification}: ${res.summary}`,
        unreadAlerts: Math.max(0, Number(res.newSignalsCount || 0)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watchlist check failed.');
    } finally {
      setScanningId(null);
    }
  };

  const unreadServerCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <section className="bg-jf-navy text-white border border-jf-dark rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-jf-sky">
              <BellRing className="w-4 h-4" />
              <span>
                {lang === 'fr'
                  ? 'Centre de notifications automatiques & veille continue'
                  : 'Automated Notification Center & Continuous Watchlist'}
              </span>
            </div>
            <h1 className="font-display text-2xl font-semibold text-white">
              {lang === 'fr'
                ? 'Alertes personnalisées, veille entreprises & rappels CRM'
                : 'Personalized Alerts, Watchlist & Follow-Up Reminders'}
            </h1>
            <p className="text-sm text-jf-soft/85 max-w-3xl">
              {lang === 'fr'
                ? 'Recevez des alertes personnalisées lorsque nos workers en arrière-plan détectent une nouvelle offre, un signal de croissance ou un contact RH compatible avec votre profil.'
                : 'Receive tailored alerts whenever background workers detect a matching job, hiring signal, or verified HR contact aligned with your profile.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPrefs((v) => !v)}
              className="px-3.5 py-2 text-xs font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-lg inline-flex items-center gap-1.5"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Préférences d’alertes' : 'Alert Preferences'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunMatchNow()}
              disabled={runningMatch}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
            >
              {runningMatch ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>
                {lang === 'fr' ? 'Vérifier mes correspondances' : 'Check Matches Now'}
              </span>
            </button>
          </div>
        </div>

        {/* Configurable Notification Preferences Drawer */}
        {showPrefs && (
          <form
            onSubmit={handleSavePrefs}
            className="p-5 bg-jf-dark/90 border border-jf-sky/25 rounded-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs"
          >
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Pays ciblés (virgules)' : 'Target Countries'}
              </span>
              <input
                type="text"
                value={prefCountries}
                onChange={(e) => setPrefCountries(e.target.value)}
                placeholder="France, Suisse, Canada…"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Secteurs ciblés (virgules)' : 'Target Sectors'}
              </span>
              <input
                type="text"
                value={prefSectors}
                onChange={(e) => setPrefSectors(e.target.value)}
                placeholder="FinTech, IA, Énergie…"
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              />
            </label>
            <label className="space-y-1">
              <span className="text-jf-soft font-medium">
                {lang === 'fr' ? 'Fréquence' : 'Frequency'}
              </span>
              <select
                value={prefFrequency}
                onChange={(e) =>
                  setPrefFrequency(e.target.value as 'instant' | 'daily' | 'weekly')
                }
                className="w-full px-3 py-2 bg-white text-jf-navy rounded-lg"
              >
                <option value="instant">{lang === 'fr' ? 'Temps réel' : 'Instant'}</option>
                <option value="daily">{lang === 'fr' ? 'Quotidienne' : 'Daily'}</option>
                <option value="weekly">{lang === 'fr' ? 'Hebdomadaire' : 'Weekly'}</option>
              </select>
            </label>
            <div className="space-y-2">
              <span className="text-jf-soft font-medium block">
                {lang === 'fr' ? 'Canaux autorisés' : 'Allowed Channels'}
              </span>
              <div className="flex flex-wrap gap-3 text-white">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chanInApp}
                    onChange={(e) => setChanInApp(e.target.checked)}
                  />
                  <span>In-App</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chanEmail}
                    onChange={(e) => setChanEmail(e.target.checked)}
                  />
                  <span>
                    Email{' '}
                    <span className="text-jf-sky/80">
                      ({emailDeliveryAvailable ? 'Resend actif' : 'clé serveur requise'})
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => void handleEnableBrowserPush()}
                  className="text-jf-sky hover:underline"
                >
                  Push ({pushStatus})
                </button>
              </div>
            </div>
            <div className="md:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-jf-sky/20">
              <label className="inline-flex items-center gap-2 text-jf-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefsEnabled}
                  onChange={(e) => setPrefsEnabled(e.target.checked)}
                />
                <span>
                  {lang === 'fr'
                    ? 'Activer le matching automatique en arrière-plan (continue même déconnecté)'
                    : 'Enable autonomous background matching (runs even while disconnected)'}
                </span>
              </label>
              <button
                type="submit"
                disabled={savingPrefs}
                className="px-4 py-2 font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-1.5"
              >
                {savingPrefs && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{lang === 'fr' ? 'Enregistrer préférences' : 'Save Preferences'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="p-4 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-sm font-medium text-jf-navy"
        >
          {error}
        </div>
      )}

      {/* Personalized Server Notifications Inbox */}
      <section className="bg-white border border-jf-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-jf-border flex flex-wrap items-center justify-between gap-3 bg-jf-ice/50">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-jf-blue" />
            <h2 className="text-sm font-semibold text-jf-navy">
              {lang === 'fr' ? 'Boîte de notifications intelligentes' : 'Smart Notifications Inbox'}
            </h2>
            {unreadServerCount > 0 && (
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-jf-blue text-white">
                {unreadServerCount} {lang === 'fr' ? 'non lues' : 'unread'}
              </span>
            )}
          </div>
          {signedIn && unreadServerCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkRead()}
              className="text-xs font-medium text-jf-blue hover:underline inline-flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>{lang === 'fr' ? 'Tout marquer lu' : 'Mark all read'}</span>
            </button>
          )}
        </div>

        {!signedIn ? (
          <div className="p-6 text-center text-xs text-slate-600 space-y-2">
            <p>
              {lang === 'fr'
                ? 'Connectez-vous pour activer votre boîte de notifications personnalisées en arrière-plan.'
                : 'Sign in to enable your autonomous background notification inbox.'}
            </p>
            <button
              type="button"
              onClick={onRequireSignIn}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-jf-blue rounded-lg"
            >
              {lang === 'fr' ? 'Connexion Google' : 'Sign in with Google'}
            </button>
          </div>
        ) : notifLoading && notifications.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-jf-blue" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {lang === 'fr'
              ? 'Aucune notification générée pour le moment. Enregistrez vos préférences et surveillez des entreprises dans « Intelligence Entreprises ».'
              : 'No notifications generated yet. Save your preferences and monitor companies in "Company Intelligence".'}
          </div>
        ) : (
          <div className="divide-y divide-jf-border max-h-96 overflow-y-auto">
            {notifications.map((n) => {
              const href = safeExternalUrl(n.actionUrl);
              return (
                <div
                  key={n.id}
                  className={`p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                    n.read ? 'bg-white' : 'bg-jf-soft/35'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono uppercase px-1.5 py-0.5 rounded bg-jf-navy text-jf-sky">
                        {n.type}
                      </span>
                      {n.companyName && (
                        <span className="font-semibold text-jf-dark">{n.companyName}</span>
                      )}
                      <span className="font-mono text-slate-400">
                        {n.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                      {n.channelEmailSent && (
                        <span className="inline-flex items-center gap-1 text-jf-blue">
                          <Mail className="w-3 h-3" /> Email envoyé
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-jf-navy">{n.title}</div>
                    <p className="text-xs text-slate-600 leading-relaxed">{n.body}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-jf-blue hover:underline inline-flex items-center gap-0.5"
                      >
                        <span>{lang === 'fr' ? 'Ouvrir' : 'Open'}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(n.id)}
                        className="px-2.5 py-1 text-xs font-medium text-jf-navy bg-white border border-jf-border rounded-md hover:bg-jf-ice"
                      >
                        {lang === 'fr' ? 'Marquer lu' : 'Read'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Manual Watchlist Form + Reminders Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-8 bg-white border border-jf-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-jf-border space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-jf-navy inline-flex items-center gap-2">
                <Bell className="w-4 h-4 text-jf-blue" />
                <span>{lang === 'fr' ? 'Cibles de veille manuelle' : 'Active Watchlist Targets'}</span>
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {watchlist.length}
              </span>
            </div>

            <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'company' | 'search')}
                className="lg:col-span-2 px-3 py-2 text-xs border border-jf-border rounded-lg bg-white"
              >
                <option value="company">{lang === 'fr' ? 'Entreprise' : 'Company'}</option>
                <option value="search">{lang === 'fr' ? 'Recherche' : 'Saved Search'}</option>
              </select>
              <input
                type="text"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  kind === 'company'
                    ? lang === 'fr'
                      ? 'Ex. Mistral AI, Verkor, Climeworks…'
                      : 'e.g. Mistral AI, Verkor, Climeworks…'
                    : lang === 'fr'
                      ? 'Ex. Senior Product Manager IA'
                      : 'e.g. Senior AI Product Manager'
                }
                className="lg:col-span-4 px-3 py-2 text-xs border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder={lang === 'fr' ? 'Pays' : 'Country'}
                className="lg:col-span-2 px-3 py-2 text-xs border border-jf-border rounded-lg"
              />
              <input
                type="text"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder={lang === 'fr' ? 'Secteur' : 'Sector'}
                className="lg:col-span-2 px-3 py-2 text-xs border border-jf-border rounded-lg"
              />
              <button
                type="submit"
                className="lg:col-span-2 px-3 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'fr' ? 'Ajouter' : 'Add'}</span>
              </button>
            </form>
          </div>

          {watchlist.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              {lang === 'fr'
                ? 'Ajoutez une entreprise ou une recherche ci-dessus pour activer la veille.'
                : 'Add a company or saved search above to monitor live hiring signals.'}
            </div>
          ) : (
            <div className="divide-y divide-jf-border">
              {watchlist.map((item) => (
                <div key={item.id} className="p-5 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span className="font-semibold text-jf-dark">
                          {item.kind === 'company'
                            ? lang === 'fr'
                              ? 'Entreprise suivie'
                              : 'Watched Company'
                            : lang === 'fr'
                              ? 'Recherche sauvegardée'
                              : 'Saved Search'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.country}</span>
                        {item.sector && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.sector}</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-jf-navy">{item.label}</h3>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {item.unreadAlerts > 0 && (
                        <span className="font-mono text-xs font-semibold tabular-nums text-jf-blue">
                          +{item.unreadAlerts} {lang === 'fr' ? 'signaux' : 'signals'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCheckOne(item)}
                        disabled={scanningId === item.id}
                        className="px-3 py-1.5 text-xs font-medium text-jf-navy bg-jf-ice hover:bg-jf-soft border border-jf-border disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {scanningId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>{lang === 'fr' ? 'Vérifier' : 'Check Now'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteWatchItem(item.id)}
                        aria-label="Remove watch"
                        className="p-1.5 text-slate-400 hover:text-jf-navy"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {item.lastSignalSummary && (
                    <div className="text-xs text-slate-600 leading-relaxed pt-1">
                      <span className="font-mono tabular-nums text-slate-400 mr-2">
                        [{item.lastChecked}]
                      </span>
                      {item.lastSignalSummary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Follow-Up Reminders from CRM */}
        <section className="xl:col-span-4 bg-white border border-jf-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-jf-border flex items-center justify-between bg-jf-ice/50">
            <h2 className="text-sm font-semibold text-jf-navy inline-flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-jf-blue" />
              <span>{lang === 'fr' ? 'Rappels de relance CRM' : 'CRM Follow-Up Reminders'}</span>
            </h2>
            <button
              type="button"
              onClick={onJumpToTracker}
              className="text-xs font-medium text-jf-blue hover:underline"
            >
              CRM
            </button>
          </div>
          {dueFollowUps.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              {lang === 'fr'
                ? 'Aucune date de relance planifiée. Définissez une date dans le CRM Candidatures.'
                : 'No follow-up dates set. Add a follow-up date in the Recruitment CRM.'}
            </div>
          ) : (
            <div className="divide-y divide-jf-border">
              {dueFollowUps.map((app) => {
                const isOverdue = (app.followUpDate || '') <= todayStr;
                return (
                  <div key={app.id} className="p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          isOverdue ? 'text-jf-blue' : 'text-slate-600'
                        }`}
                      >
                        {app.followUpDate}{' '}
                        {isOverdue ? (lang === 'fr' ? '· À relancer' : '· Due') : ''}
                      </span>
                      <span className="text-slate-500">{app.company}</span>
                    </div>
                    <div className="text-sm font-medium text-jf-navy">{app.role}</div>
                    {app.nextAction && (
                      <p className="text-xs text-jf-blue truncate">{app.nextAction}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
