import { FileText, ShieldCheck, Trash2 } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';

export function LegalScreen({ page }: { page: 'terms' | 'privacy' | 'account-deletion' }) {
  const label = page === 'terms' ? 'Terms of service' : page === 'privacy' ? 'Privacy policy' : 'Account deletion';

  return (
    <div className="signer-shell settings-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <BrandMark />
          <span>
            <strong>Forg3</strong>
            <small>{label}</small>
          </span>
        </a>
        <div className="top-actions">
          <a className="secondary-button top-link" href="#/settings">
            <ShieldCheck size={15} />
            Account
          </a>
          <a className="secondary-button top-link" href="#/">
            <FileText size={15} />
            Sender desk
          </a>
        </div>
      </header>

      <main className="settings-workspace legal-page">
        {page === 'terms' ? <TermsContent /> : page === 'privacy' ? <PrivacyContent /> : <AccountDeletionContent />}
      </main>
    </div>
  );
}

function TermsContent() {
  return (
    <section className="documents-table settings-card legal-card">
      <h1>Forg3 — Terms of Service</h1>
      <p className="legal-updated">Last updated: July 14, 2026 · Release candidate terms</p>

      <h2>1. The service</h2>
      <p>
        Forg3 lets a sender upload documents, route them to named recipients by email, and collect electronic signatures.
        Completed packets are sealed into a signed PDF or certificate PDF with an audit certificate page. Features, pricing, limits, and
        availability may change as the service moves from release candidate to general availability.
      </p>

      <h2>2. Accounts and security</h2>
      <p>
        You sign in with a one-time email code and, if you enable it, an authenticator-app code. You are responsible for
        keeping control of your email account and enrolled devices. You can review and revoke sessions and trusted
        devices at any time from Account settings.
      </p>

      <h2>3. Electronic signatures</h2>
      <p>
        By signing, a recipient consents to transact electronically and adopts their drawn or typed signature. Forg3
        records the signer&apos;s confirmation, consent text, timestamps, and document hashes. You are responsible for
        confirming that electronic signatures are appropriate for your document type and jurisdiction; some documents
        (for example certain tax, payroll, or notarized forms) have additional legal requirements Forg3 does not manage.
        Forg3 currently creates an electronic signature stamp and audit page, not a certificate-authority-backed PAdES
        digital signature, unless a production signing-certificate provider is configured.
      </p>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of documents you upload. You grant Forg3 the limited right to store, process, and deliver
        them to the recipients you designate. Do not upload content you lack the right to share or content that is
        unlawful.
      </p>

      <h2>5. Billing</h2>
      <p>
        Paid tiers are billed through the applicable app store or payment provider. Mobile app purchases are verified
        server-side before sending access is enabled. Metered plans record per-signature usage only after a packet is
        completed. Canceling stops future renewals; access continues until the end of the paid period unless the store
        provider reports a refund, revocation, failed renewal, grace-period end, or account hold.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        No impersonation, fraud, harassment, or attempts to defeat signing controls, rate limits, or audit logging.
        Forg3 may suspend accounts that put other users or the service at risk.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The service is provided &quot;as is&quot; during the pilot, without warranties of fitness for a particular
        purpose. Forg3&apos;s liability is limited to the amount you paid for the service in the twelve months before a
        claim. Nothing in these terms is legal advice.
      </p>

      <h2>8. Contact</h2>
      <p>Questions about these terms: contact the account that sent you the document, or email st@nak3deye.com.</p>
    </section>
  );
}

function PrivacyContent() {
  return (
    <section className="documents-table settings-card legal-card">
      <h1>Forg3 — Privacy Policy</h1>
      <p className="legal-updated">Last updated: July 14, 2026 · Release candidate policy</p>

      <h2>What we collect</h2>
      <p>
        Account email and display name; documents you upload and their sealed signed versions; signer names, emails, and
        signature images; subscription entitlement records; delivery records; device names and hashed device identifiers
        used for two-factor trust; and a security audit trail of account and document events.
      </p>

      <h2>What we do not collect</h2>
      <p>
        Forg3 does not capture signer IP addresses in signing records, does not sell data, and does not use document
        contents for anything other than storing and delivering them for signature.
      </p>

      <h2>How access is controlled</h2>
      <p>
        Documents are only visible to the sender&apos;s account and to recipients signed in with the exact email address
        the sender designated. Signing links are single-purpose, expiring, and stored only as hashes. Stored documents
        and signed packages are encrypted at rest when the deployment configures an encryption key.
      </p>

      <h2>Retention and your controls</h2>
      <p>
        Data is retained while your account is active, unless a longer retention period is required to complete a
        transaction, keep billing records, resolve abuse, satisfy legal obligations, or preserve an agreed audit trail.
        From Account settings you can export all account data as JSON, revoke sessions and trusted devices, and
        permanently delete your account&apos;s documents, files, and history. Deletion is immediate and irreversible inside
        the active application store; backups expire under the deployment retention policy.
      </p>
      <p>
        For direct account and data deletion instructions, visit <a href="#/account-deletion">Account deletion</a>.
      </p>

      <h2>Email delivery</h2>
      <p>
        Signing invitations, reminders, and login codes are sent through the configured email provider (for example
        Microsoft Graph or Resend). Delivery metadata (recipient, subject, status) is recorded; signing links are
        redacted from stored delivery bodies.
      </p>

      <h2>Changes</h2>
      <p>Material privacy changes will be announced in the app or through the account email address.</p>
    </section>
  );
}

function AccountDeletionContent() {
  return (
    <section className="documents-table settings-card legal-card">
      <h1>Forg3 - Account and Data Deletion</h1>
      <p className="legal-updated">Last updated: July 16, 2026</p>

      <h2>Delete from the app</h2>
      <p>
        Sign in to Forg3 with the email address for the account you want deleted. Open Account settings, go to Export or
        delete, type your account email address to confirm, and choose Delete account data.
      </p>

      <h2>What is deleted</h2>
      <p>
        Account deletion removes the account&apos;s documents, stored files, subscription entitlement record, trusted
        devices, active sessions, email delivery records, and account audit history from the active Forg3 application
        database and object store. The action is immediate and cannot be undone.
      </p>

      <h2>What may remain temporarily</h2>
      <p>
        Encrypted backups, infrastructure logs, app-store billing records, and records that must be kept for fraud
        prevention, dispute handling, legal obligations, or signed-document audit integrity may remain for the applicable
        retention period before deletion or anonymization.
      </p>

      <h2>Cannot access your account?</h2>
      <p>
        Email <a href="mailto:st@nak3deye.com">st@nak3deye.com</a> from the address tied to your Forg3 account with
        &quot;Forg3 account deletion&quot; in the subject. We will use that email address to verify the request.
      </p>

      <div className="settings-legal-links">
        <a href="#/settings">
          <Trash2 size={15} />
          Open account settings
        </a>
        <a href="#/privacy">Privacy policy</a>
      </div>
    </section>
  );
}
