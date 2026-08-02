Hello App Review,

Thank you for reviewing Forg3. We fixed the two issues reported against version 1.0 build 5.

The iOS review build now uses the supplied email-code review account as the supported sign-in path. Native Google/Apple provider buttons are hidden until those native provider bridges are enabled and real-device tested, so reviewers will not be routed into the failing provider flow.

We also updated App Store transaction verification so sandbox/review StoreKit transactions are verified against the correct App Store Server API environment before entitlement is granted.

Steps to locate the In-App Purchases:

1. Launch Forg3.
2. Sign in with the provided review email/code account.
3. Complete device verification with the supplied review code if prompted.
4. On the dashboard, tap Plans in the top navigation.
5. The Subscription section displays Forg3 Pro and Forg3 Business plan cards.
6. Tap Forg3 Pro or Forg3 Business.
7. The App Store sandbox purchase sheet opens for the selected subscription.

Submitted subscription product identifiers:

- Forg3 Pro: com.forg3.sign.pro.monthly
- Forg3 Business: com.forg3.sign.business.monthly

Notes:

- Recipients can sign assigned documents without purchasing a subscription.
- A paid sender subscription is required only before creating or emailing signature requests.
- Purchases are verified server-side before sender access is enabled.
