import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Lang } from '../types';
import { BrandLogo } from './ui';
import {
  AppAuthUser,
  authLoginWithPassword,
  authRegisterWithPassword,
  authResendVerificationCode,
  authVerifyEmailCode,
  setAppSessionToken,
} from '../utils/api';

export type AuthModalMode = 'register' | 'login' | 'verify';

interface AuthModalProps {
  open: boolean;
  initialMode: AuthModalMode;
  lang: Lang;
  pendingEmail?: string;
  onClose: () => void;
  onAuthenticated: (user: AppAuthUser, token: string) => void;
  onUnverifiedSession: (user: AppAuthUser, token: string) => void;
  onGoogleSignIn: () => Promise<void>;
}

function getPasswordStrength(password: string, isFr: boolean): {
  level: 0 | 1 | 2 | 3;
  label: string;
  color: string;
} {
  if (!password) return { level: 0, label: '', color: 'bg-slate-200' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 1) {
    return {
      level: 1,
      label: isFr ? 'Faible (min. 8 caractères)' : 'Weak (min. 8 chars)',
      color: 'bg-rose-500',
    };
  }
  if (score === 2) {
    return {
      level: 2,
      label: isFr ? 'Moyen' : 'Medium',
      color: 'bg-amber-500',
    };
  }
  return {
    level: 3,
    label: isFr ? 'Fort' : 'Strong',
    color: 'bg-emerald-600',
  };
}

export function AuthModal({
  open,
  initialMode,
  lang,
  pendingEmail = '',
  onClose,
  onAuthenticated,
  onUnverifiedSession,
  onGoogleSignIn,
}: AuthModalProps) {
  const isFr = lang === 'fr';

  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(pendingEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 5-digit verification code state
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '']);
  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [verifyEmailTarget, setVerifyEmailTarget] = useState(pendingEmail);
  const [emailDeliveryOk, setEmailDeliveryOk] = useState<boolean | null>(null);
  const [emailDeliveryNotice, setEmailDeliveryNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      if (pendingEmail) {
        setEmail(pendingEmail);
        setVerifyEmailTarget(pendingEmail);
      }
      setError(null);
      setSuccessMsg(null);
    }
  }, [open, initialMode, pendingEmail]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (open && mode === 'verify') {
      window.setTimeout(() => {
        digitRefs.current[0]?.focus();
      }, 80);
    }
  }, [open, mode]);

  if (!open) return null;

  const strength = getPasswordStrength(password, isFr);
  const codeValue = digits.join('');

  const resetFormErrors = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleDigitChange = (index: number, rawVal: string) => {
    const clean = rawVal.replace(/\D/g, '');
    resetFormErrors();

    if (clean.length > 1) {
      // Handle pasting multiple digits
      const next = [...digits];
      for (let i = 0; i < 5; i += 1) {
        next[i] = clean[i] || '';
      }
      setDigits(next);
      const focusIdx = Math.min(4, clean.length);
      digitRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 4) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      digitRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 4) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 5);
    if (!pasted) return;
    e.preventDefault();
    const next = ['', '', '', '', ''];
    for (let i = 0; i < pasted.length; i += 1) {
      next[i] = pasted[i];
    }
    setDigits(next);
    digitRefs.current[Math.min(4, pasted.length)]?.focus();
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFormErrors();

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedName.length < 2) {
      setError(
        isFr
          ? 'Veuillez entrer votre nom complet (au moins 2 caractères).'
          : 'Please enter your full name (at least 2 characters).'
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setError(isFr ? 'Veuillez entrer une adresse e-mail valide.' : 'Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError(
        isFr
          ? 'Le mot de passe doit contenir au moins 8 caractères.'
          : 'Password must be at least 8 characters.'
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(
        isFr ? 'Les deux mots de passe ne correspondent pas.' : 'Passwords do not match.'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await authRegisterWithPassword({
        fullName: trimmedName,
        email: trimmedEmail,
        password,
      });

      // Store unverified token in memory ONLY for calling verify/resend; workspace stays LOCKED
      setAppSessionToken(res.token);
      onUnverifiedSession(res.user, res.token);

      setVerifyEmailTarget(res.user.email);
      setEmailDeliveryOk(res.emailSent);
      setEmailDeliveryNotice(res.emailReason || '');
      setDigits(['', '', '', '', '']);
      setCooldown(res.cooldownSeconds || 60);
      setMode('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création du compte.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFormErrors();

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError(
        isFr
          ? 'Veuillez saisir votre adresse e-mail et votre mot de passe.'
          : 'Please enter your email and password.'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await authLoginWithPassword({
        email: trimmedEmail,
        password,
      });

      setAppSessionToken(res.token);

      if (res.verificationRequired || !res.user.emailVerified) {
        onUnverifiedSession(res.user, res.token);
        setVerifyEmailTarget(res.user.email);
        setEmailDeliveryOk(res.emailSent ?? null);
        setEmailDeliveryNotice(res.emailReason || '');
        setDigits(['', '', '', '', '']);
        setMode('verify');
        return;
      }

      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Identifiants invalides.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetFormErrors();

    if (!/^\d{5}$/.test(codeValue)) {
      setError(
        isFr
          ? 'Veuillez saisir les 5 chiffres du code de confirmation.'
          : 'Please enter all 5 digits of the confirmation code.'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await authVerifyEmailCode({
        email: verifyEmailTarget,
        code: codeValue,
      });
      setAppSessionToken(res.token);
      setSuccessMsg(
        res.message ||
          (isFr
            ? 'Compte validé avec succès ! Redirection vers votre espace…'
            : 'Account verified! Redirecting to your workspace…')
      );
      window.setTimeout(() => {
        onAuthenticated(res.user, res.token);
      }, 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code de confirmation invalide.');
      setDigits(['', '', '', '', '']);
      digitRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (cooldown > 0 || resendLoading) return;
    resetFormErrors();
    setResendLoading(true);
    try {
      const res = await authResendVerificationCode({ email: verifyEmailTarget });
      if (res.alreadyVerified && res.user && res.token) {
        setAppSessionToken(res.token);
        onAuthenticated(res.user, res.token);
        return;
      }
      setEmailDeliveryOk(res.emailSent);
      setEmailDeliveryNotice(res.emailReason);
      setCooldown(res.cooldownSeconds || 60);
      setDigits(['', '', '', '', '']);
      if (res.emailSent) {
        setSuccessMsg(
          isFr
            ? `Un nouveau code à 5 chiffres a été envoyé à ${verifyEmailTarget}.`
            : `A new 5-digit code has been sent to ${verifyEmailTarget}.`
        );
      } else {
        setError(res.emailReason);
      }
      digitRefs.current[0]?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de renvoyer le code.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleGoogleClick = async () => {
    resetFormErrors();
    setGoogleLoading(true);
    try {
      await onGoogleSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-jf-navy/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="jf-auth-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white border border-jf-border rounded-2xl shadow-2xl overflow-hidden my-auto"
      >
        {/* Modal Header */}
        <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-[#F4F8FC] to-white border-b border-jf-border flex items-center justify-between">
          <BrandLogo size="sm" />
          <button
            type="button"
            onClick={onClose}
            aria-label={isFr ? 'Fermer' : 'Close'}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-jf-ice hover:text-jf-navy transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 sm:p-7 space-y-5">
          {/* Mode Switcher Tabs (Hidden while verifying 5-digit code) */}
          {mode !== 'verify' && (
            <div className="grid grid-cols-2 p-1 bg-jf-ice rounded-xl border border-jf-border">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  resetFormErrors();
                }}
                className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                  mode === 'register'
                    ? 'bg-white text-jf-navy shadow-xs border border-jf-border/80'
                    : 'text-slate-600 hover:text-jf-navy'
                }`}
              >
                {isFr ? 'Créer un compte' : 'Create Account'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  resetFormErrors();
                }}
                className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                  mode === 'login'
                    ? 'bg-white text-jf-navy shadow-xs border border-jf-border/80'
                    : 'text-slate-600 hover:text-jf-navy'
                }`}
              >
                {isFr ? 'Se connecter' : 'Sign In'}
              </button>
            </div>
          )}

          {/* Heading */}
          {mode === 'register' && (
            <div className="space-y-1">
              <h2
                id="jf-auth-modal-title"
                className="font-display text-xl font-bold text-jf-navy tracking-tight"
              >
                {isFr ? 'Créez votre compte JOBFOUNDS' : 'Create your JOBFOUNDS account'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                {isFr
                  ? 'Un code de confirmation à 5 chiffres sera envoyé à votre e-mail pour valider votre compte.'
                  : 'A 5-digit confirmation code will be emailed to validate your account.'}
              </p>
            </div>
          )}

          {mode === 'login' && (
            <div className="space-y-1">
              <h2
                id="jf-auth-modal-title"
                className="font-display text-xl font-bold text-jf-navy tracking-tight"
              >
                {isFr ? 'Connexion à votre espace' : 'Sign in to your workspace'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                {isFr
                  ? 'Accédez à vos offres vérifiées, CV ATS, alertes et suivi de candidatures.'
                  : 'Access verified jobs, ATS CVs, alerts, and your application tracker.'}
              </p>
            </div>
          )}

          {mode === 'verify' && (
            <div className="space-y-2 text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-jf-blue/10 border border-jf-blue/25 flex items-center justify-center text-jf-blue">
                <KeyRound className="w-6 h-6" />
              </div>
              <h2
                id="jf-auth-modal-title"
                className="font-display text-xl font-bold text-jf-navy tracking-tight"
              >
                {isFr ? 'Confirmation par code à 5 chiffres' : '5-Digit Email Verification'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {isFr ? (
                  <>
                    Saisissez le code à <strong>5 chiffres</strong> envoyé à{' '}
                    <span className="font-semibold text-jf-navy break-all">{verifyEmailTarget}</span>.
                    Sans ce code, votre compte n’est pas encore validé.
                  </>
                ) : (
                  <>
                    Enter the <strong>5-digit</strong> confirmation code sent to{' '}
                    <span className="font-semibold text-jf-navy break-all">{verifyEmailTarget}</span>.
                    Your account remains unverified until confirmed.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Email Delivery Status Banner (Verify Step) */}
          {mode === 'verify' && emailDeliveryOk === false && emailDeliveryNotice && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="space-y-1">
                <div className="font-semibold">
                  {isFr ? 'Envoi d’e-mail bloqué sur le serveur' : 'Email delivery issue on server'}
                </div>
                <p className="leading-relaxed">{emailDeliveryNotice}</p>
              </div>
            </div>
          )}

          {mode === 'verify' && emailDeliveryOk === true && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>
                {isFr
                  ? 'E-mail envoyé ! Vérifiez votre boîte de réception (et vos courriers indésirables). Validité : 15 minutes.'
                  : 'Email sent! Check your inbox (and spam folder). Valid for 15 minutes.'}
              </span>
            </div>
          )}

          {/* Error & Success Feedback */}
          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* REGISTER FORM */}
          {mode === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="auth-fullname" className="block text-xs font-semibold text-jf-navy">
                  {isFr ? 'Nom complet' : 'Full Name'}
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-fullname"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder={isFr ? 'Ex. Jean-Marc Pierre' : 'e.g. Alex Morgan'}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="auth-reg-email" className="block text-xs font-semibold text-jf-navy">
                  {isFr ? 'Adresse e-mail' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-reg-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder="vous@exemple.com"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="auth-reg-password" className="block text-xs font-semibold text-jf-navy">
                  {isFr ? 'Mot de passe' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-reg-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder={isFr ? 'Minimum 8 caractères' : 'Minimum 8 characters'}
                    className="w-full pl-10 pr-11 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword
                        ? isFr
                          ? 'Masquer le mot de passe'
                          : 'Hide password'
                        : isFr
                          ? 'Afficher le mot de passe'
                          : 'Show password'
                    }
                    title={
                      showPassword
                        ? isFr
                          ? 'Masquer le mot de passe'
                          : 'Hide password'
                        : isFr
                          ? 'Afficher le mot de passe'
                          : 'Show password'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-jf-navy hover:bg-jf-ice transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {password.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1, 2, 3].map((step) => (
                        <div
                          key={step}
                          className={`h-1.5 rounded-full transition-colors ${
                            strength.level >= step ? strength.color : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="text-[11px] font-medium text-slate-600">{strength.label}</div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-reg-confirm-password"
                  className="block text-xs font-semibold text-jf-navy"
                >
                  {isFr ? 'Confirmer le mot de passe' : 'Confirm Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-reg-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder={isFr ? 'Retapez votre mot de passe' : 'Re-enter your password'}
                    className="w-full pl-10 pr-11 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={
                      showConfirmPassword
                        ? isFr
                          ? 'Masquer la confirmation du mot de passe'
                          : 'Hide confirm password'
                        : isFr
                          ? 'Afficher la confirmation du mot de passe'
                          : 'Show confirm password'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-jf-navy hover:bg-jf-ice transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <p className="text-[11px] font-medium text-rose-600">
                    {isFr ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-60 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isFr ? 'Envoi du code à 5 chiffres…' : 'Sending 5-digit code…'}</span>
                  </>
                ) : (
                  <span>
                    {isFr
                      ? 'Créer mon compte & recevoir le code'
                      : 'Create Account & Send 5-Digit Code'}
                  </span>
                )}
              </button>
            </form>
          )}

          {/* LOGIN FORM */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="auth-login-email" className="block text-xs font-semibold text-jf-navy">
                  {isFr ? 'Adresse e-mail' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder="vous@exemple.com"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-login-password"
                  className="block text-xs font-semibold text-jf-navy"
                >
                  {isFr ? 'Mot de passe' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      resetFormErrors();
                    }}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-11 py-2.5 text-sm bg-white border border-jf-border rounded-xl text-jf-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-jf-blue/30 focus:border-jf-blue"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword
                        ? isFr
                          ? 'Masquer le mot de passe'
                          : 'Hide password'
                        : isFr
                          ? 'Afficher le mot de passe'
                          : 'Show password'
                    }
                    title={
                      showPassword
                        ? isFr
                          ? 'Masquer le mot de passe'
                          : 'Hide password'
                        : isFr
                          ? 'Afficher le mot de passe'
                          : 'Show password'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-jf-navy hover:bg-jf-ice transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark disabled:opacity-60 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isFr ? 'Connexion en cours…' : 'Signing in…'}</span>
                  </>
                ) : (
                  <span>{isFr ? 'Se connecter' : 'Sign In'}</span>
                )}
              </button>
            </form>
          )}

          {/* 5-DIGIT CODE VERIFICATION FORM */}
          {mode === 'verify' && (
            <form onSubmit={handleVerifySubmit} className="space-y-5">
              <div className="flex items-center justify-center gap-2.5 sm:gap-3">
                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      digitRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    aria-label={`${isFr ? 'Chiffre' : 'Digit'} ${idx + 1}`}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    onPaste={handleDigitPaste}
                    className="w-12 h-14 sm:w-14 sm:h-16 text-center font-mono text-2xl font-bold text-jf-navy bg-jf-ice/60 border-2 border-jf-border rounded-xl focus:outline-none focus:border-jf-blue focus:bg-white focus:ring-2 focus:ring-jf-blue/25 transition-all"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={loading || codeValue.length !== 5}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isFr ? 'Validation du code…' : 'Verifying code…'}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isFr ? 'Valider mon compte' : 'Verify & Activate Account'}</span>
                  </>
                )}
              </button>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1 text-xs">
                <button
                  type="button"
                  disabled={cooldown > 0 || resendLoading}
                  onClick={handleResendCode}
                  className="font-semibold text-jf-blue hover:text-jf-navy disabled:text-slate-400 transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${resendLoading ? 'animate-spin' : ''}`} />
                  <span>
                    {cooldown > 0
                      ? isFr
                        ? `Renvoyer le code (${cooldown}s)`
                        : `Resend code (${cooldown}s)`
                      : isFr
                        ? 'Renvoyer un nouveau code à 5 chiffres'
                        : 'Resend 5-digit code'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    resetFormErrors();
                  }}
                  className="text-slate-500 hover:text-jf-navy inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{isFr ? 'Modifier l’e-mail' : 'Change email'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Optional Google OAuth Sign-In Divider (Step 1 only) */}
          {mode !== 'verify' && (
            <>
              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-jf-border" />
                <span className="shrink-0 px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  {isFr ? 'ou' : 'or'}
                </span>
                <div className="flex-grow border-t border-jf-border" />
              </div>

              <button
                type="button"
                disabled={googleLoading}
                onClick={handleGoogleClick}
                className="w-full py-2.5 px-4 text-sm font-semibold text-jf-navy bg-white hover:bg-jf-ice border border-jf-border-strong rounded-xl transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.28v3.1A12 12 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.3a7.18 7.18 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.76c1.76 0 3.34.61 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.28 6.6l4 3.1c.95-2.83 3.6-4.94 6.72-4.94z"
                  />
                </svg>
                <span>
                  {googleLoading
                    ? isFr
                      ? 'Connexion Google…'
                      : 'Connecting Google…'
                    : isFr
                      ? 'Continuer avec Google'
                      : 'Continue with Google'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
