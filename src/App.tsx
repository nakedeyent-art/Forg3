import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Lock,
  LogOut,
  PenLine,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  createDocument,
  cancelSubscription,
  getSubscription,
  getPublicSigningDocument,
  getSignedDocument,
  listDocuments,
  rotateSigningLink,
  signDocument,
  startSubscription,
  voidDocument
} from './lib/api';
import { clearStoredSession, firebaseConfigured, getStoredSession, signIn } from './lib/auth';
import { downloadDataUrl, fileToDataUrl } from './lib/pdf';
import type {
  AuthSession,
  DocumentSummary,
  PlanId,
  PublicSigningDocument,
  SignedDocumentResponse,
  SubscriptionEntitlement,
  SubscriptionPlan
} from './lib/types';
import { SignaturePad } from './components/SignaturePad';

interface RouteState {
  kind: 'dashboard' | 'sign';
  token?: string;
}

interface CreateForm {
  title: string;
  signerName: string;
  signerEmail: string;
  expiresInHours: number;
}

const blankForm: CreateForm = {
  title: '',
  signerName: '',
  signerEmail: '',
  expiresInHours: 72
};

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route.kind === 'sign' && route.token) {
    return <SignerScreen token={route.token} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [form, setForm] = useState<CreateForm>(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [latestLink, setLatestLink] = useState<{ documentId: string; url: string } | null>(null);
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);

  const activeCount = useMemo(
    () => documents.filter((document) => document.status === 'sent').length,
    [documents]
  );
  const signedCount = useMemo(
    () => documents.filter((document) => document.status === 'signed').length,
    [documents]
  );

  useEffect(() => {
    if (!session) {
      setDocuments([]);
      setEntitlement(null);
      setPlans([]);
      return;
    }

    void refreshDocuments(setDocuments, setMessage);
    void refreshSubscription(setEntitlement, setPlans, setMessage);
  }, [session]);

  useEffect(() => {
    if (!latestLink) {
      return;
    }

    const linkedDocument = documents.find((document) => document.id === latestLink.documentId);

    if (linkedDocument && !linkedDocument.linkAvailable) {
      setLatestLink(null);
    }
  }, [documents, latestLink]);

  const handleSignIn = async (provider: 'google' | 'apple') => {
    setBusy(`auth-${provider}`);
    setMessage('');

    try {
      const nextSession = await signIn(provider);
      setSession(nextSession);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];

    if (!nextFile) {
      return;
    }

    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) {
      setMessage('Choose a PDF document.');
      return;
    }

    setBusy('file');
    setMessage('');

    try {
      const dataUrl = await fileToDataUrl(nextFile);
      setFile(nextFile);
      setFileDataUrl(dataUrl);
      setForm((current) => ({
        ...current,
        title: current.title || nextFile.name.replace(/\.pdf$/i, '')
      }));
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();

    if (!session) {
      setMessage('Sign in first.');
      return;
    }

    if (!entitlement?.active) {
      setMessage('Start a Forg3 subscription before creating signing links.');
      return;
    }

    if (!file || !fileDataUrl) {
      setMessage('Add a PDF first.');
      return;
    }

    if (!form.signerName || !form.signerEmail) {
      setMessage('Add the signer name and email.');
      return;
    }

    setBusy('create');
    setMessage('');

    try {
      const response = await createDocument({
        title: form.title.trim() || file.name.replace(/\.pdf$/i, ''),
        fileName: file.name,
        fileType: file.type || 'application/pdf',
        fileDataUrl,
        signerName: form.signerName.trim(),
        signerEmail: form.signerEmail.trim(),
        authProvider: session.provider,
        expiresInHours: form.expiresInHours
      });
      setLatestLink({ documentId: response.document.id, url: makeSigningUrl(response.signingPath) });
      setDocuments((current) => [response.document, ...current]);
      setForm(blankForm);
      setFile(null);
      setFileDataUrl('');
      setMessage('Signing link created.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleStartSubscription = async (planId: PlanId) => {
    if (!session) {
      setMessage('Sign in first.');
      return;
    }

    setBusy(`subscribe-${planId}`);
    setMessage('');

    try {
      const response = await startSubscription({
        planId,
        billingProvider: getBillingProviderForRuntime()
      });
      setEntitlement(response.entitlement);
      setPlans(response.plans);
      setMessage(`${response.entitlement.plan?.name || 'Subscription'} activated.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleCancelSubscription = async () => {
    if (!session) {
      return;
    }

    setBusy('cancel-subscription');
    setMessage('');

    try {
      const response = await cancelSubscription();
      setEntitlement(response.entitlement);
      setPlans(response.plans);
      setMessage('Subscription canceled.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleRotate = async (document: DocumentSummary) => {
    setBusy(`rotate-${document.id}`);
    setMessage('');

    try {
      const response = await rotateSigningLink(document.id, 72);
      setLatestLink({ documentId: response.document.id, url: makeSigningUrl(response.signingPath) });
      await refreshDocuments(setDocuments, setMessage);
      setMessage('New signing link created.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleVoid = async (document: DocumentSummary) => {
    setBusy(`void-${document.id}`);
    setMessage('');

    try {
      await voidDocument(document.id);
      await refreshDocuments(setDocuments, setMessage);
      setLatestLink((current) => (current?.documentId === document.id ? null : current));
      setMessage('Document voided.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleDownloadSigned = async (document: DocumentSummary) => {
    setBusy(`download-${document.id}`);
    setMessage('');

    try {
      const response = await getSignedDocument(document.id);
      downloadDataUrl(response.signedFileDataUrl, response.fileName);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const signOut = () => {
    clearStoredSession();
    setSession(null);
    setDocuments([]);
    setEntitlement(null);
    setPlans([]);
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <a className="brand" href="#/">
          <span className="brand-mark">
            <PenLine size={20} />
          </span>
          <span>
            <strong>Forg3 Sign</strong>
            <small>Subscription e-signature desk</small>
          </span>
        </a>

        <div className="top-actions">
          <span className="runtime-pill">
            <Smartphone size={15} />
            {getBillingRuntimeLabel()}
          </span>
          {session ? (
            <div className="session-pill">
              <KeyRound size={15} />
              <span>{session.name}</span>
              <button type="button" className="icon-button" onClick={signOut} title="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="auth-buttons">
              <button type="button" onClick={() => void handleSignIn('google')} disabled={busy === 'auth-google'}>
                <KeyRound size={16} />
                Google
              </button>
              <button type="button" onClick={() => void handleSignIn('apple')} disabled={busy === 'auth-apple'}>
                <KeyRound size={16} />
                Apple
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="compose-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">New packet</span>
              <h1>Send a PDF for signature</h1>
            </div>
            <ShieldCheck size={24} />
          </div>

          <form className="create-form" onSubmit={handleCreate}>
            <label className="dropzone">
              <input accept="application/pdf,.pdf" type="file" onChange={(event) => void handleFile(event)} />
              <Upload size={22} />
              <span>{file ? file.name : 'Choose PDF'}</span>
              {busy === 'file' && <Loader2 className="spin" size={17} />}
            </label>

            <label>
              <span>Document title</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Client agreement"
              />
            </label>

            <label>
              <span>Signer name</span>
              <input
                value={form.signerName}
                onChange={(event) => setForm((current) => ({ ...current, signerName: event.target.value }))}
                placeholder="Customer name"
              />
            </label>

            <label>
              <span>Signer email</span>
              <input
                type="email"
                value={form.signerEmail}
                onChange={(event) => setForm((current) => ({ ...current, signerEmail: event.target.value }))}
                placeholder="customer@example.com"
              />
            </label>

            <label>
              <span>Expires in hours</span>
              <input
                type="number"
                min={1}
                max={720}
                value={form.expiresInHours}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expiresInHours: Number(event.target.value) }))
                }
              />
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={busy === 'create' || !session || !entitlement?.active}
            >
              {busy === 'create' ? <Loader2 className="spin" size={17} /> : <LinkIcon size={17} />}
              Create link
            </button>
          </form>

          <div className="trust-strip">
            <span>
              <Lock size={15} />
              Hash-only links
            </span>
            <span>
              <Clock size={15} />
              Expiring tokens
            </span>
            <span>
              <ShieldCheck size={15} />
              No IP capture
            </span>
          </div>

          {!firebaseConfigured() && (
            <div className="inline-note">
              <AlertCircle size={16} />
              Google and Apple use local demo sessions until Firebase values are added.
            </div>
          )}
        </section>

        <section className="documents-panel">
          <SubscriptionPanel
            busy={busy}
            entitlement={entitlement}
            onCancel={() => void handleCancelSubscription()}
            onStart={(planId) => void handleStartSubscription(planId)}
            plans={plans}
            signedIn={Boolean(session)}
          />

          <div className="stats-grid">
            <StatCard label="Active" value={activeCount} tone="blue" />
            <StatCard label="Signed" value={signedCount} tone="green" />
            <StatCard label="Total" value={documents.length} tone="gold" />
          </div>

          {latestLink && (
            <div className="link-banner">
              <LinkIcon size={19} />
              <input value={latestLink.url} readOnly aria-label="Latest signing link" />
              <button type="button" onClick={() => void copyText(latestLink.url, setMessage)} title="Copy link">
                <Copy size={17} />
              </button>
              <button
                type="button"
                onClick={() => window.open(latestLink.url, '_blank', 'noopener,noreferrer')}
                title="Open link"
              >
                <ExternalLink size={17} />
              </button>
            </div>
          )}

          <div className="documents-table">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Documents</span>
                <h2>Signature queue</h2>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void refreshDocuments(setDocuments, setMessage)}
              >
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>

            {documents.length === 0 ? (
              <div className="empty-state">
                <FileText size={32} />
                <p>No documents yet.</p>
              </div>
            ) : (
              <div className="document-list">
                {documents.map((document) => (
                  <article className="document-row" key={document.id}>
                    <div className="document-main">
                      <FileText size={20} />
                      <div>
                        <h3>{document.title}</h3>
                        <p>
                          {document.signerName} - {document.signerEmail}
                        </p>
                        <small>Expires {formatDate(document.expiresAt)}</small>
                      </div>
                    </div>
                    <StatusChip status={document.status} />
                    <div className="row-actions">
                      {document.status === 'signed' && (
                        <button
                          type="button"
                          onClick={() => void handleDownloadSigned(document)}
                          title="Download signed PDF"
                        >
                          <Download size={16} />
                        </button>
                      )}
                      {document.status === 'sent' || document.status === 'expired' ? (
                        <button
                          type="button"
                          onClick={() => void handleRotate(document)}
                          disabled={busy === `rotate-${document.id}`}
                          title="Create new link"
                        >
                          {busy === `rotate-${document.id}` ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <RefreshCcw size={16} />
                          )}
                        </button>
                      ) : null}
                      {document.status === 'sent' || document.status === 'expired' ? (
                        <button
                          type="button"
                          onClick={() => void handleVoid(document)}
                          disabled={busy === `void-${document.id}`}
                          title="Void link"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {message && (
        <div className="toast">
          <span>{message}</span>
          <button type="button" className="icon-button" onClick={() => setMessage('')} title="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function SubscriptionPanel({
  busy,
  entitlement,
  onCancel,
  onStart,
  plans,
  signedIn
}: {
  busy: string;
  entitlement: SubscriptionEntitlement | null;
  onCancel: () => void;
  onStart: (planId: PlanId) => void;
  plans: SubscriptionPlan[];
  signedIn: boolean;
}) {
  const activePlan = entitlement?.active ? entitlement.plan : null;
  const usageSummary = entitlement?.usageSummary;

  return (
    <section className="billing-panel">
      <div className="billing-summary">
        <div>
          <span className="eyebrow">Subscription</span>
          <h2>{activePlan ? activePlan.name : 'Choose a plan'}</h2>
          <p>
            {activePlan
              ? `Active until ${formatDate(entitlement?.subscription?.renewsAt || '')}`
              : 'A subscription is required to create signing links.'}
          </p>
        </div>
        <span className={`billing-badge ${entitlement?.active ? 'active' : 'inactive'}`}>
          <CreditCard size={15} />
          {entitlement?.active ? 'active' : entitlement?.status || 'inactive'}
        </span>
      </div>

      {activePlan ? (
        <div className="billing-active-row">
          <div className="billing-active-copy">
            <strong>
              {activePlan.priceLabel}/{activePlan.cadence}
            </strong>
            <span>{activePlan.seatLimit} owner seat{activePlan.seatLimit === 1 ? '' : 's'}</span>
            {activePlan.usagePriceLabel && <span>+ {activePlan.usagePriceLabel}</span>}
            {activePlan.billingNote && <span>{activePlan.billingNote}</span>}
          </div>
          {activePlan.billingModel === 'metered' && usageSummary && (
            <div className="billing-meter">
              <span>Metered signatures</span>
              <strong>{usageSummary.signatureCount}</strong>
              <small>{usageSummary.totalUsageLabel} usage total</small>
            </div>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={busy === 'cancel-subscription'}
          >
            {busy === 'cancel-subscription' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
            Cancel
          </button>
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.id}>
              <div>
                <h3>{plan.name}</h3>
                <p>
                  <strong>{plan.priceLabel}</strong>/{plan.cadence}
                </p>
                {plan.usagePriceLabel && <span className="usage-line">+ {plan.usagePriceLabel}</span>}
                {plan.billingNote && <small className="plan-note">{plan.billingNote}</small>}
              </div>
              <ul>
                {plan.features.slice(0, 3).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button
                className="primary-button"
                type="button"
                onClick={() => onStart(plan.id)}
                disabled={!signedIn || busy === `subscribe-${plan.id}`}
              >
                {busy === `subscribe-${plan.id}` ? <Loader2 className="spin" size={17} /> : <CreditCard size={17} />}
                {getBillingButtonLabel()}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SignerScreen({ token }: { token: string }) {
  const [document, setDocument] = useState<PublicSigningDocument | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signerNameConfirmation, setSignerNameConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('load');
  const [message, setMessage] = useState('');
  const [signedResult, setSignedResult] = useState<SignedDocumentResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    setBusy('load');
    setMessage('');

    getPublicSigningDocument(token)
      .then((response) => {
        if (!mounted) {
          return;
        }

        setDocument(response.document);
        setFileDataUrl(response.fileDataUrl);
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
  }, [token]);

  const handleSign = async (event: FormEvent) => {
    event.preventDefault();

    if (!document || !signatureDataUrl || !consent || !namesMatch(signerNameConfirmation, document.signerName)) {
      return;
    }

    setBusy('sign');
    setMessage('');

    try {
      const result = await signDocument(token, {
        signatureDataUrl,
        signerNameConfirmation,
        consentText: `${document.signerName} accepted electronic signature consent at ${new Date().toISOString()}`
      });
      setSignedResult(result);
      setMessage('Signed. This link is sealed.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="signer-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <span className="brand-mark">
            <PenLine size={20} />
          </span>
          <span>
            <strong>Forg3 Sign</strong>
            <small>Secure signing room</small>
          </span>
        </a>
        <span className="runtime-pill">
          <Lock size={15} />
          Single-use link
        </span>
      </header>

      {busy === 'load' ? (
        <div className="center-state">
          <Loader2 className="spin" size={28} />
        </div>
      ) : signedResult ? (
        <section className="complete-panel">
          <CheckCircle size={42} />
          <h1>Document signed</h1>
          <p>The signing link has been sealed and will not reopen this packet.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => downloadDataUrl(signedResult.signedFileDataUrl, signedResult.fileName)}
          >
            <Download size={17} />
            Download copy
          </button>
        </section>
      ) : message && !document ? (
        <section className="complete-panel error-panel">
          <AlertCircle size={42} />
          <h1>Link unavailable</h1>
          <p>{message}</p>
        </section>
      ) : document ? (
        <main className="signer-workspace">
          <section className="preview-panel">
            <div className="preview-heading">
              <div>
                <span className="eyebrow">Review</span>
                <h1>{document.title}</h1>
              </div>
              <StatusChip status="sent" />
            </div>
            <iframe title={document.title} src={fileDataUrl} />
          </section>

          <form className="signature-panel" onSubmit={handleSign}>
            <div>
              <span className="eyebrow">Signer</span>
              <h2>{document.signerName}</h2>
              <p>{document.signerEmail}</p>
              <small>Expires {formatDate(document.expiresAt)}</small>
            </div>

            <div className="signature-input-heading">
              <span>Draw signature</span>
              <small>Finger, stylus, mouse, or touchpad</small>
            </div>
            <SignaturePad onChange={setSignatureDataUrl} />

            <label>
              <span>Type signer name</span>
              <input
                value={signerNameConfirmation}
                onChange={(event) => setSignerNameConfirmation(event.target.value)}
                placeholder={document.signerName}
              />
            </label>

            <label className="consent-row">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>I agree to sign this document electronically.</span>
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={
                !signatureDataUrl ||
                !consent ||
                !namesMatch(signerNameConfirmation, document.signerName) ||
                busy === 'sign'
              }
            >
              {busy === 'sign' ? <Loader2 className="spin" size={17} /> : <PenLine size={17} />}
              Sign document
            </button>

            {message && <div className="inline-note">{message}</div>}
          </form>
        </main>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'green' | 'gold' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusChip({ status }: { status: DocumentSummary['status'] }) {
  const icon =
    status === 'signed' ? <CheckCircle size={14} /> : status === 'expired' ? <Clock size={14} /> : <LinkIcon size={14} />;

  return (
    <span className={`status-chip ${status}`}>
      {icon}
      {status}
    </span>
  );
}

async function refreshDocuments(
  setDocuments: (documents: DocumentSummary[]) => void,
  setMessage: (message: string) => void
) {
  try {
    const response = await listDocuments();
    setDocuments(response.documents);
  } catch (error) {
    setMessage(getErrorMessage(error));
  }
}

async function refreshSubscription(
  setEntitlement: (entitlement: SubscriptionEntitlement) => void,
  setPlans: (plans: SubscriptionPlan[]) => void,
  setMessage: (message: string) => void
) {
  try {
    const response = await getSubscription();
    setEntitlement(response.entitlement);
    setPlans(response.plans);
  } catch (error) {
    setMessage(getErrorMessage(error));
  }
}

async function copyText(value: string, setMessage: (message: string) => void) {
  await navigator.clipboard.writeText(value);
  setMessage('Copied.');
}

function parseRoute(): RouteState {
  const hash = window.location.hash.replace(/^#\/?/, '');

  if (hash.startsWith('sign/')) {
    return { kind: 'sign', token: hash.slice('sign/'.length) };
  }

  return { kind: 'dashboard' };
}

function makeSigningUrl(path: string) {
  return `${window.location.origin}${window.location.pathname}#${path}`;
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function getBillingProviderForRuntime() {
  return 'demo' as const;
}

function getBillingButtonLabel() {
  return import.meta.env.DEV ? 'Start demo' : 'Verify purchase';
}

function getBillingRuntimeLabel() {
  return import.meta.env.DEV ? 'Demo billing' : 'Store billing pending';
}

function namesMatch(left: string, right: string) {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();
}
