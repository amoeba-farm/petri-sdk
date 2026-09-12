# Security policy

## Supported versions

Before the first npm publication, security fixes are made on the current
release-candidate branch. After publication, the latest minor release line is
the supported line unless release notes say otherwise.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability.

Use the repository's
[private vulnerability reporting form](https://github.com/SPACE999978/ameba_sdk/security/advisories/new).
The repository owner must enable GitHub private vulnerability reporting before
the first public release. If that form is unavailable, open a public issue
containing no sensitive details and ask the maintainers to provide a private
reporting channel.

Include, when possible:

- the affected SDK version or commit;
- the affected entry point and method;
- reproduction steps or a minimal proof of concept;
- security impact and required preconditions; and
- any suggested mitigation.

Never include private keys, seed phrases, signed transactions, npm tokens,
production credentials, or personal data in a report.

## Security boundaries

The native SDK deliberately does not discover wallets or sign transactions.
Applications must inspect prepared transaction intent and choose a wallet
explicitly before submitting already-signed bytes. A report is security
relevant when it can cross that boundary, bypass backend/operator
authorization, construct incorrect on-chain instructions, expose credentials,
or execute an unmanifested Petri command.

Ordinary usage questions and non-sensitive bugs belong in the channels listed
in [SUPPORT.md](./SUPPORT.md).

The reviewed dependency-advisory policy is documented in
[Compatibility and support](https://github.com/SPACE999978/ameba_sdk/blob/main/docs/COMPATIBILITY.md).
