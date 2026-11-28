import crypto from 'crypto';
import express from 'express';
import {
  type AuthUserRecord,
  type UserModerationStatus,
  type VerificationCodePurpose,
  consumeVerificationCode,
  createAuthUserRecord,
  createEmailVerificationCodeRecord,
  deleteAuthUserByUid,
  deleteUserWorkspaceData,
  getAccountModerationStatus,
  getAuthUserByEmail,
  getAuthUserByUid,
  getLatestActiveVerificationCode,
  getLatestVerificationCodeAny,
  getPlatformUserDossierForAdmin,
  getUserWorkspaceData,
  grantAdminRoleByEmail,
  incrementVerificationCodeAttempts,
  isEmailInAdminRoles,
  listAdminRoleRecords,
  listAllPlatformUsersForAdmin,
  listAllSubmissionsForAdmin,
  markAuthUserEmailVerified,
  moderateAccountDirectoryAdmin,
  moderateAuthUserAdmin,
  moderateSubmissionAdmin,
  recordSourceCall,
  revokeAdminRoleByEmail,
  updateAuthUserPassword,
  upsertAccountDirectoryEntry,
  upsertUserWorkspaceData,
  writeAuditLog,
} from './serverEngineDb.ts';
import { getResendFromEmail } from './serverApplicationEngine.ts';
import {
  type AuthedRequest,
  BOOTSTRAP_ADMIN_EMAIL,
  SESSION_COOKIE_NAME,
  type VerifiedAuthUser,
  checkAccountModeration,
  clampStr,
  createRateLimiter,
  extractClientIp,
  isAdminAuthUser,
  registerAdminEmailChecker,
  registerUserModerationChecker,
  requireAdminAuth,
  requireFirebaseAuth,
} from './serverSecurity.ts';

// Ensure dynamic SQLite admin_roles and account moderation lookups are always active
registerAdminEmailChecker(isEmailInAdminRoles);
registerUserModerationChecker(getAccountModerationStatus);

// Session signing key from environment or ephemeral in-memory 256-bit key (never hardcoded)
const SESSION_SECRET =
  (process.env.AUTH_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface PublicAuthUser {
  uid: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  accountRole: 'candidate' | 'recruiter';
  isAdmin: boolean;
  moderationStatus: UserModerationStatus;
  provider: 'password';
}

function toPublicUser(user: AuthUserRecord): PublicAuthUser {
  return {
    uid: user.uid,
    email: user.email,
    fullName: user.fullName,
    emailVerified: user.emailVerified,
    accountRole: user.accountRole,
    isAdmin: isAdminAuthUser({
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
    }),
    moderationStatus: user.moderationStatus,
    provider: 'password',
  };
}

function isHttpsRequest(req: express.Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || xfProto === 'https');
}

function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function hashSecretScrypt(secret: string, saltHex: string, keyLen = 64): string {
  return crypto.scryptSync(secret, saltHex, keyLen, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function verifySecretScrypt(
  secret: string,
  saltHex: string,
  expectedHashHex: string,
  keyLen = 64
): boolean {
  const actual = Buffer.from(hashSecretScrypt(secret, saltHex, keyLen), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  return Buffer.from(pad ? normalized + '='.repeat(4 - pad) : normalized, 'base64');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a cryptographically secure 5-digit verification code (10000–99999).
 */
export function generateFiveDigitCode(): string {
  return String(crypto.randomInt(10000, 100000));
}

/**
 * Issues a server-signed HMAC-SHA256 session token (header.payload.signature).
 */
export function issueAppSessionToken(user: AuthUserRecord): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JF-SESSION' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/**
 * Verifies a server-signed JOBFOUNDS session token and resolves authoritative emailVerified state from SQLite.
 */
export function verifyAppSessionToken(token: string): VerifiedAuthUser | null {
  if (!token || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf-8')) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== 'HS256' || header.typ !== 'JF-SESSION') return null;

    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(signingInput).digest();
    const providedSig = base64UrlDecode(sigB64);
    if (expectedSig.length !== providedSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8')) as {
      sub?: string;
      email?: string;
      emailVerified?: boolean;
      exp?: number;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.exp || payload.exp <= nowSec) return null;

    // Always read authoritative verification & moderation state from SQLite
    const dbUser = getAuthUserByUid(payload.sub);
    if (!dbUser) return null;
    if (dbUser.moderationStatus === 'rejected' || dbUser.moderationStatus === 'suspended') {
      return null;
    }

    return {
      uid: dbUser.uid,
      email: dbUser.email,
      emailVerified: dbUser.emailVerified,
    };
  } catch {
    return null;
  }
}

export interface VerificationEmailDispatchResult {
  sent: boolean;
  messageId?: string;
  reason: string;
}

/**
 * Sends a 5-digit verification or password-reset code via Resend API.
 * Honest reporting: NEVER claims sent=true unless Resend confirms HTTP 2xx.
 */
export async function sendVerificationCodeEmail(params: {
  to: string;
  fullName: string;
  code: string;
  purpose?: VerificationCodePurpose;
}): Promise<VerificationEmailDispatchResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = getResendFromEmail();

  if (!apiKey) {
    return {
      sent: false,
      reason:
        'Le service d’envoi d’e-mail (RESEND_API_KEY) n’est pas configuré sur le serveur. Configurez RESEND_API_KEY pour envoyer le code à 5 chiffres.',
    };
  }
  if (!fromEmail) {
    return {
      sent: false,
      reason:
        'L’adresse expéditeur (RESEND_FROM_EMAIL ou NOTIFICATION_FROM_EMAIL) n’est pas configurée ou est invalide.',
    };
  }

  const isReset = params.purpose === 'reset_password';
  const safeName = escapeHtml(params.fullName || 'Candidat');
  const safeCode = escapeHtml(params.code);
  const subject = isReset
    ? `${params.code} — Réinitialisation de votre mot de passe JOBFOUNDS`
    : `${params.code} — Votre code de confirmation JOBFOUNDS`;

  const headline = isReset
    ? 'Réinitialisation de votre mot de passe'
    : 'Confirmez votre adresse e-mail';
  const leadParagraph = isReset
    ? 'Vous avez demandé à réinitialiser le mot de passe de votre compte JOBFOUNDS. Saisissez le code de sécurité à <strong>5 chiffres</strong> ci-dessous :'
    : 'Pour valider la création de votre compte JOBFOUNDS et accéder à votre espace personnel, saisissez le code de confirmation à <strong>5 chiffres</strong> ci-dessous :';
  const footnote = isReset
    ? 'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.'
    : 'Sans la saisie de ce code, votre compte ne sera pas activé. Si vous n’êtes pas à l’origine de cette inscription, ignorez cet e-mail en toute sécurité.';

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background-color:#F4F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#06132F;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9E6F2;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="background:#06132F;padding:20px 28px;color:#FFFFFF;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#A9D8F5;font-weight:700;">JOBFOUNDS</div>
          <div style="font-size:19px;font-weight:700;margin-top:6px;">${headline}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;font-size:14px;line-height:1.65;color:#1E293B;">
          <p style="margin:0 0 14px;">Bonjour <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 18px;">${leadParagraph}</p>
          <div style="margin:22px 0;padding:18px;background:#F0F7FF;border:1px solid #BFDBFE;border-radius:12px;text-align:center;">
            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:0.32em;color:#06132F;">${safeCode}</span>
          </div>
          <p style="margin:0 0 10px;font-size:13px;color:#475569;">Ce code est valable pendant <strong>15 minutes</strong> et ne peut être utilisé qu’une seule fois.</p>
          <p style="margin:0;font-size:12px;color:#64748B;">${footnote}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B;text-align:center;">
          JOBFOUNDS · Plateforme internationale d’intelligence carrière et recrutement
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = isReset
    ? [
        `Bonjour ${params.fullName || 'Candidat'},`,
        '',
        `Votre code JOBFOUNDS à 5 chiffres pour réinitialiser votre mot de passe est : ${params.code}`,
        '',
        'Ce code est valable pendant 15 minutes et ne peut être utilisé qu’une seule fois.',
        "Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.",
      ].join('\n')
    : [
        `Bonjour ${params.fullName || 'Candidat'},`,
        '',
        `Votre code de confirmation JOBFOUNDS à 5 chiffres est : ${params.code}`,
        '',
        'Ce code est valable pendant 15 minutes. Sans ce code, votre compte ne sera pas validé.',
        "Si vous n'avez pas demandé ce code, ignorez cet e-mail.",
      ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject,
        html,
        text,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: string;
    };
    if (!res.ok) {
      const errDetail = data?.message || data?.error || `HTTP ${res.status}`;
      recordSourceCall('resend_email', false, `Auth code email failed: ${errDetail}`);
      return {
        sent: false,
        reason: `L’envoi de l’e-mail via Resend a échoué (${errDetail}). Vérifiez que votre domaine expéditeur est bien validé dans Resend (DNS SPF/DKIM).`,
      };
    }

    recordSourceCall('resend_email', true);
    return {
      sent: true,
      messageId: data?.id || '',
      reason: 'Code à 5 chiffres envoyé par e-mail.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSourceCall('resend_email', false, `Auth email network error: ${msg}`);
    return {
      sent: false,
      reason: `Erreur réseau lors de l’envoi du code (${msg}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates, hashes, stores, and emails a 5-digit code for a user (verification or password reset).
 */
export async function issueAndSendFiveDigitCode(
  user: AuthUserRecord,
  options?: { purpose?: VerificationCodePurpose; skipEmailForTest?: boolean }
): Promise<{
  codeForTest?: string;
  expiresAt: string;
  emailSent: boolean;
  emailReason: string;
  messageId?: string;
}> {
  const purpose: VerificationCodePurpose =
    options?.purpose === 'reset_password' ? 'reset_password' : 'verify_email';
  const code = generateFiveDigitCode();
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashSecretScrypt(code, codeSalt, 32);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  createEmailVerificationCodeRecord({
    userId: user.uid,
    email: user.email,
    purpose,
    codeHash,
    codeSalt,
    expiresAt,
    maxAttempts: MAX_CODE_ATTEMPTS,
  });

  if (options?.skipEmailForTest) {
    return {
      codeForTest: code,
      expiresAt,
      emailSent: true,
      emailReason: 'Test mode: email dispatch bypassed.',
    };
  }

  const dispatch = await sendVerificationCodeEmail({
    to: user.email,
    fullName: user.fullName,
    code,
    purpose,
  });

  return {
    expiresAt,
    emailSent: dispatch.sent,
    emailReason: dispatch.reason,
    messageId: dispatch.messageId,
  };
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string') return 'Mot de passe requis.';
  if (password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (password.length > 128) {
    return 'Le mot de passe ne doit pas dépasser 128 caractères.';
  }
  return null;
}

export function createPasswordCredentials(password: string): {
  passwordHash: string;
  passwordSalt: string;
} {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashSecretScrypt(password, passwordSalt, 64);
  return { passwordHash, passwordSalt };
}

export function verifyPasswordCredentials(password: string, user: AuthUserRecord): boolean {
  if (!password || password.length > 128) return false;
  return verifySecretScrypt(password, user.passwordSalt, user.passwordHash, 64);
}

/**
 * Verifies a 5-digit code strictly scoped to its purpose ('verify_email' or 'reset_password').
 */
export function verifyFiveDigitCodeForUser(
  user: AuthUserRecord,
  rawCode: string,
  purpose: VerificationCodePurpose = 'verify_email'
): {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  remainingAttempts?: number;
  user?: AuthUserRecord;
} {
  if (purpose === 'verify_email' && user.emailVerified) {
    return { ok: true, status: 200, user };
  }

  const cleanCode = String(rawCode || '').trim();
  if (!/^\d{5}$/.test(cleanCode)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_CODE_FORMAT',
      error: 'Veuillez saisir un code valide composé exactement de 5 chiffres.',
    };
  }

  const record = getLatestActiveVerificationCode(user.uid, purpose);
  if (!record) {
    return {
      ok: false,
      status: 400,
      code: 'NO_ACTIVE_CODE',
      error:
        'Aucun code actif trouvé. Demandez un nouveau code à 5 chiffres pour continuer.',
    };
  }

  if (Date.parse(record.expiresAt) < Date.now()) {
    consumeVerificationCode(record.id);
    return {
      ok: false,
      status: 400,
      code: 'CODE_EXPIRED',
      error: 'Ce code a expiré (validité 15 minutes). Demandez un nouveau code à 5 chiffres.',
    };
  }

  if (record.attempts >= record.maxAttempts) {
    consumeVerificationCode(record.id);
    return {
      ok: false,
      status: 429,
      code: 'CODE_LOCKED',
      remainingAttempts: 0,
      error: 'Trop de tentatives incorrectes. Demandez un nouveau code à 5 chiffres.',
    };
  }

  const valid = verifySecretScrypt(cleanCode, record.codeSalt, record.codeHash, 32);
  if (!valid) {
    const newAttempts = incrementVerificationCodeAttempts(record.id);
    const remaining = Math.max(0, record.maxAttempts - newAttempts);
    if (remaining === 0) {
      consumeVerificationCode(record.id);
    }
    return {
      ok: false,
      status: 400,
      code: remaining === 0 ? 'CODE_LOCKED' : 'INVALID_CODE',
      remainingAttempts: remaining,
      error:
        remaining > 0
          ? `Code incorrect. Il vous reste ${remaining} tentative${remaining > 1 ? 's' : ''}.`
          : 'Code verrouillé après 5 essais incorrects. Demandez un nouveau code.',
    };
  }

  // Code matches: consume immediately
  consumeVerificationCode(record.id);

  if (purpose === 'verify_email') {
    const verifiedUser = markAuthUserEmailVerified(user.uid);
    if (!verifiedUser) {
      return {
        ok: false,
        status: 500,
        code: 'USER_UPDATE_FAILED',
        error: 'Impossible de valider le compte.',
      };
    }
    return { ok: true, status: 200, user: verifiedUser };
  }

  return { ok: true, status: 200, user };
}

export function createAuthRouter(): express.Router {
  const router = express.Router();

  const registerLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 10,
    maxGuest: 10,
    bucketPrefix: 'auth_register',
  });
  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 20,
    maxGuest: 20,
    bucketPrefix: 'auth_login',
  });
  const verifyLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 15,
    maxGuest: 15,
    bucketPrefix: 'auth_verify',
  });
  const resendLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 8,
    maxGuest: 8,
    bucketPrefix: 'auth_resend',
  });
  const resetLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 10,
    maxGuest: 10,
    bucketPrefix: 'auth_reset',
  });
  const workspaceLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 180,
    maxGuest: 20,
    bucketPrefix: 'account_workspace',
  });

  // 1. POST /api/auth/register — Create unverified account + send 5-digit code by email
  router.post('/auth/register', registerLimiter, async (req, res) => {
    try {
      const firstName = clampStr(req.body?.firstName, 60);
      const lastName = clampStr(req.body?.lastName, 60);
      const rawFullName = clampStr(req.body?.fullName, 120);
      const fullName =
        firstName || lastName ? clampStr(`${firstName} ${lastName}`.trim(), 120) : rawFullName;
      const email = clampStr(req.body?.email, 200).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const accountRole = req.body?.accountRole === 'recruiter' ? 'recruiter' : 'candidate';

      if (
        (req.body?.firstName !== undefined || req.body?.lastName !== undefined) &&
        (!lastName || !firstName)
      ) {
        res.status(400).json({ error: 'Veuillez renseigner votre nom et votre prénom.' });
        return;
      }
      if (!fullName || fullName.length < 2) {
        res.status(400).json({ error: 'Veuillez renseigner votre nom et votre prénom.' });
        return;
      }
      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
        return;
      }
      const pwdErr = validatePasswordStrength(password);
      if (pwdErr) {
        res.status(400).json({ error: pwdErr });
        return;
      }

      const existing = getAuthUserByEmail(email);
      if (existing) {
        if (existing.emailVerified) {
          res.status(409).json({
            code: 'EMAIL_ALREADY_REGISTERED',
            error: 'Un compte vérifié existe déjà avec cette adresse e-mail. Connectez-vous.',
          });
          return;
        }
        if (!verifyPasswordCredentials(password, existing)) {
          res.status(409).json({
            code: 'EMAIL_PENDING_VERIFICATION',
            error:
              'Un compte non encore vérifié existe avec cette adresse e-mail. Connectez-vous avec votre mot de passe pour saisir ou renvoyer le code à 5 chiffres.',
          });
          return;
        }
        const dispatch = await issueAndSendFiveDigitCode(existing, { purpose: 'verify_email' });
        const token = issueAppSessionToken(existing);
        setSessionCookie(req, res, token);
        res.status(200).json({
          user: toPublicUser(existing),
          token,
          verificationRequired: true,
          emailSent: dispatch.emailSent,
          emailReason: dispatch.emailReason,
          expiresAt: dispatch.expiresAt,
          cooldownSeconds: 60,
        });
        return;
      }

      const { passwordHash, passwordSalt } = createPasswordCredentials(password);
      const created = createAuthUserRecord({
        email,
        fullName,
        passwordHash,
        passwordSalt,
        accountRole,
      });

      const dispatch = await issueAndSendFiveDigitCode(created, { purpose: 'verify_email' });
      const token = issueAppSessionToken(created);
      setSessionCookie(req, res, token);

      res.status(201).json({
        user: toPublicUser(created),
        token,
        verificationRequired: true,
        emailSent: dispatch.emailSent,
        emailReason: dispatch.emailReason,
        expiresAt: dispatch.expiresAt,
        cooldownSeconds: 60,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la création du compte.',
      });
    }
  });

  // 2. POST /api/auth/login — Authenticate with email & password; block workspace if not verified
  router.post('/auth/login', loginLimiter, async (req, res) => {
    try {
      const email = clampStr(req.body?.email, 200).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!EMAIL_REGEX.test(email) || !password) {
        res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
        return;
      }

      const user = getAuthUserByEmail(email);
      if (!user || !verifyPasswordCredentials(password, user)) {
        res.status(401).json({
          code: 'INVALID_CREDENTIALS',
          error: 'Adresse e-mail ou mot de passe incorrect.',
        });
        return;
      }

      if (user.moderationStatus === 'rejected' || user.moderationStatus === 'suspended') {
        clearSessionCookie(req, res);
        res.status(403).json({
          code: 'ACCOUNT_MODERATED',
          moderationStatus: user.moderationStatus,
          error:
            user.moderationStatus === 'suspended'
              ? `Ce compte a été suspendu par un administrateur.${user.moderationNote ? ` Motif : ${user.moderationNote}` : ''}`
              : `Ce compte a été refusé par un administrateur.${user.moderationNote ? ` Motif : ${user.moderationNote}` : ''}`,
        });
        return;
      }

      const token = issueAppSessionToken(user);
      setSessionCookie(req, res, token);

      if (!user.emailVerified) {
        const activeCode = getLatestActiveVerificationCode(user.uid, 'verify_email');
        let emailSent = false;
        let emailReason =
          'Votre compte n’est pas encore validé. Saisissez le code à 5 chiffres envoyé à votre adresse e-mail.';
        let expiresAt = activeCode?.expiresAt || '';

        if (!activeCode || Date.parse(activeCode.expiresAt) < Date.now()) {
          const dispatch = await issueAndSendFiveDigitCode(user, { purpose: 'verify_email' });
          emailSent = dispatch.emailSent;
          emailReason = dispatch.emailReason;
          expiresAt = dispatch.expiresAt;
        }

        res.status(200).json({
          user: toPublicUser(user),
          token,
          verificationRequired: true,
          emailSent,
          emailReason,
          expiresAt,
        });
        return;
      }

      res.status(200).json({
        user: toPublicUser(user),
        token,
        verificationRequired: false,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la connexion.',
      });
    }
  });

  // 3. POST /api/auth/verify-code — Validate 5-digit code and unlock account
  router.post('/auth/verify-code', verifyLimiter, (req: AuthedRequest, res) => {
    try {
      const rawCode = clampStr(req.body?.code, 10);
      const bodyEmail = clampStr(req.body?.email, 200).toLowerCase();

      let user: AuthUserRecord | null = null;
      if (req.authUser?.uid) {
        user = getAuthUserByUid(req.authUser.uid);
      } else if (bodyEmail && EMAIL_REGEX.test(bodyEmail)) {
        user = getAuthUserByEmail(bodyEmail);
      }

      if (!user) {
        res.status(404).json({
          code: 'ACCOUNT_NOT_FOUND',
          error: 'Compte introuvable. Veuillez recommencer votre inscription.',
        });
        return;
      }

      const result = verifyFiveDigitCodeForUser(user, rawCode, 'verify_email');
      if (!result.ok || !result.user) {
        res.status(result.status).json({
          code: result.code,
          error: result.error,
          remainingAttempts: result.remainingAttempts,
        });
        return;
      }

      const freshToken = issueAppSessionToken(result.user);
      setSessionCookie(req, res, freshToken);
      res.status(200).json({
        verified: true,
        user: toPublicUser(result.user),
        token: freshToken,
        message: 'Votre adresse e-mail a été confirmée. Bienvenue sur JOBFOUNDS !',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la vérification du code.',
      });
    }
  });

  // 4. POST /api/auth/resend-code — Rate-limited 60s cooldown resend of a fresh 5-digit code
  router.post('/auth/resend-code', resendLimiter, async (req: AuthedRequest, res) => {
    try {
      const bodyEmail = clampStr(req.body?.email, 200).toLowerCase();
      let user: AuthUserRecord | null = null;
      if (req.authUser?.uid) {
        user = getAuthUserByUid(req.authUser.uid);
      } else if (bodyEmail && EMAIL_REGEX.test(bodyEmail)) {
        user = getAuthUserByEmail(bodyEmail);
      }

      if (!user) {
        res.status(404).json({
          code: 'ACCOUNT_NOT_FOUND',
          error: 'Compte introuvable.',
        });
        return;
      }

      if (user.emailVerified) {
        const freshToken = issueAppSessionToken(user);
        setSessionCookie(req, res, freshToken);
        res.status(200).json({
          alreadyVerified: true,
          user: toPublicUser(user),
          token: freshToken,
          message: 'Ce compte est déjà vérifié.',
        });
        return;
      }

      const latest = getLatestVerificationCodeAny(user.uid, 'verify_email');
      if (latest) {
        const elapsedMs = Date.now() - Date.parse(latest.createdAt);
        if (elapsedMs >= 0 && elapsedMs < RESEND_COOLDOWN_MS) {
          const waitSec = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
          res.status(429).json({
            code: 'RESEND_COOLDOWN',
            retryAfterSeconds: waitSec,
            error: `Veuillez patienter ${waitSec}s avant de demander un nouveau code.`,
          });
          return;
        }
      }

      const dispatch = await issueAndSendFiveDigitCode(user, { purpose: 'verify_email' });
      res.status(200).json({
        emailSent: dispatch.emailSent,
        emailReason: dispatch.emailReason,
        expiresAt: dispatch.expiresAt,
        cooldownSeconds: 60,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Impossible de renvoyer le code.',
      });
    }
  });

  // 5. POST /api/auth/forgot-password — Request a 5-digit password reset code
  router.post('/auth/forgot-password', resetLimiter, async (req, res) => {
    try {
      const email = clampStr(req.body?.email, 200).toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
        return;
      }

      const user = getAuthUserByEmail(email);
      if (!user) {
        // Avoid user-enumeration leak while remaining honest if email relay itself isn't configured
        const relayReady = Boolean((process.env.RESEND_API_KEY || '').trim() && getResendFromEmail());
        res.status(200).json({
          emailSent: relayReady,
          emailReason: relayReady
            ? 'Si un compte JOBFOUNDS correspond à cette adresse, un code à 5 chiffres vient d’être envoyé.'
            : 'Le service d’envoi d’e-mail Resend n’est pas configuré sur le serveur.',
          cooldownSeconds: 60,
        });
        return;
      }

      const latest = getLatestVerificationCodeAny(user.uid, 'reset_password');
      if (latest) {
        const elapsedMs = Date.now() - Date.parse(latest.createdAt);
        if (elapsedMs >= 0 && elapsedMs < RESEND_COOLDOWN_MS) {
          const waitSec = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
          res.status(429).json({
            code: 'RESEND_COOLDOWN',
            retryAfterSeconds: waitSec,
            error: `Veuillez patienter ${waitSec}s avant de demander un nouveau code de réinitialisation.`,
          });
          return;
        }
      }

      const dispatch = await issueAndSendFiveDigitCode(user, { purpose: 'reset_password' });
      res.status(200).json({
        emailSent: dispatch.emailSent,
        emailReason: dispatch.emailSent
          ? 'Si un compte JOBFOUNDS correspond à cette adresse, un code à 5 chiffres vient d’être envoyé.'
          : dispatch.emailReason,
        expiresAt: dispatch.expiresAt,
        cooldownSeconds: 60,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : 'Erreur lors de la demande de réinitialisation.',
      });
    }
  });

  // 6. POST /api/auth/reset-password — Verify 5-digit reset code & set new password
  router.post('/auth/reset-password', resetLimiter, (req, res) => {
    try {
      const email = clampStr(req.body?.email, 200).toLowerCase();
      const code = clampStr(req.body?.code, 10);
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Adresse e-mail invalide.' });
        return;
      }
      const pwdErr = validatePasswordStrength(newPassword);
      if (pwdErr) {
        res.status(400).json({ error: pwdErr });
        return;
      }

      const user = getAuthUserByEmail(email);
      if (!user) {
        res.status(400).json({
          code: 'INVALID_CODE',
          error: 'Code invalide ou expiré. Vérifiez votre adresse e-mail et votre code à 5 chiffres.',
        });
        return;
      }

      const verification = verifyFiveDigitCodeForUser(user, code, 'reset_password');
      if (!verification.ok) {
        res.status(verification.status).json({
          code: verification.code,
          error: verification.error,
          remainingAttempts: verification.remainingAttempts,
        });
        return;
      }

      const { passwordHash, passwordSalt } = createPasswordCredentials(newPassword);
      const updated = updateAuthUserPassword(user.uid, passwordHash, passwordSalt);
      if (!updated) {
        res.status(500).json({ error: 'Impossible de mettre à jour le mot de passe.' });
        return;
      }

      const freshToken = issueAppSessionToken(updated);
      setSessionCookie(req, res, freshToken);

      res.status(200).json({
        reset: true,
        user: toPublicUser(updated),
        token: freshToken,
        message: 'Mot de passe mis à jour avec succès ! Connexion en cours…',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la réinitialisation.',
      });
    }
  });

  // 7. POST /api/auth/logout — Clear HttpOnly session cookie
  router.post('/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // 8. GET /api/auth/me — Restore current session from HttpOnly cookie or Bearer token
  router.get('/auth/me', (req: AuthedRequest, res) => {
    if (!req.authUser?.uid) {
      res.status(401).json({ authenticated: false, code: 'AUTH_REQUIRED' });
      return;
    }

    const mod = checkAccountModeration(req.authUser);
    if (mod.blocked) {
      clearSessionCookie(req, res);
      res.status(403).json({
        authenticated: false,
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

    const dbUser = getAuthUserByUid(req.authUser.uid);
    if (dbUser) {
      const freshToken = issueAppSessionToken(dbUser);
      res.json({
        authenticated: true,
        user: toPublicUser(dbUser),
        token: freshToken,
      });
      return;
    }

    // Auto-index verified Firebase/Google accounts into SQLite directory so ALL Admins (Password & Google) see them
    if (req.authUser.email) {
      upsertAccountDirectoryEntry({
        uid: req.authUser.uid,
        email: req.authUser.email,
        provider: 'firebase',
      });
    }

    res.json({
      authenticated: true,
      user: {
        uid: req.authUser.uid,
        email: req.authUser.email,
        fullName: '',
        emailVerified: req.authUser.emailVerified,
        accountRole: 'candidate',
        isAdmin: isAdminAuthUser(req.authUser),
        moderationStatus: mod.moderationStatus,
        provider: 'firebase',
      },
    });
  });

  // 8b. POST /api/account/sync-directory — Mirror verified Google/Firebase user's non-sensitive profile & counts into SQLite for unified Admin visibility
  router.post(
    '/account/sync-directory',
    workspaceLimiter,
    requireFirebaseAuth,
    (req: AuthedRequest, res) => {
      try {
        const uid = req.authUser!.uid;
        const email = req.authUser!.email;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        upsertAccountDirectoryEntry({
          uid,
          email,
          fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
          provider: getAuthUserByUid(uid) ? 'password' : 'firebase',
          accountRole:
            body.accountRole === 'recruiter' || body.accountRole === 'candidate'
              ? body.accountRole
              : undefined,
          lang: typeof body.lang === 'string' ? body.lang : undefined,
          discoverable: typeof body.discoverable === 'boolean' ? body.discoverable : undefined,
          gdprConsent: typeof body.gdprConsent === 'boolean' ? body.gdprConsent : undefined,
          companyName: typeof body.companyName === 'string' ? body.companyName : undefined,
          companyWebsite: typeof body.companyWebsite === 'string' ? body.companyWebsite : undefined,
          profile: body.profile && typeof body.profile === 'object' ? body.profile : undefined,
          cvsCount: Array.isArray(body.cvs)
            ? body.cvs.length
            : typeof body.cvsCount === 'number'
              ? body.cvsCount
              : undefined,
          trackedAppsCount: Array.isArray(body.applications)
            ? body.applications.length
            : typeof body.trackedAppsCount === 'number'
              ? body.trackedAppsCount
              : undefined,
        });
        // Also mirror workspace CVs/applications if provided so Admin "Voir infos" shows full dossier even when signed in via Email/Password
        if (body.profile !== undefined || Array.isArray(body.cvs) || Array.isArray(body.applications)) {
          upsertUserWorkspaceData(uid, {
            profile: body.profile !== undefined ? body.profile : undefined,
            cvs: Array.isArray(body.cvs) ? body.cvs : undefined,
            applications: Array.isArray(body.applications) ? body.applications : undefined,
            accountRole:
              body.accountRole === 'recruiter' || body.accountRole === 'candidate'
                ? body.accountRole
                : undefined,
            lang: typeof body.lang === 'string' ? body.lang : undefined,
            discoverable: typeof body.discoverable === 'boolean' ? body.discoverable : undefined,
            gdprConsent: typeof body.gdprConsent === 'boolean' ? body.gdprConsent : undefined,
            companyName: typeof body.companyName === 'string' ? body.companyName : undefined,
            companyWebsite: typeof body.companyWebsite === 'string' ? body.companyWebsite : undefined,
          });
        }
        res.json({ synced: true });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erreur lors de la synchronisation du profil.',
        });
      }
    }
  );

  // 9. GET /api/account/workspace — Load server-persisted profile, CVs, CRM & watchlist (verified users only)
  router.get('/account/workspace', workspaceLimiter, requireFirebaseAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.uid;
    const workspace = getUserWorkspaceData(uid);
    res.json({ workspace });
  });

  // 10. PUT /api/account/workspace — Persist profile, CVs, CRM & watchlist in SQLite (strictly scoped to req.authUser.uid)
  router.put('/account/workspace', workspaceLimiter, requireFirebaseAuth, (req: AuthedRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const workspace = upsertUserWorkspaceData(uid, {
        profile: body.profile !== undefined ? body.profile : undefined,
        cvs: Array.isArray(body.cvs) ? body.cvs : undefined,
        applications: Array.isArray(body.applications) ? body.applications : undefined,
        watchlist: Array.isArray(body.watchlist) ? body.watchlist : undefined,
        accountRole:
          body.accountRole === 'recruiter' || body.accountRole === 'candidate'
            ? body.accountRole
            : undefined,
        lang: typeof body.lang === 'string' ? body.lang : undefined,
        discoverable: typeof body.discoverable === 'boolean' ? body.discoverable : undefined,
        gdprConsent: typeof body.gdprConsent === 'boolean' ? body.gdprConsent : undefined,
        companyName: typeof body.companyName === 'string' ? body.companyName : undefined,
        companyWebsite: typeof body.companyWebsite === 'string' ? body.companyWebsite : undefined,
      });
      res.json({ workspace });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du profil.',
      });
    }
  });

  // 11. DELETE /api/account/workspace — GDPR full erasure of server workspace & password account
  router.delete('/account/workspace', workspaceLimiter, requireFirebaseAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.uid;
    deleteUserWorkspaceData(uid);
    if (req.query?.deleteAccount === 'true' && getAuthUserByUid(uid)) {
      deleteAuthUserByUid(uid);
      clearSessionCookie(req, res);
    }
    res.json({ deleted: true });
  });

  // =========================================================================
  // ADMIN ONLY: USER DIRECTORY, DOSSIERS, ADMIN ROLE PROMOTION & MODERATION
  // =========================================================================
  const adminLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    maxAuthenticated: 200,
    maxGuest: 10,
    bucketPrefix: 'admin_users',
  });

  // 12. GET /api/admin/users — List all platform users + admin role grants
  router.get('/admin/users', adminLimiter, requireAdminAuth, (req: AuthedRequest, res) => {
    try {
      const search = clampStr(req.query?.search, 120);
      const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 200));
      const users = listAllPlatformUsersForAdmin(search, limit);
      const admins = listAdminRoleRecords();
      res.json({ users, admins });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Impossible de charger les utilisateurs.',
      });
    }
  });

  // 13. GET /api/admin/users/:uid — Full user dossier (profile, CVs, CRM, submissions, notifications)
  router.get('/admin/users/:uid', adminLimiter, requireAdminAuth, (req: AuthedRequest, res) => {
    try {
      const targetUid = clampStr(req.params.uid, 128);
      if (!targetUid) {
        res.status(400).json({ error: 'Identifiant utilisateur requis.' });
        return;
      }
      const dossier = getPlatformUserDossierForAdmin(targetUid);
      if (!dossier) {
        res.status(404).json({ error: 'Dossier utilisateur introuvable.' });
        return;
      }
      res.json({ dossier });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Impossible de charger le dossier utilisateur.',
      });
    }
  });

  // 14. POST /api/admin/users/:uid/moderate — Approve / Reject / Suspend / Verify / Role / Admin (covers BOTH Password AND Google accounts)
  router.post(
    '/admin/users/:uid/moderate',
    adminLimiter,
    requireAdminAuth,
    (req: AuthedRequest, res) => {
      try {
        const targetUid = clampStr(req.params.uid, 128);
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const bodyEmail = clampStr(body.email, 200).toLowerCase();

        const existingAuth =
          getAuthUserByUid(targetUid) || (bodyEmail ? getAuthUserByEmail(bodyEmail) : null);

        const actorEmail = req.authUser!.email.toLowerCase();
        const targetEmail = (existingAuth?.email || bodyEmail).toLowerCase();

        const moderationStatus =
          body.moderationStatus === 'approved' ||
          body.moderationStatus === 'pending' ||
          body.moderationStatus === 'rejected' ||
          body.moderationStatus === 'suspended'
            ? (body.moderationStatus as UserModerationStatus)
            : undefined;
        const moderationNote =
          typeof body.moderationNote === 'string' ? clampStr(body.moderationNote, 400) : undefined;
        const emailVerified =
          typeof body.emailVerified === 'boolean' ? body.emailVerified : undefined;
        const accountRole =
          body.accountRole === 'candidate' || body.accountRole === 'recruiter'
            ? body.accountRole
            : undefined;
        const isAdminFlag = typeof body.isAdmin === 'boolean' ? body.isAdmin : undefined;

        if (targetEmail === BOOTSTRAP_ADMIN_EMAIL) {
          if (moderationStatus === 'rejected' || moderationStatus === 'suspended') {
            res.status(400).json({
              error: 'Impossible de refuser ou suspendre le compte propriétaire principal.',
            });
            return;
          }
          if (isAdminFlag === false) {
            res.status(400).json({
              error: 'Impossible de retirer les droits administrateur du compte propriétaire principal.',
            });
            return;
          }
        }

        if (targetEmail && targetEmail === actorEmail) {
          if (moderationStatus === 'rejected' || moderationStatus === 'suspended') {
            res.status(400).json({ error: 'Vous ne pouvez pas suspendre votre propre compte.' });
            return;
          }
          if (isAdminFlag === false) {
            res.status(400).json({
              error: 'Vous ne pouvez pas retirer vos propres droits administrateur.',
            });
            return;
          }
        }

        if (existingAuth) {
          const updated = moderateAuthUserAdmin(existingAuth.uid, {
            moderationStatus,
            moderationNote,
            emailVerified,
            accountRole,
            isAdmin: isAdminFlag,
            moderatedBy: actorEmail,
          });
          if (!updated) {
            res.status(500).json({ error: 'Échec de la mise à jour du compte.' });
            return;
          }
          // Mirror moderation status into account_directory too if email matches a dual account
          moderateAccountDirectoryAdmin({
            uid: updated.uid,
            email: updated.email,
            moderationStatus: updated.moderationStatus,
            moderationNote: updated.moderationNote,
            accountRole: updated.accountRole,
            isAdmin: isAdminFlag,
            moderatedBy: actorEmail,
          });

          writeAuditLog({
            actorUid: req.authUser!.uid,
            actorEmail,
            actorRole: 'admin',
            action: 'admin_moderate_user',
            targetType: 'auth_user',
            targetId: updated.uid,
            details: {
              targetEmail: updated.email,
              moderationStatus: updated.moderationStatus,
              emailVerified: updated.emailVerified,
              accountRole: updated.accountRole,
              isAdmin: updated.isAdmin,
              note: updated.moderationNote,
            },
            ipAddress: extractClientIp(req),
          });

          res.json({ user: toPublicUser(updated) });
          return;
        }

        // Google / Firebase account moderation in SQLite account_directory (enforced immediately on server APIs!)
        const updatedDir = moderateAccountDirectoryAdmin({
          uid: targetUid,
          email: targetEmail,
          moderationStatus,
          moderationNote,
          accountRole,
          isAdmin: isAdminFlag,
          moderatedBy: actorEmail,
        });

        if (!updatedDir) {
          res.status(404).json({ error: 'Compte utilisateur introuvable.' });
          return;
        }

        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail,
          actorRole: 'admin',
          action: 'admin_moderate_google_user',
          targetType: 'account_directory',
          targetId: updatedDir.uid || updatedDir.email,
          details: {
            targetEmail: updatedDir.email,
            moderationStatus: updatedDir.moderationStatus,
            accountRole: updatedDir.accountRole,
            isAdmin: updatedDir.isAdmin,
            note: updatedDir.moderationNote,
          },
          ipAddress: extractClientIp(req),
        });

        res.json({
          user: {
            uid: updatedDir.uid,
            email: updatedDir.email,
            fullName: updatedDir.fullName,
            emailVerified: true,
            accountRole: updatedDir.accountRole,
            isAdmin: updatedDir.isAdmin,
            moderationStatus: updatedDir.moderationStatus,
            provider: 'firebase',
          },
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erreur lors de la modération du compte.',
        });
      }
    }
  );

  // 15. POST /api/admin/admins/grant — Promote any email address (Password or Google) to Admin
  router.post('/admin/admins/grant', adminLimiter, requireAdminAuth, (req: AuthedRequest, res) => {
    try {
      const email = clampStr(req.body?.email, 200).toLowerCase();
      const note = clampStr(req.body?.note, 300);
      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
        return;
      }

      const actorEmail = req.authUser!.email.toLowerCase();
      const grant = grantAdminRoleByEmail(email, actorEmail, note || 'Nommé administrateur');

      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail,
        actorRole: 'admin',
        action: 'admin_grant_role',
        targetType: 'admin_role',
        targetId: email,
        details: { email, note: grant.note },
        ipAddress: extractClientIp(req),
      });

      res.status(201).json({
        grant,
        admins: listAdminRoleRecords(),
        message: `${email} dispose désormais des droits administrateur.`,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossible d’accorder le rôle administrateur.',
      });
    }
  });

  // 16. POST /api/admin/admins/revoke — Revoke Admin privileges from a non-owner email
  router.post('/admin/admins/revoke', adminLimiter, requireAdminAuth, (req: AuthedRequest, res) => {
    try {
      const email = clampStr(req.body?.email, 200).toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Adresse e-mail invalide.' });
        return;
      }
      const actorEmail = req.authUser!.email.toLowerCase();
      if (email === actorEmail) {
        res.status(400).json({
          error: 'Vous ne pouvez pas révoquer vos propres droits administrateur.',
        });
        return;
      }

      const result = revokeAdminRoleByEmail(email);
      if (!result.ok) {
        res.status(400).json({ error: result.reason || 'Révocation refusée.' });
        return;
      }

      writeAuditLog({
        actorUid: req.authUser!.uid,
        actorEmail,
        actorRole: 'admin',
        action: 'admin_revoke_role',
        targetType: 'admin_role',
        targetId: email,
        details: { email },
        ipAddress: extractClientIp(req),
      });

      res.json({
        revoked: true,
        admins: listAdminRoleRecords(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la révocation.',
      });
    }
  });

  // 17. GET /api/admin/applications — List all platform application submissions for admin review
  router.get('/admin/applications', adminLimiter, requireAdminAuth, (req: AuthedRequest, res) => {
    try {
      const limit = Math.min(300, Math.max(1, Number(req.query?.limit) || 120));
      const submissions = listAllSubmissionsForAdmin(limit);
      res.json({ submissions });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Impossible de charger les candidatures.',
      });
    }
  });

  // 18. POST /api/admin/applications/:submissionId/moderate — Approve or Reject a submission
  router.post(
    '/admin/applications/:submissionId/moderate',
    adminLimiter,
    requireAdminAuth,
    (req: AuthedRequest, res) => {
      try {
        const submissionId = clampStr(req.params.submissionId, 128);
        const rawStatus = String(req.body?.status || '').trim();
        if (rawStatus !== 'approved' && rawStatus !== 'rejected' && rawStatus !== 'pending') {
          res.status(400).json({
            error: 'Statut de modération invalide (attendu : approved, rejected ou pending).',
          });
          return;
        }
        const note = clampStr(req.body?.note, 400);
        const actorEmail = req.authUser!.email.toLowerCase();

        const updated = moderateSubmissionAdmin(submissionId, {
          status: rawStatus,
          note,
          moderatedBy: actorEmail,
        });
        if (!updated) {
          res.status(404).json({ error: 'Candidature introuvable.' });
          return;
        }

        writeAuditLog({
          actorUid: req.authUser!.uid,
          actorEmail,
          actorRole: 'admin',
          action: 'admin_moderate_submission',
          targetType: 'application_submission',
          targetId: submissionId,
          details: { status: rawStatus, note },
          ipAddress: extractClientIp(req),
        });

        res.json({ submission: updated });
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error ? err.message : 'Erreur lors de la modération de la candidature.',
        });
      }
    }
  );

  return router;
}
