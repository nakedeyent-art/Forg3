# Forg3 Repository Boundary

`/Users/rizzolini/Documents/Forg3` is the only source repository for the Forg3
application. It owns the web application, API, native iOS and Android projects,
store automation, release documentation, and app-specific configuration
templates.

## Local secrets

- Keep Forg3 development credentials in this repository's ignored `.env.local`.
- Keep production-only local credentials in the ignored
  `.env.production.local` or `.deploy/` directory.
- Never commit real credentials, private keys, signing files, or generated store
  artifacts.
- Never make another project silently fall back to a Forg3 environment file.

## Cross-project records

Forg3 may refer to customer-owned source documents that remain in their proper
business repository, such as Nak3d Eye Music rights packets. Those references do
not make that customer data part of Forg3 source code and must not be used as
application configuration fallbacks.

## Enforcement

Run the boundary check before committing:

```bash
npm run repo:boundary
```

CI runs the same check and rejects operational files containing machine-specific
absolute paths, cross-repository environment loaders, foreign app names, or
foreign store identifiers.
