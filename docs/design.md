# Why notifications work this way

The plugin should signal when the user needs to act, not announce every execution event.
These are the decisions and limits of version 0.1.0 for OpenCode 2.2.5.

## A request can disappear before its notification

Problem: a question or permission request may receive a quick answer, including an automatic one. An immediate signal can outlive the need for user action.

Decision: creation schedules a timer, with a 2-second default delay. A reply or form cancellation removes the timer; the identifier stays in `seen` so a late duplicate cannot trigger another signal. A reply arriving before creation also suppresses that signal.

Tradeoff: a genuinely pending request is delayed. There is no separate SDK request lookup before delivery: replies and cancellations maintain the state. A lost event can leave stale state.

## A finished root does not mean all work has finished

Problem: the root session can finish before its descendants, while a child's open question still needs an answer.

Decision: completion waits for the root to finish, no `running` sessions in its family, and no open requests belonging to that family. These conditions are checked when scheduling the timer and again when it expires. A root or descendant failure changes the final signal to `error`.

Tradeoff: the signal depends on available family metadata and events. A delivered question remains a blocker until answered or cancelled; notifying does not resolve it.

## A new run makes an old signal obsolete

Problem: while a timer or focus check is pending, the user may resume or interrupt execution.

Decision: `session.execution.started` cancels the family's final signal and request notifications owned by the starting session. Starting an ancestor preserves descendants' requests. An interruption suppresses the family's final signal and cancels request notifications in the interrupted subtree without marking those requests answered.

Cancellation clears the timer and calls `abort()` on an active delivery's controller. Native processes receive its `AbortSignal`; cancellation is checked again after the focus query. Unloading removes subscriptions, cancels timers and deliveries, and clears state.

Tradeoff: this cannot recall a notification already accepted by the SDK or OS. `attention.notify` does not receive the abort signal, so a sound already started or an accepted banner can remain. Failed delivery is not retried, to avoid duplicating a possibly accepted notification.

## The native backend needs explicit consent

Problem: a negative SDK result does not justify bypassing its notification policy with a native retry. An absent banner is not necessarily a terminal delivery failure.

Decision: `macos-fallback` is an explicitly selected backend, not an automatic fallback. Native banners on macOS require `nativeNotifications: true` and the TUI host app's bundle ID. They are independent of `attention.notifications`; use `nativeNotifications: false` to disable them or `enabled: false` to disable the whole plugin.

Sound uses a separate SDK call with `notification: false`, respecting SDK sound and volume settings. A sound call failure does not block the native banner. Focus is checked before delivery and again inside the native script; unknown focus suppresses the banner.

Tradeoff: focus is app-wide, not per tab or project. macOS permissions and Focus modes can still suppress display. Other operating systems use the standard terminal backend.

## Boundaries and verification

- Deduplication lives in the instance's memory until cleanup on unload. Request history and session state do not survive reloads
- Events missed during a connection loss and already-open requests are not restored
- Multiple TUIs do not share deduplication; there is no cross-TUI exactly-once guarantee
- The timer controls the delivery attempt, not the exact time a banner appears
- Automated tests check state transitions and cancellation with the OS boundary mocked. Actual banners and sounds require separate observation: see [verification and coverage](verification.md)

## Code map

- [notifications.ts](https://github.com/ex10se/opencode-attention-plus/blob/main/src/notifications.ts): subscriptions, requests, session families, timers, and cancellation
- [notifier.ts](https://github.com/ex10se/opencode-attention-plus/blob/main/src/notifier.ts): SDK, native process, and focus checks
- [options.ts](https://github.com/ex10se/opencode-attention-plus/blob/main/src/options.ts): defaults and validation
- [tui.ts](https://github.com/ex10se/opencode-attention-plus/blob/main/src/tui.ts): public SDK integration
- [State tests](https://github.com/ex10se/opencode-attention-plus/blob/main/test/notifications.test.ts) and [native backend tests](https://github.com/ex10se/opencode-attention-plus/blob/main/test/macos.test.ts): reproducible scenarios without real notifications
