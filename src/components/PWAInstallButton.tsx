import { useEffect, useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { Lang } from '../types';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

export function PWAInstallButton({
  lang,
  variant = 'light',
}: {
  lang: Lang;
  variant?: 'light' | 'dark';
}) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const label =
    lang === 'fr'
      ? 'Installer l’app (PWA)'
      : lang === 'es'
        ? 'Instalar app (PWA)'
        : lang === 'de'
          ? 'App installieren'
          : lang === 'pt'
            ? 'Instalar app'
            : lang === 'ar'
              ? 'تثبيت التطبيق'
              : 'Install App (PWA)';

  const btnClass =
    variant === 'dark'
      ? 'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-jf-sky bg-jf-dark hover:bg-jf-blue/30 border border-jf-sky/25 rounded-lg transition-colors whitespace-nowrap'
      : 'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-jf-navy bg-jf-soft/60 hover:bg-jf-soft border border-jf-sky rounded-lg transition-colors whitespace-nowrap';

  if (isInstallable) {
    return (
      <button type="button" onClick={install} className={btnClass}>
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setShowGuide(true)} className={btnClass}>
        <Smartphone className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-jf-navy/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-jf-border p-6 space-y-4 text-jf-navy">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-jf-navy">
                {lang === 'fr' ? 'Installer JOBFOUNDS' : 'Install JOBFOUNDS'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close"
                className="p-1 text-slate-400 hover:text-jf-navy"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {isIOS
                ? lang === 'fr'
                  ? '1. Touchez le bouton Partager dans la barre Safari.\n2. Faites défiler et choisissez « Sur l’écran d’accueil ».'
                  : '1. Tap the Share button in Safari.\n2. Scroll down and select "Add to Home Screen".'
                : lang === 'fr'
                  ? 'Dans Chrome, Edge ou Android, ouvrez le menu du navigateur et sélectionnez « Installer JOBFOUNDS » ou « Ajouter à l’écran d’accueil ».'
                  : 'In Chrome, Edge, or Android, open your browser menu and select "Install JOBFOUNDS" or "Add to Home Screen".'}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg"
            >
              {lang === 'fr' ? 'Compris' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator({ lang }: { lang: Lang }) {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-16 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-jf-navy border border-jf-sky/40 px-3.5 py-2 text-xs font-medium text-white shadow-md"
    >
      <WifiOff className="w-3.5 h-3.5 text-jf-sky shrink-0" />
      <span>
        {lang === 'fr'
          ? 'Mode hors ligne — Données locales affichées.'
          : 'Offline Mode — Cached local data active.'}
      </span>
    </div>
  );
}
