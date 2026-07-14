import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AlertCircle,
  BookOpen,
  Building2,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Fingerprint,
  FileCheck2,
  FileText,
  Inbox,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Lock,
  LogOut,
  PenLine,
  RefreshCcw,
  ReceiptText,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  createDocument,
  createTemplate,
  cancelSubscription,
  addCompanyMember,
  getAssignedSigningDocument,
  getCompany,
  getFeatureStatus,
  getSubscription,
  getPublicSigningDocument,
  getSignedDocument,
  listEmailDeliveries,
  listSignerDocuments,
  listTemplates,
  listDocuments,
  rotateSigningLink,
  sendReminder,
  signAssignedDocument,
  signDocument,
  startSubscription,
  verifySubscription,
  voidDocument
} from './lib/api';
import {
  clearStoredSession,
  firebaseConfigured,
  getStoredSession,
  signIn
} from './lib/auth';
import {
  manageNativeSubscriptions,
  purchaseNativeSubscription,
  restoreNativePurchases,
  type NativeBillingPurchase
} from './lib/nativeBilling';
import { AuthControls, DeviceVerificationPanel, DeviceVerificationScreen } from './components/AuthPanels';
import { BrandMark } from './components/BrandMark';
import { PdfPreview } from './components/PdfPreview';
import { SettingsScreen } from './screens/SettingsScreen';
import { LegalScreen } from './screens/LegalScreen';
import { downloadDataUrl, fileToDataUrl } from './lib/pdf';
import type {
  AuthSession,
  BillingProvider,
  CompanyProfile,
  DocumentTemplate,
  DocumentSummary,
  EmailDelivery,
  FeatureStatus,
  PlanId,
  PublicSigningDocument,
  SignerInboxDocument,
  SignedDocumentResponse,
  SignatureFieldPlacement,
  SubscriptionEntitlement,
  SubscriptionPlan
} from './lib/types';
import { SignaturePad } from './components/SignaturePad';

interface RouteState {
  kind: 'dashboard' | 'sign' | 'inbox' | 'assigned-sign' | 'settings' | 'terms' | 'privacy';
  token?: string;
  documentId?: string;
  signerId?: string;
}

interface CreateForm {
  title: string;
  signerName: string;
  signerEmail: string;
  additionalSigners: Array<{ name: string; email: string; role?: string }>;
  expiresInHours: number;
  signatureField: SignatureFieldPlacement;
  identityVerificationRequired: boolean;
}

const blankForm: CreateForm = {
  title: '',
  signerName: '',
  signerEmail: '',
  additionalSigners: [],
  expiresInHours: 72,
  signatureField: {
    page: 'last',
    xPercent: 4,
    yPercent: 4,
    widthPercent: 88
  },
  identityVerificationRequired: false
};

const manualTierRows = [
  {
    feature: 'Base price',
    payPerSignature: '$12/year',
    pro: '$19/month',
    business: '$49/month'
  },
  {
    feature: 'Usage charge',
    payPerSignature: '$0.99 per completed signature',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Best fit',
    payPerSignature: 'Occasional sending',
    pro: 'Consistent single-owner use',
    business: 'Highest-tier unlimited use'
  },
  {
    feature: 'Unlimited access',
    payPerSignature: 'No - metered per completed signature',
    pro: 'No - capped below highest tier',
    business: 'Yes'
  },
  {
    feature: 'Owner seats',
    payPerSignature: '1',
    pro: '1',
    business: '5 planned seats'
  },
  {
    feature: 'PDF upload and signing links',
    payPerSignature: 'Included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Drawn or typed signatures',
    payPerSignature: 'Included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Expiring single-use links',
    payPerSignature: 'Included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Signed PDF download',
    payPerSignature: 'Included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Audit certificate page',
    payPerSignature: 'Included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Email delivery',
    payPerSignature: 'Local outbox',
    pro: 'Provider delivery + reminders',
    business: 'Provider delivery + reminders'
  },
  {
    feature: 'Multi-signer routing',
    payPerSignature: 'Not included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Drag-and-drop field placement',
    payPerSignature: 'Default placement',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'ID verification',
    payPerSignature: 'Not included',
    pro: 'Not included',
    business: 'Self-attestation; provider-ready'
  },
  {
    feature: 'Payment receipt verification',
    payPerSignature: 'Provider-ready',
    pro: 'Provider-ready',
    business: 'Provider-ready'
  },
  {
    feature: 'Production object storage',
    payPerSignature: 'Local object store',
    pro: 'Local object store',
    business: 'Provider-ready'
  },
  {
    feature: 'Company admin controls',
    payPerSignature: 'Not included',
    pro: 'Not included',
    business: 'Included'
  },
  {
    feature: 'Templates',
    payPerSignature: 'Not included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'Reminders',
    payPerSignature: 'Not included',
    pro: 'Included',
    business: 'Included'
  },
  {
    feature: 'CA-backed PDF signatures',
    payPerSignature: 'Not included',
    pro: 'Not included',
    business: 'Provider-ready'
  },
  {
    feature: 'Priority audit exports',
    payPerSignature: 'Not included',
    pro: 'Not included',
    business: 'Planned'
  }
];

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route.kind === 'sign' && route.token) {
    return <SignerScreen access={{ kind: 'token', token: route.token }} />;
  }

  if (route.kind === 'assigned-sign' && route.documentId && route.signerId) {
    return <SignerScreen access={{ kind: 'assigned', documentId: route.documentId, signerId: route.signerId }} />;
  }

  if (route.kind === 'inbox') {
    return <RecipientInboxScreen />;
  }

  if (route.kind === 'settings') {
    return <SettingsScreen />;
  }

  if (route.kind === 'terms' || route.kind === 'privacy') {
    return <LegalScreen page={route.kind} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [form, setForm] = useState<CreateForm>(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [latestLinks, setLatestLinks] = useState<Array<{ documentId: string; signerName: string; signerEmail: string; url: string }>>([]);
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [featureStatus, setFeatureStatus] = useState<FeatureStatus | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [deliveries, setDeliveries] = useState<EmailDelivery[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [companyMember, setCompanyMember] = useState({ name: '', email: '', role: 'viewer' as 'admin' | 'sender' | 'viewer' });

  const activeCount = useMemo(
    () => documents.filter((document) => document.status === 'sent').length,
    [documents]
  );
  const signedCount = useMemo(
    () => documents.filter((document) => document.status === 'signed').length,
    [documents]
  );

  useEffect(() => {
    if (!session || !deviceVerified) {
      setDocuments([]);
      setEntitlement(null);
      setPlans([]);
      setFeatureStatus(null);
      setCapabilities({});
      setDeliveries([]);
      setTemplates([]);
      setCompany(null);
      return;
    }

    void refreshDocuments(setDocuments, setMessage);
    void refreshSubscription(setEntitlement, setPlans, setMessage);
    void refreshFeatureSuite(setFeatureStatus, setCapabilities, setDeliveries, setTemplates, setCompany);
  }, [session, deviceVerified]);

  useEffect(() => {
    setDeviceVerified(false);
  }, [session?.uid, session?.email]);

  useEffect(() => {
    if (!latestLinks.length) {
      return;
    }

    const liveDocumentIds = new Set(documents.filter((document) => document.linkAvailable).map((document) => document.id));

    setLatestLinks((current) => current.filter((link) => liveDocumentIds.has(link.documentId)));
  }, [documents, latestLinks.length]);

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
      const signers = [
        { name: form.signerName.trim(), email: form.signerEmail.trim(), role: 'Signer' },
        ...form.additionalSigners
          .map((signer) => ({
            name: signer.name.trim(),
            email: signer.email.trim(),
            role: signer.role?.trim() || 'Signer'
          }))
          .filter((signer) => signer.name && signer.email)
      ];
      const response = await createDocument({
        title: form.title.trim() || file.name.replace(/\.pdf$/i, ''),
        fileName: file.name,
        fileType: file.type || 'application/pdf',
        fileDataUrl,
        signerName: form.signerName.trim(),
        signerEmail: form.signerEmail.trim(),
        signers,
        signatureField: form.signatureField,
        identityVerificationRequired: form.identityVerificationRequired,
        authProvider: session.provider,
        expiresInHours: form.expiresInHours
      });
      setLatestLinks(linksFromResponse(response));
      if (response.deliveries?.length) {
        setDeliveries((current) => [...response.deliveries!, ...current].slice(0, 25));
      }
      setDocuments((current) => [response.document, ...current]);
      setForm(blankForm);
      setFile(null);
      setFileDataUrl('');
      await refreshFeatureSuite(setFeatureStatus, setCapabilities, setDeliveries, setTemplates, setCompany);
      setMessage(
        response.deliveries?.length
          ? `${response.deliveries.length} delivery record${response.deliveries.length === 1 ? '' : 's'} created.`
          : response.signingLinks.length > 1
            ? 'Multi-signer links created.'
            : 'Signing link created.'
      );
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
      const billingProvider = getBillingProviderForRuntime();
      const response =
        billingProvider === 'demo'
          ? await startSubscription({ planId, billingProvider })
          : await verifySubscription({
              planId,
              billingProvider,
              ...(await requestNativePurchase(planId, billingProvider, plans))
            });
      setEntitlement(response.entitlement);
      setPlans(response.plans);
      await refreshFeatureSuite(setFeatureStatus, setCapabilities, setDeliveries, setTemplates, setCompany);
      setMessage(`${response.entitlement.plan?.name || 'Subscription'} activated.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleRestoreSubscription = async () => {
    if (!session) {
      setMessage('Sign in first.');
      return;
    }

    setBusy('restore-subscription');
    setMessage('');

    try {
      const billingProvider = getBillingProviderForRuntime();
      if (billingProvider !== 'apple_app_store' && billingProvider !== 'google_play') {
        throw new Error('Restore purchases is only available inside the iOS and Android apps.');
      }

      const restored = await restoreNativePurchases({ billingProvider });
      const restoredPurchase = restored.purchases
        .map((purchase) => ({ purchase, plan: findPlanForNativePurchase(purchase, billingProvider, plans) }))
        .find((entry) => Boolean(entry.plan));

      if (!restoredPurchase?.plan) {
        throw new Error('No active Forg3 store subscription was found for this account.');
      }

      const response = await verifySubscription({
        planId: restoredPurchase.plan.id,
        billingProvider,
        ...restoredPurchase.purchase
      });
      setEntitlement(response.entitlement);
      setPlans(response.plans);
      await refreshFeatureSuite(setFeatureStatus, setCapabilities, setDeliveries, setTemplates, setCompany);
      setMessage(`${response.entitlement.plan?.name || 'Subscription'} restored.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleManageSubscription = async () => {
    const billingProvider = getBillingProviderForRuntime();
    const productId = entitlement?.plan
      ? billingProvider === 'apple_app_store'
        ? entitlement.plan.appleProductId
        : billingProvider === 'google_play'
          ? entitlement.plan.googleProductId
          : undefined
      : undefined;

    setBusy('manage-subscription');
    setMessage('');

    try {
      await manageNativeSubscriptions({ productId });
      setMessage('Subscription management opened.');
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
      setLatestLinks(linksFromResponse(response));
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
      setLatestLinks((current) => current.filter((link) => link.documentId !== document.id));
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
      if (!response.signedFileDataUrl) {
        throw new Error('Signed PDF is not available yet.');
      }
      downloadDataUrl(response.signedFileDataUrl, response.fileName);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleReminder = async (document: DocumentSummary) => {
    setBusy(`remind-${document.id}`);
    setMessage('');

    try {
      const response = await sendReminder(document.id);
      setDeliveries((current) => [...response.deliveries, ...current].slice(0, 25));
      setLatestLinks(linksFromResponse({ document, signingLinks: response.signingLinks }));
      setMessage(`${response.deliveries.length} reminder${response.deliveries.length === 1 ? '' : 's'} queued.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const handleSaveTemplate = async () => {
    if (!form.title.trim()) {
      setMessage('Add a document title before saving a template.');
      return;
    }

    setBusy('save-template');
    setMessage('');

    try {
      const response = await createTemplate({
        name: form.title.trim(),
        title: form.title.trim(),
        signers: [
          { name: form.signerName || 'Signer', email: form.signerEmail || 'signer@example.com', role: 'Signer' },
          ...form.additionalSigners
        ],
        expiresInHours: form.expiresInHours,
        signatureField: form.signatureField,
        identityVerificationRequired: form.identityVerificationRequired
      });
      setTemplates((current) => [response.template, ...current]);
      setMessage('Template saved.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy('');
    }
  };

  const applyTemplate = (template: DocumentTemplate) => {
    const [firstSigner, ...additionalSigners] = template.signerRoles;
    setForm((current) => ({
      ...current,
      title: template.title,
      signerName: firstSigner?.name || current.signerName,
      signerEmail: firstSigner?.email || current.signerEmail,
      additionalSigners: additionalSigners.map((signer) => ({
        name: signer.name,
        email: signer.email,
        role: signer.role
      })),
      expiresInHours: template.expiresInHours,
      signatureField: template.signatureField,
      identityVerificationRequired: template.identityVerificationRequired
    }));
    setMessage('Template applied.');
  };

  const handleAddCompanyMember = async () => {
    if (!companyMember.email) {
      setMessage('Add a team member email.');
      return;
    }

    setBusy('company-member');
    setMessage('');

    try {
      const response = await addCompanyMember(companyMember);
      setCompany(response.company);
      setCompanyMember({ name: '', email: '', role: 'viewer' });
      setMessage('Company member invited.');
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
    setDocuments([]);
    setEntitlement(null);
    setPlans([]);
    setFeatureStatus(null);
    setCapabilities({});
    setDeliveries([]);
    setTemplates([]);
    setCompany(null);
    setLatestLinks([]);
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
    <div className="app-shell">
      <header className="top-bar">
        <a className="brand" href="#/">
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>Subscription e-signature desk</small>
          </span>
        </a>

        <div className="top-actions">
          <a className="secondary-button top-link" href="#/inbox">
            <Inbox size={15} />
            Recipient inbox
          </a>
          <a className="secondary-button top-link" href="#/settings">
            <ShieldCheck size={15} />
            Account
          </a>
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
            <AuthControls onSignedIn={setSession} />
          )}
        </div>
      </header>

      {!session && (
        <section className="onboarding-banner">
          <div>
            <span className="eyebrow">Welcome</span>
            <h2>Send a PDF for signature in three steps</h2>
          </div>
          <ol>
            <li>
              <strong>Sign in with your email.</strong> We send a one-time code — no password to remember.
            </li>
            <li>
              <strong>Upload a PDF and add recipients.</strong> Each recipient gets a private link addressed to their
              email only.
            </li>
            <li>
              <strong>Recipients verify and sign.</strong> You both get a sealed PDF with an audit certificate page.
            </li>
          </ol>
        </section>
      )}

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

            <div className="feature-box">
              <div className="feature-box-heading">
                <span>Multi-signer routing</span>
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      additionalSigners: [...current.additionalSigners, { name: '', email: '', role: 'Approver' }]
                    }))
                  }
                  disabled={!capabilities.multiSigner}
                >
                  <Users size={16} />
                  Add signer
                </button>
              </div>
              {form.additionalSigners.map((signer, index) => (
                <div className="signer-mini-grid" key={`signer-${index}`}>
                  <input
                    value={signer.name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        additionalSigners: current.additionalSigners.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item
                        )
                      }))
                    }
                    placeholder="Additional signer"
                  />
                  <input
                    type="email"
                    value={signer.email}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        additionalSigners: current.additionalSigners.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, email: event.target.value } : item
                        )
                      }))
                    }
                    placeholder="signer@example.com"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        additionalSigners: current.additionalSigners.filter((_, itemIndex) => itemIndex !== index)
                      }))
                    }
                    title="Remove signer"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {!capabilities.multiSigner && <small>Pro or Business unlocks additional signers.</small>}
            </div>

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

            <FieldPlacementControl
              disabled={!capabilities.fieldPlacement}
              field={form.signatureField}
              onChange={(signatureField) => setForm((current) => ({ ...current, signatureField }))}
            />

            <label className="consent-row compact-toggle">
              <input
                type="checkbox"
                checked={form.identityVerificationRequired}
                disabled={!capabilities.idVerification}
                onChange={(event) =>
                  setForm((current) => ({ ...current, identityVerificationRequired: event.target.checked }))
                }
              />
              <span>ID verification attestation {capabilities.idVerification ? '' : '(Business)'}</span>
            </label>

            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleSaveTemplate()}
              disabled={!capabilities.templates || busy === 'save-template'}
            >
              {busy === 'save-template' ? <Loader2 className="spin" size={16} /> : <FileCheck2 size={16} />}
              Save template
            </button>

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

          {!firebaseConfigured() && import.meta.env.DEV && (
            <div className="inline-note">
              <AlertCircle size={16} />
              Google and Apple use local demo sessions until Firebase values are added.
            </div>
          )}

          {!firebaseConfigured() && import.meta.env.PROD && (
            <div className="inline-note">
              <ShieldCheck size={16} />
              Email-code login is enabled.
            </div>
          )}
        </section>

        <section className="documents-panel">
          <SubscriptionPanel
            busy={busy}
            entitlement={entitlement}
            onCancel={() => void handleCancelSubscription()}
            onManage={() => void handleManageSubscription()}
            onRestore={() => void handleRestoreSubscription()}
            onStart={(planId) => void handleStartSubscription(planId)}
            plans={plans}
            signedIn={Boolean(session)}
          />

          <div className="stats-grid">
            <StatCard label="Active" value={activeCount} tone="blue" />
            <StatCard label="Signed" value={signedCount} tone="green" />
            <StatCard label="Total" value={documents.length} tone="gold" />
          </div>

          {latestLinks.length > 0 && (
            <div className="link-stack">
              <LinkIcon size={19} />
              <div>
                {latestLinks.map((link) => (
                  <div className="link-banner" key={`${link.documentId}-${link.signerEmail}`}>
                    <span>{link.signerName}</span>
                    <input value={link.url} readOnly aria-label={`Signing link for ${link.signerName}`} />
                    <button type="button" onClick={() => void copyText(link.url, setMessage)} title="Copy link">
                      <Copy size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                      title="Open link"
                    >
                      <ExternalLink size={17} />
                    </button>
                  </div>
                ))}
              </div>
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
                          {document.signerCount > 1
                            ? `${document.signedSignerCount}/${document.signerCount} signers completed`
                            : `${document.signerName} - ${document.signerEmail}`}
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
                      {document.status === 'sent' ? (
                        <button
                          type="button"
                          onClick={() => void handleReminder(document)}
                          disabled={!capabilities.reminders || busy === `remind-${document.id}`}
                          title="Send reminder"
                        >
                          {busy === `remind-${document.id}` ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
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

          <FeatureSuitePanel
            busy={busy}
            capabilities={capabilities}
            company={company}
            companyMember={companyMember}
            deliveries={deliveries}
            featureStatus={featureStatus}
            onAddCompanyMember={() => void handleAddCompanyMember()}
            onApplyTemplate={applyTemplate}
            setCompanyMember={setCompanyMember}
            templates={templates}
          />
        </section>
      </main>

      <InstructionManual />

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

function RecipientInboxScreen() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [documents, setDocuments] = useState<SignerInboxDocument[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!session || !deviceVerified) {
      setDocuments([]);
      return;
    }

    void refreshSignerInbox(setDocuments, setMessage, setBusy);
  }, [session, deviceVerified]);

  useEffect(() => {
    setDeviceVerified(false);
  }, [session?.uid, session?.email]);

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

  const signOut = () => {
    clearStoredSession();
    setSession(null);
    setDeviceVerified(false);
    setDocuments([]);
  };

  if (session && !deviceVerified) {
    return (
      <DeviceVerificationScreen
        session={session}
        onVerified={() => setDeviceVerified(true)}
        onSignOut={signOut}
        context="recipient"
      />
    );
  }

  return (
    <div className="signer-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>Recipient inbox</small>
          </span>
        </a>
        <div className="top-actions">
          <a className="secondary-button top-link" href="#/">
            <Upload size={15} />
            Sender desk
          </a>
          <a className="secondary-button top-link" href="#/settings">
            <ShieldCheck size={15} />
            Account
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
          <Inbox size={42} />
          <h1>Open documents assigned to your email</h1>
          <p>Sign in with the email address the sender added to the document.</p>
          <AuthControls onSignedIn={setSession} />
          {message && <div className="inline-note">{message}</div>}
        </section>
      ) : (
        <main className="recipient-workspace">
          <section className="documents-table recipient-inbox-table">
            <div className="table-heading">
              <div>
                <span className="eyebrow">Assigned to</span>
                <h1>{session.email}</h1>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void refreshSignerInbox(setDocuments, setMessage, setBusy)}
                disabled={busy === 'inbox'}
              >
                {busy === 'inbox' ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                Refresh
              </button>
            </div>

            {busy === 'inbox' && !documents.length ? (
              <div className="center-state">
                <Loader2 className="spin" size={28} />
              </div>
            ) : documents.length === 0 ? (
              <div className="empty-state">
                <FileText size={32} />
                <p>No documents are assigned to this email.</p>
              </div>
            ) : (
              <div className="document-list">
                {documents.map((document) => (
                  <article className="document-row" key={`${document.id}-${document.signerId}`}>
                    <div className="document-main">
                      <FileText size={20} />
                      <div>
                        <h3>{document.title}</h3>
                        <p>{document.ownerName}</p>
                        <small>
                          {document.signerStatus === 'signed'
                            ? `Signed ${formatDate(document.signedAt || '')}`
                            : `Expires ${formatDate(document.expiresAt)}`}
                        </small>
                      </div>
                    </div>
                    <StatusChip status={document.documentStatus} />
                    <div className="row-actions">
                      <button
                        type="button"
                        disabled={!document.canSign}
                        onClick={() => {
                          window.location.hash = `#/inbox/sign/${document.id}/${document.signerId}`;
                        }}
                        title={document.canSign ? 'Review and sign' : 'Document is not available for signing'}
                      >
                        <PenLine size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          {message && <div className="inline-note">{message}</div>}
        </main>
      )}
    </div>
  );
}

function FieldPlacementControl({
  disabled,
  field,
  onChange
}: {
  disabled: boolean;
  field: SignatureFieldPlacement;
  onChange: (field: SignatureFieldPlacement) => void;
}) {
  return (
    <div className="feature-box">
      <div className="feature-box-heading">
        <span>Signature field placement</span>
        <small>{disabled ? 'Pro or Business' : `${field.xPercent}% / ${field.yPercent}%`}</small>
      </div>
      <div
        className={`field-designer ${disabled ? 'disabled' : ''}`}
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          const xPercent = Math.round(((event.clientX - rect.left) / rect.width) * 100);
          const yPercent = Math.round((1 - (event.clientY - rect.top) / rect.height) * 100);
          onChange({
            ...field,
            xPercent: clampPercent(xPercent),
            yPercent: clampPercent(yPercent)
          });
        }}
        role="slider"
        aria-label="Signature field placement"
        aria-valuetext={`${field.xPercent} percent across and ${field.yPercent} percent up the page`}
      >
        <div
          className="field-marker"
          style={{
            left: `${field.xPercent}%`,
            bottom: `${field.yPercent}%`,
            width: `${field.widthPercent}%`
          }}
        >
          Signature
        </div>
      </div>
      <label>
        <span>Field width</span>
        <input
          type="range"
          min={35}
          max={95}
          value={field.widthPercent}
          disabled={disabled}
          onChange={(event) => onChange({ ...field, widthPercent: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}

function FeatureSuitePanel({
  busy,
  capabilities,
  company,
  companyMember,
  deliveries,
  featureStatus,
  onAddCompanyMember,
  onApplyTemplate,
  setCompanyMember,
  templates
}: {
  busy: string;
  capabilities: Record<string, boolean>;
  company: CompanyProfile | null;
  companyMember: { name: string; email: string; role: 'admin' | 'sender' | 'viewer' };
  deliveries: EmailDelivery[];
  featureStatus: FeatureStatus | null;
  onAddCompanyMember: () => void;
  onApplyTemplate: (template: DocumentTemplate) => void;
  setCompanyMember: (member: { name: string; email: string; role: 'admin' | 'sender' | 'viewer' }) => void;
  templates: DocumentTemplate[];
}) {
  return (
    <section className="feature-suite-panel">
      <div className="table-heading">
        <div>
          <span className="eyebrow">Feature suite</span>
          <h2>Automation and team controls</h2>
        </div>
        <ShieldCheck size={22} />
      </div>

      <div className="feature-suite-grid">
        <article className="feature-card">
          <div className="manual-section-title">
            <Send size={18} />
            <h3>Delivery and reminders</h3>
          </div>
          <p>
            Email {featureStatus?.emailDelivery.configured ? 'provider configured' : 'local outbox'}.
          </p>
          <div className="mini-list">
            {deliveries.slice(0, 3).map((delivery) => (
              <span key={delivery.id}>
                {delivery.kind} from {delivery.senderEmail || delivery.ownerEmail} to {delivery.toEmail} - {delivery.status}
              </span>
            ))}
            {!deliveries.length && <span>No delivery records yet.</span>}
          </div>
        </article>

        <article className="feature-card">
          <div className="manual-section-title">
            <FileCheck2 size={18} />
            <h3>Templates</h3>
          </div>
          <p>{capabilities.templates ? 'Save and reuse packet settings.' : 'Pro or Business required.'}</p>
          <div className="template-chip-row">
            {templates.slice(0, 4).map((template) => (
              <button type="button" key={template.id} onClick={() => onApplyTemplate(template)}>
                {template.name}
              </button>
            ))}
            {!templates.length && <span>No templates saved.</span>}
          </div>
        </article>

        <article className="feature-card">
          <div className="manual-section-title">
            <Users size={18} />
            <h3>Company admin</h3>
          </div>
          <p>{capabilities.companyAdmin ? company?.companyName || 'Business admin ready.' : 'Business tier required.'}</p>
          <div className="company-form">
            <input
              value={companyMember.name}
              onChange={(event) => setCompanyMember({ ...companyMember, name: event.target.value })}
              placeholder="Member name"
              disabled={!capabilities.companyAdmin}
            />
            <input
              type="email"
              value={companyMember.email}
              onChange={(event) => setCompanyMember({ ...companyMember, email: event.target.value })}
              placeholder="member@example.com"
              disabled={!capabilities.companyAdmin}
            />
            <select
              value={companyMember.role}
              onChange={(event) =>
                setCompanyMember({ ...companyMember, role: event.target.value as 'admin' | 'sender' | 'viewer' })
              }
              disabled={!capabilities.companyAdmin}
            >
              <option value="viewer">Viewer</option>
              <option value="sender">Sender</option>
              <option value="admin">Admin</option>
            </select>
            <button type="button" onClick={onAddCompanyMember} disabled={!capabilities.companyAdmin || busy === 'company-member'}>
              {busy === 'company-member' ? <Loader2 className="spin" size={16} /> : <Users size={16} />}
              Invite
            </button>
          </div>
        </article>

        <article className="feature-card">
          <div className="manual-section-title">
            <Fingerprint size={18} />
            <h3>Provider status</h3>
          </div>
          <div className="provider-list">
            <span>Receipts: {featureStatus?.receiptVerification.configured ? 'configured' : 'provider required'}</span>
            <span>ID: {featureStatus?.identityVerification.configured ? 'provider configured' : 'self-attestation'}</span>
            <span>Objects: {featureStatus?.objectStorage.mode || 'local_object_store'}</span>
            <span>CA PDF: {featureStatus?.certificateAuthoritySignatures.configured ? 'configured' : 'certificate required'}</span>
          </div>
        </article>
      </div>
    </section>
  );
}

function InstructionManual() {
  return (
    <section className="manual-panel" aria-labelledby="manual-title">
      <div className="manual-heading">
        <div>
          <span className="eyebrow">Instruction manual</span>
          <h2 id="manual-title">How Forg3 works</h2>
        </div>
        <BookOpen size={24} />
      </div>

      <div className="manual-grid">
        <article className="manual-section">
          <div className="manual-section-title">
            <Upload size={18} />
            <h3>Send a document for signature</h3>
          </div>
          <ol>
            <li>Sign in with email code, Google, or Apple.</li>
            <li>Activate a subscription tier.</li>
            <li>Choose a PDF, add a document title, signers, field placement, identity settings, and expiration window.</li>
            <li>Create the packet.</li>
            <li>Forg3 creates signer-specific recipient links and delivers them by the configured email provider.</li>
          </ol>
          <p>
            Pro and Business can route a packet to multiple signers. Pay Per Signature keeps a single signer per packet.
          </p>
        </article>

        <article className="manual-section">
          <div className="manual-section-title">
            <PenLine size={18} />
            <h3>Signer experience</h3>
          </div>
          <ol>
            <li>The signer opens the link before it expires.</li>
            <li>The signer reviews the PDF.</li>
            <li>The signer draws with a finger, stylus, mouse, or touchpad, or uses the typed-signature option.</li>
            <li>The signer types the assigned name, completes ID attestation when required, and accepts consent.</li>
            <li>Forg3 seals that signer link. The signed PDF is generated when every required signer completes.</li>
          </ol>
          <p>
            A completed signing link cannot be reused. Expired or voided links are unavailable to the signer.
          </p>
        </article>

        <article className="manual-section">
          <div className="manual-section-title">
            <FileCheck2 size={18} />
            <h3>Storage and signed copies</h3>
          </div>
          <p>
            The current build stores document metadata in the server store and moves original/signed PDF data into the
            local object store. Production can swap this object layer to private cloud storage without changing the user
            flow.
          </p>
          <p>
            After signing, the signer can download a copy from the completion screen. The owner sees the packet marked
            signed in the dashboard and can download the signed PDF from the document row.
          </p>
        </article>

        <article className="manual-section">
          <div className="manual-section-title">
            <LinkIcon size={18} />
            <h3>Sharing rules</h3>
          </div>
          <p>
            Forg3 creates hash-backed signer links and records automatic email delivery attempts through the configured
            provider.
          </p>
          <p>
            If a link expires before signing, create a new link from the document row. If the packet should no longer be
            signed, void it.
          </p>
        </article>

        <article className="manual-section">
          <div className="manual-section-title">
            <Building2 size={18} />
            <h3>Business document use</h3>
          </div>
          <p>
            Purchase orders, vendor agreements, approvals, onboarding forms, waivers, work orders, invoices, estimates,
            and internal acknowledgements can be sent as PDFs when the sender is comfortable using an electronic
            signature workflow.
          </p>
          <p>
            Forg3 creates an electronic signature stamp and audit certificate page. Business exposes certificate-authority
            provider readiness; live CA-backed PAdES signing still requires a configured signing certificate/provider.
          </p>
        </article>

        <article className="manual-section">
          <div className="manual-section-title">
            <ReceiptText size={18} />
            <h3>W-2, 1099, and payroll forms</h3>
          </div>
          <p>
            Forg3 can capture a signature or consent acknowledgement on a PDF. Payroll and tax forms have additional IRS,
            SSA, state, employer, recipient-consent, delivery, filing, and retention rules. Use this build only as a
            generic PDF signing tool unless those compliance requirements are reviewed and configured for the company.
          </p>
          <p>
            Practical note: employees usually receive W-2s; they do not normally sign W-2s. Contractors commonly sign
            W-9s, while 1099 recipients may need to consent before receiving electronic copies.
          </p>
        </article>
      </div>

      <div className="manual-tier-block">
        <div className="manual-section-title">
          <CreditCard size={18} />
          <h3>Tier matrix</h3>
        </div>

        <div className="tier-table" role="table" aria-label="Forg3 subscription tiers">
          <div className="tier-row tier-head" role="row">
            <span role="columnheader">Feature</span>
            <span role="columnheader">Pay Per Signature</span>
            <span role="columnheader">Pro</span>
            <span role="columnheader">Business</span>
          </div>
          {manualTierRows.map((row) => (
            <div className="tier-row" role="row" key={row.feature}>
              <span role="cell">{row.feature}</span>
              <span role="cell">{row.payPerSignature}</span>
              <span role="cell">{row.pro}</span>
              <span role="cell">{row.business}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="manual-limitations">
        <strong>Provider configuration required:</strong>
        <span>
          live email sending, government/third-party ID checks, live App Store/Play/Stripe receipt verification, cloud
          object storage, and certificate-authority backed PDF signatures require external credentials or certificates.
          Local/demo flows are built into the app for development and testing.
        </span>
      </div>
    </section>
  );
}

function SubscriptionPanel({
  busy,
  entitlement,
  onCancel,
  onManage,
  onRestore,
  onStart,
  plans,
  signedIn
}: {
  busy: string;
  entitlement: SubscriptionEntitlement | null;
  onCancel: () => void;
  onManage: () => void;
  onRestore: () => void;
  onStart: (planId: PlanId) => void;
  plans: SubscriptionPlan[];
  signedIn: boolean;
}) {
  const activePlan = entitlement?.active ? entitlement.plan : null;
  const usageSummary = entitlement?.usageSummary;
  const storePlans = getVisiblePlansForRuntime(plans);
  const nativeStoreBilling = isNativeStoreBillingRuntime();

  return (
    <section className="billing-panel">
      <div className="billing-summary">
        <div>
          <span className="eyebrow">Subscription</span>
          <h2>{getEntitlementTitle(entitlement)}</h2>
          <p>
            {getEntitlementDescription(entitlement)}
          </p>
        </div>
        <span className={`billing-badge ${entitlement?.active ? 'active' : 'inactive'}`}>
          <CreditCard size={15} />
          {entitlement?.creatorAccess ? 'creator' : entitlement?.active ? 'active' : entitlement?.status || 'inactive'}
        </span>
      </div>
      {nativeStoreBilling && !entitlement?.active && (
        <button
          className="secondary-button restore-button"
          type="button"
          onClick={onRestore}
          disabled={!signedIn || busy === 'restore-subscription'}
        >
          {busy === 'restore-subscription' ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
          Restore purchase
        </button>
      )}

      {entitlement?.active ? (
        <div className="billing-active-row">
          <div className="billing-active-copy">
            <strong>{getEntitlementPriceLine(entitlement)}</strong>
            {activePlan ? (
              <>
                <span>{activePlan.seatLimit} owner seat{activePlan.seatLimit === 1 ? '' : 's'}</span>
                <span>{activePlan.unlimitedAccess ? 'Unlimited access enabled' : 'Limited tier access'}</span>
                {activePlan.usagePriceLabel && <span>+ {activePlan.usagePriceLabel}</span>}
                {activePlan.billingNote && <span>{activePlan.billingNote}</span>}
              </>
            ) : (
              <>
                <span>Creator-only unlimited access</span>
                <span>No paid subscription required for this account.</span>
              </>
            )}
          </div>
          {activePlan?.billingModel === 'metered' && usageSummary && (
            <div className="billing-meter">
              <span>Metered signatures</span>
              <strong>{usageSummary.signatureCount}</strong>
              <small>{usageSummary.totalUsageLabel} usage total</small>
            </div>
          )}
          {activePlan && (
            <div className="billing-actions">
              {nativeStoreBilling && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onManage}
                  disabled={busy === 'manage-subscription'}
                >
                  {busy === 'manage-subscription' ? <Loader2 className="spin" size={16} /> : <ExternalLink size={16} />}
                  Manage
                </button>
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
          )}
        </div>
      ) : (
        <>
          <div className="plan-grid">
            {storePlans.map((plan) => (
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
          {nativeStoreBilling && storePlans.length !== plans.length && (
            <div className="inline-note">
              <ShieldCheck size={16} />
              Pay Per Signature will launch on mobile after the per-signature model is packaged as store-managed
              credits.
            </div>
          )}
        </>
      )}
    </section>
  );
}

type SigningAccess =
  | { kind: 'token'; token: string }
  | { kind: 'assigned'; documentId: string; signerId: string };

function SignerScreen({ access }: { access: SigningAccess }) {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [document, setDocument] = useState<PublicSigningDocument | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signerNameConfirmation, setSignerNameConfirmation] = useState('');
  const [signerEmailConfirmation, setSignerEmailConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('load');
  const [message, setMessage] = useState('');
  const [signedResult, setSignedResult] = useState<SignedDocumentResponse | null>(null);
  const requiresAuth = true;

  useEffect(() => {
    let mounted = true;

    if (!session || !deviceVerified) {
      setBusy('');
      return () => {
        mounted = false;
      };
    }

    setBusy('load');
    setMessage('');
    setDocument(null);
    setFileDataUrl('');
    setSignedResult(null);

    const request =
      access.kind === 'token'
        ? getPublicSigningDocument(access.token)
        : getAssignedSigningDocument(access.documentId, access.signerId);

    request
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
  }, [access, session, deviceVerified]);

  useEffect(() => {
    setDeviceVerified(false);
  }, [session?.uid, session?.email]);

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

  const handleSign = async (event: FormEvent) => {
    event.preventDefault();

    if (
      !document ||
      !signatureDataUrl ||
      !consent ||
      !namesMatch(signerNameConfirmation, document.signerName) ||
      (document.identityVerificationRequired && signerEmailConfirmation.trim().toLowerCase() !== document.signerEmail.toLowerCase())
    ) {
      return;
    }

    setBusy('sign');
    setMessage('');

    try {
      const payload = {
        signatureDataUrl,
        signerNameConfirmation,
        signerEmailConfirmation,
        consentText: `${document.signerName} accepted electronic signature consent at ${new Date().toISOString()}`
      };
      const result =
        access.kind === 'token'
          ? await signDocument(access.token, payload)
          : await signAssignedDocument(access.documentId, access.signerId, payload);
      setSignedResult(result);
      setMessage(result.signedFileDataUrl ? 'Signed. This link is sealed.' : 'Your signature is complete.');
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
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>Secure signing room</small>
          </span>
        </a>
        <span className="runtime-pill">
          <Lock size={15} />
          Email-verified access
        </span>
      </header>

      {!session ? (
        <section className="complete-panel inbox-auth-panel">
          <Inbox size={42} />
          <h1>Sign in to open this document</h1>
          <p>Use the email address assigned by the sender.</p>
          <AuthControls onSignedIn={setSession} />
          {message && <div className="inline-note">{message}</div>}
        </section>
      ) : !deviceVerified ? (
        <DeviceVerificationPanel
          session={session}
          onVerified={() => setDeviceVerified(true)}
          onSignOut={() => {
            clearStoredSession();
            setSession(null);
            setDeviceVerified(false);
            setDocument(null);
            setFileDataUrl('');
          }}
          context="document"
        />
      ) : busy === 'load' ? (
        <div className="center-state">
          <Loader2 className="spin" size={28} />
        </div>
      ) : signedResult ? (
        <section className="complete-panel">
          <CheckCircle size={42} />
          <h1>{signedResult.signedFileDataUrl ? 'Document signed' : 'Signature complete'}</h1>
          <p>
            {signedResult.signedFileDataUrl
              ? 'The signing link has been sealed and will not reopen this packet.'
              : `${signedResult.pendingSignerCount || 0} signer${signedResult.pendingSignerCount === 1 ? '' : 's'} still need to complete this packet.`}
          </p>
          {signedResult.signedFileDataUrl && (
            <button
              type="button"
              className="primary-button"
              onClick={() => downloadDataUrl(signedResult.signedFileDataUrl!, signedResult.fileName)}
            >
              <Download size={17} />
              Download copy
            </button>
          )}
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
            <PdfPreview
              fileDataUrl={fileDataUrl}
              fileName={document.fileName}
              title={document.title}
              onDownload={() => downloadDataUrl(fileDataUrl, document.fileName)}
            />
          </section>

          <form className="signature-panel" onSubmit={handleSign}>
            <div>
              <span className="eyebrow">Signer</span>
              <h2>{document.signerName}</h2>
              <p>{document.signerEmail}</p>
              {document.signerRole && <p>{document.signerRole}</p>}
              <small>Expires {formatDate(document.expiresAt)}</small>
            </div>

            <div className="request-context">
              <div className="request-context-heading">
                <ShieldCheck size={16} />
                <span>About this request</span>
              </div>
              <ul>
                <li>
                  Sent by <strong>{document.ownerName}</strong> for &quot;{document.title}&quot;.
                </li>
                <li>
                  Addressed to <strong>{document.signerEmail}</strong> — only that verified email can open or sign it.
                </li>
                <li>
                  Document fingerprint <code>{document.documentHash.slice(0, 16)}…</code> proves the file has not
                  changed since it was sent.
                </li>
                <li>
                  After everyone signs, the PDF is sealed with an audit certificate page and you can download your copy
                  immediately.
                </li>
              </ul>
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

            {document.identityVerificationRequired && (
              <label>
                <span>Confirm signer email</span>
                <input
                  type="email"
                  value={signerEmailConfirmation}
                  onChange={(event) => setSignerEmailConfirmation(event.target.value)}
                  placeholder={document.signerEmail}
                />
              </label>
            )}

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
                (document.identityVerificationRequired &&
                  signerEmailConfirmation.trim().toLowerCase() !== document.signerEmail.toLowerCase()) ||
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

async function refreshSignerInbox(
  setDocuments: (documents: SignerInboxDocument[]) => void,
  setMessage: (message: string) => void,
  setBusy?: (busy: string) => void
) {
  setBusy?.('inbox');

  try {
    const response = await listSignerDocuments();
    setDocuments(response.documents);
  } catch (error) {
    setMessage(getErrorMessage(error));
  } finally {
    setBusy?.('');
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

async function refreshFeatureSuite(
  setFeatureStatus: (featureStatus: FeatureStatus) => void,
  setCapabilities: (capabilities: Record<string, boolean>) => void,
  setDeliveries: (deliveries: EmailDelivery[]) => void,
  setTemplates: (templates: DocumentTemplate[]) => void,
  setCompany: (company: CompanyProfile | null) => void
) {
  try {
    const features = await getFeatureStatus();
    setFeatureStatus(features.featureStatus);
    setCapabilities(features.capabilities);

    const deliveriesResponse = await listEmailDeliveries();
    setDeliveries(deliveriesResponse.deliveries);

    if (features.capabilities.templates) {
      const templatesResponse = await listTemplates();
      setTemplates(templatesResponse.templates);
    } else {
      setTemplates([]);
    }

    if (features.capabilities.companyAdmin) {
      const companyResponse = await getCompany();
      setCompany(companyResponse.company);
    } else {
      setCompany(null);
    }
  } catch {
    setCapabilities({});
  }
}

function linksFromResponse(response: { document: DocumentSummary; signingLinks?: Array<{ signerName: string; signerEmail: string; signingPath: string; signingUrl?: string }> }) {
  return (response.signingLinks || [])
    .filter((link) => link.signingPath)
    .map((link) => ({
      documentId: response.document.id,
      signerName: link.signerName,
      signerEmail: link.signerEmail,
      url: link.signingUrl || makeSigningUrl(link.signingPath)
    }));
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

  if (hash.startsWith('inbox/sign/')) {
    const [, , documentId, signerId] = hash.split('/');

    if (documentId && signerId) {
      return { kind: 'assigned-sign', documentId, signerId };
    }
  }

  if (hash === 'inbox') {
    return { kind: 'inbox' };
  }

  if (hash === 'settings') {
    return { kind: 'settings' };
  }

  if (hash === 'terms') {
    return { kind: 'terms' };
  }

  if (hash === 'privacy') {
    return { kind: 'privacy' };
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

function getEntitlementTitle(entitlement: SubscriptionEntitlement | null) {
  if (entitlement?.creatorAccess) {
    return 'Creator Unlimited';
  }

  if (entitlement?.active && entitlement.plan) {
    return entitlement.plan.name;
  }

  return 'Choose a plan';
}

function getEntitlementDescription(entitlement: SubscriptionEntitlement | null) {
  if (entitlement?.creatorAccess) {
    return 'Unlimited creator access is active for this account.';
  }

  if (entitlement?.active && entitlement.subscription) {
    return `Active until ${formatDate(entitlement.subscription.renewsAt)}`;
  }

  return 'A subscription is required to create signing links.';
}

function getEntitlementPriceLine(entitlement: SubscriptionEntitlement) {
  if (entitlement.creatorAccess) {
    return 'Creator pass';
  }

  return entitlement.plan ? `${entitlement.plan.priceLabel}/${entitlement.plan.cadence}` : 'Active access';
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}

function getBillingProviderForRuntime(): BillingProvider {
  if (import.meta.env.DEV) {
    return 'demo';
  }

  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    return 'apple_app_store';
  }

  if (platform === 'android') {
    return 'google_play';
  }

  return 'stripe';
}

function isNativeStoreBillingRuntime() {
  if (import.meta.env.DEV) {
    return false;
  }

  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
}

function getVisiblePlansForRuntime(plans: SubscriptionPlan[]) {
  if (!isNativeStoreBillingRuntime()) {
    return plans;
  }

  return plans.filter((plan) => plan.billingModel === 'flat');
}

function getBillingButtonLabel() {
  if (import.meta.env.DEV) {
    return 'Start demo';
  }

  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    return 'Buy with App Store';
  }

  if (platform === 'android') {
    return 'Buy with Play Store';
  }

  return 'Native billing required';
}

function getBillingRuntimeLabel() {
  if (import.meta.env.DEV) {
    return 'Demo billing';
  }

  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    return 'App Store billing';
  }

  if (platform === 'android') {
    return 'Play Billing';
  }

  return 'Mobile billing only';
}

async function requestNativePurchase(
  planId: PlanId,
  billingProvider: BillingProvider,
  plans: SubscriptionPlan[]
) {
  if (billingProvider !== 'apple_app_store' && billingProvider !== 'google_play') {
    throw new Error('Native store billing is only available inside the iOS and Android apps.');
  }

  const plan = plans.find((current) => current.id === planId);
  const productId = billingProvider === 'apple_app_store' ? plan?.appleProductId : plan?.googleProductId;

  if (!productId) {
    throw new Error('This plan is missing a native store product id.');
  }

  const purchase = await purchaseNativeSubscription({ planId, billingProvider, productId });

  if (!purchase.providerReceipt) {
    throw new Error('Native purchase did not return a receipt or purchase token.');
  }

  return purchase;
}

function findPlanForNativePurchase(
  purchase: NativeBillingPurchase,
  billingProvider: Exclude<BillingProvider, 'demo' | 'stripe'>,
  plans: SubscriptionPlan[]
) {
  if (!purchase.productId) {
    return null;
  }

  return (
    plans.find((plan) =>
      billingProvider === 'apple_app_store'
        ? plan.appleProductId === purchase.productId
        : plan.googleProductId === purchase.productId
    ) || null
  );
}

function namesMatch(left: string, right: string) {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();
}
