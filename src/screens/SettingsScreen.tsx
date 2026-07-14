import { type FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileText,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Trash2,
  X
} from 'lucide-react';
import {
  activateTotp,
  deleteAccount,
  disableTotp,
  enrollTotp,
  exportAccountData,
  getTotpStatus,
  listAuditEvents,
  listSessions,
  listTrustedDevices,
  revokeAllSessions,
  revokeSession,
  revokeTrustedDevice
} from '../lib/api';
import { clearStoredSession, getStoredSession } from '../lib/auth';
import { BrandMark } from '../components/BrandMark';
import type {
  AuditEventSummary,
  AuthSession,
  OwnerSessionSummary,
  TotpStatus,
  TrustedDeviceSummary
} from '../lib/types';
import { AuthControls, DeviceVerificationScreen, getErrorMessage } from '../components/AuthPanels';

export function SettingsScreen() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [sessions, setSessions] = useState<OwnerSessionSummary[]>([]);
  const [devices, setDevices] = useState<TrustedDeviceSummary[]>([]);
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpOtpauthUrl, setTotpOtpauthUrl] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [auditEvents, setAuditEvents] = useState<AuditEventSummary[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDeviceVerified(false);
  }, [session?.uid, session?.email]);

  useEffect(() => {
    if (!session || !deviceVerified) {
      return;
    }

    void refreshAll();
  }, [session, deviceVerified]);

  const refreshAll = async () => {
    setBusy('refresh');

    try {
      const [sessionsResponse, devicesResponse, totpResponse, auditResponse] = await Promise.all([
        listSessions(),
        listTrustedDevices(),
        getTotpStatus(),
        listAuditEvents()
      ]);
      setSessions(sessionsResponse.sessions);
      setDevices(devicesResponse.devices);
      setTotp(totpResponse);
      setAuditEvents(auditResponse.events);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const signOut = () => {
    clearStoredSession();
    setSession(null);
    setDeviceVerified(false);
  };

  const handleRevokeSession = async (sessionId: string) => {
    setBusy(`session-${sessionId}`);
    setMessage('');

    try {
      await revokeSession(sessionId);
      const response = await listSessions();
      setSessions(response.sessions);
      setMessage('Session signed out.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleRevokeAll = async () => {
    setBusy('revoke-all');
    setMessage('');

    try {
      await revokeAllSessions();
      signOut();
    } catch (error) {
      setMessage(getErrorMessage(error));
      setBusy('');
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setBusy(`device-${deviceId}`);
    setMessage('');

    try {
      await revokeTrustedDevice(deviceId);
      const response = await listTrustedDevices();
      setDevices(response.devices);
      setMessage('Trusted device removed. It will need two-factor verification again.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleEnrollTotp = async () => {
    setBusy('totp-enroll');
    setMessage('');

    try {
      const response = await enrollTotp();
      setTotpSecret(response.secret);
      setTotpOtpauthUrl(response.otpauthUrl);
      setTotp({ enabled: false, pending: true });
      setMessage('Add the secret to your authenticator app, then enter a code to activate.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleActivateTotp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('totp-activate');
    setMessage('');

    try {
      await activateTotp(totpCode);
      setTotp({ enabled: true, pending: false });
      setTotpSecret('');
      setTotpOtpauthUrl('');
      setTotpCode('');
      setMessage('Authenticator app is active. It is now required at every login.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleDisableTotp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('totp-disable');
    setMessage('');

    try {
      await disableTotp(totpCode);
      setTotp({ enabled: false, pending: false });
      setTotpCode('');
      setMessage('Authenticator app was disabled.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleExport = async () => {
    setBusy('export');
    setMessage('');

    try {
      const data = await exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `forg3-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Account export downloaded.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleDelete = async (event: FormEvent) => {
    event.preventDefault();

    setBusy('delete');
    setMessage('');

    try {
      const response = await deleteAccount(deleteConfirm.trim());
      setMessage(`Account data deleted (${response.documentsRemoved} documents removed).`);
      signOut();
    } catch (error) {
      setMessage(getErrorMessage(error));
      setBusy('');
    }
  };

  if (session && !deviceVerified) {
    return (
      <DeviceVerificationScreen
        session={session}
        onVerified={() => setDeviceVerified(true)}
        onSignOut={signOut}
        context="account"
      />
    );
  }

  return (
    <div className="signer-shell settings-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>Account and security</small>
          </span>
        </a>
        <div className="top-actions">
          <a className="secondary-button top-link" href="#/">
            <FileText size={15} />
            Sender desk
          </a>
          {session && (
            <div className="session-pill">
              <KeyRound size={15} />
              <span>{session.email}</span>
              <button type="button" className="icon-button" onClick={signOut} title="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </header>

      {!session ? (
        <section className="complete-panel inbox-auth-panel">
          <ShieldCheck size={42} />
          <h1>Sign in to manage your account</h1>
          <p>Security, devices, sessions, and data controls live here.</p>
          <AuthControls onSignedIn={setSession} />
          {message && <div className="inline-note">{message}</div>}
        </section>
      ) : (
        <main className="settings-workspace">
          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Profile</span>
                <h2>{session.name}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => void refreshAll()} disabled={busy === 'refresh'}>
                {busy === 'refresh' ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                Refresh
              </button>
            </div>
            <p className="settings-profile-line">
              Signed in as <strong>{session.email}</strong>. Login uses an emailed one-time code
              {totp?.enabled ? ' plus your authenticator app' : ''}, and new devices require two-factor verification.
            </p>
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Two-factor</span>
                <h2>Authenticator app</h2>
              </div>
              <Smartphone size={20} />
            </div>

            {totp?.enabled ? (
              <form className="settings-inline-form" onSubmit={handleDisableTotp}>
                <p>
                  An authenticator app is <strong>active</strong> and required at every login
                  {totp.activatedAt ? ` since ${formatDate(totp.activatedAt)}` : ''}.
                </p>
                <div className="settings-inline-controls">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Code to disable"
                  />
                  <button className="secondary-button" type="submit" disabled={totpCode.length !== 6 || busy === 'totp-disable'}>
                    {busy === 'totp-disable' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                    Disable
                  </button>
                </div>
              </form>
            ) : totpSecret || totp?.pending ? (
              <form className="settings-inline-form" onSubmit={handleActivateTotp}>
                {totpSecret ? (
                  <>
                    <p>Add this secret to Google Authenticator, 1Password, Authy, or Apple Passwords:</p>
                    <code className="settings-secret">{totpSecret}</code>
                    {totpOtpauthUrl && (
                      <a className="settings-otpauth" href={totpOtpauthUrl}>
                        Open in authenticator app
                      </a>
                    )}
                  </>
                ) : (
                  <p>Enrollment is pending. Enter a code from your authenticator app to activate, or restart enrollment.</p>
                )}
                <div className="settings-inline-controls">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                  />
                  <button className="primary-button" type="submit" disabled={totpCode.length !== 6 || busy === 'totp-activate'}>
                    {busy === 'totp-activate' ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                    Activate
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void handleEnrollTotp()} disabled={busy === 'totp-enroll'}>
                    New secret
                  </button>
                </div>
              </form>
            ) : (
              <div className="settings-inline-form">
                <p>
                  Add a second factor beyond email. Once active, every login also requires a 6-digit code from your
                  authenticator app — even if someone controls your email inbox.
                </p>
                <button className="primary-button settings-fit-button" type="button" onClick={() => void handleEnrollTotp()} disabled={busy === 'totp-enroll'}>
                  {busy === 'totp-enroll' ? <Loader2 className="spin" size={16} /> : <Smartphone size={16} />}
                  Set up authenticator app
                </button>
              </div>
            )}
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Sessions</span>
                <h2>Where you are signed in</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => void handleRevokeAll()} disabled={busy === 'revoke-all'}>
                {busy === 'revoke-all' ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
                Sign out everywhere
              </button>
            </div>
            {sessions.filter((item) => item.active).length === 0 ? (
              <div className="empty-state">
                <p>No active sessions recorded yet. Sessions appear after email-code logins.</p>
              </div>
            ) : (
              <div className="document-list">
                {sessions
                  .filter((item) => item.active)
                  .map((item) => (
                    <article className="document-row" key={item.id}>
                      <div className="document-main">
                        <Laptop size={18} />
                        <div>
                          <h3>
                            {item.deviceName || 'Unknown device'}
                            {item.current ? ' (this session)' : ''}
                          </h3>
                          <p>Signed in {formatDate(item.createdAt)}</p>
                          <small>Expires {formatDate(item.expiresAt)}</small>
                        </div>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          onClick={() => void handleRevokeSession(item.id)}
                          disabled={busy === `session-${item.id}`}
                          title="Sign out this session"
                        >
                          {busy === `session-${item.id}` ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Trusted devices</span>
                <h2>Devices that skip two-factor</h2>
              </div>
              <ShieldCheck size={20} />
            </div>
            {devices.length === 0 ? (
              <div className="empty-state">
                <p>No trusted devices. Each device is trusted after completing email two-factor verification.</p>
              </div>
            ) : (
              <div className="document-list">
                {devices.map((device) => (
                  <article className="document-row" key={device.id}>
                    <div className="document-main">
                      <Smartphone size={18} />
                      <div>
                        <h3>{device.deviceName}</h3>
                        <p>Trusted {formatDate(device.trustedAt)} · Last seen {formatDate(device.lastSeenAt)}</p>
                        <small>Trust expires {formatDate(device.expiresAt)}</small>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => void handleRevokeDevice(device.id)}
                        disabled={busy === `device-${device.id}`}
                        title="Remove trusted device"
                      >
                        {busy === `device-${device.id}` ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Security activity</span>
                <h2>Audit trail</h2>
              </div>
              <ScrollText size={20} />
            </div>
            {auditEvents.length === 0 ? (
              <div className="empty-state">
                <p>No security events recorded yet.</p>
              </div>
            ) : (
              <div className="audit-list">
                {auditEvents.slice(0, 25).map((event) => (
                  <div className="audit-row" key={event.id}>
                    <span className="audit-type">{event.type}</span>
                    <span className="audit-message">{event.message}</span>
                    <small>{formatDate(event.createdAt)}</small>
                  </div>
                ))}
              </div>
            )}
            <p className="settings-footnote">
              Events are hash-chained: each entry commits to the one before it, so tampering is detectable.
            </p>
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Your data</span>
                <h2>Export or delete</h2>
              </div>
              <Download size={20} />
            </div>
            <div className="settings-inline-form">
              <p>Download a JSON export of your documents metadata, deliveries, devices, sessions, and audit trail.</p>
              <button className="secondary-button settings-fit-button" type="button" onClick={() => void handleExport()} disabled={busy === 'export'}>
                {busy === 'export' ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                Export account data
              </button>
            </div>
            <form className="settings-inline-form settings-danger" onSubmit={handleDelete}>
              <p>
                <AlertCircle size={15} /> Permanently delete this account&apos;s documents, files, subscription, devices,
                and audit history. This cannot be undone.
              </p>
              <div className="settings-inline-controls">
                <input
                  type="email"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  placeholder={`Type ${session.email} to confirm`}
                />
                <button
                  className="secondary-button danger-button"
                  type="submit"
                  disabled={deleteConfirm.trim().toLowerCase() !== session.email.toLowerCase() || busy === 'delete'}
                >
                  {busy === 'delete' ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                  Delete account data
                </button>
              </div>
            </form>
          </section>

          <section className="documents-table settings-card">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Legal</span>
                <h2>Terms and privacy</h2>
              </div>
              <FileText size={20} />
            </div>
            <div className="settings-legal-links">
              <a href="#/terms">Terms of service</a>
              <a href="#/privacy">Privacy policy</a>
            </div>
          </section>

          {message && (
            <div className="toast">
              <span>{message}</span>
              <button type="button" className="icon-button" onClick={() => setMessage('')} title="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function formatDate(value: string) {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}
