# Changelog

## 0.1.0

- Added notification language selection: `auto` / `en` / `ru`; the system language is detected once, with English as the fallback for unsupported locales or lookup errors
- Added a TUI plugin for OpenCode 2.2.5 with the `opencode-attention-plus/tui` export
- Added question, permission, completion, and error notifications with a configurable delay
- Added waiting for child sessions, duplicate suppression, and cancellation of stale notifications
- Added a native macOS backend with explicit `nativeNotifications` opt-in and app focus checks
- Kept sound under OpenCode's standard settings
- Preserved notifications for descendants' requests when a parent starts a new run
- Added tests for the scheduler, native backend, and packaged plugin installation
