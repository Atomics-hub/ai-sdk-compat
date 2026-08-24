# Contributing

Use Node.js 22 or newer for development.

```bash
npm ci
npm run verify
```

Changes to a migration must include fixtures for the old and new shapes, a non-mutation assertion, diagnostics for lossy behavior, and an idempotence test where applicable. Keep runtime dependencies at zero unless a proposal demonstrates that the behavior cannot be implemented safely without one.

Open an issue before expanding the package beyond Vercel AI SDK compatibility. Pull requests should be focused, explain the affected SDK majors, and link the upstream migration contract.
