import { FileText, PenLine, ShieldCheck } from 'lucide-react';

export function LegalScreen({ page }: { page: 'terms' | 'privacy' }) {
  return (
    <div className="signer-shell settings-shell">
      <header className="signer-header">
        <a className="brand" href="#/">
          <span className="brand-mark">
            <PenLine size={20} />
          </span>
          <span>
            <strong>Forg3 Sign</strong>
            <small>{page === 'terms' ? 'Terms of service' : 'Privacy policy'}</small>
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
        {page === 'terms' ? <TermsContent /> : <PrivacyContent />}
      </main>
    </div>
  );
}

function TermsContent() {
  return (
    <section className="documents-table settings-card legal-card">
      <h1>Forg3 Sign — Terms of Service</h1>
      <p className="legal-updated">Last updated: July 2026 · Pilot terms</p>

      <h2>1. The service</h2>
      <p>
        Forg3 Sign lets a sender upload a PDF, route it to named recipients by email, and collect electronic signatures.
        Completed packets are sealed into a signed PDF with an audit certificate page. The service is currently offered
        as a controlled pilot; features, pricing, and availability may change.
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
      </p>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of documents you upload. You grant Forg3 the limited right to store, process, and deliver
        them to the recipients you designate. Do not upload content you lack the right to share or content that is
        unlawful.
      </p>

      <h2>5. Billing</h2>
      <p>
        Paid tiers are billed through the applicable app store or payment provider. Metered plans record a per-signature
        charge when a packet is completed. Canceling stops future renewals; access continues until the end of the paid
        period.
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
      <p>Questions about these terms: contact the account that sent you the document, or the Forg3 operator.</p>
    </section>
  );
}

function PrivacyContent() {
  return (
    <section className="documents-table settings-card legal-card">
      <h1>Forg3 Sign — Privacy Policy</h1>
      <p className="legal-updated">Last updated: July 2026 · Pilot policy</p>

      <h2>What we collect</h2>
      <p>
        Account email and display name; documents you upload and their sealed signed versions; signer names, emails, and
        signature images; delivery records; device names and hashed device identifiers used for two-factor trust; and a
        security audit trail of account and document events.
      </p>

      <h2>What we do not collect</h2>
      <p>
        Forg3 does not capture signer IP addresses in signing records, does not sell data, and does not use document
        contents for anything other than storing and delivering them for signature.
      </p>

      <h2>How access is controlled</h2>
      <p>
        Documents are only visible to the sender&apos;s account and to recipients signed in with the exact email address
        the sender designated. Signing links are single-purpose, expiring, and stored only as hashes. Stored PDFs are
        encrypted at rest when the deployment configures an encryption key.
      </p>

      <h2>Retention and your controls</h2>
      <p>
        Data is retained while your account is active. From Account settings you can export all account data as JSON,
        revoke sessions and trusted devices, and permanently delete your account&apos;s documents, files, and history.
        Deletion is immediate and irreversible.
      </p>

      <h2>Email delivery</h2>
      <p>
        Signing invitations, reminders, and login codes are sent through the configured email provider (for example
        Microsoft Graph or Resend). Delivery metadata (recipient, subject, status) is recorded; signing links are
        redacted from stored delivery bodies.
      </p>

      <h2>Changes</h2>
      <p>This pilot policy may change as Forg3 moves toward general availability; material changes will be announced in the app.</p>
    </section>
  );
}
