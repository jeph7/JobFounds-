import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  ApplicationAttachmentInput,
  ApplicationSubmissionChannel,
  ApplicationSubmissionRecord,
  CandidateProfile,
  CvDocument,
  HrContactRecord,
  JobAvailabilityCheck,
  Lang,
  NeedClassification,
  TrackedApplication,
} from '../types';
import {
  checkJobAvailability,
  confirmPortalApplicationSubmission,
  fetchIntelligenceContacts,
  findRecruiters,
  generateOutreach,
  optimizeCv,
  submitRealApplication,
} from '../utils/api';

export interface ApplicationModalTarget {
  companyId?: string;
  companyName: string;
  roleTitle: string;
  location: string;
  sector?: string;
  opportunityType: 'published_job' | 'hidden_opportunity';
  classification?: NeedClassification | '';
  officialUrl?: string;
  sourceName?: string;
  publishedDate?: string;
  applicationDeadline?: string;
  salaryRange?: string;
  description?: string;
  inferredSkills?: string[];
  signalReason?: string;
  signalEvidence?: string;
  recommendedContactName?: string;
  recommendedContactRole?: string;
  recommendedContactEmail?: string;
  recommendedContactUrl?: string;
  isEmployerDirect?: boolean;
  recruiterId?: string;
}

interface ApplicationSubmissionModalProps {
  target: ApplicationModalTarget;
  lang: Lang;
  profile: CandidateProfile;
  cvVersions: CvDocument[];
  signedIn: boolean;
  onRequireSignIn?: () => void;
  onSaveTailoredCv?: (tailored: CvDocument) => void;
  onApplicationRecorded: (app: TrackedApplication) => void;
  onSendDirectEmployerMessage?: (params: {
    recruiterId: string;
    companyName: string;
    roleTitle: string;
    messageBody: string;
  }) => Promise<boolean>;
  onClose: () => void;
}

function serializeCvToPlainText(cv: CvDocument): string {
  const lines: string[] = [
    cv.fullName || 'Candidat',
    cv.headline || '',
    [cv.email, cv.phone, cv.location, cv.linkedin].filter(Boolean).join(' | '),
    '',
    'RÉSUMÉ PROFESSIONNEL',
    cv.summary || '',
    '',
    'EXPÉRIENCES',
    ...cv.experiences.flatMap((exp) => [
      `${exp.role} — ${exp.company} (${exp.location}, ${exp.period})`,
      ...exp.highlights.map((h) => `  • ${h}`),
      '',
    ]),
    'FORMATION',
    ...cv.education.map((edu) => `${edu.degree} — ${edu.institution} (${edu.year})`),
    '',
    `COMPÉTENCES : ${cv.skills.join(', ')}`,
    `LANGUES : ${cv.languages.join(', ')}`,
  ];
  return lines.join('\n').trim();
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export const ApplicationSubmissionModal: React.FC<ApplicationSubmissionModalProps> = ({
  target,
  lang,
  profile,
  cvVersions,
  signedIn,
  onRequireSignIn,
  onSaveTailoredCv,
  onApplicationRecorded,
  onSendDirectEmployerMessage,
  onClose,
}) => {
  const isHidden = target.opportunityType === 'hidden_opportunity';
  const [selectedCvId, setSelectedCvId] = useState<string>(cvVersions[0]?.id || '');
  const activeCv = useMemo(
    () => cvVersions.find((c) => c.id === selectedCvId) || cvVersions[0] || null,
    [cvVersions, selectedCvId]
  );

  // Availability check state
  const [availability, setAvailability] = useState<JobAvailabilityCheck | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  // Verified HR contacts state
  const [hrContacts, setHrContacts] = useState<HrContactRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [findingLiveContacts, setFindingLiveContacts] = useState(false);
  const [liveContactNote, setLiveContactNote] = useState('');

  // Channel & Recipient
  const defaultChannel: ApplicationSubmissionChannel =
    target.isEmployerDirect && target.recruiterId
      ? 'jobfounds_direct'
      : target.recommendedContactEmail
        ? 'resend_email'
        : target.officialUrl
          ? 'official_portal'
          : 'resend_email';

  const [channel, setChannel] = useState<ApplicationSubmissionChannel>(defaultChannel);
  const [recipientName, setRecipientName] = useState(target.recommendedContactName || '');
  const [recipientEmail, setRecipientEmail] = useState(target.recommendedContactEmail || '');

  // Tailoring & Cover Letter
  const [tailoringCv, setTailoringCv] = useState(false);
  const [tailoredSummaryNote, setTailoredSummaryNote] = useState('');
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [subject, setSubject] = useState(
    isHidden
      ? `Candidature spontanée — ${target.roleTitle} (${profile.fullName || 'Candidat'})`
      : `Candidature — ${target.roleTitle} (${profile.fullName || 'Candidat'})`
  );
  const [coverLetter, setCoverLetter] = useState('');
  const [linkedinNote, setLinkedinNote] = useState('');
  const [copiedLinkedin, setCopiedLinkedin] = useState(false);
  const [copiedDossier, setCopiedDossier] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState<ApplicationAttachmentInput[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Explicit authorization & submission
  const [explicitAuth, setExplicitAuth] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    submission: ApplicationSubmissionRecord;
    transmitted: boolean;
    message: string;
    nextStepUrl?: string;
  } | null>(null);

  // Portal confirmation step (after candidate completes external employer ATS form)
  const [portalRefInput, setPortalRefInput] = useState('');
  const [confirmingPortal, setConfirmingPortal] = useState(false);

  // Run live availability check on mount for published jobs when signed in
  useEffect(() => {
    if (!signedIn || !target.officialUrl) return;
    let active = true;
    const runCheck = async () => {
      setCheckingAvailability(true);
      try {
        const res = await checkJobAvailability(target.officialUrl!);
        if (active) setAvailability(res.result);
      } catch {
        // user can retry manually
      } finally {
        if (active) setCheckingAvailability(false);
      }
    };
    runCheck();
    return () => {
      active = false;
    };
  }, [signedIn, target.officialUrl]);

  // Load persisted verified HR contacts for this company when companyId exists
  useEffect(() => {
    if (!signedIn || !target.companyId) return;
    let active = true;
    const loadContacts = async () => {
      setLoadingContacts(true);
      try {
        const res = await fetchIntelligenceContacts(target.companyId);
        if (!active) return;
        setHrContacts(res.contacts || []);
        const withEmail = (res.contacts || []).find((c) => c.corporateEmail);
        if (withEmail && !recipientEmail) {
          setRecipientEmail(withEmail.corporateEmail);
          setRecipientName(`${withEmail.fullName} (${withEmail.roleTitle})`);
          if (!target.isEmployerDirect) setChannel('resend_email');
        }
      } catch {
        // non-blocking
      } finally {
        if (active) setLoadingContacts(false);
      }
    };
    loadContacts();
    return () => {
      active = false;
    };
  }, [signedIn, target.companyId]);

  const handleManualAvailabilityCheck = async () => {
    if (!target.officialUrl) return;
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setCheckingAvailability(true);
    try {
      const res = await checkJobAvailability(target.officialUrl);
      setAvailability(res.result);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Vérification impossible.');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleSearchPublicContacts = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setFindingLiveContacts(true);
    setLiveContactNote('');
    try {
      const res = await findRecruiters({
        company: target.companyName,
        department: target.roleTitle,
        country: target.location,
        lang,
      });
      const mapped: HrContactRecord[] = (res.contacts || []).map((c, idx) => {
        const channelEmailMatch = String(c.channel || '').match(
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
        );
        const rawEmail = (c.corporateEmail || channelEmailMatch?.[0] || '').trim().toLowerCase();
        const publicEmail =
          rawEmail && !/@(gmail|yahoo|hotmail|outlook|live|proton)\./i.test(rawEmail)
            ? rawEmail
            : '';
        const mxOk = Boolean(c.domainMxVerified ?? (res.emailDomainStatus === 'Verified'));
        const confidence: HrContactRecord['confidenceLevel'] =
          c.confidenceLevel ||
          (c.publicUrl || (publicEmail && mxOk) ? 'probable' : 'unverified');
        return {
          id: `live_cnt_${idx}_${Date.now()}`,
          companyId: target.companyId || '',
          companyName: target.companyName,
          fullName: c.nameOrTitle,
          roleTitle: c.role,
          department: '',
          location: c.location || target.location,
          contactChannel: c.channel,
          publicUrl: c.publicUrl,
          corporateEmail: publicEmail,
          domainMxVerified: mxOk,
          confidenceLevel: confidence,
          sourceName: 'Public Web Grounding',
          sourceUrl: c.publicUrl,
          verifiedAt: new Date().toISOString(),
          adminStatus: 'pending',
          createdAt: new Date().toISOString(),
        };
      });
      if (mapped.length > 0) {
        setHrContacts((prev) => {
          const existingKeys = new Set(prev.map((x) => x.fullName.toLowerCase()));
          return [...prev, ...mapped.filter((m) => !existingKeys.has(m.fullName.toLowerCase()))];
        });
      } else {
        setLiveContactNote(
          `Aucun contact RH public vérifiable trouvé pour ${target.companyName}. Ne jamais inventer d’adresse e-mail.`
        );
      }
    } catch (err) {
      setLiveContactNote(
        err instanceof Error ? err.message : 'Recherche de contacts publics indisponible.'
      );
    } finally {
      setFindingLiveContacts(false);
    }
  };

  const handleTailorCv = async () => {
    if (!activeCv) return;
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setTailoringCv(true);
    setTailoredSummaryNote('');
    setSubmitError(null);
    try {
      const contextText = [
        `Poste cible : ${target.roleTitle} chez ${target.companyName} (${target.location})`,
        target.description || '',
        target.signalReason ? `Signal détecté : ${target.signalReason}` : '',
        target.inferredSkills?.length
          ? `Compétences recherchées : ${target.inferredSkills.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const res = await optimizeCv({
        action: 'tailor',
        cvData: activeCv,
        targetJob: contextText,
        lang,
      });

      const tailoredCv: CvDocument = {
        ...activeCv,
        id: `cv_tailored_${Date.now()}`,
        versionName: `${activeCv.versionName} · Adapté ${target.companyName}`,
        updatedAt: new Date().toISOString().slice(0, 10),
        headline: res?.headline || res?.optimizedCv?.headline || activeCv.headline,
        summary: res?.summary || res?.optimizedCv?.summary || activeCv.summary,
        skills:
          res?.skills?.length
            ? res.skills
            : res?.optimizedCv?.skills?.length
              ? res.optimizedCv.skills
              : activeCv.skills,
        experiences:
          res?.experiences?.length
            ? res.experiences
            : res?.optimizedCv?.experiences?.length
              ? res.optimizedCv.experiences
              : activeCv.experiences,
      };

      onSaveTailoredCv?.(tailoredCv);
      setSelectedCvId(tailoredCv.id);
      setTailoredSummaryNote(
        `CV adapté et sauvegardé (« ${tailoredCv.versionName} »). Vous pouvez le joindre en 1 clic ci-dessous.`
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Adaptation du CV impossible.');
    } finally {
      setTailoringCv(false);
    }
  };

  const handleGenerateCoverLetter = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    setGeneratingLetter(true);
    setSubmitError(null);
    try {
      const draft = await generateOutreach({
        profile,
        opportunity: {
          id: target.companyId || `opp_${Date.now()}`,
          company: target.companyName,
          country: target.location || 'International',
          location: target.location || 'International',
          sector: target.sector || 'Technology',
          classification: isHidden ? 'Active Hiring Signal' : 'Confirmed Job',
          detectionReason: target.signalReason || target.roleTitle,
          signalEvidence: target.signalEvidence || target.description || '',
          potentialRoles: [target.roleTitle],
          confidenceScore: 80,
          confidenceJustification: target.sourceName || 'Verified source',
          sourceName: target.sourceName || target.companyName,
          sourceUrl: target.officialUrl || '',
          detectedDate: target.publishedDate || new Date().toISOString().slice(0, 10),
          professionalContact: {
            nameOrDepartment: recipientName || `Équipe Recrutement ${target.companyName}`,
            channel: recipientEmail || target.officialUrl || 'Official portal',
            url: target.recommendedContactUrl || target.officialUrl || '',
          },
          spontaneousOutreachAngle: isHidden
            ? `${target.signalReason || ''} ${target.signalEvidence || ''}`.trim()
            : `${target.description || ''} (${target.location})`.trim(),
        },
        lang,
      });
      setSubject(draft.emailSubject || subject);
      setCoverLetter(draft.emailBody || '');
      setLinkedinNote(draft.linkedinNote || '');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Génération de la lettre impossible.');
    } finally {
      setGeneratingLetter(false);
    }
  };

  const handleAttachSelectedCv = () => {
    if (!activeCv) return;
    setAttachmentError(null);
    if (attachments.length >= 3) {
      setAttachmentError('Maximum 3 pièces jointes autorisées.');
      return;
    }
    const text = serializeCvToPlainText(activeCv);
    const safeBase = (activeCv.fullName || 'Candidat').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `CV_${safeBase}_${target.companyName.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    const base64Content = toBase64Utf8(text);
    setAttachments((prev) => [
      ...prev.filter((a) => a.filename !== filename),
      {
        filename,
        contentType: 'text/plain',
        base64Content,
        sizeBytes: new TextEncoder().encode(text).length,
      },
    ]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setAttachmentError(null);
    if (files.length === 0) return;

    const allowed = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ]);

    const next: ApplicationAttachmentInput[] = [...attachments];
    for (const f of files) {
      if (next.length >= 3) {
        setAttachmentError('Maximum 3 pièces jointes autorisées par candidature.');
        break;
      }
      if (!allowed.has(f.type)) {
        setAttachmentError(`Format non accepté (${f.name}). Formats autorisés : PDF, DOCX, DOC, TXT.`);
        continue;
      }
      if (f.size > 4 * 1024 * 1024) {
        setAttachmentError(`Le fichier ${f.name} dépasse 4 Mo.`);
        continue;
      }
      try {
        const base64Content = await fileToBase64(f);
        next.push({
          filename: f.name,
          contentType: f.type,
          base64Content,
          sizeBytes: f.size,
        });
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : 'Lecture fichier échouée.');
      }
    }
    setAttachments(next);
  };

  const handleSubmit = async () => {
    if (!signedIn) {
      onRequireSignIn?.();
      return;
    }
    if (!explicitAuth) {
      setSubmitError('Vous devez cocher l’autorisation explicite avant de poursuivre.');
      return;
    }
    if (coverLetter.trim().length < 20) {
      setSubmitError('Rédigez ou générez votre lettre / message de candidature (minimum 20 caractères).');
      return;
    }
    if (channel === 'resend_email' && !recipientEmail.trim()) {
      setSubmitError('Saisissez ou sélectionnez une adresse e-mail professionnelle vérifiée.');
      return;
    }
    if (channel === 'official_portal' && !target.officialUrl) {
      setSubmitError('Aucun lien de portail employeur officiel disponible pour cette opportunité.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // If direct JOBFOUNDS employer job, also send real Firestore message to employer inbox
      if (channel === 'jobfounds_direct' && target.recruiterId && onSendDirectEmployerMessage) {
        await onSendDirectEmployerMessage({
          recruiterId: target.recruiterId,
          companyName: target.companyName,
          roleTitle: target.roleTitle,
          messageBody: `${subject}\n\n${coverLetter}${
            activeCv ? `\n\n[CV joint : ${activeCv.versionName}]` : ''
          }`,
        });
      }

      const res = await submitRealApplication({
        companyId: target.companyId,
        recruiterId: target.recruiterId,
        companyName: target.companyName,
        roleTitle: target.roleTitle,
        opportunityType: target.opportunityType,
        classification: target.classification || '',
        channel,
        recipientEmail: channel === 'resend_email' ? recipientEmail.trim() : undefined,
        recipientName: recipientName.trim() || undefined,
        officialUrl: target.officialUrl,
        subject: subject.trim(),
        coverLetter: coverLetter.trim(),
        cvVersionName: activeCv?.versionName,
        candidateName: profile.fullName || activeCv?.fullName || undefined,
        attachments: attachments.map(({ filename, contentType, base64Content }) => ({
          filename,
          contentType,
          base64Content,
        })),
        explicitAuthorization: true,
      });

      setSubmissionResult({
        submission: res.submission,
        transmitted: res.transmitted,
        message: res.message,
        nextStepUrl: res.nextStepUrl,
      });

      const today = new Date().toISOString().slice(0, 10);
      const followUp = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

      // HONESTY GUARANTEE: Only set stage='Application Sent' when genuinely transmitted!
      onApplicationRecorded({
        id: `app_${Date.now()}`,
        role: target.roleTitle,
        company: target.companyName,
        companyId: target.companyId,
        location: target.location,
        type: isHidden ? 'Spontaneous' : 'Confirmed Job',
        stage: res.transmitted ? 'Application Sent' : 'Application Prepared',
        dateAdded: today,
        sentDate: res.transmitted ? today : undefined,
        followUpDate: res.transmitted ? followUp : undefined,
        sourceUrl: target.officialUrl,
        salaryRange: target.salaryRange,
        contactName: recipientName || target.recommendedContactName || undefined,
        contactChannel:
          channel === 'resend_email'
            ? recipientEmail
            : channel === 'jobfounds_direct'
              ? 'Messagerie Employeur JOBFOUNDS'
              : target.officialUrl || 'Portail officiel employeur',
        cvVersionId: activeCv?.id,
        cvVersionName: activeCv?.versionName,
        coverLetterUsed: coverLetter.slice(0, 800),
        approvalStatus: 'approved_by_user',
        submissionId: res.submission.id,
        deliveryStatus: res.deliveryStatus,
        deliveryChannel: channel,
        providerMessageId: res.submission.providerMessageId || undefined,
        attachmentNames: res.submission.attachments.map((a) => a.filename),
        nextAction: res.transmitted
          ? 'Suivre les réponses recruteur et relancer sous 7 jours'
          : 'Soumettre sur le portail officiel puis confirmer l’envoi',
        notes: res.message,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur lors de la candidature.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPortalSubmitted = async () => {
    if (!submissionResult) return;
    setConfirmingPortal(true);
    setSubmitError(null);
    try {
      const res = await confirmPortalApplicationSubmission(
        submissionResult.submission.id,
        portalRefInput.trim()
      );
      setSubmissionResult({
        submission: res.submission,
        transmitted: true,
        message: `Soumission sur le portail officiel confirmée par vos soins${
          res.submission.portalReference ? ` (Réf. ${res.submission.portalReference})` : ''
        }.`,
      });
      const today = new Date().toISOString().slice(0, 10);
      onApplicationRecorded({
        id: `app_conf_${res.submission.id}`,
        role: target.roleTitle,
        company: target.companyName,
        companyId: target.companyId,
        location: target.location,
        type: isHidden ? 'Spontaneous' : 'Confirmed Job',
        stage: 'Application Sent',
        dateAdded: today,
        sentDate: today,
        followUpDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
        sourceUrl: target.officialUrl,
        cvVersionId: activeCv?.id,
        cvVersionName: activeCv?.versionName,
        coverLetterUsed: coverLetter.slice(0, 800),
        approvalStatus: 'approved_by_user',
        submissionId: res.submission.id,
        deliveryStatus: 'portal_confirmed_by_user',
        deliveryChannel: 'official_portal',
        attachmentNames: res.submission.attachments.map((a) => a.filename),
        notes: `Confirmé sur le portail officiel${res.submission.portalReference ? ` — Réf: ${res.submission.portalReference}` : ''}`,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Confirmation impossible.');
    } finally {
      setConfirmingPortal(false);
    }
  };

  const noReliableDirectChannel =
    !target.isEmployerDirect &&
    !target.officialUrl &&
    !recipientEmail &&
    hrContacts.every((c) => !c.corporateEmail && !c.publicUrl);

  const classificationLabel =
    target.classification === 'confirmed_job'
      ? 'Offre d’emploi confirmée'
      : target.classification === 'confirmed_hiring_need'
        ? 'Besoin de recrutement confirmé (sans offre publiée)'
        : target.classification === 'probable_hiring_signal'
          ? 'Signal de recrutement probable — non confirmé comme poste vacant'
          : target.classification === 'potential_opportunity'
            ? 'Opportunité potentielle exploratoire — aucun poste vacant confirmé'
            : isHidden
              ? 'Opportunité cachée (candidature spontanée)'
              : 'Offre d’emploi publiée';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-[#06132F] px-6 py-4 text-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-sky-300">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{target.companyName}</span>
              <span className="text-slate-500">·</span>
              <span>{classificationLabel}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-white truncate">{target.roleTitle}</h2>
            <p className="mt-0.5 text-xs text-slate-300">
              {target.location}
              {target.sector ? ` · ${target.sector}` : ''}
              {target.applicationDeadline ? ` · Date limite : ${target.applicationDeadline}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Epistemic Distinction Banner for Hidden Opportunities */}
          {isHidden && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-800 space-y-1">
                  <p className="font-semibold text-amber-950">
                    Pourquoi JOBFOUNDS a détecté cette entreprise ({classificationLabel})
                  </p>
                  {target.signalReason && <p>{target.signalReason}</p>}
                  {target.signalEvidence && (
                    <p className="text-slate-600">Preuve publique : {target.signalEvidence}</p>
                  )}
                  {target.inferredSkills && target.inferredSkills.length > 0 && (
                    <p className="text-slate-700">
                      <span className="font-medium">Compétences potentiellement recherchées :</span>{' '}
                      {target.inferredSkills.join(', ')}
                    </p>
                  )}
                  <p className="text-[11px] text-amber-900">
                    Distinction importante : une opportunité cachée repose sur des signaux publics de croissance et ne constitue pas automatiquement un poste vacant confirmé.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Live Availability Check Bar (when official URL exists) */}
          {target.officialUrl && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {checkingAvailability ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#287BC7] shrink-0" />
                ) : availability?.status === 'available' ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : availability?.status === 'expired' ? (
                  <ShieldAlert className="h-4 w-4 text-red-600 shrink-0" />
                ) : (
                  <Globe className="h-4 w-4 text-slate-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {checkingAvailability
                      ? 'Vérification en direct de la disponibilité du poste...'
                      : availability?.status === 'available'
                        ? `Offre active vérifiée (HTTP ${availability.httpStatus})`
                        : availability?.status === 'expired'
                          ? 'Offre expirée ou clôturée sur le portail officiel'
                          : availability?.status === 'unverifiable'
                            ? `Portail protégé (HTTP ${availability.httpStatus}) — vérifiez directement sur le lien`
                            : 'Source officielle disponible'}
                    {availability?.applicationDeadline
                      ? ` · Date limite : ${availability.applicationDeadline}`
                      : ''}
                  </div>
                  {availability?.warnings && availability.warnings.length > 0 && (
                    <p className="text-amber-700 mt-0.5">{availability.warnings[0]}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualAvailabilityCheck}
                  disabled={checkingAvailability}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingAvailability ? 'animate-spin' : ''}`} />
                  Revérifier
                </button>
                <a
                  href={target.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#287BC7] hover:bg-sky-50"
                >
                  Source officielle
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {/* Result / Receipt Banner if submitted */}
          {submissionResult && (
            <div
              className={`rounded-lg border p-4 space-y-3 ${
                submissionResult.transmitted
                  ? 'border-emerald-200 bg-emerald-50/80'
                  : submissionResult.submission.deliveryStatus === 'awaiting_portal_confirmation'
                    ? 'border-sky-200 bg-sky-50/80'
                    : 'border-red-200 bg-red-50/80'
              }`}
            >
              <div className="flex items-start gap-3">
                {submissionResult.transmitted ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : submissionResult.submission.deliveryStatus === 'awaiting_portal_confirmation' ? (
                  <Clock className="h-5 w-5 text-[#287BC7] shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-slate-900">
                    {submissionResult.transmitted
                      ? 'Candidature confirmée et enregistrée'
                      : submissionResult.submission.deliveryStatus === 'awaiting_portal_confirmation'
                        ? 'Action requise sur le portail officiel (non encore envoyée)'
                        : 'Candidature non transmise'}
                  </p>
                  <p className="text-xs text-slate-700">{submissionResult.message}</p>
                  <p className="text-[11px] font-mono text-slate-500">
                    Reçu serveur : {submissionResult.submission.id}
                    {submissionResult.submission.providerMessageId
                      ? ` · Provider ID : ${submissionResult.submission.providerMessageId}`
                      : ''}
                  </p>
                </div>
              </div>

              {/* Official Portal 2-Step Honest Completion Flow */}
              {submissionResult.submission.deliveryStatus === 'awaiting_portal_confirmation' &&
                submissionResult.nextStepUrl && (
                  <div className="rounded-md border border-sky-200 bg-white p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-800">
                        Étape 1 : Soumettez votre dossier sur le formulaire officiel de {target.companyName}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const fullDossier = [
                              `OBJET : ${subject}`,
                              '',
                              'LETTRE / MESSAGE :',
                              coverLetter,
                              ...(activeCv ? ['', '--- CV ADAPTÉ ---', serializeCvToPlainText(activeCv)] : []),
                            ].join('\n');
                            navigator.clipboard?.writeText(fullDossier);
                            setCopiedDossier(true);
                            setTimeout(() => setCopiedDossier(false), 2500);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedDossier ? 'Dossier copié' : 'Copier dossier'}
                        </button>
                        {activeCv && (
                          <button
                            type="button"
                            onClick={() => {
                              const blob = new Blob([serializeCvToPlainText(activeCv)], {
                                type: 'text/plain;charset=utf-8',
                              });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `CV_${(activeCv.fullName || 'Candidat').replace(/[^a-zA-Z0-9_-]/g, '_')}_${target.companyName.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Télécharger CV
                          </button>
                        )}
                        <a
                          href={submissionResult.nextStepUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#287BC7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e64a4]"
                        >
                          Ouvrir le formulaire officiel
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                    <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={portalRefInput}
                        onChange={(e) => setPortalRefInput(e.target.value)}
                        placeholder="N° de référence employeur (optionnel)"
                        className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-[#287BC7] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmPortalSubmitted}
                        disabled={confirmingPortal}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {confirmingPortal ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Étape 2 : Confirmer l’envoi effectué
                      </button>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* Step 1: Verified Public HR Contacts & Submission Channel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Channel Selector */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">1. Canal réel de candidature</h3>
              </div>

              <div className="space-y-2">
                {target.isEmployerDirect && target.recruiterId && (
                  <label className="flex items-start gap-2.5 rounded-md border border-slate-200 p-2.5 cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="channel"
                      checked={channel === 'jobfounds_direct'}
                      onChange={() => setChannel('jobfounds_direct')}
                      className="mt-0.5 accent-[#287BC7]"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900">
                        Candidature directe JOBFOUNDS
                      </div>
                      <p className="text-slate-600">
                        Transmission immédiate dans la messagerie employeur vérifiée de {target.companyName}.
                      </p>
                    </div>
                  </label>
                )}

                {target.officialUrl && (
                  <label className="flex items-start gap-2.5 rounded-md border border-slate-200 p-2.5 cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="channel"
                      checked={channel === 'official_portal'}
                      onChange={() => setChannel('official_portal')}
                      className="mt-0.5 accent-[#287BC7]"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900">
                        Formulaire officiel de l’employeur (ATS / Carrières)
                      </div>
                      <p className="text-slate-600">
                        Prépare votre dossier + lien officiel vérifié, puis enregistre la confirmation une fois soumise.
                      </p>
                    </div>
                  </label>
                )}

                <label className="flex items-start gap-2.5 rounded-md border border-slate-200 p-2.5 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === 'resend_email'}
                    onChange={() => setChannel('resend_email')}
                    className="mt-0.5 accent-[#287BC7]"
                  />
                  <div className="text-xs">
                    <div className="font-semibold text-slate-900">
                      Envoi e-mail professionnel vérifié (avec pièces jointes)
                    </div>
                    <p className="text-slate-600">
                      Vérifie le domaine DNS MX de l’entreprise puis transmet réellement l’e-mail avec Reply-To sur votre adresse.
                    </p>
                  </div>
                </label>
              </div>

              {channel === 'resend_email' && (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Destinataire (RH / Recruteur officiel)
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Ex: Responsable Recrutement / Talent Acquisition"
                      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-[#287BC7] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Adresse e-mail officielle vérifiée de l’entreprise
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="Ex: careers@entreprise.com (jamais d'adresse inventée)"
                      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-[#287BC7] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {noReliableDirectChannel && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Aucun canal d’envoi direct vérifié n’est enregistré pour {target.companyName}. Lancez la recherche de contacts RH publics ci-contre ou saisissez uniquement une adresse publiée officiellement par l’entreprise.
                  </span>
                </div>
              )}
            </div>

            {/* Verified Public HR Contacts Panel */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-[#287BC7]" />
                  Contacts RH publics vérifiés
                </h3>
                <button
                  type="button"
                  onClick={handleSearchPublicContacts}
                  disabled={findingLiveContacts}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {findingLiveContacts ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-[#287BC7]" />
                  )}
                  Rechercher RH
                </button>
              </div>

              {loadingContacts ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des contacts enregistrés...
                </div>
              ) : hrContacts.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {hrContacts.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{c.fullName}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {c.domainMxVerified && (
                            <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-mono text-emerald-800">
                              MX OK
                            </span>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              c.confidenceLevel === 'confirmed'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : c.confidenceLevel === 'probable'
                                  ? 'bg-sky-50 text-sky-900 border border-sky-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {c.confidenceLevel === 'confirmed'
                              ? 'Vérifié'
                              : c.confidenceLevel === 'probable'
                                ? 'Source publique · À confirmer'
                                : 'Non vérifié'}
                          </span>
                        </div>
                      </div>
                      <p className="text-slate-600">{c.roleTitle}</p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {c.corporateEmail && (
                          <button
                            type="button"
                            onClick={() => {
                              setRecipientEmail(c.corporateEmail);
                              setRecipientName(`${c.fullName} (${c.roleTitle})`);
                              setChannel('resend_email');
                            }}
                            className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900 hover:bg-sky-200"
                          >
                            <Mail className="h-3 w-3" /> Utiliser {c.corporateEmail}
                          </button>
                        )}
                        {c.publicUrl && (
                          <a
                            href={c.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#287BC7] hover:underline"
                          >
                            Profil public <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {liveContactNote ||
                    'Aucun contact RH pré-enregistré. Cliquez sur « Rechercher RH » pour identifier les responsables recrutement publics (sans jamais inventer de coordonnées).'}
                </p>
              )}
            </div>
          </div>

          {/* Step 2: CV Selection, AI Adaptation & Real Attachments */}
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                2. CV adapté & pièces jointes (PDF, DOCX, TXT)
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {activeCv && (
                  <>
                    <button
                      type="button"
                      onClick={handleTailorCv}
                      disabled={tailoringCv}
                      className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-[#06132F] hover:bg-sky-100 disabled:opacity-50"
                    >
                      {tailoringCv ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-[#287BC7]" />
                      )}
                      Adapter mon CV à ce poste
                    </button>
                    <button
                      type="button"
                      onClick={handleAttachSelectedCv}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FileCheck2 className="h-3.5 w-3.5 text-emerald-600" />
                      Joindre ce CV
                    </button>
                  </>
                )}
                <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Paperclip className="h-3.5 w-3.5" />
                  Ajouter fichier
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Version de CV JOBFOUNDS
                </label>
                <select
                  value={selectedCvId}
                  onChange={(e) => setSelectedCvId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#287BC7] focus:outline-none"
                >
                  {cvVersions.length === 0 && (
                    <option value="">Aucun CV enregistré (ajoutez un fichier PDF/DOCX)</option>
                  )}
                  {cvVersions.map((cv) => (
                    <option key={cv.id} value={cv.id}>
                      {cv.versionName} — {cv.headline || cv.fullName}
                    </option>
                  ))}
                </select>
                {tailoredSummaryNote && (
                  <p className="mt-1 text-[11px] text-emerald-700 font-medium">
                    {tailoredSummaryNote}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Pièces jointes prêtes ({attachments.length}/3)
                </label>
                {attachments.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-[11px] text-slate-500">
                    Aucun document joint. Cliquez sur « Joindre ce CV » ou importez un PDF/DOCX.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {attachments.map((att, i) => (
                      <div
                        key={`${att.filename}_${i}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="inline-flex items-center gap-1.5 truncate text-slate-800">
                          <FileText className="h-3.5 w-3.5 text-[#287BC7] shrink-0" />
                          <span className="truncate">{att.filename}</span>
                          {att.sizeBytes ? (
                            <span className="text-[10px] text-slate-500 tabular-nums">
                              ({formatBytes(att.sizeBytes)})
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="text-slate-400 hover:text-red-600"
                          aria-label="Supprimer pièce jointe"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {attachmentError && (
                  <p className="mt-1 text-[11px] text-red-600">{attachmentError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: Personalized Cover Letter / Spontaneous Message */}
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                3. {isHidden ? 'Candidature spontanée personnalisée' : 'Lettre de motivation personnalisée'}
              </h3>
              <button
                type="button"
                onClick={handleGenerateCoverLetter}
                disabled={generatingLetter}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#06132F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {generatingLetter ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-sky-300" />
                )}
                Générer avec l’IA
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Objet</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-[#287BC7] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Corps de la lettre / message
              </label>
              <textarea
                rows={7}
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                placeholder="Cliquez sur « Générer avec l’IA » ou rédigez votre lettre de motivation personnalisée..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs leading-relaxed focus:border-[#287BC7] focus:outline-none"
              />
            </div>

            {linkedinNote && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">
                    Note LinkedIn d’approche (optionnelle)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(linkedinNote);
                      setCopiedLinkedin(true);
                      setTimeout(() => setCopiedLinkedin(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#287BC7] hover:underline"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedLinkedin ? 'Copié' : 'Copier'}
                  </button>
                </div>
                <p className="text-xs text-slate-700 whitespace-pre-line">{linkedinNote}</p>
              </div>
            )}
          </div>

          {/* Step 4: Mandatory Explicit Candidate Authorization */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={explicitAuth}
                onChange={(e) => setExplicitAuth(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#287BC7]"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong className="text-slate-900">Autorisation explicite obligatoire :</strong>{' '}
                je confirme avoir vérifié le poste/signal, mon CV, ma lettre et mes pièces jointes, et j’autorise JOBFOUNDS à{' '}
                {channel === 'resend_email'
                  ? `transmettre réellement cette candidature par e-mail à ${recipientEmail || 'l’adresse indiquée'}`
                  : channel === 'jobfounds_direct'
                    ? `transmettre directement cette candidature à l’employeur ${target.companyName}`
                    : `préparer mon dossier et m’orienter vers le formulaire officiel de ${target.companyName} (l’envoi ne sera confirmé qu’après ma validation sur le portail)`}
                .
              </span>
            </label>

            {submitError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !explicitAuth || availability?.status === 'expired'}
                className="inline-flex items-center gap-2 rounded-md bg-[#287BC7] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1e64a4] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : channel === 'official_portal' ? (
                  <ExternalLink className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {channel === 'resend_email'
                  ? 'Envoyer la candidature par e-mail'
                  : channel === 'jobfounds_direct'
                    ? 'Envoyer directement à l’employeur'
                    : 'Préparer & ouvrir le formulaire officiel'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
