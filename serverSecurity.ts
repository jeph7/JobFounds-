import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : path.resolve(__dirname, '..');

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthedRequest extends Request {
  authUser?: VerifiedAuthUser | null;
}

// Load Firebase Project ID from environment override or firebase-applet-config.json
let FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || '').trim();
if (!FIREBASE_PROJECT_ID) {
  try {
    const cfgPath = path.resolve(PROJECT_ROOT, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      FIREBASE_PROJECT_ID = String(raw.projectId || '').trim();
    }
  } catch {
    // fallback empty
  }
}

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface CachedJwks {
  keys: Record<string, crypto.KeyObject>;
  expiresAt: number;
}

let jwksCache: CachedJwks | null = null;

async function getFirebasePublicKeys(): Promise<Record<string, crypto.KeyObject>> {
  if (jwksCache && Date.now() < jwksCache.expiresAt) {
    return jwksCache.keys;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(GOOGLE_JWKS_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch Firebase JWKS (${res.status})`);
    }
    const cacheHeader = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheHeader.match(/max-age=(\d+)/i);
    const maxAgeMs = (maxAgeMatch ? Number(maxAgeMatch[1]) : 3600) * 1000;
    const body = (await res.json()) as { keys?: Array<Record<string, any>> };

    const map: Record<string, crypto.KeyObject> = {};
    for (const jwk of body.keys || []) {
      if (jwk.kid) {
        map[jwk.kid] = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
      }
    }
    jwksCache = {
      keys: map,
      expiresAt: Date.now() + Math.max(60_000, Math.min(maxAgeMs, 6 * 3600_000)),
    };
    return map;
  } finally {
    clearTimeout(timer);
  }
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  return Buffer.from(pad ? normalized + '='.repeat(4 - pad) : normalized, 'base64');
}

/**
 * Verifies a Firebase Auth ID token using RS256 against Google's official JWKS certs.
 */
export async function verifyFirebaseIdToken(token: string): Promise<VerifiedAuthUser | null> {
  if (!FIREBASE_PROJECT_ID || !token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf-8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return null;

    const keys = await getFirebasePublicKeys();
    const pubKey = keys[header.kid];
    if (!pubKey) return null;

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf-8');
    const signature = base64UrlDecode(sigB64);
    const validSig = crypto.verify('RSA-SHA256', signingInput, pubKey, signature);
    if (!validSig) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;
    if (!payload.exp || payload.exp <= nowSec) return null;
    if (payload.iat && payload.iat > nowSec + 300) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      emailVerified: Boolean(payload.email_verified),
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = 'jf_session';

export function parseCookieValue(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader || typeof cookieHeader !== 'string') return '';
  const pairs = cookieHeader.split(';');
  for (const part of pairs) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim());
      } catch {
        return part.slice(eqIdx + 1).trim();
      }
    }
  }
  return '';
}

function isSameOriginMutation(req: Request): boolean {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = String(req.headers.origin || '').trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim().toLowerCase();
  if (!origin || !host) return true;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

type AppSessionVerifier = (token: string) => VerifiedAuthUser | null;
let appSessionVerifier: AppSessionVerifier | null = null;

export function registerAppTokenVerifier(fn: AppSessionVerifier): void {
  appSessionVerifier = fn;
}

/**
 * Express middleware that verifies optional Authorization Bearer token (JOBFOUNDS session or Firebase JWT)
 * or HttpOnly jf_session cookie and attaches req.authUser (preserving emailVerified for strict server-side gating).
 */
export async function attachFirebaseAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const appUser = appSessionVerifier ? appSessionVerifier(token) : null;
    if (appUser) {
      req.authUser = appUser;
    } else {
      req.authUser = await verifyFirebaseIdToken(token);
    }
    next();
    return;
  }

  const cookieToken = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (cookieToken && appSessionVerifier && isSameOriginMutation(req)) {
    req.authUser = appSessionVerifier(cookieToken);
  } else {
    req.authUser = null;
  }
  next();
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * Sliding/fixed window rate limiter distinguishing verified Firebase users from guest IPs.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxAuthenticated: number;
  maxGuest: number;
  bucketPrefix: string;
}) {
  const buckets = new Map<string, RateBucket>();

  // Periodic cleanup to prevent unbounded map growth
  setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets.entries()) {
      if (now >= b.resetAt) buckets.delete(key);
    }
  }, Math.min(options.windowMs, 5 * 60_000)).unref?.();

  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const isAuthed = Boolean(req.authUser?.uid);
    const clientIp = extractClientIp(req);
    const key = isAuthed
      ? `${options.bucketPrefix}:uid:${req.authUser!.uid}`
      : `${options.bucketPrefix}:ip:${clientIp}`;

    const limit = isAuthed ? options.maxAuthenticated : options.maxGuest;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > limit) {
      const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.status(429).json({
        error: isAuthed
          ? `Rate limit reached (${limit} requests per window). Please retry in ${retrySec}s.`
          : `Guest request limit reached (${limit} requests). Sign in with Google for higher limits or retry in ${retrySec}s.`,
      });
      return;
    }

    next();
  };
}

/**
 * Clamps untrusted string fields to safe character bounds before passing to prompts or APIs.
 */
export function clampStr(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLen);
}

/**
 * Validates that a user-provided URL is strictly public http/https and not pointing to
 * loopback, link-local, metadata endpoints, or private RFC1918 networks.
 */
export function isSafePublicHttpUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes('.')) return false;
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '::1' ||
      host === '0.0.0.0' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sanitizeHttpUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  return isSafePublicHttpUrl(trimmed) ? trimmed : '';
}

export const BOOTSTRAP_ADMIN_EMAIL = 'guerrierjephly@gmail.com';

type AdminEmailChecker = (email: string) => boolean;
let registeredAdminEmailChecker: AdminEmailChecker | null = null;

export function registerAdminEmailChecker(fn: AdminEmailChecker): void {
  registeredAdminEmailChecker = fn;
}

export interface AccountModerationCheckResult {
  blocked: boolean;
  moderationStatus: 'approved' | 'pending' | 'rejected' | 'suspended';
  moderationNote: string;
}

type UserModerationChecker = (uid: string, email: string) => AccountModerationCheckResult;
let registeredUserModerationChecker: UserModerationChecker | null = null;

export function registerUserModerationChecker(fn: UserModerationChecker): void {
  registeredUserModerationChecker = fn;
}

export function checkAccountModeration(
  user?: Pick<VerifiedAuthUser, 'uid' | 'email'> | null
): AccountModerationCheckResult {
  if (!user) {
    return { blocked: false, moderationStatus: 'approved', moderationNote: '' };
  }
  const email = (user.email || '').trim().toLowerCase();
  if (email === BOOTSTRAP_ADMIN_EMAIL) {
    return { blocked: false, moderationStatus: 'approved', moderationNote: '' };
  }
  if (registeredUserModerationChecker) {
    return registeredUserModerationChecker(user.uid, email);
  }
  return { blocked: false, moderationStatus: 'approved', moderationNote: '' };
}

export function getConfiguredEnvAdminEmails(): string[] {
  const raw = String(process.env.ADMIN_EMAILS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export function isAdminAuthUser(user?: VerifiedAuthUser | null): boolean {
  if (!user || !user.uid || !user.emailVerified) return false;
  const email = user.email.trim().toLowerCase();
  if (!email) return false;
  if (email === BOOTSTRAP_ADMIN_EMAIL) return true;
  if (getConfiguredEnvAdminEmails().includes(email)) return true;
  if (registeredAdminEmailChecker && registeredAdminEmailChecker(email)) return true;
  return false;
}

export function extractClientIp(req: Request): string {
  const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cfIp) return cfIp;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

/**
 * Mandatory Firebase Authentication gate for sensitive AI, intelligence, and mutation APIs.
 */
export function requireFirebaseAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser?.uid) {
    res.status(401).json({
      error: 'Connexion requise : veuillez vous connecter à votre compte JOBFOUNDS.',
      code: 'AUTH_REQUIRED',
    });
    return;
  }
  if (!req.authUser.emailVerified) {
    res.status(403).json({
      error:
        'Votre adresse e-mail n’est pas encore confirmée. Saisissez le code à 5 chiffres reçu par e-mail pour activer votre compte.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }
  const mod = checkAccountModeration(req.authUser);
  if (mod.blocked) {
    res.status(403).json({
      code: 'ACCOUNT_MODERATED',
      moderationStatus: mod.moderationStatus,
      moderationNote: mod.moderationNote,
      error:
        mod.moderationStatus === 'suspended'
          ? `Votre compte a été suspendu par un administrateur.${mod.moderationNote ? ` Motif : ${mod.moderationNote}` : ''}`
          : `Votre compte a été refusé par un administrateur.${mod.moderationNote ? ` Motif : ${mod.moderationNote}` : ''}`,
    });
    return;
  }
  next();
}

/**
 * Strict Admin RBAC gate verifying an email-verified administrator account.
 */
export function requireAdminAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser?.uid) {
    res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    return;
  }
  if (!isAdminAuthUser(req.authUser)) {
    res.status(403).json({ error: 'Administrator privileges required.', code: 'ADMIN_REQUIRED' });
    return;
  }
  next();
}

/**
 * Normalizes a company domain or name into a canonical deduplication key.
 */
export function extractDomainFromUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeCanonicalName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|llc|ltd|sas|sarl|sa|gmbh|ag|corp|corporation|co|group|groupe|technologies|tech)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

