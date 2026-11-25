import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AccountRole,
  CandidateProfile,
  CompanyJobDoc,
  ConversationDoc,
  CvDocument,
  Lang,
  MessageDoc,
  PublicCandidateDoc,
  TrackedApplication,
  WatchlistItem,
} from '../types';

function cleanId(raw: string): string {
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return sanitized || `id_${Date.now()}`;
}

function cap(str: string | undefined, max: number): string {
  return (str ?? '').trim().slice(0, max);
}

function capList(arr: string[] | undefined, maxItems: number, maxStr = 80): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => String(s).trim().slice(0, maxStr))
    .filter(Boolean)
    .slice(0, maxItems);
}

export interface UserAccountDoc {
  uid: string;
  email: string;
  fullName: string;
  accountRole: AccountRole;
  lang: Lang;
  discoverable: boolean;
  gdprConsent: boolean;
  companyName?: string;
  companyWebsite?: string;
  profile?: CandidateProfile;
}

export async function ensureUserAccount(params: {
  uid: string;
  email: string;
  displayName: string;
  lang: Lang;
  defaultProfile: CandidateProfile;
}): Promise<UserAccountDoc> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      return {
        uid: data.uid,
        email: data.email,
        fullName: data.fullName,
        accountRole: data.accountRole || 'candidate',
        lang: data.lang || params.lang,
        discoverable: Boolean(data.discoverable),
        gdprConsent: Boolean(data.gdprConsent),
        companyName: data.companyName || '',
        companyWebsite: data.companyWebsite || '',
        profile: data.profile || params.defaultProfile,
      };
    }

    const newAccount: UserAccountDoc = {
      uid: params.uid,
      email: cap(params.email, 200) || 'user@jobfounds.local',
      fullName: cap(params.displayName || params.defaultProfile.fullName, 120) || 'JOBFOUNDS Member',
      accountRole: 'candidate',
      lang: params.lang,
      discoverable: false,
      gdprConsent: true,
      companyName: '',
      companyWebsite: '',
      profile: params.defaultProfile,
    };

    await setDoc(ref, {
      ...newAccount,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newAccount;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserAccount(
  uid: string,
  updates: Partial<Omit<UserAccountDoc, 'uid' | 'email'>>
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const payload: Record<string, any> = { updatedAt: serverTimestamp() };
    if (updates.fullName !== undefined) payload.fullName = cap(updates.fullName, 120) || 'Member';
    if (updates.accountRole !== undefined) payload.accountRole = updates.accountRole;
    if (updates.lang !== undefined) payload.lang = updates.lang;
    if (updates.discoverable !== undefined) payload.discoverable = Boolean(updates.discoverable);
    if (updates.gdprConsent !== undefined) payload.gdprConsent = Boolean(updates.gdprConsent);
    if (updates.companyName !== undefined) payload.companyName = cap(updates.companyName, 140);
    if (updates.companyWebsite !== undefined) payload.companyWebsite = cap(updates.companyWebsite, 300);
    if (updates.profile !== undefined) payload.profile = updates.profile;
    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function syncPublicCandidateDirectory(
  uid: string,
  profile: CandidateProfile,
  discoverable: boolean
): Promise<void> {
  const path = `publicCandidates/${uid}`;
  const ref = doc(db, 'publicCandidates', uid);
  try {
    if (!discoverable) {
      const existingSnap = await getDoc(ref);
      if (existingSnap.exists()) {
        await deleteDoc(ref);
      }
      return;
    }

    const existingSnap = await getDoc(ref);
    const baseData = {
      userId: uid,
      displayName: cap(profile.fullName, 120) || 'Candidate',
      headline: cap(profile.currentTitle, 200) || 'International Professional',
      yearsExperience: Math.min(60, Math.max(0, Math.round(profile.yearsExperience || 0))),
      highestDegree: cap(profile.highestDegree, 160),
      skills: capList(profile.skills, 25, 60),
      languages: capList(profile.languages, 12, 60),
      preferredCountries: capList(profile.preferredCountries, 20, 60),
      preferredWorkModes: capList(profile.preferredWorkModes, 3, 20),
      availability: cap(profile.availability, 120),
      isOpenToRecruiters: true,
      updatedAt: serverTimestamp(),
    };

    if (existingSnap.exists()) {
      await updateDoc(ref, {
        displayName: baseData.displayName,
        headline: baseData.headline,
        yearsExperience: baseData.yearsExperience,
        highestDegree: baseData.highestDegree,
        skills: baseData.skills,
        languages: baseData.languages,
        preferredCountries: baseData.preferredCountries,
        preferredWorkModes: baseData.preferredWorkModes,
        availability: baseData.availability,
        isOpenToRecruiters: true,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...baseData,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// CV Versions CRUD
export function subscribeUserCvs(uid: string, onData: (items: CvDocument[]) => void) {
  const path = `users/${uid}/cvs`;
  const q = query(collection(db, 'users', uid, 'cvs'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: CvDocument[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: data.id || d.id,
          versionName: data.versionName || 'CV',
          updatedAt: data.updatedDate || new Date().toISOString().slice(0, 10),
          template: data.template || 'executive',
          fullName: data.fullName || '',
          headline: data.headline || '',
          email: data.email || '',
          phone: data.phone || '',
          location: data.location || '',
          linkedin: data.linkedin || '',
          summary: data.summary || '',
          experiences: Array.isArray(data.experiences) ? data.experiences : [],
          education: Array.isArray(data.education) ? data.education : [],
          skills: Array.isArray(data.skills) ? data.skills : [],
          languages: Array.isArray(data.languages) ? data.languages : [],
        };
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveUserCv(uid: string, cv: CvDocument): Promise<void> {
  const id = cleanId(cv.id);
  const path = `users/${uid}/cvs/${id}`;
  const ref = doc(db, 'users', uid, 'cvs', id);
  try {
    const snap = await getDoc(ref);
    const fields = {
      versionName: cap(cv.versionName, 140) || 'CV',
      template: cv.template,
      fullName: cap(cv.fullName, 120),
      headline: cap(cv.headline, 220),
      email: cap(cv.email, 200),
      phone: cap(cv.phone, 60),
      location: cap(cv.location, 160),
      linkedin: cap(cv.linkedin, 240),
      summary: cap(cv.summary, 3000),
      experiences: (cv.experiences || []).slice(0, 25),
      education: (cv.education || []).slice(0, 15),
      skills: capList(cv.skills, 40, 80),
      languages: capList(cv.languages, 15, 80),
      updatedDate: cap(cv.updatedAt, 32) || new Date().toISOString().slice(0, 10),
      updatedAt: serverTimestamp(),
    };

    if (snap.exists()) {
      await updateDoc(ref, fields);
    } else {
      await setDoc(ref, {
        id,
        ownerId: uid,
        ...fields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteUserCv(uid: string, cvId: string): Promise<void> {
  const id = cleanId(cvId);
  const path = `users/${uid}/cvs/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'cvs', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// Tracked Applications CRUD
export function subscribeUserApplications(
  uid: string,
  onData: (items: TrackedApplication[]) => void
) {
  const path = `users/${uid}/applications`;
  const q = query(collection(db, 'users', uid, 'applications'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: TrackedApplication[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: data.id || d.id,
          role: data.role || '',
          company: data.company || '',
          companyId: data.companyId || '',
          location: data.location || '',
          type: data.type || 'Confirmed Job',
          stage: data.stage || 'Opportunity Identified',
          dateAdded: data.dateAdded || '',
          sentDate: data.sentDate || '',
          followUpDate: data.followUpDate || '',
          interviewDate: data.interviewDate || '',
          sourceUrl: data.sourceUrl || '',
          salaryRange: data.salaryRange || '',
          contactName: data.contactName || '',
          contactRole: data.contactRole || '',
          contactChannel: data.contactChannel || '',
          cvVersionId: data.cvVersionId || '',
          cvVersionName: data.cvVersionName || '',
          coverLetterUsed: data.coverLetterUsed || '',
          responseReceived: Boolean(data.responseReceived),
          responseSummary: data.responseSummary || '',
          responseSource: data.responseSource || 'none',
          nextAction: data.nextAction || '',
          approvalStatus: data.approvalStatus || 'not_required',
          followUpCount: Number(data.followUpCount || 0),
          lastFollowUpAt: data.lastFollowUpAt || '',
          notes: data.notes || '',
        };
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveUserApplication(
  uid: string,
  app: TrackedApplication
): Promise<void> {
  const id = cleanId(app.id);
  const path = `users/${uid}/applications/${id}`;
  const ref = doc(db, 'users', uid, 'applications', id);
  try {
    const snap = await getDoc(ref);
    const fields = {
      role: cap(app.role, 180) || 'Role',
      company: cap(app.company, 140) || 'Company',
      companyId: cap(app.companyId, 128),
      location: cap(app.location, 140),
      type: app.type,
      stage: app.stage,
      sentDate: cap(app.sentDate, 32),
      followUpDate: cap(app.followUpDate, 32),
      interviewDate: cap(app.interviewDate, 40),
      sourceUrl: cap(app.sourceUrl, 500),
      salaryRange: cap(app.salaryRange, 120),
      contactName: cap(app.contactName, 140),
      contactRole: cap(app.contactRole, 140),
      contactChannel: cap(app.contactChannel, 200),
      cvVersionId: cap(app.cvVersionId, 128),
      cvVersionName: cap(app.cvVersionName, 140),
      coverLetterUsed: cap(app.coverLetterUsed, 2000),
      responseReceived: Boolean(app.responseReceived),
      responseSummary: cap(app.responseSummary, 1000),
      responseSource: app.responseSource || 'none',
      nextAction: cap(app.nextAction, 300),
      approvalStatus: app.approvalStatus || 'not_required',
      followUpCount: Math.min(20, Math.max(0, Math.round(app.followUpCount || 0))),
      lastFollowUpAt: cap(app.lastFollowUpAt, 32),
      notes: cap(app.notes, 2000),
      updatedAt: serverTimestamp(),
    };
    if (snap.exists()) {
      await updateDoc(ref, fields);
    } else {
      await setDoc(ref, {
        id,
        ownerId: uid,
        dateAdded: cap(app.dateAdded, 32) || new Date().toISOString().slice(0, 10),
        ...fields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteUserApplication(uid: string, appId: string): Promise<void> {
  const id = cleanId(appId);
  const path = `users/${uid}/applications/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'applications', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// Watchlist CRUD
export function subscribeUserWatchlist(uid: string, onData: (items: WatchlistItem[]) => void) {
  const path = `users/${uid}/watchlist`;
  const q = query(collection(db, 'users', uid, 'watchlist'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: WatchlistItem[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: data.id || d.id,
          kind: data.kind || 'company',
          label: data.label || '',
          country: data.country || '',
          sector: data.sector || '',
          lastChecked: data.lastChecked || '',
          lastSignalSummary: data.lastSignalSummary || '',
          unreadAlerts: Number(data.unreadAlerts || 0),
        };
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveWatchlistItem(uid: string, item: WatchlistItem): Promise<void> {
  const id = cleanId(item.id);
  const path = `users/${uid}/watchlist/${id}`;
  const ref = doc(db, 'users', uid, 'watchlist', id);
  try {
    const snap = await getDoc(ref);
    const fields = {
      label: cap(item.label, 140) || 'Watchlist',
      country: cap(item.country, 80),
      sector: cap(item.sector, 120),
      lastChecked: cap(item.lastChecked, 40),
      lastSignalSummary: cap(item.lastSignalSummary, 1000),
      unreadAlerts: Math.min(500, Math.max(0, Math.round(item.unreadAlerts || 0))),
      updatedAt: serverTimestamp(),
    };
    if (snap.exists()) {
      await updateDoc(ref, fields);
    } else {
      await setDoc(ref, {
        id,
        ownerId: uid,
        kind: item.kind,
        ...fields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteWatchlistItem(uid: string, watchId: string): Promise<void> {
  const id = cleanId(watchId);
  const path = `users/${uid}/watchlist/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'watchlist', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// Employer / Recruiter Job Postings
export function subscribeOpenCompanyJobs(onData: (items: CompanyJobDoc[]) => void) {
  const path = 'companyJobs';
  const q = query(collection(db, 'companyJobs'), where('status', '==', 'open'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as CompanyJobDoc), id: d.id })));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function publishCompanyJob(
  recruiterId: string,
  job: Omit<CompanyJobDoc, 'id' | 'recruiterId' | 'status' | 'verificationStatus'>
): Promise<string> {
  const id = cleanId(`cjob_${Date.now()}`);
  const path = `companyJobs/${id}`;
  try {
    const hasOfficialUrl = /^https?:\/\/.+\..+/i.test(job.companyWebsite || '');
    await setDoc(doc(db, 'companyJobs', id), {
      id,
      recruiterId,
      companyName: cap(job.companyName, 140) || 'Company',
      companyWebsite: cap(job.companyWebsite, 300),
      title: cap(job.title, 180) || 'Position',
      country: cap(job.country, 80) || 'International',
      city: cap(job.city, 80) || 'Remote',
      workMode: job.workMode,
      contractType: job.contractType,
      experienceLevel: cap(job.experienceLevel, 60),
      degreeRequired: cap(job.degreeRequired, 140),
      salaryRange: cap(job.salaryRange, 120),
      skills: capList(job.skills, 25, 60),
      languages: capList(job.languages, 10, 60),
      description: cap(job.description, 4000) || 'Role description',
      visaSponsorship: cap(job.visaSponsorship, 60),
      verificationStatus: hasOfficialUrl ? 'Partially Verified' : 'Unverified',
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function closeCompanyJob(jobId: string): Promise<void> {
  const id = cleanId(jobId);
  const path = `companyJobs/${id}`;
  try {
    await updateDoc(doc(db, 'companyJobs', id), {
      status: 'closed',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Opt-in Public Candidate Directory
export function subscribePublicCandidates(onData: (items: PublicCandidateDoc[]) => void) {
  const path = 'publicCandidates';
  const q = query(
    collection(db, 'publicCandidates'),
    where('isOpenToRecruiters', '==', true)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as PublicCandidateDoc));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

// Direct Messaging (Candidate <-> Recruiter)
export function subscribeUserConversations(
  uid: string,
  onData: (items: ConversationDoc[]) => void
) {
  const map = new Map<string, ConversationDoc>();
  const emit = () => onData(Array.from(map.values()));

  const qCand = query(collection(db, 'conversations'), where('candidateId', '==', uid));
  const qRec = query(collection(db, 'conversations'), where('recruiterId', '==', uid));

  const unsub1 = onSnapshot(
    qCand,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, d.data() as ConversationDoc));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
  );

  const unsub2 = onSnapshot(
    qRec,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, d.data() as ConversationDoc));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
  );

  return () => {
    unsub1();
    unsub2();
  };
}

export async function createOrOpenConversation(params: {
  candidateId: string;
  recruiterId: string;
  candidateName: string;
  recruiterName: string;
  companyName: string;
  jobTitle: string;
}): Promise<string> {
  const id = cleanId(`conv_${params.candidateId.slice(0, 12)}_${params.recruiterId.slice(0, 12)}_${Date.now()}`);
  const path = `conversations/${id}`;
  try {
    await setDoc(doc(db, 'conversations', id), {
      id,
      candidateId: params.candidateId,
      recruiterId: params.recruiterId,
      candidateName: cap(params.candidateName, 120) || 'Candidate',
      recruiterName: cap(params.recruiterName, 120) || 'Recruiter',
      companyName: cap(params.companyName, 140) || 'Company',
      jobTitle: cap(params.jobTitle, 180) || 'Opportunity',
      lastMessage: '',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeConversationMessages(
  conversationId: string,
  uid: string,
  onData: (items: MessageDoc[]) => void
) {
  const map = new Map<string, MessageDoc>();
  const emit = () => {
    const arr = Array.from(map.values()).sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return ta - tb;
    });
    onData(arr);
  };

  const basePath = `conversations/${conversationId}/messages`;
  const qSent = query(collection(db, basePath), where('senderId', '==', uid));
  const qRecv = query(collection(db, basePath), where('recipientId', '==', uid));

  const unsub1 = onSnapshot(
    qSent,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, d.data() as MessageDoc));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, basePath)
  );
  const unsub2 = onSnapshot(
    qRecv,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, d.data() as MessageDoc));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, basePath)
  );

  return () => {
    unsub1();
    unsub2();
  };
}

export async function sendConversationMessage(params: {
  conversationId: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  body: string;
}): Promise<void> {
  const messageId = cleanId(`msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const msgPath = `conversations/${params.conversationId}/messages/${messageId}`;
  const cleanBody = cap(params.body, 2500);
  if (!cleanBody) return;

  try {
    await setDoc(doc(db, 'conversations', params.conversationId, 'messages', messageId), {
      id: messageId,
      conversationId: params.conversationId,
      senderId: params.senderId,
      recipientId: params.recipientId,
      senderName: cap(params.senderName, 120) || 'User',
      body: cleanBody,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'conversations', params.conversationId), {
      lastMessage: cleanBody.slice(0, 480),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, msgPath);
  }
}

// GDPR Data Export & Complete Account Deletion (including owned companyJobs & archiving conversations)
export async function deleteAllUserCloudData(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const batch = writeBatch(db);
    const subcols = ['cvs', 'applications', 'watchlist'] as const;
    for (const sub of subcols) {
      const q = query(collection(db, 'users', uid, sub), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      snap.docs.forEach((d) => batch.delete(d.ref));
    }

    // Delete any employer postings created by this user
    const ownedJobsSnap = await getDocs(
      query(collection(db, 'companyJobs'), where('recruiterId', '==', uid))
    );
    ownedJobsSnap.docs.forEach((d) => batch.delete(d.ref));

    // Archive any active conversations involving this user
    const [candConvs, recConvs] = await Promise.all([
      getDocs(query(collection(db, 'conversations'), where('candidateId', '==', uid))),
      getDocs(query(collection(db, 'conversations'), where('recruiterId', '==', uid))),
    ]);
    const archivedIds = new Set<string>();
    for (const d of [...candConvs.docs, ...recConvs.docs]) {
      if (!archivedIds.has(d.id) && (d.data() as any)?.status === 'active') {
        archivedIds.add(d.id);
        batch.update(d.ref, { status: 'archived', updatedAt: serverTimestamp() });
      }
    }

    const pubRef = doc(db, 'publicCandidates', uid);
    const pubSnap = await getDoc(pubRef);
    if (pubSnap.exists()) {
      batch.delete(pubRef);
    }
    batch.delete(doc(db, 'users', uid));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// -----------------------------------------------------------------------------
// ADMIN MODERATION & PLATFORM GOVERNANCE (Authorized Admin accounts only)
// -----------------------------------------------------------------------------
export const BOOTSTRAP_ADMIN_EMAIL = 'guerrierjephly@gmail.com';

export async function checkIsAdminUser(uid: string, email?: string | null): Promise<boolean> {
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true;
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export function subscribeAllCompanyJobsAdmin(onData: (items: CompanyJobDoc[]) => void) {
  const path = 'companyJobs';
  return onSnapshot(
    collection(db, 'companyJobs'),
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as CompanyJobDoc), id: d.id })));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeAllUsersAdmin(onData: (items: UserAccountDoc[]) => void) {
  const path = 'users';
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: data.uid || d.id,
            email: data.email || '',
            fullName: data.fullName || 'Member',
            accountRole: data.accountRole || 'candidate',
            lang: data.lang || 'fr',
            discoverable: Boolean(data.discoverable),
            gdprConsent: Boolean(data.gdprConsent),
            companyName: data.companyName || '',
            companyWebsite: data.companyWebsite || '',
          };
        })
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeAllConversationsAdmin(onData: (items: ConversationDoc[]) => void) {
  const path = 'conversations';
  return onSnapshot(
    collection(db, 'conversations'),
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as ConversationDoc), id: d.id })));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function adminUpdateCompanyJob(
  jobId: string,
  updates: Partial<Pick<CompanyJobDoc, 'verificationStatus' | 'status'>>
): Promise<void> {
  const id = cleanId(jobId);
  const path = `companyJobs/${id}`;
  try {
    await updateDoc(doc(db, 'companyJobs', id), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminDeleteCompanyJob(jobId: string): Promise<void> {
  const id = cleanId(jobId);
  const path = `companyJobs/${id}`;
  try {
    await deleteDoc(doc(db, 'companyJobs', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

