import { execFile } from 'node:child_process';
import type { Plugin } from '@opencode/plugin/tui';
import type { readOptions } from './options.ts';

export interface NotifierDependencies {
  platform: string;
  exec: typeof execFile;
}
const defaults: NotifierDependencies = { platform: process.platform, exec: execFile };
const focusScript = `ObjC.import('AppKit');
function foreground() {
  try {
    var id = $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js;
    return typeof id === 'string' ? id : '';
  } catch (_) { return ''; }
}`;
const queryScript = `${focusScript}
function run() { return foreground(); }`;
const bannerScript = `${focusScript}
function run(argv) {
  var active = foreground();
  if (!active || active === argv[0]) return;
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.displayNotification(argv[2], {withTitle: argv[1]});
}`;

export function createNotifier(
  attention: Plugin.Context['attention'],
  options: ReturnType<typeof readOptions>,
  dependencies: NotifierDependencies = defaults,
) {
  const run = (script: string, args: string[], signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    if (signal.aborted) { resolve(''); return; }
    dependencies.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args],
      { timeout: 5000, maxBuffer: 4096, signal }, (error, stdout) => {
        if (error) reject(error); else resolve(String(stdout).trim());
      });
  });
  return async (name: 'question' | 'permission' | 'done' | 'error', signal: AbortSignal) => {
    const messages = { question: 'Агент ждёт ответа на вопрос', permission: 'Требуется твоё разрешение', done: 'Агент завершил ответ и ждёт ввода', error: 'Агент остановился с ошибкой' };
    const content = { title: 'OpenCode', message: messages[name] };
    if (signal.aborted) return;
    try {
      if (options.notificationBackend !== 'macos-fallback' || dependencies.platform !== 'darwin') {
        await attention.notify({ ...content, notification: { when: 'blurred' }, sound: { name, when: 'always' } });
        return;
      }
      // Sound stays in the SDK: its global enablement, volume and sounds apply.
      // Do not let sound failure delay or reject the independent banner path.
      void attention.notify({ ...content, notification: false, sound: { name, when: 'always' } }).catch(() => {});
      // Explicit plugin opt-in, independent of global SDK notification settings.
      if (!options.nativeNotifications) return;
      const active = await run(queryScript, [], signal);
      if (signal.aborted || !active || active === options.macosHostBundleId) return;
      // argv carries data only; the fixed program checks focus again before display.
      await run(bannerScript, [options.macosHostBundleId!, content.title, content.message], signal);
    } catch {
      // OS/SDK failure is fail-closed; never retry a possibly accepted delivery.
    }
  };
}
