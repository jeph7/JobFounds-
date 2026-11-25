import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Rocket,
  Save,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  ConnectionTestResult,
  DeployAuthMethod,
  DeployDashboardState,
  DeployProtocol,
  DeployRunRecord,
  DeployStepState,
  DomainHealthCheckResult,
  Lang,
} from '../types';
import {
  checkAdminLiveDomain,
  downloadAdminDeployBundle,
  fetchAdminDeployRun,
  fetchAdminDeployState,
  saveAdminDeployConfig,
  saveAdminDeployEnv,
  testAdminHostingerConnection,
  triggerAdminHostingerDeploy,
} from '../utils/api';

interface HostingerDeployPanelProps {
  lang: Lang;
  onNotify: (msg: string) => void;
}

function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

export function HostingerDeployPanel({ lang, onNotify }: HostingerDeployPanelProps) {
  const [state, setState] = useState<DeployDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hostinger configuration form state (never persisted to localStorage)
  const [protocol, setProtocol] = useState<DeployProtocol>('ssh');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(65002);
  const [username, setUsername] = useState('');
  const [remotePath, setRemotePath] = useState('~/domains/jobfounds.com/nodejs');
  const [domain, setDomain] = useState('jobfounds.com');
  const [environment, setEnvironment] = useState<'production' | 'staging'>('production');
  const [nodeVersion, setNodeVersion] = useState('22.x');
  const [authMethod, setAuthMethod] = useState<DeployAuthMethod>('ssh_key');
  const [sshPrivateKeyInput, setSshPrivateKeyInput] = useState('');
  const [sshPassphraseInput, setSshPassphraseInput] = useState('');
  // Transient one-time session password (cleared from React memory right after submit)
  const [sessionPassword, setSessionPassword] = useState('');

  // Environment variables form state
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [envSaving, setEnvSaving] = useState(false);

  // Operational state
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<ConnectionTestResult | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [domainResult, setDomainResult] = useState<DomainHealthCheckResult | null>(null);
  const [startingDeploy, setStartingDeploy] = useState(false);
  const [downloadingBundle, setDownloadingBundle] = useState(false);

  // Active / inspected deployment run
  const [selectedRun, setSelectedRun] = useState<DeployRunRecord | null>(null);

  const hydrateFromState = useCallback((data: DeployDashboardState) => {
    setState(data);
    setProtocol(data.config.protocol);
    setHost(data.config.host);
    setPort(data.config.port);
    setUsername(data.config.username);
    setRemotePath(data.config.remotePath);
    setDomain(data.config.domain);
    setEnvironment(data.config.environment);
    setNodeVersion(data.config.nodeVersion);
    setAuthMethod(data.config.authMethod);

    const drafts: Record<string, string> = {};
    for (const item of data.envVars) {
      drafts[item.key] = item.isSecret ? '' : item.value;
    }
    setEnvDrafts(drafts);

    if (data.latestRun) {
      setSelectedRun((prev) => {
        if (!prev || prev.id === data.latestRun!.id) return data.latestRun!;
        return prev;
      });
    }
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDeployState();
      hydrateFromState(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger l’état de déploiement Hostinger.'
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromState]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Live poll active deployment run every 2 seconds until finished
  useEffect(() => {
    if (!selectedRun || selectedRun.status !== 'running') return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetchAdminDeployRun(selectedRun.id);
        if (cancelled) return;
        setSelectedRun(res.run);
        if (res.run.status !== 'running') {
          window.clearInterval(interval);
          const refreshed = await fetchAdminDeployState();
          if (!cancelled) {
            setState(refreshed);
          }
          if (res.run.status === 'succeeded') {
            onNotify(
              lang === 'fr'
                ? `Déploiement JOBFOUNDS terminé avec succès sur https://${res.run.domain}.`
                : `JOBFOUNDS deployment succeeded on https://${res.run.domain}.`
            );
          } else if (res.run.status === 'failed') {
            onNotify(
              lang === 'fr'
                ? 'Le déploiement a échoué — consultez les journaux ci-dessous.'
                : 'Deployment failed — inspect the logs below.'
            );
          }
        }
      } catch {
        // Keep polling on transient network blip
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedRun, lang, onNotify]);

  const needsSessionPassword = protocol === 'ftps' || authMethod === 'password';

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setError(null);
    try {
      const res = await saveAdminDeployConfig({
        protocol,
        host: host.trim(),
        port: Number(port) || (protocol === 'ftps' ? 21 : 65002),
        username: username.trim(),
        remotePath: remotePath.trim(),
        domain: domain.trim(),
        environment,
        nodeVersion: nodeVersion.trim() || '22.x',
        authMethod: protocol === 'ftps' ? 'password' : authMethod,
        sshPrivateKey: sshPrivateKeyInput.trim() || undefined,
        sshPassphrase: sshPassphraseInput || undefined,
      });
      setSshPrivateKeyInput('');
      setSshPassphraseInput('');
      hydrateFromState(res.state);
      onNotify(
        lang === 'fr'
          ? 'Configuration Hostinger enregistrée côté serveur.'
          : 'Hostinger configuration saved securely on server.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’enregistrement de configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleClearSshKey = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await saveAdminDeployConfig({
        protocol,
        host: host.trim(),
        port: Number(port) || 65002,
        username: username.trim(),
        remotePath: remotePath.trim(),
        domain: domain.trim(),
        environment,
        nodeVersion: nodeVersion.trim() || '22.x',
        authMethod,
        clearSshKey: true,
      });
      hydrateFromState(res.state);
      onNotify(lang === 'fr' ? 'Clé SSH supprimée du coffre-fort serveur.' : 'SSH key removed from server vault.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer la clé SSH.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveEnvVars = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    setEnvSaving(true);
    setError(null);
    try {
      const entries = state.envVars
        .map((item) => {
          const val = envDrafts[item.key] ?? '';
          if (item.isSecret) {
            if (!val.trim()) return null; // Keep existing secret untouched
            return { key: item.key, value: val.trim() };
          }
          return { key: item.key, value: val.trim() };
        })
        .filter((x): x is { key: string; value: string } => Boolean(x));

      if (entries.length === 0) {
        onNotify(lang === 'fr' ? 'Aucune modification à enregistrer.' : 'No changes to save.');
        return;
      }

      const res = await saveAdminDeployEnv(entries);
      hydrateFromState(res.state);
      onNotify(
        lang === 'fr'
          ? 'Variables d’environnement chiffrées et enregistrées côté serveur.'
          : 'Environment variables encrypted and saved on server.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde des variables.');
    } finally {
      setEnvSaving(false);
    }
  };

  const handleClearSingleEnv = async (envKey: string) => {
    setEnvSaving(true);
    setError(null);
    try {
      const res = await saveAdminDeployEnv([{ key: envKey, clear: true }]);
      hydrateFromState(res.state);
      onNotify(
        lang === 'fr' ? `Variable ${envKey} effacée du serveur.` : `Variable ${envKey} cleared from server.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setEnvSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setError(null);
    const transientPwd = needsSessionPassword ? sessionPassword : undefined;
    try {
      const res = await testAdminHostingerConnection(transientPwd);
      setConnResult(res.result);
      setState(res.state);
      onNotify(res.result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test de connexion échoué.');
    } finally {
      setTestingConn(false);
    }
  };

  const handleCheckDomain = async () => {
    setCheckingDomain(true);
    setError(null);
    try {
      const res = await checkAdminLiveDomain(domain.trim() || 'jobfounds.com');
      setDomainResult(res.result);
      onNotify(
        res.result.healthOk
          ? `https://${res.result.domain} répond HTTP ${res.result.httpStatus} (${res.result.latencyMs} ms).`
          : res.result.error || `Statut HTTP ${res.result.httpStatus ?? 'injoignable'}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vérification du domaine échouée.');
    } finally {
      setCheckingDomain(false);
    }
  };

  const handleDeployNow = async () => {
    if (needsSessionPassword && !sessionPassword.trim()) {
      setError(
        lang === 'fr'
          ? 'Renseignez le mot de passe de session SSH/FTPS ci-dessous pour autoriser ce déploiement (il ne sera jamais enregistré).'
          : 'Enter the one-time SSH/FTPS session password below to authorize this deployment (never stored).'
      );
      return;
    }
    setStartingDeploy(true);
    setError(null);
    const transientPwd = needsSessionPassword ? sessionPassword : undefined;
    try {
      const res = await triggerAdminHostingerDeploy(transientPwd);
      // Immediately clear transient password from browser memory
      setSessionPassword('');
      setSelectedRun(res.run);
      onNotify(
        lang === 'fr'
          ? 'Déploiement JOBFOUNDS lancé — suivi en direct activé.'
          : 'JOBFOUNDS deployment started — live progress tracking active.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de lancer le déploiement.');
    } finally {
      setStartingDeploy(false);
    }
  };

  const handleDownloadBundle = async () => {
    setDownloadingBundle(true);
    setError(null);
    try {
      await downloadAdminDeployBundle();
      onNotify(lang === 'fr' ? 'Archive de production téléchargée.' : 'Production release archive downloaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible.');
    } finally {
      setDownloadingBundle(false);
    }
  };

  const configuredEnvCount = useMemo(
    () => (state?.envVars ? state.envVars.filter((v) => v.configured).length : 0),
    [state]
  );

  const runProgressPercent = useMemo(() => {
    if (!selectedRun || selectedRun.steps.length === 0) return 0;
    const finished = selectedRun.steps.filter(
      (s) => s.status === 'completed' || s.status === 'warning' || s.status === 'failed' || s.status === 'skipped'
    ).length;
    return Math.round((finished / selectedRun.steps.length) * 100);
  }, [selectedRun]);

  const renderStepIcon = (status: DeployStepState) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-jf-blue animate-spin shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  if (loading && !state) {
    return (
      <div className="py-12 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-jf-blue" />
        <span>Chargement du centre de déploiement Hostinger…</span>
      </div>
    );
  }

  const isRunning = selectedRun?.status === 'running';
  const latestRun = state?.latestRun || null;

  return (
    <div className="space-y-6">
      {/* Header & Main One-Click Deploy Action */}
      <div className="p-5 bg-jf-navy text-white rounded-xl border border-jf-dark flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-jf-sky">
            <Server className="w-4 h-4" />
            <span>Déploiement Production Hostinger · https://{domain || 'jobfounds.com'}</span>
          </div>
          <h2 className="font-display text-lg font-semibold text-white">
            Centre de Déploiement Automatisé JOBFOUNDS
          </h2>
          <p className="text-xs text-jf-soft/90 max-w-3xl leading-relaxed">
            Configurez votre accès SSH/FTPS Hostinger et vos variables d’environnement chiffrées côté serveur une
            seule fois. Le déploiement sauvegarde automatiquement les données existantes, compile l’application,
            transfère les fichiers sans écraser SQLite ni Firebase, installe les dépendances, redémarre Node.js et
            vérifie <span className="font-mono text-jf-sky">https://{domain || 'jobfounds.com'}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={testingConn || isRunning}
            onClick={() => void handleTestConnection()}
            className="px-3.5 py-2.5 text-xs font-semibold text-white bg-jf-dark border border-jf-sky/30 hover:bg-jf-blue rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {testingConn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
            <span>Tester la connexion</span>
          </button>

          <button
            type="button"
            disabled={checkingDomain}
            onClick={() => void handleCheckDomain()}
            className="px-3.5 py-2.5 text-xs font-semibold text-white bg-jf-dark border border-jf-sky/30 hover:bg-jf-blue rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {checkingDomain ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            <span>Vérifier {domain || 'jobfounds.com'}</span>
          </button>

          <button
            type="button"
            disabled={startingDeploy || isRunning}
            onClick={() => void handleDeployNow()}
            className="px-4 py-2.5 text-xs font-semibold text-jf-navy bg-jf-sky hover:bg-white rounded-lg inline-flex items-center gap-2 shadow-sm disabled:opacity-60"
          >
            {startingDeploy || isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            <span>
              {isRunning ? 'Déploiement en cours…' : 'Déployer JOBFOUNDS sur Hostinger'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-900 flex items-start gap-2.5"
        >
          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold">Erreur de déploiement ou de configuration</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {/* Status Tracking Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">Configuration Hostinger</div>
          <div className="text-xs font-semibold text-jf-navy">
            {state?.preflight.connectionConfigured ? 'Configurée' : 'À compléter'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            {host ? `${protocol.toUpperCase()} · ${host}:${port}` : 'Aucun serveur défini'}
          </div>
        </div>

        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">État de connexion</div>
          <div
            className={`text-xs font-semibold ${
              state?.config.lastConnectionStatus === 'connected'
                ? 'text-emerald-700'
                : state?.config.lastConnectionStatus === 'failed'
                  ? 'text-red-700'
                  : 'text-slate-600'
            }`}
          >
            {state?.config.lastConnectionStatus === 'connected'
              ? 'Connecté'
              : state?.config.lastConnectionStatus === 'failed'
                ? 'Échec'
                : 'Non testé'}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {formatDateTime(state?.config.lastConnectionCheckedAt, lang)}
          </div>
        </div>

        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">Variables d’env.</div>
          <div
            className={`text-xs font-semibold font-mono ${
              state?.preflight.requiredEnvReady ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {configuredEnvCount} / {state?.envVars.length ?? 0} configurées
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {state?.preflight.requiredEnvReady
              ? 'Obligatoires OK'
              : `Manque : ${state?.preflight.missingRequiredEnv.join(', ')}`}
          </div>
        </div>

        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">État du build</div>
          <div className="text-xs font-semibold text-jf-navy">
            {latestRun?.buildStatus === 'succeeded'
              ? 'Réussi (dist/)'
              : latestRun?.buildStatus === 'running'
                ? 'Compilation…'
                : latestRun?.buildStatus === 'failed'
                  ? 'Échec'
                  : 'En attente'}
          </div>
          <div className="text-[11px] text-slate-500">
            Sauvegardes : <span className="font-mono">{state?.backupsCount ?? 0}</span>
          </div>
        </div>

        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">Serveur {domain}</div>
          <div
            className={`text-xs font-semibold ${
              domainResult?.healthOk || latestRun?.serverStatus === 'online'
                ? 'text-emerald-700'
                : domainResult?.reachable || latestRun?.serverStatus === 'degraded'
                  ? 'text-amber-700'
                  : 'text-slate-600'
            }`}
          >
            {domainResult
              ? domainResult.healthOk
                ? `En ligne (${domainResult.latencyMs}ms)`
                : domainResult.reachable
                  ? `HTTP ${domainResult.httpStatus}`
                  : 'Injoignable'
              : latestRun?.serverStatus === 'online'
                ? 'En ligne'
                : latestRun?.serverStatus === 'degraded'
                  ? 'Partiel'
                  : 'À vérifier'}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {domainResult ? formatDateTime(domainResult.checkedAt, lang) : 'Cliquez « Vérifier »'}
          </div>
        </div>

        <div className="p-3.5 bg-jf-ice border border-jf-border rounded-xl space-y-1">
          <div className="text-[11px] text-slate-500">Dernier déploiement</div>
          <div className="text-xs font-semibold text-jf-navy">
            {latestRun
              ? latestRun.status === 'succeeded'
                ? 'Réussi'
                : latestRun.status === 'completed_with_warnings'
                  ? 'Avertissements'
                  : latestRun.status === 'running'
                    ? 'En cours'
                    : 'Échec'
              : 'Aucun'}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {formatDateTime(latestRun?.finishedAt || latestRun?.startedAt, lang)}
          </div>
        </div>
      </div>

      {/* Live Connection Test & Domain Verification Banners */}
      {(connResult || domainResult) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {connResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                connResult.connected
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div className="font-semibold flex items-center gap-1.5">
                {connResult.connected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span>Test {connResult.protocol.toUpperCase()} Hostinger</span>
              </div>
              <p className="leading-relaxed">{connResult.message}</p>
            </div>
          )}

          {domainResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                domainResult.healthOk
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50/80 border-amber-200 text-amber-950'
              }`}
            >
              <div className="font-semibold flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                <span>
                  Vérification {domainResult.url} · {domainResult.latencyMs} ms
                </span>
              </div>
              <p className="leading-relaxed">
                {domainResult.healthOk
                  ? `HTTP ${domainResult.httpStatus} — API JOBFOUNDS opérationnelle (moteur : ${domainResult.engineStatus || 'ok'}).`
                  : domainResult.error || `HTTP ${domainResult.httpStatus ?? 'aucune réponse'}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Hostinger Unlimited Architecture Compatibility Card (GitHub/ZIP + Cron Jobs + Persistent SQLite) */}
      <div className="p-4 bg-jf-ice border border-jf-border rounded-xl grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
        <div className="space-y-1">
          <div className="font-semibold text-jf-navy">Déploiement GitHub / ZIP (Hostinger Unlimited)</div>
          <p className="text-slate-600 leading-relaxed">
            Node.js <span className="font-mono font-semibold text-jf-navy">22.x</span> · Build{' '}
            <span className="font-mono text-jf-navy">npm run build</span> · Démarrage{' '}
            <span className="font-mono text-jf-navy">npm start</span>. Aucune clé de compte de service Firebase n’est
            requise : Firebase Auth/Firestore est déjà configuré via{' '}
            <span className="font-mono text-jf-navy">firebase-applet-config.json</span>.
          </p>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-jf-navy">Worker par Cron Jobs (limite 30 min respectée)</div>
          <p className="text-slate-600 leading-relaxed">
            Avec <span className="font-mono text-jf-navy">WORKER_MODE=cron</span>, aucun processus infini ne tourne en
            arrière-plan. Planifiez dans hPanel (toutes les 15 min) :{' '}
            <span className="font-mono text-jf-blue">npm run cron:tick</span> ou un appel{' '}
            <span className="font-mono text-jf-blue">POST /api/cron/tick</span> avec l’en-tête{' '}
            <span className="font-mono">X-Cron-Secret</span>.
          </p>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-jf-navy">Persistance SQLite hors dossier de build</div>
          <p className="text-slate-600 leading-relaxed">
            Définissez <span className="font-mono text-jf-navy">JOBFOUNDS_DATA_DIR</span> vers un dossier permanent
            externe (ex. <span className="font-mono">/home/uXXXXXXXXX/jobfounds_data</span>) pour préserver toutes les
            données SQLite entre les redéploiements GitHub/ZIP et redémarrages.
          </p>
        </div>
      </div>

      {/* Two-Column Configuration Layout: Hostinger Connection + Encrypted Env Vault */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 1. Hostinger Server Configuration */}
        <form
          onSubmit={handleSaveConfig}
          className="bg-white border border-jf-border rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-jf-border">
            <div>
              <h3 className="text-sm font-semibold text-jf-navy flex items-center gap-2">
                <Server className="w-4 h-4 text-jf-blue" />
                <span>1. Configuration de l’hébergement Hostinger</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Protocole réel pris en charge par Hostinger (SSH/SFTP port 65002 recommandé, ou FTPS).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadState()}
              className="p-1.5 text-slate-500 hover:text-jf-navy rounded-lg border border-jf-border"
              title="Recharger"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-jf-navy">Méthode de déploiement</span>
              <select
                value={protocol}
                onChange={(e) => {
                  const next = e.target.value as DeployProtocol;
                  setProtocol(next);
                  if (next === 'ftps') {
                    setPort(21);
                    setAuthMethod('password');
                  } else {
                    setPort(65002);
                    setAuthMethod('ssh_key');
                  }
                }}
                className="w-full px-3 py-2 border border-jf-border rounded-lg bg-white text-jf-navy"
              >
                <option value="ssh">SSH / SFTP (Recommandé — Automatisé)</option>
                <option value="ftps">FTPS chiffré (Transfert TLS uniquement)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-jf-navy">Adresse du serveur Hostinger</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="ex. 147.93.xx.xx ou ssh.jobfounds.com"
                className="w-full px-3 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-jf-navy">Port {protocol === 'ssh' ? 'SSH' : 'FTPS'}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full px-3 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-jf-navy">Nom d’utilisateur SSH / FTP</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex. u123456789"
                autoComplete="off"
                className="w-full px-3 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
              />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="font-semibold text-jf-navy">Répertoire de destination sur Hostinger</span>
              <input
                type="text"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="~/domains/jobfounds.com/nodejs"
                className="w-full px-3 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-jf-navy">Domaine principal</span>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="jobfounds.com"
                className="w-full px-3 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="font-semibold text-jf-navy">Environnement</span>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'production' | 'staging')}
                  className="w-full px-2.5 py-2 border border-jf-border rounded-lg bg-white text-jf-navy"
                >
                  <option value="production">production</option>
                  <option value="staging">staging</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-jf-navy">Node.js</span>
                <input
                  type="text"
                  value={nodeVersion}
                  onChange={(e) => setNodeVersion(e.target.value)}
                  placeholder="22.x"
                  className="w-full px-2.5 py-2 border border-jf-border rounded-lg font-mono text-jf-navy"
                />
              </label>
            </div>
          </div>

          {/* Authentication Security Block */}
          <div className="p-4 bg-jf-ice border border-jf-border rounded-xl space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-jf-navy flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-jf-blue" />
                <span>Authentification sécurisée Hostinger</span>
              </span>
              {protocol === 'ssh' && (
                <select
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value as DeployAuthMethod)}
                  className="px-2.5 py-1 border border-jf-border rounded-md bg-white text-jf-navy font-medium"
                >
                  <option value="ssh_key">Clé privée SSH (recommandée)</option>
                  <option value="password">Mot de passe de session (non stocké)</option>
                </select>
              )}
            </div>

            {protocol === 'ssh' && authMethod === 'ssh_key' ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span
                    className={
                      state?.config.hasSshKey ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'
                    }
                  >
                    {state?.config.hasSshKey
                      ? 'Clé privée SSH enregistrée et chiffrée côté serveur (AES-256-GCM).'
                      : 'Aucune clé privée SSH enregistrée.'}
                  </span>
                  {state?.config.hasSshKey && (
                    <button
                      type="button"
                      onClick={() => void handleClearSshKey()}
                      className="text-red-700 hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Supprimer la clé</span>
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={sshPrivateKeyInput}
                  onChange={(e) => setSshPrivateKeyInput(e.target.value)}
                  placeholder={
                    state?.config.hasSshKey
                      ? 'Laissez vide pour conserver la clé SSH chiffrée actuelle, ou collez une nouvelle clé PEM/OpenSSH…'
                      : '-----BEGIN OPENSSH PRIVATE KEY-----\n...'
                  }
                  className="w-full px-3 py-2 border border-jf-border rounded-lg bg-white font-mono text-[11px] text-jf-navy"
                />
                <input
                  type="password"
                  value={sshPassphraseInput}
                  onChange={(e) => setSshPassphraseInput(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Passphrase de la clé SSH (optionnel — laissez vide si aucune)"
                  className="w-full px-3 py-2 border border-jf-border rounded-lg bg-white text-jf-navy"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Par sécurité, le mot de passe Hostinger n’est <strong>jamais enregistré</strong> ni dans le
                  navigateur ni en base de données. Saisissez-le uniquement ici au moment de tester ou lancer le
                  déploiement : il est effacé immédiatement après l’envoi.
                </p>
                <input
                  type="password"
                  value={sessionPassword}
                  onChange={(e) => setSessionPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={`Mot de passe de session ${protocol.toUpperCase()} (usage unique)`}
                  className="w-full px-3 py-2 border border-jf-border rounded-lg bg-white text-jf-navy"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Chiffrement serveur actif · Aucune donnée persistance écrasée</span>
            </span>
            <button
              type="submit"
              disabled={savingConfig}
              className="px-4 py-2 text-xs font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {savingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Enregistrer la configuration Hostinger</span>
            </button>
          </div>
        </form>

        {/* 2. Production Environment Variables Vault (Server-Side Only) */}
        <form
          onSubmit={handleSaveEnvVars}
          className="bg-white border border-jf-border rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-jf-border">
            <div>
              <h3 className="text-sm font-semibold text-jf-navy flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-jf-blue" />
                <span>2. Variables d’environnement de production</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Stockées chiffrées côté serveur (jamais exposées dans le frontend ni sur GitHub).
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              {configuredEnvCount}/{state?.envVars.length ?? 0}
            </span>
          </div>

          <div className="space-y-3 max-h-[470px] overflow-y-auto pr-1">
            {(state?.envVars || []).map((item) => (
              <div key={item.key} className="p-3 bg-jf-ice/60 border border-jf-border rounded-lg space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-jf-navy truncate">{item.key}</span>
                    {item.required && (
                      <span className="text-[10px] font-semibold text-jf-blue">Obligatoire</span>
                    )}
                    {item.isSecret && (
                      <span className="text-[10px] font-medium text-slate-500 inline-flex items-center gap-0.5">
                        <Lock className="w-2.5 h-2.5" /> Secret
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] font-semibold ${
                        item.configured ? 'text-emerald-700' : item.required ? 'text-amber-700' : 'text-slate-400'
                      }`}
                    >
                      {item.configured ? 'Configurée' : 'Manquante'}
                    </span>
                    {item.configured && item.isSecret && (
                      <button
                        type="button"
                        onClick={() => void handleClearSingleEnv(item.key)}
                        className="text-[11px] text-slate-500 hover:text-red-700"
                        title="Effacer la valeur stockée"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">{item.description}</p>
                <input
                  type={item.isSecret ? 'password' : 'text'}
                  autoComplete="new-password"
                  value={envDrafts[item.key] ?? ''}
                  onChange={(e) =>
                    setEnvDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))
                  }
                  placeholder={
                    item.isSecret
                      ? item.configured
                        ? '•••••••••••• (chiffrée côté serveur — laissez vide pour conserver)'
                        : `Saisir ${item.key}…`
                      : `Valeur pour ${item.key}`
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-jf-border rounded-md bg-white text-jf-navy"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-500">
              Écrit automatiquement dans <span className="font-mono">.env</span> (chmod 600) sur Hostinger.
            </span>
            <button
              type="submit"
              disabled={envSaving}
              className="px-4 py-2 text-xs font-semibold text-white bg-jf-blue hover:bg-jf-dark rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {envSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Enregistrer les variables côté serveur</span>
            </button>
          </div>
        </form>
      </div>

      {/* 3. Live 9-Step Deployment Pipeline Tracker & Redacted Logs */}
      <div className="bg-white border border-jf-border rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-jf-border">
          <div>
            <h3 className="text-sm font-semibold text-jf-navy flex items-center gap-2">
              <Terminal className="w-4 h-4 text-jf-blue" />
              <span>3. Progression du déploiement, journaux et historique</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Suivi temps réel des 9 étapes de mise en production. Tous les secrets sont automatiquement masqués dans
              les journaux.
            </p>
          </div>
          {state?.hasDownloadableBundle && (
            <button
              type="button"
              disabled={downloadingBundle}
              onClick={() => void handleDownloadBundle()}
              className="px-3 py-1.5 text-xs font-semibold text-jf-navy bg-jf-ice border border-jf-border hover:bg-jf-soft/60 rounded-lg inline-flex items-center gap-1.5"
            >
              {downloadingBundle ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Télécharger le bundle (.tar.gz)</span>
            </button>
          )}
        </div>

        {selectedRun ? (
          <div className="space-y-4">
            {/* Run Summary + Progress Bar */}
            <div className="p-4 bg-jf-ice border border-jf-border rounded-xl space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-jf-navy">{selectedRun.id}</span>
                  <span className="text-slate-500">·</span>
                  <span className="uppercase font-mono text-slate-600">{selectedRun.protocol}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono text-jf-blue">https://{selectedRun.domain}</span>
                </div>
                <div className="font-mono text-jf-navy font-semibold">
                  {runProgressPercent}% ·{' '}
                  {selectedRun.status === 'running'
                    ? 'En cours'
                    : selectedRun.status === 'succeeded'
                      ? 'Déployé'
                      : selectedRun.status === 'completed_with_warnings'
                        ? 'Terminé avec avertissements'
                        : 'Échec'}
                </div>
              </div>
              <div className="w-full h-2 bg-white border border-jf-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    selectedRun.status === 'failed'
                      ? 'bg-red-600'
                      : selectedRun.status === 'completed_with_warnings'
                        ? 'bg-amber-500'
                        : 'bg-jf-blue'
                  }`}
                  style={{ width: `${Math.max(4, runProgressPercent)}%` }}
                />
              </div>
              {selectedRun.errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 font-medium">
                  {selectedRun.errorMessage}
                </div>
              )}
            </div>

            {/* 9-Step Timeline & Live Console Logs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-jf-border rounded-xl divide-y divide-jf-border">
                {selectedRun.steps.map((step) => (
                  <div key={step.id} className="p-3 flex items-start gap-3 text-xs">
                    <div className="mt-0.5">{renderStepIcon(step.status)}</div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-jf-navy">
                          {step.order}. {step.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          {step.finishedAt
                            ? formatDateTime(step.finishedAt, lang).split(' ').pop()
                            : step.status === 'running'
                              ? 'en cours'
                              : ''}
                        </span>
                      </div>
                      {step.detail && (
                        <p className="text-[11px] text-slate-600 leading-relaxed">{step.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-jf-navy text-jf-ice rounded-xl p-4 border border-jf-dark flex flex-col">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-jf-dark text-[11px] text-jf-sky font-mono">
                  <span>JOURNAUX DE DÉPLOIEMENT (SECRETS MASQUÉS)</span>
                  <span>{selectedRun.logs.length} entrées</span>
                </div>
                <div className="flex-1 max-h-[380px] overflow-y-auto font-mono text-[11px] space-y-1.5 leading-relaxed">
                  {selectedRun.logs.map((entry, idx) => (
                    <div key={`${entry.timestamp}-${idx}`} className="flex items-start gap-2">
                      <span className="text-slate-400 shrink-0">
                        {entry.timestamp.slice(11, 19)}
                      </span>
                      <span
                        className={
                          entry.level === 'error'
                            ? 'text-red-300'
                            : entry.level === 'warn'
                              ? 'text-amber-300'
                              : entry.level === 'success'
                                ? 'text-emerald-300'
                                : 'text-jf-ice/90'
                        }
                      >
                        [{entry.stepId}] {entry.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center bg-jf-ice/60 border border-dashed border-jf-border rounded-xl text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-jf-navy">Aucun déploiement encore exécuté.</p>
            <p>
              Renseignez votre accès Hostinger et vos variables d’environnement, testez la connexion, puis cliquez sur
              « Déployer JOBFOUNDS sur Hostinger ».
            </p>
          </div>
        )}

        {/* Recent Deployment Runs Table */}
        {state && state.recentRuns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-jf-navy">Historique des déploiements</h4>
            <div className="overflow-x-auto border border-jf-border rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-jf-ice border-b border-jf-border text-slate-500">
                    <th className="py-2 px-3 font-semibold">Date</th>
                    <th className="py-2 px-3 font-semibold">Domaine / Protocole</th>
                    <th className="py-2 px-3 font-semibold">Build</th>
                    <th className="py-2 px-3 font-semibold">Statut</th>
                    <th className="py-2 px-3 font-semibold text-right">Journaux</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-jf-border">
                  {state.recentRuns.map((run) => (
                    <tr key={run.id} className={selectedRun?.id === run.id ? 'bg-jf-ice/60' : ''}>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {formatDateTime(run.startedAt, lang)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-semibold text-jf-navy">{run.domain}</span>{' '}
                        <span className="font-mono text-[11px] uppercase text-slate-500">({run.protocol})</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{run.buildStatus}</td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span
                          className={
                            run.status === 'succeeded'
                              ? 'text-emerald-700'
                              : run.status === 'failed'
                                ? 'text-red-700'
                                : run.status === 'completed_with_warnings'
                                  ? 'text-amber-700'
                                  : 'text-jf-blue'
                          }
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedRun(run)}
                          className="text-jf-blue hover:underline font-semibold"
                        >
                          Voir détails
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
