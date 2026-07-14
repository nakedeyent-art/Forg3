import { type FormEvent, useEffect, useState } from 'react';
import { KeyRound, Loader2, LogOut, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { BrandMark } from './BrandMark';
import {
  AuthApiError,
  checkDeviceSecurity,
  firebaseConfigured,
  signIn,
  startDeviceVerification,
  startEmailSignIn,
  verifyDeviceCode,
  verifyEmailSignIn
} from '../lib/auth';
import type { AuthSession } from '../lib/types';

export function AuthControls({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [devCode, setDevCode] = useState('');
  const showProviderButtons = firebaseConfigured() || import.meta.env.DEV;

  const handleProviderSignIn = async (provider: 'google' | 'apple') => {
    setBusy(`auth-${provider}`);
    setMessage('');

    try {
      onSignedIn(await signIn(provider));
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleSendEmailCode = async (event: FormEvent) => {
    event.preventDefault();

    if (!email.trim()) {
      setMessage('Enter your email address.');
      return;
    }

    setBusy('email-start');
    setMessage('');
    setDevCode('');

    try {
      const response = await startEmailSignIn(email.trim(), name.trim() || undefined);
      setChallengeId(response.challengeId);
      setMessage(`Login code sent to ${email.trim()}.`);
      setDevCode(response.devCode || '');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleVerifyEmailCode = async (event: FormEvent) => {
    event.preventDefault();

    if (!challengeId || code.length !== 6) {
      return;
    }

    setBusy('email-verify');
    setMessage('');

    try {
      const session = await verifyEmailSignIn({
        email: email.trim(),
        name: name.trim() || undefined,
        challengeId,
        code,
        totpCode: totpRequired ? totpCode : undefined
      });
      onSignedIn(session);
    } catch (error) {
      if (error instanceof AuthApiError && error.totpRequired) {
        setTotpRequired(true);
      }
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="auth-stack">
      {showProviderButtons && (
        <div className="auth-buttons">
          <button type="button" onClick={() => void handleProviderSignIn('google')} disabled={busy === 'auth-google'}>
            {busy === 'auth-google' ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
            Google
          </button>
          <button type="button" onClick={() => void handleProviderSignIn('apple')} disabled={busy === 'auth-apple'}>
            {busy === 'auth-apple' ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
            Apple
          </button>
        </div>
      )}

      <form className="email-auth-form" onSubmit={challengeId ? handleVerifyEmailCode : handleSendEmailCode}>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={Boolean(challengeId)}
        />
        {!challengeId && (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
          />
        )}
        {challengeId && (
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Email code"
          />
        )}
        {challengeId && totpRequired && (
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Authenticator code"
          />
        )}
        <button type="submit" disabled={busy === 'email-start' || busy === 'email-verify'}>
          {busy === 'email-start' || busy === 'email-verify' ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          {challengeId ? 'Verify' : 'Email code'}
        </button>
      </form>
      {totpRequired && (
        <div className="inline-note">
          <Smartphone size={15} />
          This account requires a 6-digit code from its authenticator app.
        </div>
      )}
      {message && <div className="inline-note">{message}</div>}
      {devCode && <div className="inline-note">Local code: {devCode}</div>}
    </div>
  );
}

export function DeviceVerificationPanel({
  session,
  onVerified,
  onSignOut,
  context
}: {
  session: AuthSession;
  onVerified: () => void;
  onSignOut: () => void;
  context: 'account' | 'recipient' | 'document';
}) {
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('check');
  const [message, setMessage] = useState('');
  const [devCode, setDevCode] = useState('');

  useEffect(() => {
    let mounted = true;
    setBusy('check');
    setMessage('');

    checkDeviceSecurity()
      .then((status) => {
        if (!mounted) {
          return;
        }

        if (!status.required || status.trusted) {
          onVerified();
          return;
        }

        setMessage('Send a verification code to continue.');
      })
      .catch((error) => {
        if (mounted) {
          setMessage(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (mounted) {
          setBusy('');
        }
      });

    return () => {
      mounted = false;
    };
  }, [session.email]);

  const handleSendCode = async () => {
    setBusy('send-code');
    setMessage('');
    setDevCode('');

    try {
      const response = await startDeviceVerification();
      if (response.trusted) {
        onVerified();
        return;
      }
      setChallengeId(response.challengeId || '');
      setMessage(`Verification code sent to ${session.email}.`);
      setDevCode(response.devCode || '');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleVerifyCode = async (event: FormEvent) => {
    event.preventDefault();

    if (!challengeId || code.replace(/\D/g, '').length !== 6) {
      return;
    }

    setBusy('verify-code');
    setMessage('');

    try {
      await verifyDeviceCode(challengeId, code);
      onVerified();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const heading =
    context === 'document'
      ? 'Verify device to open document'
      : context === 'recipient'
        ? 'Verify device for recipient access'
        : 'Verify this device';

  return (
    <section className="complete-panel security-panel">
      <ShieldCheck size={42} />
      <h1>{heading}</h1>
      <p>{session.email}</p>

      <div className="security-actions">
        <button type="button" onClick={() => void handleSendCode()} disabled={busy === 'check' || busy === 'send-code'}>
          {busy === 'send-code' ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          {challengeId ? 'Send new code' : 'Send code'}
        </button>
        <button type="button" className="secondary-button" onClick={onSignOut}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>

      <form className="security-code-form" onSubmit={handleVerifyCode}>
        <label>
          <span>Verification code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
          />
        </label>
        <button className="primary-button" type="submit" disabled={!challengeId || code.length !== 6 || busy === 'verify-code'}>
          {busy === 'verify-code' ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
          Verify
        </button>
      </form>

      {message && <div className="inline-note">{message}</div>}
      {devCode && <div className="inline-note">Local code: {devCode}</div>}
    </section>
  );
}

export function DeviceVerificationScreen({
  session,
  onVerified,
  onSignOut,
  context
}: {
  session: AuthSession;
  onVerified: () => void;
  onSignOut: () => void;
  context: 'account' | 'recipient';
}) {
  return (
    <div className="signer-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>{context === 'recipient' ? 'Recipient verification' : 'Account verification'}</small>
          </span>
        </a>
        <div className="session-pill">
          <KeyRound size={15} />
          <span>{session.email}</span>
          <button type="button" className="icon-button" onClick={onSignOut} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <DeviceVerificationPanel session={session} onVerified={onVerified} onSignOut={onSignOut} context={context} />
    </div>
  );
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
