import crypto from 'crypto';
import express from 'express';
import {
  type AuthUserRecord,
  consumeVerificationCode,
  createAuthUserRecord,
  createEmailVerificationCodeRecord,
  getAuthUserByEmail,
  getAuthUserByUid,
  getLatestActiveVerificationCode,
  getLatestVerificationCodeAny,
  incrementVerificationCodeAttempts,
  markAuthUserEmailVerified,
  recordSourceCall,
} from './serverEngineDb.ts';
import { getResendFromEmail } from './serverApplicationEngine.ts';
import {
  type AuthedRequest,
  type VerifiedAuthUser,
  clampStr,
  createRateLimiter,
  isAdminAuthUser,
} from './serverSecurity.ts';

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
    provider: 'password',
  };
}

function hashSecretScrypt(secret: string, saltHex: string, keyLen = 64): string {
  return crypto.scryptSync(secret, saltHex, keyLen, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function verifySecretScrypt(secret: string, saltHex: string, expectedHashHex: string, keyLen = 64): boolean {
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
 * Issues a server-signed HMAC-SHA256 session token (jf1.<payload>.<signature>).
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

    // Always read authoritative verification state from SQLite
    const dbUser = getAuthUserByUid(payload.sub);
    if (!dbUser) return null;

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
 * Sends the 5-digit account confirmation code via Resend API.
 * Honest reporting: NEVER claims sent=true unless Resend confirms HTTP 2xx.
 */
export async function sendVerificationCodeEmail(params: {
  to: string;
  fullName: string;
  code: string;
}): Promise<VerificationEmailDispatchResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = getResendFromEmail();

  if (!apiKey) {
    return {
      sent: false,
      reason:
        'Le service d’envoi d’e-mail (RESEND_API_KEY) n’est pas configuré sur le serveur. Configurez RESEND_API_KEY pour envoyer le code de confirmation.',
    };
  }
  if (!fromEmail) {
    return {
      sent: false,
      reason:
        'L’adresse expéditeur (RESEND_FROM_EMAIL ou NOTIFICATION_FROM_EMAIL) n’est pas configurée ou est invalide.',
    };
  }

  const safeName = escapeHtml(params.fullName || 'Candidat');
  const safeCode = escapeHtml(params.code);
  const subject = `${params.code} — Votre code de confirmation JOBFOUNDS`;

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background-color:#F4F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#06132F;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9E6F2;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="background:#06132F;padding:20px 28px;color:#FFFFFF;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#A9D8F5;font-weight:700;">JOBFOUNDS</div>
          <div style="font-size:19px;font-weight:700;margin-top:6px;">Confirmez votre adresse e-mail</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;font-size:14px;line-height:1.65;color:#1E293B;">
          <p style="margin:0 0 14px;">Bonjour <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 18px;">Pour valider la création de votre compte JOBFOUNDS et accéder à votre espace personnel, saisissez le code de confirmation à <strong>5 chiffres</strong> ci-dessous :</p>
          <div style="margin:22px 0;padding:18px;background:#F0F7FF;border:1px solid #BFDBFE;border-radius:12px;text-align:center;">
            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:0.32em;color:#06132F;">${safeCode}</span>
          </div>
          <p style="margin:0 0 10px;font-size:13px;color:#475569;">Ce code est valable pendant <strong>15 minutes</strong> et ne peut être utilisé qu’une seule fois.</p>
          <p style="margin:0;font-size:12px;color:#64748B;">Sans la saisie de ce code, votre compte ne sera pas activé. Si vous n’êtes pas à l’origine de cette inscription, vous pouvez ignorer cet e-mail en toute sécurité.</p>
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

  const text = [
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

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
    if (!res.ok) {
      const errDetail = data?.message || data?.error || `HTTP ${res.status}`;
      recordSourceCall('resend_email', false, `Verification code email failed: ${errDetail}`);
      return {
        sent: false,
        reason: `L’envoi de l’e-mail de confirmation via Resend a échoué (${errDetail}). Vérifiez la configuration du domaine expéditeur dans Resend.`,
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
    recordSourceCall('resend_email', false, `Verification email network error: ${msg}`);
    return {
      sent: false,
      reason: `Erreur réseau lors de l’envoi du code de confirmation (${msg}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates, hashes, stores, and emails a 5-digit verification code for a user.
 */
export async function issueAndSendFiveDigitCode(
  user: AuthUserRecord,
  options?: { skipEmailForTest?: boolean }
): Promise<{
  codeForTest?: string;
  expiresAt: string;
  emailSent: boolean;
  emailReason: string;
  messageId?: string;
}> {
  const code = generateFiveDigitCode();
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashSecretScrypt(code, codeSalt, 32);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  createEmailVerificationCodeRecord({
    userId: user.uid,
    email: user.email,
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
 * Verifies a 5-digit confirmation code against the latest active hashed record for the user.
 */
export function verifyFiveDigitCodeForUser(
  user: AuthUserRecord,
  rawCode: string
): {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  remainingAttempts?: number;
  user?: AuthUserRecord;
} {
  if (user.emailVerified) {
    return { ok: true, status: 200, user };
  }

  const cleanCode = String(rawCode || '').trim();
  if (!/^\d{5}$/.test(cleanCode)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_CODE_FORMAT',
      error: 'Veuillez saisir un code de confirmation valide composé exactement de 5 chiffres.',
    };
  }

  const record = getLatestActiveVerificationCode(user.uid);
  if (!record) {
    return {
      ok: false,
      status: 400,
      code: 'NO_ACTIVE_CODE',
      error: 'Aucun code actif trouvé. Cliquez sur « Renvoyer le code » pour recevoir un nouveau code à 5 chiffres.',
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
          : 'Code verrouillé après 5 essais incorrects. Cliquez sur « Renvoyer le code ».',
    };
  }

  // Code matches: consume immediately and mark user verified
  consumeVerificationCode(record.id);
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

  // 1. POST /api/auth/register — Create unverified account + send 5-digit code by email
  router.post('/auth/register', registerLimiter, async (req, res) => {
    try {
      const fullName = clampStr(req.body?.fullName, 120);
      const email = clampStr(req.body?.email, 200).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const accountRole = req.body?.accountRole === 'recruiter' ? 'recruiter' : 'candidate';

      if (!fullName || fullName.length < 2) {
        res.status(400).json({ error: 'Veuillez saisir votre nom complet (au moins 2 caractères).' });
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
        // Account exists but was never verified: require password check or let them re-verify if password matches
        if (!verifyPasswordCredentials(password, existing)) {
          res.status(409).json({
            code: 'EMAIL_PENDING_VERIFICATION',
            error:
              'Un compte non encore vérifié existe avec cette adresse e-mail. Connectez-vous avec votre mot de passe pour saisir ou renvoyer le code à 5 chiffres.',
          });
          return;
        }
        const dispatch = await issueAndSendFiveDigitCode(existing);
        const token = issueAppSessionToken(existing);
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

      const dispatch = await issueAndSendFiveDigitCode(created);
      const token = issueAppSessionToken(created);

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

      const token = issueAppSessionToken(user);

      if (!user.emailVerified) {
        // Check if an active non-expired code exists; if not, send a fresh 5-digit code
        const activeCode = getLatestActiveVerificationCode(user.uid);
        let emailSent = false;
        let emailReason =
          'Votre compte n’est pas encore validé. Saisissez le code à 5 chiffres envoyé à votre adresse e-mail.';
        let expiresAt = activeCode?.expiresAt || '';

        if (!activeCode || Date.parse(activeCode.expiresAt) < Date.now()) {
          const dispatch = await issueAndSendFiveDigitCode(user);
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

      // Identify user strictly via authenticated Bearer token OR matching email
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

      const result = verifyFiveDigitCodeForUser(user, rawCode);
      if (!result.ok || !result.user) {
        res.status(result.status).json({
          code: result.code,
          error: result.error,
          remainingAttempts: result.remainingAttempts,
        });
        return;
      }

      const freshToken = issueAppSessionToken(result.user);
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
        res.status(200).json({
          alreadyVerified: true,
          user: toPublicUser(user),
          token: issueAppSessionToken(user),
          message: 'Ce compte est déjà vérifié.',
        });
        return;
      }

      const latest = getLatestVerificationCodeAny(user.uid);
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

      const dispatch = await issueAndSendFiveDigitCode(user);
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

  // 5. GET /api/auth/me — Inspect current verified or unverified session
  router.get('/auth/me', (req: AuthedRequest, res) => {
    if (!req.authUser?.uid) {
      res.status(401).json({ authenticated: false, code: 'AUTH_REQUIRED' });
      return;
    }
    const dbUser = getAuthUserByUid(req.authUser.uid);
    if (dbUser) {
      res.json({
        authenticated: true,
        user: toPublicUser(dbUser),
      });
      return;
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
        provider: 'firebase',
      },
    });
  });

  return router;
}
