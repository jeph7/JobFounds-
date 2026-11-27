import dns from 'node:dns/promises';
import {
  type ApplicationDeliveryStatus,
  type ApplicationSubmissionChannel,
  type ApplicationSubmissionRecord,
  type NeedClassification,
  createApplicationSubmission,
  createNotification,
  isSourceEnabled,
  recordSourceCall,
} from './serverEngineDb.ts';
import { verifyCorporateDomainMx } from './serverWorkerEngine.ts';
import { clampStr, isSafePublicHttpUrl, sanitizeHttpUrl } from './serverSecurity.ts';

function isPlausibleFromEmail(value: string): boolean {
  if (!value) return false;
  const angleMatch = value.match(/<([^>]+)>/);
  const clean = (angleMatch ? angleMatch[1] : value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

export function getResendFromEmail(): string {
  const primary = process.env.RESEND_FROM_EMAIL?.trim() || '';
  if (isPlausibleFromEmail(primary)) return primary;
  const fallback = process.env.NOTIFICATION_FROM_EMAIL?.trim() || '';
  if (isPlausibleFromEmail(fallback)) return fallback;
  return '';
}

export interface ResendDomainDiagnostics {
  apiKeyConfigured: boolean;
  fromEmailConfigured: boolean;
  fromEmail: string;
  senderDomain: string;
  ready: boolean;
  dnsSpfDetected: boolean;
  dnsDmarcDetected: boolean;
  resendDomainStatus: 'verified' | 'pending' | 'not_found' | 'unconfigured' | 'check_failed';
  notes: string[];
}

export async function verifyResendDomainStatus(): Promise<ResendDomainDiagnostics> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || '';
  const fromEmail = getResendFromEmail();
  const angleMatch = fromEmail.match(/<([^>]+)>/);
  const cleanAddr = (angleMatch ? angleMatch[1] : fromEmail).trim().toLowerCase();
  const senderDomain = cleanAddr.includes('@') ? cleanAddr.split('@')[1] : '';
  const notes: string[] = [];

  if (!apiKey) notes.push('Variable RESEND_API_KEY absente de l’environnement serveur.');
  if (!fromEmail) {
    notes.push('Variable RESEND_FROM_EMAIL (ou NOTIFICATION_FROM_EMAIL) absente.');
  }

  let dnsSpfDetected = false;
  let dnsDmarcDetected = false;
  if (senderDomain) {
    try {
      const txt = await dns.resolveTxt(senderDomain);
      dnsSpfDetected = txt.some((parts) => parts.join('').toLowerCase().includes('v=spf1'));
    } catch {
      dnsSpfDetected = false;
    }
    try {
      const dmarcTxt = await dns.resolveTxt(`_dmarc.${senderDomain}`);
      dnsDmarcDetected = dmarcTxt.some((parts) => parts.join('').toLowerCase().includes('v=dmarc1'));
    } catch {
      dnsDmarcDetected = false;
    }
    if (!dnsSpfDetected) notes.push(`Aucun enregistrement DNS SPF détecté sur ${senderDomain}.`);
    if (!dnsDmarcDetected) notes.push(`Aucun enregistrement DNS DMARC détecté sur _dmarc.${senderDomain}.`);
  }

  let resendDomainStatus: ResendDomainDiagnostics['resendDomainStatus'] = 'unconfigured';
  if (apiKey && senderDomain) {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ name?: string; status?: string }> };
        const matched = (body.data || []).find(
          (d) => String(d.name || '').toLowerCase() === senderDomain
        );
        if (!matched) {
          resendDomainStatus = 'not_found';
          notes.push(`Le domaine ${senderDomain} n’est pas encore ajouté dans votre compte Resend.`);
        } else if (String(matched.status || '').toLowerCase() === 'verified') {
          resendDomainStatus = 'verified';
        } else {
          resendDomainStatus = 'pending';
          notes.push(`Statut du domaine ${senderDomain} sur Resend : ${matched.status || 'en attente'}.`);
        }
      } else {
        resendDomainStatus = 'check_failed';
        notes.push(`Impossible de vérifier les domaines Resend (HTTP ${res.status}).`);
      }
    } catch (err) {
      resendDomainStatus = 'check_failed';
      notes.push(`Erreur réseau lors du contrôle Resend : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    apiKeyConfigured: Boolean(apiKey),
    fromEmailConfigured: Boolean(fromEmail),
    fromEmail,
    senderDomain,
    ready: Boolean(apiKey && fromEmail),
    dnsSpfDetected,
    dnsDmarcDetected,
    resendDomainStatus,
    notes,
  };
}

export interface LiveJobAvailabilityResult {
  url: string;
  finalUrl: string;
  available: boolean;
  status: 'available' | 'expired' | 'unreachable' | 'unverifiable';
  httpStatus: number | null;
  applicationDeadline: string;
  warnings: string[];
  checkedAt: string;
}

export interface ApplicationAttachmentPayload {
  filename: string;
  contentType: string;
  base64Content: string;
}

export interface SubmitRealApplicationInput {
  userId: string;
  recruiterId?: string;
  candidateName: string;
  candidateEmail: string;
  applicationId?: string;
  companyId?: string;
  companyName: string;
  roleTitle: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  classification?: NeedClassification | '';
  channel: ApplicationSubmissionChannel;
  recipientEmail?: string;
  recipientName?: string;
  officialUrl?: string;
  subject: string;
  coverLetter: string;
  cvVersionName?: string;
  attachments?: ApplicationAttachmentPayload[];
  explicitAuthorization: boolean;
}

export interface SubmitRealApplicationResult {
  submission: ApplicationSubmissionRecord;
  transmitted: boolean;
  deliveryStatus: ApplicationDeliveryStatus;
  message: string;
  nextStepUrl?: string;
  mxVerified?: boolean;
  availabilityCheck?: LiveJobAvailabilityResult | null;
}

const CLOSED_JOB_PATTERNS: RegExp[] = [
  /no longer accepting applications/i,
  /this (job|position|role|posting) (has been|is) (closed|filled|expired|removed)/i,
  /position (has been )?filled/i,
  /job (not found|has expired|is no longer available)/i,
  /offre (expirée|pourvue|clôturée|n'est plus disponible)/i,
  /poste (pourvu|clôturé|n'est plus disponible)/i,
  /cette annonce n'est plus (en ligne|disponible)/i,
  /la oferta ha expirado/i,
  /stelle ist nicht mehr verfügbar/i,
];

const FRAUD_RED_FLAG_PATTERNS: Array<{ regex: RegExp; warning: string }> = [
  {
    regex: /(pay|send|wire|transfer).{0,35}(registration fee|application fee|training fee|deposit|crypto|bitcoin|western union|moneygram)/i,
    warning: 'Alerte sécurité : mention potentielle de frais demandés au candidat.',
  },
  {
    regex: /(frais d'inscription|frais de dossier|paiement requis|envoyer de l'argent).{0,40}(candidat|recrutement|poste)/i,
    warning: 'Alerte sécurité : mention potentielle de frais demandés au candidat.',
  },
  {
    regex: /(interview|apply|contact).{0,25}(only on telegram|via whatsapp only|telegram only)/i,
    warning: 'Alerte sécurité : canal de recrutement inhabituel (messagerie uniquement).',
  },
];

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/html',
]);

const MAX_ATTACHMENTS = 3;
const MAX_SINGLE_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB decoded per file
const MAX_TOTAL_ATTACHMENTS_BYTES = 9 * 1024 * 1024; // 9 MB total

function sanitizeFilename(raw: string, fallback = 'document.pdf'): string {
  const cleaned = String(raw || '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120);
  return cleaned.length >= 3 ? cleaned : fallback;
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function detectScamRedFlags(text: string): string[] {
  const content = String(text || '');
  if (!content) return [];
  const warnings: string[] = [];
  for (const rule of FRAUD_RED_FLAG_PATTERNS) {
    if (rule.regex.test(content)) {
      warnings.push(rule.warning);
    }
  }
  return warnings;
}

function extractValidThroughFromHtml(html: string): string {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];
      for (const item of list) {
        if (
          item &&
          (item['@type'] === 'JobPosting' ||
            (Array.isArray(item['@type']) && item['@type'].includes('JobPosting')))
        ) {
          if (typeof item.validThrough === 'string' && item.validThrough.trim()) {
            return item.validThrough.trim().slice(0, 30);
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return '';
}

/**
 * Performs a real, SSRF-safe live HTTP availability check on a job posting URL.
 * Checks HTTP status, Schema.org validThrough deadline, closed-posting text markers, and fraud indicators.
 */
export async function checkLiveJobAvailability(rawUrl: string): Promise<LiveJobAvailabilityResult> {
  const checkedAt = new Date().toISOString();
  const cleanUrl = sanitizeHttpUrl(rawUrl);
  if (!cleanUrl || !isSafePublicHttpUrl(cleanUrl)) {
    return {
      url: rawUrl || '',
      finalUrl: '',
      available: false,
      status: 'unreachable',
      httpStatus: null,
      applicationDeadline: '',
      warnings: ['URL invalide ou non publique (bloquée par la politique de sécurité).'],
      checkedAt,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'JOBFOUNDS-AvailabilityVerifier/1.0 (+https://jobfounds.com)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.5',
      },
    });

    const finalUrl = sanitizeHttpUrl(res.url) || cleanUrl;
    if (!isSafePublicHttpUrl(finalUrl)) {
      return {
        url: cleanUrl,
        finalUrl: '',
        available: false,
        status: 'unreachable',
        httpStatus: res.status,
        applicationDeadline: '',
        warnings: ['Redirection vers une adresse réseau non publique bloquée.'],
        checkedAt,
      };
    }

    if (res.status === 404 || res.status === 410) {
      return {
        url: cleanUrl,
        finalUrl,
        available: false,
        status: 'expired',
        httpStatus: res.status,
        applicationDeadline: '',
        warnings: [`La page officielle répond HTTP ${res.status} : l’offre semble retirée ou expirée.`],
        checkedAt,
      };
    }

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        url: cleanUrl,
        finalUrl,
        available: true,
        status: 'unverifiable',
        httpStatus: res.status,
        applicationDeadline: '',
        warnings: [
          `Le portail employeur protège l’accès automatisé (HTTP ${res.status}). Ouvrez le lien officiel pour confirmer la disponibilité en direct.`,
        ],
        checkedAt,
      };
    }

    if (!res.ok) {
      return {
        url: cleanUrl,
        finalUrl,
        available: false,
        status: 'unreachable',
        httpStatus: res.status,
        applicationDeadline: '',
        warnings: [`Réponse serveur inattendue (HTTP ${res.status}).`],
        checkedAt,
      };
    }

    const html = (await res.text()).slice(0, 260_000);
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    const deadline = extractValidThroughFromHtml(html);
    const warnings = detectScamRedFlags(plain);

    // Check explicit deadline expiration
    if (deadline) {
      const parsedDeadline = Date.parse(deadline);
      if (!Number.isNaN(parsedDeadline) && parsedDeadline < Date.now() - 86_400_000) {
        warnings.push(`Date limite dépassée (${deadline.slice(0, 10)}).`);
        return {
          url: cleanUrl,
          finalUrl,
          available: false,
          status: 'expired',
          httpStatus: res.status,
          applicationDeadline: deadline.slice(0, 10),
          warnings,
          checkedAt,
        };
      }
    }

    // Check explicit closed-job indicators in page body
    const isClosed = CLOSED_JOB_PATTERNS.some((rx) => rx.test(plain));
    if (isClosed) {
      warnings.push('Le texte de la page indique que le poste est clôturé ou n’accepte plus de candidatures.');
      return {
        url: cleanUrl,
        finalUrl,
        available: false,
        status: 'expired',
        httpStatus: res.status,
        applicationDeadline: deadline ? deadline.slice(0, 10) : '',
        warnings,
        checkedAt,
      };
    }

    return {
      url: cleanUrl,
      finalUrl,
      available: true,
      status: 'available',
      httpStatus: res.status,
      applicationDeadline: deadline ? deadline.slice(0, 10) : '',
      warnings,
      checkedAt,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      url: cleanUrl,
      finalUrl: cleanUrl,
      available: false,
      status: 'unreachable',
      httpStatus: null,
      applicationDeadline: '',
      warnings: [
        isAbort
          ? 'Délai dépassé lors de la vérification du portail officiel.'
          : 'Impossible de joindre le portail employeur depuis le serveur.',
      ],
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateAndSanitizeAttachments(rawAttachments?: ApplicationAttachmentPayload[]): {
  resendAttachments: Array<{ filename: string; content: string; content_type: string }>;
  metadata: Array<{ filename: string; contentType: string; sizeBytes: number }>;
} {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { resendAttachments: [], metadata: [] };
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_ATTACHMENTS} pièces jointes autorisées par candidature.`);
  }

  const resendAttachments: Array<{ filename: string; content: string; content_type: string }> = [];
  const metadata: Array<{ filename: string; contentType: string; sizeBytes: number }> = [];
  let totalBytes = 0;

  for (const att of rawAttachments) {
    const contentType = String(att.contentType || 'application/octet-stream').trim().toLowerCase();
    if (!ALLOWED_ATTACHMENT_MIMES.has(contentType)) {
      throw new Error(
        `Format de pièce jointe non autorisé (${contentType}). Formats acceptés : PDF, DOCX, DOC, TXT.`
      );
    }
    const cleanBase64 = String(att.base64Content || '')
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');
    if (!cleanBase64 || !/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
      throw new Error(`Contenu base64 invalide pour la pièce jointe "${att.filename || 'document'}".`);
    }
    const decoded = Buffer.from(cleanBase64, 'base64');
    if (decoded.length === 0) {
      throw new Error(`La pièce jointe "${att.filename || 'document'}" est vide.`);
    }
    if (decoded.length > MAX_SINGLE_ATTACHMENT_BYTES) {
      throw new Error(
        `La pièce jointe "${att.filename}" dépasse la limite de 4 Mo.`
      );
    }
    totalBytes += decoded.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENTS_BYTES) {
      throw new Error('La taille totale des pièces jointes dépasse 9 Mo.');
    }

    const safeName = sanitizeFilename(att.filename);
    resendAttachments.push({
      filename: safeName,
      content: cleanBase64,
      content_type: contentType,
    });
    metadata.push({
      filename: safeName,
      contentType,
      sizeBytes: decoded.length,
    });
  }

  return { resendAttachments, metadata };
}

function buildApplicationEmailHtml(params: {
  candidateName: string;
  candidateEmail: string;
  companyName: string;
  roleTitle: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  coverLetter: string;
  attachmentsCount: number;
}): string {
  const safeBody = escapeHtml(params.coverLetter).replace(/\n/g, '<br />');
  const headerBadge =
    params.opportunityType === 'hidden_opportunity'
      ? 'Candidature spontanée ciblée'
      : 'Candidature professionnelle';
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background-color:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="background:#06132F;padding:18px 24px;color:#FFFFFF;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#93C5FD;">${headerBadge}</div>
          <div style="font-size:17px;font-weight:700;margin-top:4px;">${escapeHtml(params.roleTitle)} — ${escapeHtml(params.companyName)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;font-size:14px;line-height:1.65;color:#1E293B;">
          ${safeBody}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#475569;">
          <div><strong>Candidat :</strong> ${escapeHtml(params.candidateName)} (${escapeHtml(params.candidateEmail)})</div>
          ${params.attachmentsCount > 0 ? `<div style="margin-top:4px;"><strong>Pièces jointes :</strong> ${params.attachmentsCount} document(s) joint(s) à cet e-mail.</div>` : ''}
          <div style="margin-top:8px;font-size:11px;color:#64748B;">Transmis avec l’autorisation explicite du candidat via JOBFOUNDS. Pour répondre directement au candidat, utilisez la fonction « Répondre » (Reply-To configuré sur ${escapeHtml(params.candidateEmail)}).</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Executes a real, honest application submission across 3 supported channels:
 * 1. `resend_email`: Real Resend API transmission with DNS MX domain check & base64 attachments.
 *    ONLY marks transmitted=true when Resend returns HTTP 2xx + messageId.
 * 2. `official_portal`: Verifies live URL availability, records an `awaiting_portal_confirmation` handoff
 *    (NEVER marks as "Application Sent" until the candidate explicitly confirms submission on the employer form).
 * 3. `jobfounds_direct`: Direct employer portal submission for jobs published on JOBFOUNDS.
 */
export async function submitRealApplication(
  input: SubmitRealApplicationInput
): Promise<SubmitRealApplicationResult> {
  if (!input.explicitAuthorization) {
    throw new Error(
      'Votre autorisation explicite est obligatoire avant toute transmission de candidature.'
    );
  }

  const authorizationTimestamp = new Date().toISOString();
  const { resendAttachments, metadata } = validateAndSanitizeAttachments(input.attachments);
  const companyName = clampStr(input.companyName, 160);
  const roleTitle = clampStr(input.roleTitle, 180);
  const subject =
    clampStr(input.subject, 240) || `Candidature — ${roleTitle} (${input.candidateName})`;
  const coverLetter = clampStr(input.coverLetter, 10_000);
  if (!companyName || !roleTitle) {
    throw new Error('Le nom de l’entreprise et l’intitulé du poste sont requis.');
  }

  // CHANNEL 1: Direct verified corporate email via Resend
  if (input.channel === 'resend_email') {
    const recipientEmail = String(input.recipientEmail || '').trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(recipientEmail)) {
      throw new Error('Une adresse e-mail professionnelle valide du recruteur est requise.');
    }

    const domain = recipientEmail.split('@')[1] || '';
    const mx = await verifyCorporateDomainMx(domain);
    if (!mx.verified) {
      const failedSub = createApplicationSubmission({
        userId: input.userId,
        applicationId: input.applicationId,
        companyId: input.companyId,
        companyName,
        roleTitle,
        opportunityType: input.opportunityType,
        classification: input.classification,
        channel: 'resend_email',
        recipientEmail,
        recipientName: input.recipientName,
        officialUrl: input.officialUrl,
        subject,
        coverLetterPreview: coverLetter.slice(0, 1000),
        cvVersionName: input.cvVersionName,
        attachments: metadata,
        explicitAuthorization: true,
        authorizationTimestamp,
        transmitted: false,
        deliveryStatus: 'failed',
        errorMessage: `Le domaine ${domain} ne possède aucun enregistrement DNS MX valide.`,
      });
      return {
        submission: failedSub,
        transmitted: false,
        deliveryStatus: 'failed',
        mxVerified: false,
        message: `Envoi annulé : le domaine e-mail « ${domain} » n’a pas pu être vérifié via DNS MX. Aucune candidature n’a été envoyée.`,
      };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromEmail = getResendFromEmail();
    if (!apiKey || !fromEmail) {
      const failedSub = createApplicationSubmission({
        userId: input.userId,
        applicationId: input.applicationId,
        companyId: input.companyId,
        companyName,
        roleTitle,
        opportunityType: input.opportunityType,
        classification: input.classification,
        channel: 'resend_email',
        recipientEmail,
        recipientName: input.recipientName,
        officialUrl: input.officialUrl,
        subject,
        coverLetterPreview: coverLetter.slice(0, 1000),
        cvVersionName: input.cvVersionName,
        attachments: metadata,
        explicitAuthorization: true,
        authorizationTimestamp,
        transmitted: false,
        deliveryStatus: 'failed',
        errorMessage: 'Relais e-mail transactionnel (Resend) non configuré sur le serveur.',
      });
      return {
        submission: failedSub,
        transmitted: false,
        deliveryStatus: 'failed',
        mxVerified: true,
        message:
          'Le relais e-mail serveur (Resend) n’est pas configuré. Aucune candidature n’a été envoyée ; utilisez le portail officiel de l’employeur.',
      };
    }

    if (!isSourceEnabled('resend_email')) {
      throw new Error('Le service d’envoi e-mail est momentanément suspendu par l’administrateur.');
    }

    try {
      const payload: Record<string, any> = {
        from: fromEmail,
        to: [recipientEmail],
        reply_to: input.candidateEmail || undefined,
        subject,
        text: `${coverLetter}\n\n---\n${input.candidateName}\n${input.candidateEmail}`,
        html: buildApplicationEmailHtml({
          candidateName: input.candidateName,
          candidateEmail: input.candidateEmail,
          companyName,
          roleTitle,
          opportunityType: input.opportunityType,
          coverLetter,
          attachmentsCount: resendAttachments.length,
        }),
      };
      if (resendAttachments.length > 0) {
        payload.attachments = resendAttachments;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 260);
        recordSourceCall('resend_email', false, `HTTP ${res.status}: ${errText}`);
        const failedSub = createApplicationSubmission({
          userId: input.userId,
          applicationId: input.applicationId,
          companyId: input.companyId,
          companyName,
          roleTitle,
          opportunityType: input.opportunityType,
          classification: input.classification,
          channel: 'resend_email',
          recipientEmail,
          recipientName: input.recipientName,
          officialUrl: input.officialUrl,
          subject,
          coverLetterPreview: coverLetter.slice(0, 1000),
          cvVersionName: input.cvVersionName,
          attachments: metadata,
          explicitAuthorization: true,
          authorizationTimestamp,
          transmitted: false,
          deliveryStatus: 'failed',
          errorMessage: `Resend HTTP ${res.status}: ${errText}`,
        });
        return {
          submission: failedSub,
          transmitted: false,
          deliveryStatus: 'failed',
          mxVerified: true,
          message: `Échec de transmission e-mail (HTTP ${res.status}). Aucune candidature n’a été envoyée.`,
        };
      }

      const resBody = (await res.json().catch(() => ({}))) as { id?: string };
      const messageId = clampStr(resBody.id || '', 160);
      recordSourceCall('resend_email', true);

      const sentSub = createApplicationSubmission({
        userId: input.userId,
        applicationId: input.applicationId,
        companyId: input.companyId,
        companyName,
        roleTitle,
        opportunityType: input.opportunityType,
        classification: input.classification,
        channel: 'resend_email',
        recipientEmail,
        recipientName: input.recipientName,
        officialUrl: input.officialUrl,
        subject,
        coverLetterPreview: coverLetter.slice(0, 1000),
        cvVersionName: input.cvVersionName,
        attachments: metadata,
        explicitAuthorization: true,
        authorizationTimestamp,
        transmitted: true,
        deliveryStatus: 'transmitted_email',
        providerMessageId: messageId,
      });

      return {
        submission: sentSub,
        transmitted: true,
        deliveryStatus: 'transmitted_email',
        mxVerified: true,
        message: `Candidature réellement transmise par e-mail à ${recipientEmail}${messageId ? ` (Réf. ${messageId})` : ''}.`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      recordSourceCall('resend_email', false, errMsg);
      const failedSub = createApplicationSubmission({
        userId: input.userId,
        applicationId: input.applicationId,
        companyId: input.companyId,
        companyName,
        roleTitle,
        opportunityType: input.opportunityType,
        classification: input.classification,
        channel: 'resend_email',
        recipientEmail,
        recipientName: input.recipientName,
        officialUrl: input.officialUrl,
        subject,
        coverLetterPreview: coverLetter.slice(0, 1000),
        cvVersionName: input.cvVersionName,
        attachments: metadata,
        explicitAuthorization: true,
        authorizationTimestamp,
        transmitted: false,
        deliveryStatus: 'failed',
        errorMessage: errMsg,
      });
      return {
        submission: failedSub,
        transmitted: false,
        deliveryStatus: 'failed',
        mxVerified: true,
        message: `Erreur réseau lors de l’envoi e-mail : ${errMsg}. Aucune candidature n’a été envoyée.`,
      };
    }
  }

  // CHANNEL 2: Direct JOBFOUNDS Employer Portal (for jobs published directly by employers on JOBFOUNDS)
  if (input.channel === 'jobfounds_direct') {
    const recruiterId = clampStr(input.recruiterId || '', 128);
    const directAttachmentsData = resendAttachments.map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
      base64Content: a.content,
    }));
    const directSub = createApplicationSubmission({
      userId: input.userId,
      recruiterId,
      candidateName: input.candidateName,
      candidateEmail: input.candidateEmail,
      applicationId: input.applicationId,
      companyId: input.companyId,
      companyName,
      roleTitle,
      opportunityType: input.opportunityType,
      classification: input.classification,
      channel: 'jobfounds_direct',
      recipientName: input.recipientName || `Équipe Recrutement · ${companyName}`,
      officialUrl: input.officialUrl,
      subject,
      coverLetterPreview: coverLetter.slice(0, 1000),
      coverLetterFull: coverLetter,
      cvVersionName: input.cvVersionName,
      attachments: metadata,
      attachmentsData: directAttachmentsData,
      explicitAuthorization: true,
      authorizationTimestamp,
      transmitted: true,
      deliveryStatus: 'transmitted_jobfounds_portal',
      providerMessageId: `jf_portal_${Date.now()}`,
    });

    if (recruiterId) {
      createNotification({
        uid: recruiterId,
        type: 'application_update',
        title: `Nouvelle candidature directe : ${roleTitle}`,
        body: `${input.candidateName} (${input.candidateEmail || 'Candidat vérifié'}) a postulé pour ${roleTitle} chez ${companyName}${metadata.length > 0 ? ` avec ${metadata.length} pièce(s) jointe(s).` : '.'}`,
        companyId: input.companyId || '',
        companyName,
        classification: 'confirmed_job',
        channelStatus: { inApp: true, emailSent: false, pushReady: false },
        dedupKey: `direct_app_${directSub.id}`,
      });
    }

    return {
      submission: directSub,
      transmitted: true,
      deliveryStatus: 'transmitted_jobfounds_portal',
      message: `Candidature transmise directement dans l’espace employeur de ${companyName} sur JOBFOUNDS.`,
    };
  }

  // CHANNEL 3: Official Employer Portal / ATS Handoff
  // CRITICAL HONESTY RULE: Never mark transmitted=true here! Record `awaiting_portal_confirmation`
  // until the candidate actually submits on the employer's official form and confirms.
  const officialUrl = sanitizeHttpUrl(input.officialUrl);
  if (!officialUrl || !isSafePublicHttpUrl(officialUrl)) {
    throw new Error(
      'Aucun lien officiel valide vers le portail de candidature de l’employeur n’est disponible.'
    );
  }

  const availabilityCheck = await checkLiveJobAvailability(officialUrl);
  if (availabilityCheck.status === 'expired') {
    const failedSub = createApplicationSubmission({
      userId: input.userId,
      applicationId: input.applicationId,
      companyId: input.companyId,
      companyName,
      roleTitle,
      opportunityType: input.opportunityType,
      classification: input.classification,
      channel: 'official_portal',
      recipientName: input.recipientName,
      officialUrl,
      subject,
      coverLetterPreview: coverLetter.slice(0, 1000),
      cvVersionName: input.cvVersionName,
      attachments: metadata,
      explicitAuthorization: true,
      authorizationTimestamp,
      transmitted: false,
      deliveryStatus: 'failed',
      errorMessage: availabilityCheck.warnings.join(' ') || 'Offre expirée ou retirée.',
    });
    return {
      submission: failedSub,
      transmitted: false,
      deliveryStatus: 'failed',
      availabilityCheck,
      message:
        availabilityCheck.warnings[0] ||
        'Cette offre semble expirée ou retirée du portail officiel.',
    };
  }

  const handoffSub = createApplicationSubmission({
    userId: input.userId,
    applicationId: input.applicationId,
    companyId: input.companyId,
    companyName,
    roleTitle,
    opportunityType: input.opportunityType,
    classification: input.classification,
    channel: 'official_portal',
    recipientName: input.recipientName,
    officialUrl: availabilityCheck.finalUrl || officialUrl,
    subject,
    coverLetterPreview: coverLetter.slice(0, 1000),
    cvVersionName: input.cvVersionName,
    attachments: metadata,
    explicitAuthorization: true,
    authorizationTimestamp,
    transmitted: false,
    deliveryStatus: 'awaiting_portal_confirmation',
  });

  return {
    submission: handoffSub,
    transmitted: false,
    deliveryStatus: 'awaiting_portal_confirmation',
    nextStepUrl: availabilityCheck.finalUrl || officialUrl,
    availabilityCheck,
    message:
      'Dossier prêt. Ouvrez le formulaire officiel de l’employeur pour soumettre votre candidature, puis confirmez l’envoi une fois terminé.',
  };
}
