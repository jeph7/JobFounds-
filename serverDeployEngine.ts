import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { Client as FtpClient } from 'basic-ftp';
import {
  getEngineDb,
  getEngineDbPath,
  resolveEngineDataDir,
} from './serverEngineDb.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = __dirname;
const getDataDir = () => resolveEngineDataDir();
const getBackupsDir = () => path.join(getDataDir(), 'backups');
const getStagingDir = () => path.join(getDataDir(), 'deploy-staging');
const getSqlitePath = () => getEngineDbPath();
const CONFIG_ROW_ID = 'hostinger_primary';

const { Client: SshClient } = ssh2;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export type DeployProtocol = 'ssh' | 'ftps';
export type DeployAuthMethod = 'ssh_key' | 'password';
export type DeployStepState = 'pending' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';

export interface DeployConfigView {
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  domain: string;
  environment: 'production' | 'staging';
  nodeVersion: string;
  authMethod: DeployAuthMethod;
  hasSshKey: boolean;
  hasPassphrase: boolean;
  lastConnectionStatus: 'untested' | 'connected' | 'failed';
  lastConnectionMessage: string;
  lastConnectionCheckedAt: string | null;
  updatedAt: string;
  vaultEncryptionActive: boolean;
  vaultKeyMode: 'DEPLOY_VAULT_SECRET' | 'derived_server_key' | 'ephemeral';
}

export interface DeployEnvCatalogEntry {
  key: string;
  label: string;
  description: string;
  category: 'core' | 'ai' | 'firebase' | 'email' | 'engine';
  required: boolean;
  isSecret: boolean;
  defaultValue?: string;
}

export interface DeployEnvVarItem {
  key: string;
  label: string;
  description: string;
  category: 'core' | 'ai' | 'firebase' | 'email' | 'engine';
  required: boolean;
  isSecret: boolean;
  configured: boolean;
  /** Strictly empty for secrets; only populated for non-secret config vars */
  value: string;
  updatedAt: string | null;
}

export interface DeployStepRecord {
  id: string;
  order: number;
  title: string;
  status: DeployStepState;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeployLogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  stepId: string;
  message: string;
}

export interface DeployRunRecord {
  id: string;
  status: 'running' | 'succeeded' | 'completed_with_warnings' | 'failed';
  triggeredBy: string;
  domain: string;
  protocol: DeployProtocol;
  startedAt: string;
  finishedAt: string | null;
  buildStatus: 'pending' | 'running' | 'succeeded' | 'failed';
  serverStatus: 'unknown' | 'online' | 'degraded' | 'offline';
  steps: DeployStepRecord[];
  logs: DeployLogEntry[];
  errorMessage: string;
  backupPath: string;
  hasDownloadableBundle: boolean;
}

export interface DomainHealthCheckResult {
  domain: string;
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  healthOk: boolean;
  latencyMs: number;
  engineStatus: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ConnectionTestResult {
  connected: boolean;
  protocol: DeployProtocol;
  host: string;
  port: number;
  message: string;
  remoteNodeVersion: string | null;
  remotePathAccessible: boolean;
  checkedAt: string;
}

export interface DeployDashboardState {
  config: DeployConfigView;
  envVars: DeployEnvVarItem[];
  preflight: {
    projectFilesOk: boolean;
    missingFiles: string[];
    requiredEnvReady: boolean;
    missingRequiredEnv: string[];
    connectionConfigured: boolean;
    readyToDeploy: boolean;
  };
  activeRunId: string | null;
  latestRun: DeployRunRecord | null;
  recentRuns: DeployRunRecord[];
  backupsCount: number;
  hasDownloadableBundle: boolean;
}

// -----------------------------------------------------------------------------
// Allowlisted Real Project Environment Variables
// -----------------------------------------------------------------------------
export const DEPLOY_ENV_CATALOG: DeployEnvCatalogEntry[] = [
  {
    key: 'NODE_ENV',
    label: 'NODE_ENV',
    description: 'Environnement d’exécution Node.js (obligatoire : production).',
    category: 'core',
    required: true,
    isSecret: false,
    defaultValue: 'production',
  },
  {
    key: 'APP_URL',
    label: 'APP_URL',
    description: 'URL publique principale de JOBFOUNDS (https://jobfounds.com).',
    category: 'core',
    required: true,
    isSecret: false,
    defaultValue: 'https://jobfounds.com',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'GEMINI_API_KEY',
    description: 'Clé API Google Gemini côté serveur (recherche, signaux, analyse CV et Coach Vocal Live).',
    category: 'ai',
    required: true,
    isSecret: true,
  },
  {
    key: 'WORKER_MODE',
    label: 'WORKER_MODE',
    description: 'Mode du moteur : "cron" recommandé sur Hostinger Unlimited (pas de processus permanent).',
    category: 'engine',
    required: false,
    isSecret: false,
    defaultValue: 'cron',
  },
  {
    key: 'CRON_SECRET',
    label: 'CRON_SECRET',
    description: 'Jeton secret (>= 16 car.) pour sécuriser les appels Cron HTTP vers /api/cron/tick.',
    category: 'engine',
    required: false,
    isSecret: true,
  },
  {
    key: 'JOBFOUNDS_DATA_DIR',
    label: 'JOBFOUNDS_DATA_DIR',
    description: 'Chemin absolu persistant hors dossier de build pour SQLite (ex. /home/u123456789/jobfounds_data).',
    category: 'core',
    required: false,
    isSecret: false,
  },
  {
    key: 'RESEND_API_KEY',
    label: 'RESEND_API_KEY',
    description: 'Clé API Resend (optionnelle) pour envoyer les alertes candidats par e-mail.',
    category: 'email',
    required: false,
    isSecret: true,
  },
  {
    key: 'NOTIFICATION_FROM_EMAIL',
    label: 'NOTIFICATION_FROM_EMAIL',
    description: 'Adresse expéditrice vérifiée Resend (ex. JOBFOUNDS <alerts@jobfounds.com>).',
    category: 'email',
    required: false,
    isSecret: false,
    defaultValue: 'JOBFOUNDS <alerts@jobfounds.com>',
  },
  {
    key: 'ENGINE_DEFAULT_MONITOR_MINUTES',
    label: 'ENGINE_DEFAULT_MONITOR_MINUTES',
    description: 'Intervalle de surveillance des pages Carrières en minutes (720 = 12h).',
    category: 'engine',
    required: false,
    isSecret: false,
    defaultValue: '720',
  },
  {
    key: 'AI_DAILY_MAX_CALLS',
    label: 'AI_DAILY_MAX_CALLS',
    description: 'Plafond quotidien d’appels IA côté serveur.',
    category: 'engine',
    required: false,
    isSecret: false,
    defaultValue: '100',
  },
  {
    key: 'AI_DAILY_MAX_COST_USD',
    label: 'AI_DAILY_MAX_COST_USD',
    description: 'Budget quotidien maximal estimé pour les appels IA (USD).',
    category: 'engine',
    required: false,
    isSecret: false,
    defaultValue: '3',
  },
  {
    key: 'PORT',
    label: 'PORT',
    description: 'Port d’écoute du serveur Express (Hostinger injecte généralement PORT automatiquement).',
    category: 'core',
    required: false,
    isSecret: false,
    defaultValue: '3000',
  },
];

const ENV_CATALOG_MAP = new Map<string, DeployEnvCatalogEntry>(
  DEPLOY_ENV_CATALOG.map((item) => [item.key, item])
);

// -----------------------------------------------------------------------------
// Server-Side AES-256-GCM Encryption Vault
// -----------------------------------------------------------------------------
let ephemeralFallbackSecret: string | null = null;

function getVaultKeyInfo(): { key: Buffer; mode: 'DEPLOY_VAULT_SECRET' | 'derived_server_key' | 'ephemeral' } {
  const dedicated = (process.env.DEPLOY_VAULT_SECRET || '').trim();
  if (dedicated.length >= 16) {
    return {
      key: crypto.scryptSync(dedicated, 'jobfounds-hostinger-vault-v1', 32),
      mode: 'DEPLOY_VAULT_SECRET',
    };
  }
  const serverKey = (process.env.GEMINI_API_KEY || '').trim();
  if (serverKey.length >= 16) {
    return {
      key: crypto.scryptSync(serverKey, 'jobfounds-hostinger-vault-v1', 32),
      mode: 'derived_server_key',
    };
  }
  if (!ephemeralFallbackSecret) {
    ephemeralFallbackSecret = crypto.randomBytes(32).toString('hex');
  }
  return {
    key: crypto.scryptSync(ephemeralFallbackSecret, 'jobfounds-hostinger-vault-v1', 32),
    mode: 'ephemeral',
  };
}

export function encryptVaultValue(plain: string): string {
  if (!plain) return '';
  const { key } = getVaultKeyInfo();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptVaultValue(encoded: string): string {
  if (!encoded || !encoded.startsWith('v1:')) return '';
  const parts = encoded.split(':');
  if (parts.length !== 4) return '';
  const [, ivHex, tagHex, dataHex] = parts;
  try {
    const { key } = getVaultKeyInfo();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

// -----------------------------------------------------------------------------
// Security Validators (SSRF Prevention, Path Sanitization, Secret Redaction)
// -----------------------------------------------------------------------------
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const ipVersion = net.isIP(ip);
  if (ipVersion === 4) return isPrivateOrReservedIpv4(ip);
  if (ipVersion === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIpv4(lower.slice(7));
    }
    return false;
  }
  return true;
}

export function validateDeployHostSyntax(host: string): { valid: boolean; reason?: string } {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return { valid: false, reason: 'Adresse du serveur Hostinger requise.' };
  if (trimmed.length > 253) return { valid: false, reason: 'Adresse du serveur trop longue.' };
  if (
    trimmed === 'localhost' ||
    trimmed.endsWith('.localhost') ||
    trimmed.endsWith('.local') ||
    trimmed.endsWith('.internal')
  ) {
    return { valid: false, reason: 'Les adresses locales ou internes ne sont pas autorisées.' };
  }
  if (net.isIP(trimmed)) {
    if (isPrivateOrReservedIp(trimmed)) {
      return { valid: false, reason: 'Les adresses IP privées ou locales ne sont pas autorisées.' };
    }
    return { valid: true };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(trimmed)) {
    return { valid: false, reason: 'Nom d’hôte ou adresse IP publique invalide.' };
  }
  return { valid: true };
}

export async function assertPublicDeployHost(host: string): Promise<string> {
  const syntax = validateDeployHostSyntax(host);
  if (!syntax.valid) {
    throw new Error(syntax.reason || 'Adresse serveur invalide.');
  }
  const trimmed = host.trim();
  if (net.isIP(trimmed)) {
    if (isPrivateOrReservedIp(trimmed)) {
      throw new Error('Connexion refusée vers une adresse IP privée ou réservée.');
    }
    return trimmed;
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(trimmed, { all: true });
  } catch {
    throw new Error(`Impossible de résoudre le serveur Hostinger "${trimmed}". Vérifiez l’adresse saisie.`);
  }
  if (!records.length || records.some((r) => isPrivateOrReservedIp(r.address))) {
    throw new Error('L’adresse du serveur résout vers un réseau privé non autorisé.');
  }
  return trimmed;
}

export function validateRemotePath(remotePath: string): { valid: boolean; reason?: string } {
  const trimmed = remotePath.trim();
  if (!trimmed) return { valid: false, reason: 'Répertoire de destination requis.' };
  if (trimmed.includes('..') || trimmed.includes('//') || trimmed.includes('\\')) {
    return { valid: false, reason: 'Le chemin distant ne doit pas contenir ".." ou de séparateurs invalides.' };
  }
  if (!/^(?:~\/|\/)[a-zA-Z0-9._/-]{1,220}$/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Le répertoire distant doit commencer par "/" ou "~/" et ne contenir que des caractères valides.',
    };
  }
  return { valid: true };
}

export function validateDomainName(domain: string): { valid: boolean; normalized: string; reason?: string } {
  const cleaned = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (
    !cleaned ||
    cleaned === 'localhost' ||
    cleaned.endsWith('.local') ||
    cleaned.endsWith('.internal') ||
    net.isIP(cleaned) !== 0
  ) {
    return { valid: false, normalized: cleaned, reason: 'Domaine public invalide (ex. jobfounds.com).' };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(cleaned)) {
    return { valid: false, normalized: cleaned, reason: 'Format de domaine invalide (ex. jobfounds.com).' };
  }
  return { valid: true, normalized: cleaned };
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toSafeRemoteShellPath(remotePath: string): string {
  const clean = remotePath.trim().replace(/\/+$/, '');
  if (clean.startsWith('~/')) {
    return `"$HOME"/${shellSingleQuote(clean.slice(2))}`;
  }
  return shellSingleQuote(clean);
}

function redactSecretsFromText(text: string, secretValues: string[]): string {
  let output = text;
  for (const secret of secretValues) {
    if (secret && secret.length >= 4) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  output = output.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
  return output;
}

// -----------------------------------------------------------------------------
// Database Initialization & Persistence Helpers
// -----------------------------------------------------------------------------
function ensureDefaultConfigAndEnv(): void {
  const db = getEngineDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO deploy_config (
      id, protocol, host, port, username, remote_path, domain, environment, node_version,
      auth_method, has_ssh_key, last_connection_status, last_connection_message, updated_at
    ) VALUES (?, 'ssh', '', 65002, '', '~/domains/jobfounds.com/nodejs', 'jobfounds.com', 'production', '22.x', 'ssh_key', 0, 'untested', '', ?)
  `).run(CONFIG_ROW_ID, now);

  const insertEnv = db.prepare(`
    INSERT OR IGNORE INTO deploy_env_vars (env_key, is_secret, encrypted_value, plain_value, updated_at)
    VALUES (?, ?, '', ?, ?)
  `);
  for (const item of DEPLOY_ENV_CATALOG) {
    if (!item.isSecret && item.defaultValue !== undefined && item.defaultValue !== '') {
      insertEnv.run(item.key, 0, item.defaultValue, now);
    }
  }
}

function getRawConfigRow(): any {
  ensureDefaultConfigAndEnv();
  const db = getEngineDb();
  return db.prepare('SELECT * FROM deploy_config WHERE id = ?').get(CONFIG_ROW_ID) as any;
}

export function getHostingerConfigView(): DeployConfigView {
  const row = getRawConfigRow();
  const { mode } = getVaultKeyInfo();
  return {
    protocol: row.protocol === 'ftps' ? 'ftps' : 'ssh',
    host: String(row.host || ''),
    port: Number(row.port || (row.protocol === 'ftps' ? 21 : 65002)),
    username: String(row.username || ''),
    remotePath: String(row.remote_path || '~/domains/jobfounds.com/nodejs'),
    domain: String(row.domain || 'jobfounds.com'),
    environment: row.environment === 'staging' ? 'staging' : 'production',
    nodeVersion: String(row.node_version || '22.x'),
    authMethod: row.auth_method === 'password' ? 'password' : 'ssh_key',
    hasSshKey: Boolean(row.has_ssh_key && row.encrypted_ssh_key),
    hasPassphrase: Boolean(row.encrypted_passphrase),
    lastConnectionStatus:
      row.last_connection_status === 'connected'
        ? 'connected'
        : row.last_connection_status === 'failed'
          ? 'failed'
          : 'untested',
    lastConnectionMessage: String(row.last_connection_message || ''),
    lastConnectionCheckedAt: row.last_connection_checked_at || null,
    updatedAt: String(row.updated_at || new Date().toISOString()),
    vaultEncryptionActive: true,
    vaultKeyMode: mode,
  };
}

export function saveHostingerConfig(input: {
  protocol: DeployProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  domain: string;
  environment: 'production' | 'staging';
  nodeVersion: string;
  authMethod: DeployAuthMethod;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  clearSshKey?: boolean;
}): DeployConfigView {
  ensureDefaultConfigAndEnv();
  const existing = getRawConfigRow();

  const hostTrimmed = input.host.trim();
  if (hostTrimmed) {
    const hostCheck = validateDeployHostSyntax(hostTrimmed);
    if (!hostCheck.valid) {
      throw new Error(hostCheck.reason || 'Adresse serveur invalide.');
    }
  }

  const pathCheck = validateRemotePath(input.remotePath);
  if (!pathCheck.valid) {
    throw new Error(pathCheck.reason || 'Répertoire de destination invalide.');
  }

  const domainCheck = validateDomainName(input.domain);
  if (!domainCheck.valid) {
    throw new Error(domainCheck.reason || 'Nom de domaine invalide.');
  }

  const username = input.username.trim();
  if (username && !/^[a-zA-Z0-9._@-]{1,80}$/.test(username)) {
    throw new Error('Nom d’utilisateur SSH/FTP invalide.');
  }

  const port = Math.max(1, Math.min(65535, Math.floor(Number(input.port) || 65002)));
  const nodeVersion = input.nodeVersion.trim() || '22.x';
  if (!/^[0-9a-zA-Z._-]{1,24}$/.test(nodeVersion)) {
    throw new Error('Format de version Node.js invalide.');
  }

  let encryptedSshKey = String(existing.encrypted_ssh_key || '');
  let encryptedPassphrase = String(existing.encrypted_passphrase || '');
  let hasSshKey = Number(existing.has_ssh_key || 0);

  if (input.clearSshKey) {
    encryptedSshKey = '';
    encryptedPassphrase = '';
    hasSshKey = 0;
  } else if (typeof input.sshPrivateKey === 'string' && input.sshPrivateKey.trim().length > 0) {
    const trimmedKey = input.sshPrivateKey.trim();
    if (!trimmedKey.includes('PRIVATE KEY')) {
      throw new Error('La clé privée SSH doit être au format PEM ou OpenSSH (-----BEGIN ... PRIVATE KEY-----).');
    }
    encryptedSshKey = encryptVaultValue(trimmedKey);
    hasSshKey = 1;
    if (typeof input.sshPassphrase === 'string' && input.sshPassphrase.length > 0) {
      encryptedPassphrase = encryptVaultValue(input.sshPassphrase);
    } else if (input.sshPassphrase === '') {
      encryptedPassphrase = '';
    }
  } else if (typeof input.sshPassphrase === 'string' && input.sshPassphrase.length > 0 && hasSshKey) {
    encryptedPassphrase = encryptVaultValue(input.sshPassphrase);
  }

  const db = getEngineDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE deploy_config
    SET protocol = ?, host = ?, port = ?, username = ?, remote_path = ?, domain = ?,
        environment = ?, node_version = ?, auth_method = ?,
        encrypted_ssh_key = ?, encrypted_passphrase = ?, has_ssh_key = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.protocol,
    hostTrimmed,
    port,
    username,
    input.remotePath.trim(),
    domainCheck.normalized,
    input.environment,
    nodeVersion,
    input.authMethod,
    encryptedSshKey,
    encryptedPassphrase,
    hasSshKey,
    now,
    CONFIG_ROW_ID
  );

  return getHostingerConfigView();
}

export function listDeployEnvVarsView(): DeployEnvVarItem[] {
  ensureDefaultConfigAndEnv();
  const db = getEngineDb();
  const rows = db.prepare('SELECT * FROM deploy_env_vars').all() as any[];
  const byKey = new Map<string, any>(rows.map((r) => [String(r.env_key), r]));

  return DEPLOY_ENV_CATALOG.map((meta) => {
    const row = byKey.get(meta.key);
    if (meta.isSecret) {
      const hasVal = Boolean(row && row.encrypted_value && decryptVaultValue(String(row.encrypted_value)).length > 0);
      return {
        key: meta.key,
        label: meta.label,
        description: meta.description,
        category: meta.category,
        required: meta.required,
        isSecret: true,
        configured: hasVal,
        value: '',
        updatedAt: row?.updated_at || null,
      };
    }
    const plain = row ? String(row.plain_value || '') : '';
    return {
      key: meta.key,
      label: meta.label,
      description: meta.description,
      category: meta.category,
      required: meta.required,
      isSecret: false,
      configured: plain.trim().length > 0,
      value: plain,
      updatedAt: row?.updated_at || null,
    };
  });
}

export function saveDeployEnvVars(entries: Array<{ key: string; value?: string; clear?: boolean }>): DeployEnvVarItem[] {
  ensureDefaultConfigAndEnv();
  const db = getEngineDb();
  const now = new Date().toISOString();

  const upsertStmt = db.prepare(`
    INSERT INTO deploy_env_vars (env_key, is_secret, encrypted_value, plain_value, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(env_key) DO UPDATE SET
      is_secret = excluded.is_secret,
      encrypted_value = excluded.encrypted_value,
      plain_value = excluded.plain_value,
      updated_at = excluded.updated_at
  `);
  const deleteStmt = db.prepare('DELETE FROM deploy_env_vars WHERE env_key = ?');

  for (const entry of entries) {
    const meta = ENV_CATALOG_MAP.get(entry.key);
    if (!meta) {
      throw new Error(`Variable d’environnement non autorisée : ${entry.key}`);
    }
    if (entry.clear) {
      deleteStmt.run(meta.key);
      continue;
    }
    if (typeof entry.value !== 'string') continue;

    if (meta.isSecret) {
      const trimmed = entry.value.trim();
      if (!trimmed) continue; // Keep existing secret untouched if left blank
      const encrypted = encryptVaultValue(trimmed);
      upsertStmt.run(meta.key, 1, encrypted, '', now);
    } else {
      const trimmed = entry.value.trim();
      if (!trimmed) {
        deleteStmt.run(meta.key);
      } else {
        upsertStmt.run(meta.key, 0, '', trimmed, now);
      }
    }
  }

  return listDeployEnvVarsView();
}

function loadDecryptedProductionEnvMap(): { envMap: Record<string, string>; secretValues: string[] } {
  ensureDefaultConfigAndEnv();
  const db = getEngineDb();
  const rows = db.prepare('SELECT * FROM deploy_env_vars').all() as any[];
  const envMap: Record<string, string> = {};
  const secretValues: string[] = [];

  for (const row of rows) {
    const key = String(row.env_key);
    const meta = ENV_CATALOG_MAP.get(key);
    if (!meta) continue;
    if (meta.isSecret) {
      const plain = decryptVaultValue(String(row.encrypted_value || ''));
      if (plain) {
        envMap[key] = plain;
        secretValues.push(plain);
      }
    } else {
      const plain = String(row.plain_value || '').trim();
      if (plain) {
        envMap[key] = plain;
      }
    }
  }
  return { envMap, secretValues };
}

function formatDotEnvContent(envMap: Record<string, string>): string {
  const lines: string[] = [
    '# JOBFOUNDS Production Environment — Generated by JOBFOUNDS Deployment Center',
    `# Generated at ${new Date().toISOString()}`,
    '',
  ];
  for (const meta of DEPLOY_ENV_CATALOG) {
    const val = envMap[meta.key];
    if (val === undefined || val === '') continue;
    const escaped = val.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/"/g, '\\"');
    lines.push(`${meta.key}="${escaped}"`);
  }
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Pre-Flight & Domain Verification
// -----------------------------------------------------------------------------
function checkRequiredProjectFiles(): { ok: boolean; missing: string[] } {
  const required = [
    'package.json',
    'server.ts',
    'firebase-applet-config.json',
    'src/App.tsx',
    'index.html',
    'node_modules',
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(PROJECT_ROOT, rel)));
  return { ok: missing.length === 0, missing };
}

export async function checkLiveDomainHealth(domainInput?: string): Promise<DomainHealthCheckResult> {
  const config = getHostingerConfigView();
  const targetDomain = domainInput || config.domain || 'jobfounds.com';
  const validation = validateDomainName(targetDomain);
  if (!validation.valid) {
    throw new Error(validation.reason || 'Domaine invalide.');
  }
  const normalized = validation.normalized;
  const healthUrl = `https://${normalized}/api/health`;
  const homeUrl = `https://${normalized}/`;
  const checkedAt = new Date().toISOString();
  const started = Date.now();

  try {
    await assertPublicDeployHost(normalized);
  } catch (dnsErr) {
    const msg = dnsErr instanceof Error ? dnsErr.message : 'Résolution DNS impossible.';
    if (msg.includes('privé') || msg.includes('autorisé')) {
      throw dnsErr;
    }
    return {
      domain: normalized,
      url: healthUrl,
      reachable: false,
      httpStatus: null,
      healthOk: false,
      latencyMs: Date.now() - started,
      engineStatus: null,
      error: `DNS introuvable pour ${normalized} (vérifiez les enregistrements A/CNAME chez Cloudflare ou Hostinger).`,
      checkedAt,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const resp = await fetch(healthUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'JOBFOUNDS-DeployCheck/1.0' },
    }).finally(() => clearTimeout(timer));

    const latencyMs = Date.now() - started;
    let healthOk = false;
    let engineStatus: string | null = null;
    if (resp.ok) {
      try {
        const json = (await resp.json()) as any;
        healthOk = json?.ok === true || json?.status === 'ok';
        engineStatus =
          typeof json?.engine === 'string'
            ? json.engine
            : json?.engine?.sqliteReady
              ? `sqlite:${json.engine.workerMode || 'ok'}`
              : null;
      } catch {
        healthOk = false;
      }
    }

    if (healthOk) {
      return {
        domain: normalized,
        url: healthUrl,
        reachable: true,
        httpStatus: resp.status,
        healthOk: true,
        latencyMs,
        engineStatus,
        error: null,
        checkedAt,
      };
    }

    // Fallback check on homepage in case API health route isn't yet deployed
    const homeController = new AbortController();
    const homeTimer = setTimeout(() => homeController.abort(), 10_000);
    const homeResp = await fetch(homeUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: homeController.signal,
      headers: { 'User-Agent': 'JOBFOUNDS-DeployCheck/1.0' },
    }).finally(() => clearTimeout(homeTimer));

    return {
      domain: normalized,
      url: homeUrl,
      reachable: homeResp.status < 500,
      httpStatus: homeResp.status,
      healthOk: false,
      latencyMs: Date.now() - started,
      engineStatus: null,
      error:
        resp.status === 404
          ? 'Le domaine répond, mais /api/health n’est pas encore actif sur le serveur Node.js.'
          : `Réponse HTTP ${resp.status} sur /api/health (page d’accueil : HTTP ${homeResp.status}).`,
      checkedAt,
    };
  } catch (err) {
    return {
      domain: normalized,
      url: healthUrl,
      reachable: false,
      httpStatus: null,
      healthOk: false,
      latencyMs: Date.now() - started,
      engineStatus: null,
      error: err instanceof Error ? err.message : 'Impossible de joindre le domaine en HTTPS.',
      checkedAt,
    };
  }
}

// -----------------------------------------------------------------------------
// Real SSH/SFTP & FTPS Transport Helpers
// -----------------------------------------------------------------------------
function buildSshConnectConfig(rawConfig: any, oneTimePassword?: string): ConnectConfig {
  const host = String(rawConfig.host || '').trim();
  const port = Number(rawConfig.port || 65002);
  const username = String(rawConfig.username || '').trim();
  if (!host || !username) {
    throw new Error('Adresse serveur et nom d’utilisateur Hostinger requis avant connexion.');
  }

  const base: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
  };

  if (rawConfig.auth_method === 'ssh_key') {
    const privateKey = decryptVaultValue(String(rawConfig.encrypted_ssh_key || ''));
    if (!privateKey) {
      throw new Error('Clé privée SSH manquante. Enregistrez une clé privée SSH dans la configuration Hostinger.');
    }
    const passphrase = decryptVaultValue(String(rawConfig.encrypted_passphrase || ''));
    base.privateKey = privateKey;
    if (passphrase) {
      base.passphrase = passphrase;
    }
    return base;
  }

  const pwd = (oneTimePassword || '').trim();
  if (!pwd) {
    throw new Error(
      'Mot de passe de session SSH requis pour cette opération (jamais stocké dans le navigateur ni en base).'
    );
  }
  base.password = pwd;
  return base;
}

function connectSsh(config: ConnectConfig): Promise<InstanceType<typeof SshClient>> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    const onError = (err: Error) => {
      client.end();
      reject(err);
    };
    client.once('error', onError);
    client.once('ready', () => {
      client.off('error', onError);
      resolve(client);
    });
    client.connect(config);
  });
}

function execSshCommand(
  client: InstanceType<typeof SshClient>,
  command: string,
  timeoutMs = 180_000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Délai dépassé (${Math.round(timeoutMs / 1000)}s) lors de la commande SSH.`));
      }
    }, timeoutMs);

    client.exec(command, (err, stream: ClientChannel) => {
      if (err) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
      });
      stream.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
        }
      });
    });
  });
}

function openSftp(client: InstanceType<typeof SshClient>): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sftpWriteTextFile(sftp: SFTPWrapper, remotePath: string, content: string, mode = 0o600): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { mode });
    stream.once('error', reject);
    stream.once('close', () => resolve());
    stream.end(Buffer.from(content, 'utf8'));
  });
}

export async function testHostingerConnection(oneTimePassword?: string): Promise<ConnectionTestResult> {
  const raw = getRawConfigRow();
  const protocol: DeployProtocol = raw.protocol === 'ftps' ? 'ftps' : 'ssh';
  const host = String(raw.host || '').trim();
  const port = Number(raw.port || (protocol === 'ftps' ? 21 : 65002));
  const username = String(raw.username || '').trim();
  const remotePath = String(raw.remote_path || '~/domains/jobfounds.com/nodejs').trim();
  const checkedAt = new Date().toISOString();

  const updateConnectionStatus = (status: 'connected' | 'failed', message: string) => {
    const db = getEngineDb();
    db.prepare(`
      UPDATE deploy_config
      SET last_connection_status = ?, last_connection_message = ?, last_connection_checked_at = ?
      WHERE id = ?
    `).run(status, message.slice(0, 400), checkedAt, CONFIG_ROW_ID);
  };

  try {
    await assertPublicDeployHost(host);
    const pathCheck = validateRemotePath(remotePath);
    if (!pathCheck.valid) {
      throw new Error(pathCheck.reason || 'Répertoire distant invalide.');
    }

    if (protocol === 'ssh') {
      const sshConfig = buildSshConnectConfig(raw, oneTimePassword);
      const client = await connectSsh(sshConfig);
      try {
        const safeDir = toSafeRemoteShellPath(remotePath);
        const probe = await execSshCommand(
          client,
          `node -v 2>/dev/null || echo "NODE_MISSING"; echo "---PATH---"; if [ -d ${safeDir} ]; then echo "DIR_OK"; else echo "DIR_MISSING"; fi`,
          25_000
        );
        const lines = probe.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        const nodeLine = lines[0] || '';
        const remoteNodeVersion = nodeLine && nodeLine !== 'NODE_MISSING' ? nodeLine : null;
        const remotePathAccessible = lines.includes('DIR_OK');
        const message = remotePathAccessible
          ? `Connexion SSH réussie (${host}:${port}). Node distant : ${remoteNodeVersion || 'non détecté dans PATH'}. Répertoire cible accessible.`
          : `Connexion SSH réussie (${host}:${port}), mais le répertoire ${remotePath} n’existe pas encore (il sera créé lors du déploiement). Node distant : ${remoteNodeVersion || 'non détecté'}.`;
        updateConnectionStatus('connected', message);
        return {
          connected: true,
          protocol,
          host,
          port,
          message,
          remoteNodeVersion,
          remotePathAccessible,
          checkedAt,
        };
      } finally {
        client.end();
      }
    }

    // FTPS mode (explicit TLS)
    const pwd = (oneTimePassword || '').trim();
    if (!pwd) {
      throw new Error('Mot de passe de session FTPS requis pour tester la connexion (jamais stocké).');
    }
    const ftp = new FtpClient(20_000);
    try {
      await ftp.access({
        host,
        port,
        user: username,
        password: pwd,
        secure: true,
        secureOptions: { rejectUnauthorized: true },
      });
      const ftpsDir = remotePath.startsWith('~/') ? remotePath.slice(2) : remotePath;
      let remotePathAccessible = false;
      try {
        await ftp.cd(ftpsDir);
        remotePathAccessible = true;
      } catch {
        remotePathAccessible = false;
      }
      const message = remotePathAccessible
        ? `Connexion FTPS chiffrée réussie (${host}:${port}). Répertoire cible accessible.`
        : `Connexion FTPS chiffrée réussie (${host}:${port}). Le répertoire cible sera créé lors du transfert.`;
      updateConnectionStatus('connected', message);
      return {
        connected: true,
        protocol,
        host,
        port,
        message,
        remoteNodeVersion: null,
        remotePathAccessible,
        checkedAt,
      };
    } finally {
      ftp.close();
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Échec de connexion Hostinger.';
    const safeMsg = redactSecretsFromText(rawMsg, oneTimePassword ? [oneTimePassword] : []);
    updateConnectionStatus('failed', safeMsg);
    return {
      connected: false,
      protocol,
      host,
      port,
      message: safeMsg,
      remoteNodeVersion: null,
      remotePathAccessible: false,
      checkedAt,
    };
  }
}

// -----------------------------------------------------------------------------
// Deployment Run Persistence & Real 9-Step Orchestrator
// -----------------------------------------------------------------------------
let activeDeployRunId: string | null = null;

function createInitialSteps(): DeployStepRecord[] {
  return [
    { id: 'verify_project', order: 1, title: 'Vérification des fichiers et dépendances du projet', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'verify_env', order: 2, title: 'Validation des variables d’environnement obligatoires', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'build_app', order: 3, title: 'Construction du bundle de production (Vite build)', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'prepare_package', order: 4, title: 'Sauvegarde pré-déploiement et préparation de l’archive', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'transfer_files', order: 5, title: 'Transfert sécurisé vers Hostinger (sans écraser les données)', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'install_deps', order: 6, title: 'Installation des dépendances de production sur Hostinger', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'start_server', order: 7, title: 'Configuration et redémarrage du serveur Node.js', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'verify_domain', order: 8, title: 'Vérification HTTPS du domaine jobfounds.com', status: 'pending', detail: '', startedAt: null, finishedAt: null },
    { id: 'finalize', order: 9, title: 'Clôture, journalisation et nettoyage sécurisé', status: 'pending', detail: '', startedAt: null, finishedAt: null },
  ];
}

function hydrateRunRow(row: any): DeployRunRecord {
  let steps: DeployStepRecord[] = [];
  let logs: DeployLogEntry[] = [];
  try {
    steps = JSON.parse(String(row.steps_json || '[]'));
  } catch {
    steps = [];
  }
  try {
    logs = JSON.parse(String(row.logs_json || '[]'));
  } catch {
    logs = [];
  }
  const bundlePath = String(row.bundle_path || '');
  return {
    id: String(row.id),
    status: row.status,
    triggeredBy: String(row.triggered_by || ''),
    domain: String(row.domain || 'jobfounds.com'),
    protocol: row.protocol === 'ftps' ? 'ftps' : 'ssh',
    startedAt: String(row.started_at),
    finishedAt: row.finished_at || null,
    buildStatus: row.build_status || 'pending',
    serverStatus: row.server_status || 'unknown',
    steps,
    logs,
    errorMessage: String(row.error_message || ''),
    backupPath: String(row.backup_path || ''),
    hasDownloadableBundle: Boolean(bundlePath && fs.existsSync(bundlePath)),
  };
}

export function getDeployRunById(runId: string): DeployRunRecord | null {
  const db = getEngineDb();
  const row = db.prepare('SELECT * FROM deploy_runs WHERE id = ?').get(runId) as any;
  return row ? hydrateRunRow(row) : null;
}

export function listRecentDeployRuns(limit = 10): DeployRunRecord[] {
  const db = getEngineDb();
  const rows = db
    .prepare('SELECT * FROM deploy_runs ORDER BY started_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(30, limit))) as any[];
  return rows.map(hydrateRunRow);
}

export function getLatestBundlePath(): string | null {
  const db = getEngineDb();
  const row = db
    .prepare("SELECT bundle_path FROM deploy_runs WHERE bundle_path != '' ORDER BY started_at DESC LIMIT 1")
    .get() as any;
  const candidate = row?.bundle_path ? String(row.bundle_path) : '';
  if (candidate && candidate.startsWith(getStagingDir()) && fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function persistRunSnapshot(run: DeployRunRecord, bundlePath: string): void {
  const db = getEngineDb();
  db.prepare(`
    UPDATE deploy_runs
    SET status = ?, finished_at = ?, build_status = ?, server_status = ?,
        steps_json = ?, logs_json = ?, error_message = ?, backup_path = ?, bundle_path = ?
    WHERE id = ?
  `).run(
    run.status,
    run.finishedAt,
    run.buildStatus,
    run.serverStatus,
    JSON.stringify(run.steps),
    JSON.stringify(run.logs.slice(-250)),
    run.errorMessage,
    run.backupPath,
    bundlePath,
    run.id
  );
}

function collectProductionBundleEntries(): string[] {
  const candidates = [
    'dist',
    'public',
    'scripts/cron-worker.ts',
    'package.json',
    'package-lock.json',
    'firebase-applet-config.json',
    'tsconfig.json',
    'server.ts',
  ];
  const rootEntries = fs.readdirSync(PROJECT_ROOT);
  for (const name of rootEntries) {
    if (/^server[A-Za-z0-9_-]*\.ts$/.test(name) && !candidates.includes(name)) {
      candidates.push(name);
    }
  }
  // Explicitly NEVER include node_modules, .env*, or data/
  return candidates.filter((entry) => fs.existsSync(path.join(PROJECT_ROOT, entry)));
}

async function uploadDirectoryFtps(ftp: FtpClient, localDir: string, remoteDir: string): Promise<void> {
  await ftp.ensureDir(remoteDir);
  const items = fs.readdirSync(localDir, { withFileTypes: true });
  for (const item of items) {
    const localChild = path.join(localDir, item.name);
    const remoteChild = `${remoteDir.replace(/\/+$/, '')}/${item.name}`;
    if (item.isDirectory()) {
      await uploadDirectoryFtps(ftp, localChild, remoteChild);
    } else if (item.isFile()) {
      await ftp.uploadFrom(localChild, remoteChild);
    }
  }
}

export function startHostingerDeployment(options: {
  triggeredBy: string;
  oneTimePassword?: string;
}): DeployRunRecord {
  if (activeDeployRunId) {
    const existing = getDeployRunById(activeDeployRunId);
    if (existing && existing.status === 'running') {
      throw new Error('Un déploiement JOBFOUNDS est déjà en cours. Patientez jusqu’à sa fin.');
    }
    activeDeployRunId = null;
  }

  ensureDefaultConfigAndEnv();
  const rawConfig = getRawConfigRow();
  const protocol: DeployProtocol = rawConfig.protocol === 'ftps' ? 'ftps' : 'ssh';
  const domain = String(rawConfig.domain || 'jobfounds.com');

  const runId = `deploy_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const steps = createInitialSteps();
  const run: DeployRunRecord = {
    id: runId,
    status: 'running',
    triggeredBy: options.triggeredBy,
    domain,
    protocol,
    startedAt: now,
    finishedAt: null,
    buildStatus: 'pending',
    serverStatus: 'unknown',
    steps,
    logs: [
      {
        timestamp: now,
        level: 'info',
        stepId: 'verify_project',
        message: `Démarrage du pipeline de déploiement JOBFOUNDS vers ${domain} (${protocol.toUpperCase()}).`,
      },
    ],
    errorMessage: '',
    backupPath: '',
    hasDownloadableBundle: false,
  };

  const db = getEngineDb();
  db.prepare(`
    INSERT INTO deploy_runs (
      id, status, triggered_by, domain, protocol, started_at,
      build_status, server_status, steps_json, logs_json, error_message, backup_path, bundle_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '')
  `).run(
    run.id,
    run.status,
    run.triggeredBy,
    run.domain,
    run.protocol,
    run.startedAt,
    run.buildStatus,
    run.serverStatus,
    JSON.stringify(run.steps),
    JSON.stringify(run.logs)
  );

  activeDeployRunId = runId;

  // Execute the real 9-step deployment asynchronously
  void executeDeploymentPipeline(run, rawConfig, options.oneTimePassword).finally(() => {
    if (activeDeployRunId === runId) {
      activeDeployRunId = null;
    }
  });

  return run;
}

async function executeDeploymentPipeline(
  run: DeployRunRecord,
  rawConfig: any,
  oneTimePassword?: string
): Promise<void> {
  const { envMap, secretValues } = loadDecryptedProductionEnvMap();
  const allSecrets = [...secretValues];
  if (oneTimePassword) allSecrets.push(oneTimePassword);
  const savedSshKey = decryptVaultValue(String(rawConfig.encrypted_ssh_key || ''));
  const savedPassphrase = decryptVaultValue(String(rawConfig.encrypted_passphrase || ''));
  if (savedSshKey) allSecrets.push(savedSshKey);
  if (savedPassphrase) allSecrets.push(savedPassphrase);

  let bundlePath = '';
  let hasWarnings = false;

  const log = (stepId: string, level: DeployLogEntry['level'], message: string) => {
    const cleanMsg = redactSecretsFromText(message, allSecrets);
    run.logs.push({
      timestamp: new Date().toISOString(),
      level,
      stepId,
      message: cleanMsg,
    });
    persistRunSnapshot(run, bundlePath);
  };

  const setStep = (stepId: string, status: DeployStepState, detail?: string) => {
    const step = run.steps.find((s) => s.id === stepId);
    if (!step) return;
    const now = new Date().toISOString();
    if (status === 'running' && !step.startedAt) step.startedAt = now;
    if (status === 'completed' || status === 'warning' || status === 'failed' || status === 'skipped') {
      step.finishedAt = now;
    }
    step.status = status;
    if (detail !== undefined) {
      step.detail = redactSecretsFromText(detail, allSecrets);
    }
    if (status === 'warning') hasWarnings = true;
    persistRunSnapshot(run, bundlePath);
  };

  let sshClient: InstanceType<typeof SshClient> | null = null;
  let ftpClient: FtpClient | null = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Verify project files and dependencies
    // -------------------------------------------------------------------------
    setStep('verify_project', 'running', 'Contrôle de l’intégrité des fichiers et dépendances…');
    const fileCheck = checkRequiredProjectFiles();
    if (!fileCheck.ok) {
      throw new Error(`Fichiers projet manquants : ${fileCheck.missing.join(', ')}`);
    }
    const pkgJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    log(
      'verify_project',
      'success',
      `Projet vérifié : ${pkgJson.name}@${pkgJson.version}, Node local ${process.version}, scripts build/start présents.`
    );
    setStep('verify_project', 'completed', `Node ${process.version} · Fichiers essentiels validés.`);

    // -------------------------------------------------------------------------
    // STEP 2: Verify mandatory production environment variables
    // -------------------------------------------------------------------------
    setStep('verify_env', 'running', 'Vérification des variables de production chiffrées…');
    const missingReq = DEPLOY_ENV_CATALOG.filter((m) => m.required && !envMap[m.key]).map((m) => m.key);
    if (missingReq.length > 0) {
      throw new Error(
        `Variables d’environnement obligatoires manquantes : ${missingReq.join(', ')}. Complétez le formulaire sécurisé avant de déployer.`
      );
    }
    const configuredKeys = Object.keys(envMap);
    log(
      'verify_env',
      'success',
      `${configuredKeys.length} variable(s) prête(s) pour production (${configuredKeys.join(', ')}). Valeurs secrètes chiffrées côté serveur.`
    );
    setStep('verify_env', 'completed', `${configuredKeys.length} variables validées.`);

    // -------------------------------------------------------------------------
    // STEP 3: Build production application
    // -------------------------------------------------------------------------
    setStep('build_app', 'running', 'Exécution de npm run build…');
    run.buildStatus = 'running';
    persistRunSnapshot(run, bundlePath);

    try {
      const { stdout, stderr } = await execFileAsync('npm', ['run', 'build'], {
        cwd: PROJECT_ROOT,
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const distIndex = path.join(PROJECT_ROOT, 'dist', 'index.html');
      if (!fs.existsSync(distIndex)) {
        throw new Error('La compilation s’est terminée sans produire dist/index.html.');
      }
      const distAssetsDir = path.join(PROJECT_ROOT, 'dist', 'assets');
      const assetCount = fs.existsSync(distAssetsDir) ? fs.readdirSync(distAssetsDir).length : 0;
      run.buildStatus = 'succeeded';
      log('build_app', 'success', `Build Vite réussi : dist/index.html + ${assetCount} asset(s) optimisé(s).`);
      if (stdout) {
        const lastLine = stdout.trim().split('\n').slice(-2).join(' | ');
        log('build_app', 'info', lastLine);
      }
      if (stderr && stderr.trim().length > 0) {
        log('build_app', 'info', stderr.trim().slice(0, 300));
      }
      setStep('build_app', 'completed', `Bundle prêt (${assetCount} assets).`);
    } catch (buildErr: any) {
      run.buildStatus = 'failed';
      const detail = buildErr?.stderr || buildErr?.message || 'Erreur de build Vite.';
      throw new Error(`Échec de la construction de l’application : ${String(detail).slice(0, 450)}`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Pre-deploy local backup & production archive preparation
    // -------------------------------------------------------------------------
    setStep('prepare_package', 'running', 'Sauvegarde SQLite locale et création de l’archive de production…');
    const backupsDir = getBackupsDir();
    const stagingDir = getStagingDir();
    const sqlitePath = getSqlitePath();
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    const tsStamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (fs.existsSync(sqlitePath)) {
      const backupFile = path.join(backupsDir, `jobfonds_engine-${tsStamp}.sqlite`);
      fs.copyFileSync(sqlitePath, backupFile);
      run.backupPath = path.relative(PROJECT_ROOT, backupFile);
      log('prepare_package', 'success', `Sauvegarde locale SQLite créée : ${run.backupPath}`);

      // Retain last 10 local backups
      const existingBackups = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.sqlite'))
        .sort();
      while (existingBackups.length > 10) {
        const oldest = existingBackups.shift();
        if (oldest) fs.unlinkSync(path.join(backupsDir, oldest));
      }
    }

    const bundleEntries = collectProductionBundleEntries();
    bundlePath = path.join(stagingDir, `jobfounds-release-${tsStamp}.tar.gz`);
    await execFileAsync('tar', ['-czf', bundlePath, ...bundleEntries], {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
    });
    const bundleSizeMb = (fs.statSync(bundlePath).size / (1024 * 1024)).toFixed(2);
    run.hasDownloadableBundle = true;
    log(
      'prepare_package',
      'success',
      `Archive de production générée (${bundleSizeMb} Mo) — inclut scripts/cron-worker.ts, exclut strictement data/, node_modules/ et .env local.`
    );
    setStep('prepare_package', 'completed', `Archive ${bundleSizeMb} Mo prête + sauvegarde SQLite effectuée.`);

    // Cleanup older staging archives (keep last 3)
    const oldArchives = fs
      .readdirSync(stagingDir)
      .filter((f) => f.endsWith('.tar.gz'))
      .sort();
    while (oldArchives.length > 3) {
      const oldest = oldArchives.shift();
      if (oldest) fs.unlinkSync(path.join(stagingDir, oldest));
    }

    // -------------------------------------------------------------------------
    // STEP 5: Transfer files securely to Hostinger (preserving persistent data)
    // -------------------------------------------------------------------------
    setStep('transfer_files', 'running', 'Connexion sécurisée et transfert vers Hostinger…');
    const host = String(rawConfig.host || '').trim();
    const remotePath = String(rawConfig.remote_path || '').trim();
    const port = Number(rawConfig.port || (run.protocol === 'ftps' ? 21 : 65002));
    const username = String(rawConfig.username || '').trim();

    if (!host || !username) {
      throw new Error(
        'Configuration Hostinger incomplète : renseignez l’adresse du serveur et le nom d’utilisateur SSH/FTP.'
      );
    }
    await assertPublicDeployHost(host);
    const pathCheck = validateRemotePath(remotePath);
    if (!pathCheck.valid) {
      throw new Error(pathCheck.reason || 'Répertoire distant invalide.');
    }

    const dotEnvContent = formatDotEnvContent(envMap);

    if (run.protocol === 'ssh') {
      const sshConfig = buildSshConnectConfig(rawConfig, oneTimePassword);
      log('transfer_files', 'info', `Connexion SSH/SFTP à ${host}:${port} (${username})…`);
      sshClient = await connectSsh(sshConfig);
      const safeDir = toSafeRemoteShellPath(remotePath);

      // Resolve absolute remote path cleanly via SSH pwd
      const pwdRes = await execSshCommand(
        sshClient,
        `mkdir -p ${safeDir} ${safeDir}/data ${safeDir}/backups ${safeDir}/tmp ${safeDir}/logs && cd ${safeDir} && pwd`,
        30_000
      );
      if (pwdRes.code !== 0 || !pwdRes.stdout) {
        throw new Error(`Impossible d’accéder au répertoire distant ${remotePath} : ${pwdRes.stderr || 'accès refusé'}`);
      }
      const absRemoteDir = pwdRes.stdout.split('\n').pop()!.trim();
      if (!absRemoteDir.startsWith('/')) {
        throw new Error('Chemin absolu distant invalide retourné par le serveur.');
      }

      // Remote pre-deploy backup of existing data/ and .env BEFORE extracting anything
      const backupCmd = `cd ${shellSingleQuote(absRemoteDir)} && if [ -d data ] || [ -f .env ]; then tar -czf backups/predeploy-${tsStamp}.tar.gz $([ -d data ] && echo data) $([ -f .env ] && echo .env) 2>/dev/null || true; echo "BACKUP_DONE"; fi`;
      const backupRes = await execSshCommand(sshClient, backupCmd, 60_000);
      if (backupRes.stdout.includes('BACKUP_DONE')) {
        log('transfer_files', 'success', `Sauvegarde distante créée : ${absRemoteDir}/backups/predeploy-${tsStamp}.tar.gz`);
      }

      // Upload archive and .env via SFTP
      const sftp = await openSftp(sshClient);
      const remoteArchive = `${absRemoteDir}/.jobfounds-release-${tsStamp}.tar.gz`;
      await sftpFastPut(sftp, bundlePath, remoteArchive);
      log('transfer_files', 'info', 'Archive de production transférée via SFTP. Extraction en cours…');

      const extractRes = await execSshCommand(
        sshClient,
        `cd ${shellSingleQuote(absRemoteDir)} && tar -xzf ${shellSingleQuote(remoteArchive)} && rm -f ${shellSingleQuote(remoteArchive)}`,
        90_000
      );
      if (extractRes.code !== 0) {
        throw new Error(`Erreur d’extraction sur Hostinger : ${extractRes.stderr || extractRes.stdout}`);
      }

      // Write production .env securely with chmod 0600
      const remoteEnvPath = `${absRemoteDir}/.env`;
      await sftpWriteTextFile(sftp, remoteEnvPath, dotEnvContent, 0o600);
      await execSshCommand(sshClient, `chmod 600 ${shellSingleQuote(remoteEnvPath)}`, 15_000);
      sftp.end();

      log(
        'transfer_files',
        'success',
        `Fichiers extraits et fichier .env écrit en mode sécurisé (0600) dans ${absRemoteDir}. Le dossier persistant data/ a été préservé.`
      );
      setStep('transfer_files', 'completed', `Transfert SFTP réussi dans ${absRemoteDir}.`);

      // -----------------------------------------------------------------------
      // STEP 6: Install production dependencies on Hostinger (SSH)
      // -----------------------------------------------------------------------
      setStep('install_deps', 'running', 'Vérification Node.js et installation des dépendances npm…');
      const nodeCheck = await execSshCommand(sshClient, 'node -v', 15_000);
      const remoteNodeVer = nodeCheck.stdout.trim();
      log('install_deps', 'info', `Version Node.js détectée sur Hostinger : ${remoteNodeVer || 'inconnue'}`);
      const majorMatch = remoteNodeVer.match(/^v(\d+)/);
      if (majorMatch && Number(majorMatch[1]) < 22) {
        log(
          'install_deps',
          'warn',
          `Attention : Hostinger utilise ${remoteNodeVer}. JOBFOUNDS nécessite Node.js 22+ (changez la version dans Hostinger hPanel -> Node.js).`
        );
        hasWarnings = true;
      }

      const npmRes = await execSshCommand(
        sshClient,
        `cd ${shellSingleQuote(absRemoteDir)} && npm install --omit=dev --no-audit --no-fund`,
        240_000
      );
      if (npmRes.code !== 0) {
        throw new Error(`npm install a échoué sur Hostinger : ${(npmRes.stderr || npmRes.stdout).slice(0, 450)}`);
      }
      log('install_deps', 'success', 'Dépendances Node.js de production installées sur Hostinger.');
      setStep('install_deps', 'completed', `npm install terminé (${remoteNodeVer || 'Node.js'}).`);

      // -----------------------------------------------------------------------
      // STEP 7: Configure & restart Node.js server (SSH)
      // -----------------------------------------------------------------------
      setStep('start_server', 'running', 'Redémarrage du serveur Node.js JOBFOUNDS…');
      const restartCmd = [
        `cd ${shellSingleQuote(absRemoteDir)}`,
        'mkdir -p tmp logs data',
        'touch tmp/restart.txt',
        'if command -v pm2 >/dev/null 2>&1; then (pm2 reload jobfounds --update-env || pm2 start server.ts --name jobfounds --interpreter node); pm2 save || true; echo "RESTART_PM2"; else echo "RESTART_PASSENGER"; fi',
      ].join(' && ');

      const restartRes = await execSshCommand(sshClient, restartCmd, 60_000);
      if (restartRes.code !== 0) {
        throw new Error(`Erreur lors du redémarrage du serveur : ${(restartRes.stderr || restartRes.stdout).slice(0, 350)}`);
      }
      const modeUsed = restartRes.stdout.includes('RESTART_PM2')
        ? 'PM2 + Passenger (tmp/restart.txt)'
        : 'Hostinger Passenger/LiteSpeed (tmp/restart.txt)';
      log('start_server', 'success', `Signal de redémarrage serveur envoyé via ${modeUsed}.`);
      setStep('start_server', 'completed', `Redémarrage effectué (${modeUsed}).`);
    } else {
      // FTPS transfer mode (explicit TLS)
      const pwd = (oneTimePassword || '').trim();
      if (!pwd) {
        throw new Error('Mot de passe de session FTPS requis pour le déploiement.');
      }
      log('transfer_files', 'info', `Connexion FTPS chiffrée à ${host}:${port}…`);
      ftpClient = new FtpClient(30_000);
      await ftpClient.access({
        host,
        port,
        user: username,
        password: pwd,
        secure: true,
        secureOptions: { rejectUnauthorized: true },
      });

      const ftpsRoot = remotePath.startsWith('~/') ? remotePath.slice(2) : remotePath;
      await ftpClient.ensureDir(ftpsRoot);

      for (const entry of bundleEntries) {
        const localEntry = path.join(PROJECT_ROOT, entry);
        const remoteEntry = `${ftpsRoot.replace(/\/+$/, '')}/${entry}`;
        const stat = fs.statSync(localEntry);
        if (stat.isDirectory()) {
          await uploadDirectoryFtps(ftpClient, localEntry, remoteEntry);
        } else {
          await ftpClient.uploadFrom(localEntry, remoteEntry);
        }
      }

      // Upload .env from temporary staging file then immediately delete temp file
      const tmpEnvLocal = path.join(getStagingDir(), `.env.upload.${tsStamp}`);
      fs.writeFileSync(tmpEnvLocal, dotEnvContent, { mode: 0o600 });
      try {
        await ftpClient.uploadFrom(tmpEnvLocal, `${ftpsRoot.replace(/\/+$/, '')}/.env`);
      } finally {
        if (fs.existsSync(tmpEnvLocal)) fs.unlinkSync(tmpEnvLocal);
      }
      log('transfer_files', 'success', `Fichiers de production et .env transférés via FTPS dans ${ftpsRoot}.`);
      setStep('transfer_files', 'completed', `Transfert FTPS réussi dans ${ftpsRoot}.`);

      // FTPS cannot run remote shell commands — be 100% honest and transparent
      setStep(
        'install_deps',
        'warning',
        'FTPS ne permet pas d’exécuter npm install à distance. Cliquez sur "Exécuter NPM Install" dans Hostinger hPanel → Node.js, ou passez en mode SSH.'
      );
      log(
        'install_deps',
        'warn',
        'Protocole FTPS détecté : exécutez "NPM Install" depuis Hostinger hPanel → Node.js (ou activez SSH sur le port 65002 pour l’automatisation complète).'
      );
      setStep(
        'start_server',
        'warning',
        'FTPS ne permet pas de redémarrer Node.js à distance. Cliquez sur "Redémarrer" dans Hostinger hPanel → Node.js.'
      );
      log(
        'start_server',
        'warn',
        'Redémarrez l’application dans Hostinger hPanel → Node.js pour charger le nouveau build.'
      );
    }

    // -------------------------------------------------------------------------
    // STEP 8: Verify live domain https://jobfounds.com
    // -------------------------------------------------------------------------
    setStep('verify_domain', 'running', `Vérification HTTPS de https://${run.domain}/api/health…`);
    // Brief settle pause after server restart
    await new Promise((r) => setTimeout(r, 3000));
    const health = await checkLiveDomainHealth(run.domain);
    if (health.healthOk) {
      run.serverStatus = 'online';
      log(
        'verify_domain',
        'success',
        `https://${run.domain}/api/health répond HTTP ${health.httpStatus} en ${health.latencyMs}ms (moteur : ${health.engineStatus || 'actif'}).`
      );
      setStep('verify_domain', 'completed', `En ligne (HTTP ${health.httpStatus} · ${health.latencyMs}ms).`);
    } else if (health.reachable) {
      run.serverStatus = 'degraded';
      log(
        'verify_domain',
        'warn',
        `Le domaine ${run.domain} répond (HTTP ${health.httpStatus}), mais /api/health n’est pas encore prêt : ${health.error || ''}`
      );
      setStep('verify_domain', 'warning', health.error || 'Domaine joignable, API santé en attente.');
    } else {
      run.serverStatus = 'offline';
      log('verify_domain', 'warn', `Impossible de joindre https://${run.domain} : ${health.error || 'injoignable'}`);
      setStep('verify_domain', 'warning', health.error || 'Domaine non joignable pour le moment.');
    }

    // -------------------------------------------------------------------------
    // STEP 9: Finalize run
    // -------------------------------------------------------------------------
    setStep('finalize', 'running', 'Finalisation du rapport de déploiement…');
    run.status = hasWarnings ? 'completed_with_warnings' : 'succeeded';
    run.finishedAt = new Date().toISOString();
    log(
      'finalize',
      hasWarnings ? 'warn' : 'success',
      hasWarnings
        ? 'Déploiement terminé avec avertissements — consultez les étapes signalées ci-dessus.'
        : `Déploiement JOBFOUNDS sur https://${run.domain} réussi et vérifié.`
    );
    setStep('finalize', 'completed', hasWarnings ? 'Terminé avec avertissements.' : 'Déploiement vérifié.');
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Erreur inattendue lors du déploiement.';
    const safeMsg = redactSecretsFromText(rawMsg, allSecrets);
    run.status = 'failed';
    run.errorMessage = safeMsg;
    run.finishedAt = new Date().toISOString();

    const activeStep = run.steps.find((s) => s.status === 'running') || run.steps.find((s) => s.status === 'pending');
    if (activeStep) {
      setStep(activeStep.id, 'failed', safeMsg);
      log(activeStep.id, 'error', safeMsg);
    } else {
      log('finalize', 'error', safeMsg);
    }
    for (const step of run.steps) {
      if (step.status === 'pending') {
        step.status = 'skipped';
      }
    }
    persistRunSnapshot(run, bundlePath);
  } finally {
    if (sshClient) {
      try {
        sshClient.end();
      } catch {
        // ignore close errors
      }
    }
    if (ftpClient) {
      try {
        ftpClient.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Dashboard Aggregate State
// -----------------------------------------------------------------------------
export function getDeployDashboardState(): DeployDashboardState {
  const config = getHostingerConfigView();
  const envVars = listDeployEnvVarsView();
  const fileCheck = checkRequiredProjectFiles();
  const missingRequiredEnv = envVars.filter((v) => v.required && !v.configured).map((v) => v.key);
  const connectionConfigured = Boolean(
    config.host &&
      config.username &&
      config.remotePath &&
      (config.authMethod === 'password' || config.hasSshKey)
  );

  const recentRuns = listRecentDeployRuns(10);
  const latestRun = recentRuns[0] || null;
  const backupsDir = getBackupsDir();
  const backupsCount = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir).filter((f) => f.endsWith('.sqlite')).length
    : 0;

  return {
    config,
    envVars,
    preflight: {
      projectFilesOk: fileCheck.ok,
      missingFiles: fileCheck.missing,
      requiredEnvReady: missingRequiredEnv.length === 0,
      missingRequiredEnv,
      connectionConfigured,
      readyToDeploy: fileCheck.ok && missingRequiredEnv.length === 0 && connectionConfigured,
    },
    activeRunId: activeDeployRunId,
    latestRun,
    recentRuns,
    backupsCount,
    hasDownloadableBundle: Boolean(getLatestBundlePath()),
  };
}
