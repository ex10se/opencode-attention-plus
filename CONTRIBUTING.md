# Contributing

This project is experimental. The current version is 0.1.0, targeting OpenCode 2.2.5.
It is distributed under the [MIT license](LICENSE).

## Setup and checks

You need Node.js with `--experimental-strip-types` support and npm.
From the repository root, run:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
ATTENTION_PACK_TEST=1 npm test
```

The last command also tests packaging and installation with the real SDK.
For manual checks, connect the package directory using the [installation guide](README.md#installation) and restart the TUI.

## Changes

- Keep each change focused on one task and explain its observable result
- For bug fixes, add a regression test that reproduces the bug before the fix
- For notification changes, consider delays, cancellation, duplicates, child sessions, and both backends
- Update both READMEs when behavior or options change
- In pull requests, list the commands run, results, and untested scenarios; automated checks do not prove that a banner appeared or a sound played

See the [coverage matrix](docs/verification.md) for test scenarios and the [release guide](docs/releasing.md) for packaging and rollback.
Include a minimal reproduction in bug reports, without secrets or personal data.
Report vulnerabilities through the [security policy](SECURITY.md), not by posting exploit details in public issues.
