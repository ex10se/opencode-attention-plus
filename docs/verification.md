# Verification and coverage

Verified OpenCode version: 2.2.5. Automated checks do not need access to macOS notifications; physical delivery is checked separately.

## Automated checks

```sh
npm test
npm run typecheck
npm run build
ATTENTION_PACK_TEST=1 npm test
```

Recorded result for version 0.1.0 with language selection: 98 tests passed without skips with packaging checks enabled on Node.js 26.13.0; type checking and the build passed. CI specifies Node.js 22.19.0, which has not been checked locally. Plain `npm test` skips the packaging test.

Coverage includes the 1999/2000 ms boundary, questions and permissions, quick replies, cancellation, duplicates, children and grandchildren, errors, interruptions, restarts, independent roots, and plugin unloading. The archive check installs the package separately, imports the public `/tui` export with the real SDK, and checks handler registration and cleanup.

macOS tests mock system calls: they check focus, independent sound, explicit banner opt-in, JXA argument passing, timeouts, and process cancellation. They do not send real banners.

Language tests cover all four messages in English and Russian on both backends, first-system-locale selection, `ru-RU` / `ru_RU` normalization, English fallback on errors or unsupported languages, a single lookup, and cancellation during detection. Explicit language selection and a disabled plugin skip system-language detection. With `language: "auto"`, macOS language detection can still start a process when `nativeNotifications: false`; that option disables native banners, not language lookup. The demo shows an English question banner; it does not verify all translated messages, language switching in a real TUI, or sound. The earlier live results below do not establish those broader language scenarios.

## Live checks

"Verified" means the scenario was observed, not that every combination of settings and environments is guaranteed. Results apply to macOS and PyCharm.

| Scenario | Result |
| --- | --- |
| Loading the installed archive in the TUI with the built-in handler disabled | Verified |
| Background question, permission, ordinary completion, and root error | Banner and sound observed |
| TUI host app active | Sound without a banner observed |
| `nativeNotifications: false` in the background | Sound without a native banner observed |
| Quick answer to a question or permission | No late signal observed; exact question response time was not measured |
| Two children, one with an open question | Question delivered; no premature completion; one final signal after the answer and family completion |
| Interrupting current execution | No sound or banner observed after stopping |
| New run before the previous completion is delivered | One notifier call 2002.984 ms after the latest completion; no call at the old deadline |

The last row used temporary tracing of the real module. It establishes notifier call timing, not macOS banner display timing. Observing a single banner does not establish its exact delivery delay.

## Deferred checks

The following physical checks are outside the current MVP acceptance scope and must not be treated as passed:

- A grandchild's request and a descendant's error
- Subtree interruption
- TUI reload with pending timers
- Transport event redelivery and multiple TUIs sharing a session
- Full physical delivery timing checks when pending completion is cancelled

For the next run, record the OpenCode version, scenario, active app, and observed result. Signals from different TUIs must be distinguishable. SDK success or native process completion does not prove that a banner appeared.

## Implementation limits

- Reload does not restore open requests or deduplication history
- The OpenCode 2.2.5 event stream does not replay events missed while disconnected. Restoring session metadata may delay or prevent a completion notification
- Deduplication is per plugin instance, not shared across multiple TUIs
- macOS focus is app-wide; windows and tabs are not distinguished
- Notifications already accepted by the SDK or macOS cannot be recalled

Transport behavior is described in the OpenCode 2.2.5 source: [event subscription](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/bus.ts), [server feed](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/server/src/event-feed.ts), and [client connection](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/client/src/solid/connection.ts).

## Dependencies

A previous audit recorded moderate warnings in transitive `glob` and `minimatch`, with no high or critical findings. This is not a current audit result: run `npm audit --ignore-scripts` before release.

- [glob: AbortSignal cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [minimatch: denial of service](https://github.com/advisories/GHSA-g3hv-75wg-m249)

Reachability of these paths from the public TUI SDK entry point has not been established. This does not establish that the entire dependency graph is safe.
