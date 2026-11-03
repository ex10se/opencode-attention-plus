import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startNotifications } from '../src/notifications.ts';
import { readOptions } from '../src/options.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(t: any, config: any = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: any[] = [], processes: any[] = [];
  const handlers = new Map<string, any>();
  const ctx: any = {
    options: { language: 'ru', notificationBackend: 'macos-fallback', nativeNotifications: true, macosHostBundleId: 'com.jetbrains.pycharm', ...config.options },
    attention: { notify: async (input: any) => {
      sent.push(input);
      if (config.sdkError) throw new Error('SDK sound');
      return config.result ?? { ok: true, notification: false, sound: true };
    } },
    data: { on: (name: string, fn: any) => { handlers.set(name, fn); return () => handlers.delete(name); },
      session: { get: (id: string) => id === 'c' ? { id, parentID: 'r' } : { id: 'r' }, root: () => 'r', family: () => ['c'], status: () => 'idle' } },
  };
  const dependencies = { platform: config.platform ?? 'darwin', exec: (file: string, args: string[], options: any, cb: any) => {
    processes.push({ file, args, options, cb });
    if ((args.length === 4 && config.focusDeferred) || (args.length > 4 && config.nativeDeferred)) return;
    cb(config.processError ? new Error('timeout') : null, config.focus ?? 'com.apple.finder\n', '');
  } };
  // External OS boundary only: scheduler, backend policy and script are real.
  const stop = startNotifications(ctx, dependencies as any);
  t.after(stop);
  const emit = (name: string, data: any = { sessionID: 'r' }) => handlers.get(name)?.({ data });
  const start = async () => { emit('form.created', { form: { id: 'q', sessionID: 'r' } }); t.mock.timers.tick(2000); await flush(); };
  return { start, emit, stop, sent, processes, config };
}

test('macOS focused: sound only, independent of terminal focus reporting', async t => {
  const h = harness(t, { focus: 'com.jetbrains.pycharm\n' }); await h.start();
  assert.deepEqual(h.sent, [{ title: 'OpenCode', message: 'Агент ждёт ответа на вопрос', notification: false, sound: { name: 'question', when: 'always' } }]);
  assert.equal(h.processes.length, 1);
});

test('explicit native opt-in: one sound-only SDK call and one native banner, safe argv and focus recheck', async t => {
  const h = harness(t); await h.start();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].notification, false);
  assert.equal(h.processes.length, 2);
  for (const p of h.processes) {
    assert.equal(p.file, '/usr/bin/osascript');
    assert.equal(p.options.timeout, 5000); assert.equal(p.options.maxBuffer, 4096);
    assert.ok(p.options.signal instanceof AbortSignal);
    assert.equal(p.options.shell, undefined);
  }
  const native = h.processes[1];
  assert.deepEqual(native.args.slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.deepEqual(native.args.slice(4), ['com.jetbrains.pycharm', 'OpenCode', 'Агент ждёт ответа на вопрос']);
  const banners: any[] = [];
  let foreground: any = 'com.jetbrains.pycharm';
  const app = {
    includeStandardAdditions: false,
    displayNotification(...args: any[]) {
      if (!this.includeStandardAdditions) throw new Error('Standard Additions are not enabled');
      banners.push(args);
    },
  };
  const sandbox = vm.createContext({ ObjC: { import() {} }, $: { NSWorkspace: { sharedWorkspace: { get frontmostApplication() { return { bundleIdentifier: { js: foreground } }; } } } }, Application: { currentApplication: () => app } });
  vm.runInContext(native.args[3], sandbox);
  sandbox.args = ['com.jetbrains.pycharm', 'quoted " title', 'text "; do shell script "bad'];
  vm.runInContext('run(args)', sandbox); assert.equal(banners.length, 0);
  foreground = undefined; vm.runInContext('run(args)', sandbox); assert.equal(banners.length, 0);
  foreground = 'com.apple.finder'; vm.runInContext('run(args)', sandbox);
  assert.equal(banners.length, 1);
  assert.equal(banners[0][0], sandbox.args[2]);
  assert.equal(banners[0][1].withTitle, sandbox.args[1]);
  assert.equal(banners[0][1].soundName, undefined);
});

// Removing the explicit gate must fail even if SDK results look like unsupported delivery.
for (const nativeNotifications of [undefined, false]) {
  for (const focus of ['com.apple.finder', 'com.jetbrains.pycharm']) {
    test(`native opt-out/default performs no process: ${nativeNotifications}/${focus}`, async t => {
      const h = harness(t, { options: { nativeNotifications }, focus }); await h.start();
      assert.equal(h.processes.length, 0);
      assert.equal(h.sent.length, 1); assert.equal(h.sent[0].notification, false);
      assert.deepEqual(h.sent[0].sound, { name: 'question', when: 'always' });
    });
  }
}
for (const result of [
  { ok: false, notification: false, sound: false },
  { ok: false, notification: false, sound: false, skipped: 'attention_disabled' },
  { ok: false, notification: false, sound: false, skipped: 'renderer_destroyed' },
  { ok: false, notification: false, sound: false, skipped: 'empty_message' },
]) {
  test(`native opt-in independent of SDK sound result: ${JSON.stringify(result)}`, async t => {
    const h = harness(t, { result }); await h.start(); assert.equal(h.processes.length, 2);
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].notification, false);
  });
}
test('SDK sound rejection cannot block explicitly enabled native banner', async t => {
  const h = harness(t, { sdkError: true }); await h.start();
  assert.equal(h.processes.length, 2); assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].notification, false);
});
test('overall enabled=false disables both channels', async t => {
  const h = harness(t, { options: { enabled: false } }); await h.start();
  assert.deepEqual(h.sent, []); assert.deepEqual(h.processes, []);
});
for (const config of [{ focus: '' }, { processError: true }]) {
  test(`unknown focus or external failure contained: ${JSON.stringify(config)}`, async t => {
    const h = harness(t, config); await h.start();
    assert.equal(h.sent[0].sound.name, 'question'); assert.equal(h.processes.length, 1);
  });
}
for (const event of ['form.replied', 'form.cancelled', 'session.execution.interrupted', 'session.execution.started', 'dispose']) {
  for (const phase of ['focus', 'native']) {
    test(`${event} cancels in-flight ${phase} without stale fallback`, async t => {
      const config: any = { focusDeferred: phase === 'focus', nativeDeferred: phase === 'native' };
      const h = harness(t, config); await h.start();
      assert.equal(h.processes.length, phase === 'native' ? 2 : 1);
      if (event === 'dispose') h.stop(); else h.emit(event, { id: 'q', sessionID: 'r' });
      assert.equal(h.processes.at(-1).options.signal.aborted, true);
      h.processes.at(-1).cb(null, 'com.apple.finder', '');
      await flush();
      assert.equal(h.processes.length, phase === 'native' ? 2 : 1);
      if (phase === 'focus') assert.equal(h.sent.length, 1);
    });
  }
}
for (const phase of ['focus', 'native']) {
  for (const event of ['ancestor-start', 'owner-start', 'ancestor-interrupt']) {
    test(`child in-flight ${phase}: ${event} preserves only ordinary ancestor resume`, async t => {
      const h = harness(t, { focusDeferred: phase === 'focus', nativeDeferred: phase === 'native' });
      h.emit('form.created', { form: { id: 'q', sessionID: 'c' } });
      t.mock.timers.tick(2000); await flush();
      const process = h.processes.at(-1);
      h.emit(event === 'ancestor-interrupt' ? 'session.execution.interrupted' : 'session.execution.started', { sessionID: event === 'owner-start' ? 'c' : 'r' });
      assert.equal(process.options.signal.aborted, event !== 'ancestor-start');
      process.cb(null, 'com.apple.finder', ''); await flush();
      assert.equal(h.processes.length, phase === 'native' || event === 'ancestor-start' ? 2 : 1);
      assert.equal(h.sent.length, 1);
      assert.equal(h.sent[0].notification, false);
    });
  }
}
test('native process failure is contained', async t => {
  const h = harness(t, { nativeDeferred: true }); await h.start();
  assert.equal(h.processes.length, 2); h.processes[1].cb(new Error('timeout')); await flush();
});
test('old completion cleanup cannot delete a newer controller for the same done key', async t => {
  const h = harness(t, { nativeDeferred: true });
  h.emit('session.execution.succeeded'); t.mock.timers.tick(2000); await flush();
  const oldNative = h.processes[1];
  assert.equal(oldNative.options.signal.aborted, false);
  h.emit('session.execution.started');
  assert.equal(oldNative.options.signal.aborted, true);
  // Hold the next focus query while the cancelled native delivery settles.
  h.config.focusDeferred = true;
  h.emit('session.execution.succeeded'); t.mock.timers.tick(2000); await flush();
  const newProcess = h.processes.at(-1);
  assert.notEqual(newProcess, oldNative);
  oldNative.cb(new Error('aborted')); await flush();
  h.stop();
  assert.equal(newProcess.options.signal.aborted, true);
});
test('non-macOS keeps terminal blurred notification and sound in one SDK call', async t => {
  const h = harness(t, { platform: 'linux' }); await h.start();
  assert.equal(h.processes.length, 0); assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].notification, { when: 'blurred' });
});
test('terminal backend ignores native opt-in and keeps SDK controls', async t => {
  const h = harness(t, { options: { notificationBackend: 'terminal', nativeNotifications: true } }); await h.start();
  assert.equal(h.processes.length, 0); assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].notification, { when: 'blurred' });
  assert.deepEqual(h.sent[0].sound, { name: 'question', when: 'always' });
});
test('backend options default to terminal and reject invalid host identifiers', () => {
  assert.equal(readOptions({}).notificationBackend, 'terminal');
  assert.equal(readOptions({}).nativeNotifications, false);
  for (const nativeNotifications of [null, 1, 'true']) assert.throws(() => readOptions({ nativeNotifications }), TypeError);
  for (const notificationBackend of ['other', null, 1]) assert.throws(() => readOptions({ notificationBackend }), TypeError);
  for (const macosHostBundleId of [undefined, '', ' ', 'com.apple;bad', 'com..apple', 1]) assert.throws(() => readOptions({ notificationBackend: 'macos-fallback', macosHostBundleId }), TypeError);
  assert.equal(readOptions({ notificationBackend: 'macos-fallback', macosHostBundleId: 'com.jetbrains.pycharm' }).macosHostBundleId, 'com.jetbrains.pycharm');
});
