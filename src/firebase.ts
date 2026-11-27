import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfigFile from '../firebase-applet-config.json';

const env = import.meta.env;
const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY || '').trim() || firebaseConfigFile.apiKey,
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim() || firebaseConfigFile.authDomain,
  projectId: (env.VITE_FIREBASE_PROJECT_ID || '').trim() || firebaseConfigFile.projectId,
  messagingSenderId:
    (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() || firebaseConfigFile.messagingSenderId,
  appId: (env.VITE_FIREBASE_APP_ID || '').trim() || firebaseConfigFile.appId,
};
const firestoreDatabaseId =
  (env.VITE_FIREBASE_DATABASE_ID || '').trim() || firebaseConfigFile.firestoreDatabaseId || '(default)';

const app = initializeApp(firebaseConfig);
export const db =
  firestoreDatabaseId === '(default)' ? getFirestore(app) : getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Strictly in-memory Gmail OAuth token cache (never persisted to localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGmailEmail: string | null = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedGmailAccessToken = null;
    cachedGmailEmail = null;
  }
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function mapFirebaseAuthError(err: unknown): Error {
  const code = (err as { code?: string })?.code || '';
  if (code === 'auth/popup-blocked') {
    return new Error(
      'La fenêtre de connexion Google a été bloquée par le navigateur. Autorisez les pop-ups pour ce site puis réessayez.'
    );
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new Error('Connexion Google annulée avant validation.');
  }
  if (code === 'auth/unauthorized-domain') {
    return new Error(
      `Domaine non autorisé dans Firebase Auth (${typeof window !== 'undefined' ? window.location.hostname : ''}). Ajoutez ce domaine dans Firebase Console > Authentication > Authorized domains.`
    );
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error('La connexion Google n’est pas activée dans la configuration Firebase.');
  }
  return err instanceof Error ? err : new Error(String(err || 'Google authentication failed.'));
}

export async function signInWithGooglePopup() {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function connectGmailReadonly(): Promise<{ accessToken: string; email: string }> {
  const gmailProvider = new GoogleAuthProvider();
  for (const scope of GMAIL_SCOPES) {
    gmailProvider.addScope(scope);
  }
  gmailProvider.setCustomParameters({
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  });

  try {
    const result = auth.currentUser
      ? await reauthenticateWithPopup(auth.currentUser, gmailProvider).catch(() =>
          signInWithPopup(auth, gmailProvider)
        )
      : await signInWithPopup(auth, gmailProvider);

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Autorisation OAuth Gmail (lecture seule) non reçue. Vérifiez que la case d’accès Gmail lecture seule a bien été cochée.'
      );
    }
    cachedGmailAccessToken = credential.accessToken;
    cachedGmailEmail = result.user.email || auth.currentUser?.email || '';
    return {
      accessToken: cachedGmailAccessToken,
      email: cachedGmailEmail,
    };
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function getConnectedGmailEmail(): string | null {
  return cachedGmailEmail;
}

export function disconnectGmail(): void {
  cachedGmailAccessToken = null;
  cachedGmailEmail = null;
}

export async function signOutUser() {
  cachedGmailAccessToken = null;
  cachedGmailEmail = null;
  return signOut(auth);
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();
