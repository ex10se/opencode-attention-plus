# Build, release, and rollback

## Prepare the package

The SDK is pinned to OpenCode 2.2.5. When updating it, check types, tarball installation, and behavior in a real TUI.

From the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
ATTENTION_PACK_TEST=1 npm test
npm pack --dry-run
npm pack
shasum -a 256 opencode-attention-plus-0.1.0.tgz
```

`npm pack` automatically runs type checking and the build. Inspect the archive: it should contain only `dist`, `LICENSE`, documentation, and package metadata. Check for both READMEs, CONTRIBUTING, SECURITY, CHANGELOG, and the documents in `docs`. After deleting source files, check for stale files in `dist`: TypeScript does not remove them automatically.

Keep the version in `package.json`, the lockfile, and CHANGELOG consistent. Use SemVer; breaking changes in the 0.x series increment the minor version. Update the archive version in commands when it changes.

## Prepare npm publication

npm installation, in a dedicated directory:

```sh
mkdir -p "$HOME/.local/share/opencode-attention-plus-install"
cd "$HOME/.local/share/opencode-attention-plus-install"
npm install --ignore-scripts opencode-attention-plus@0.1.0
```

Version 0.1.0 is experimental and currently available through both `latest` and `next`. Pin `0.1.0` as above for reproducible installation. Configure the absolute installed package directory in `cli.json`, as described below.

Validate the exact candidate archive without publishing:

```sh
npm publish /absolute/path/opencode-attention-plus-0.1.0.tgz --dry-run --tag next --access public --registry=https://registry.npmjs.org/
```

A successful dry run does not establish registry authentication, package ownership, or permission to publish. Select the intended dist-tag explicitly with `--tag`; this does not guarantee that other tags are absent. Verify the registry's dist-tags after publication. Ensure the GitHub release tag and archive correspond to the published npm version.

## Install the tarball

```sh
mkdir -p "$HOME/.local/share/opencode-attention-plus-install"
npm install --prefix "$HOME/.local/share/opencode-attention-plus-install" \
  --ignore-scripts /absolute/path/opencode-attention-plus-0.1.0.tgz
```

In `cli.json`, use the absolute path to `node_modules/opencode-attention-plus` inside that directory. See the [README](../README.md#installation) for the configuration format. Preserve other plugins' settings and disable the built-in `opencode.notifications` handler.

Restart the TUI: reloading configuration does not guarantee that changed dependencies in `node_modules` are reloaded. Check plugin loading and a notification both in the background and with the host app focused. On macOS, also check `nativeNotifications` enabled and disabled.

## Release checks

- Confirm that automated checks pass and the archive installs outside the repository
- Check the relevant scenarios in the [coverage matrix](verification.md); automated tests do not establish physical banner delivery
- Run `npm audit --ignore-scripts` and assess current dependency warnings
- Keep the previous archive and a configuration backup for rollback

The package is distributed under the [MIT license](../LICENSE), copyright 2026 Mikhail Belyakov.

Build the release archive from a verified commit. Verify the release tag points to that commit, and record the commit SHA and the archive's SHA-256.

## Rollback

1. Install the previous archive with the same `npm install --prefix ... --ignore-scripts ...` command
2. Restore the configuration and restart the TUI
3. Check question and completion notifications in the background and with the host app focused

To return to built-in notifications, remove this plugin's entry and `-opencode.notifications`. Do not leave both handlers enabled.
