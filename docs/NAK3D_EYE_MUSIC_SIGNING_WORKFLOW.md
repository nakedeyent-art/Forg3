# Nak3d Eye Music Signing Workflow

Use Forg3 Sign as the first-party replacement for the DocuSign send path.

## Access Rule

- Configure the creator account in `FORG3_CREATOR_EMAILS`.
- For local demo testing, set `VITE_DEV_OWNER_EMAIL` to the same creator email.
- Creator accounts get unlimited access without a paid subscription.
- Approved API agents can use the secret agent override only after normal login/device verification and only for emails in `FORG3_AGENT_OVERRIDE_EMAILS` or, by default, `FORG3_CREATOR_EMAILS`. Send the raw code as `X-Forg3-Agent-Override`; the server should store only `FORG3_AGENT_OVERRIDE_CODE_SHA256`.
- Paid customer unlimited access is reserved for the highest tier, Forg3 Business.
- Lower tiers can create packets only within their paid model; do not label them unlimited.

## Current Packet Sources

Already staged as PDFs for Sean/internal signing:

- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/00_admin/docusign_upload_staging_2026-07-08/Sean_Terry_Solo_Catalog_Ownership_Attestation_2026-07-02_FOR_DOCUSIGN.pdf`
- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/00_admin/docusign_upload_staging_2026-07-08/Demic_signed_Master_Use_needs_Sean_countersign_FOR_DOCUSIGN.pdf`
- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/00_admin/docusign_upload_staging_2026-07-08/Demic_signed_Composition_needs_Sean_countersign_FOR_DOCUSIGN.pdf`

Still DOCX and must be exported to PDF before Forg3 upload:

- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/01_unsigned_for_signature/Harold_Ponder_Pone/Deli_Composition_Split_and_Sync_Authorization_2026-07-02.docx`
- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/01_unsigned_for_signature/Harold_Ponder_Pone/Pone_Identity_Intake_2026-07-02.docx`
- `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/01_unsigned_for_signature/Sean_Terry_Internal/Sean_Terry_Solo_Catalog_Ownership_Attestation_2026-07-02.docx`

## Forg3 Send Steps

1. Deploy the Forg3 web app and API to HTTPS.
2. Set `PUBLIC_SIGNING_BASE_URL` to the deployed signer-facing web app URL.
3. Configure `EMAIL_PROVIDER=microsoft_graph`, `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`, and `MICROSOFT_GRAPH_SENDER`.
4. Sign in as the configured creator account.
5. Upload one PDF packet.
6. Set the title to the rights packet name.
7. Enter the assigned signer name and email address.
8. Create the signing link. Forg3 emails the configured signer an assigned-recipient URL automatically.
9. The signer must log in with the assigned email address and verify any new device before the PDF opens.
10. Use the reminder action to issue a fresh assigned-recipient URL and send a new email if the signer does not complete the packet.
11. After completion, download the signed PDF from Forg3.
12. File the signed PDF under the matching `rights_packets/02_signed_complete/...` folder.

Without provider credentials, Forg3 records delivery attempts in the local outbox for development only. Do not treat a local-outbox row as proof that Pone or Sean received a signing request.
