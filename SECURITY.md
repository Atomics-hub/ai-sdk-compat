# Security policy

Report vulnerabilities privately through GitHub Security Advisories for `Atomics-hub/ai-sdk-compat`. Do not open a public issue for an undisclosed vulnerability.

Supported releases receive security fixes on the latest minor line. Reports should include affected versions, impact, reproduction steps, and any proposed mitigation. We will acknowledge a complete report within seven days and coordinate disclosure after a fix is available.

This package transforms untrusted data but does not validate application-specific schemas. Treat migrated output as untrusted input and use database transactions and backups for bulk writes. The CLI rejects inputs larger than 64 MiB by default and refuses unsafe `--write` operations unless `--force` is explicit; library consumers must enforce equivalent limits and write policies themselves.
