import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNotifier } from '../src/notifier.ts';
import { readOptions } from '../src/options.ts';
import { startNotifications } from '../src/notifications.ts';

const names = ['question', 'permission', 'done', 'error'] as const;
const expected = {
  en: ['The agent is waiting for your answer', 'Permission required', 'The agent has finished and is waiting for input', 'The agent stopped with an error'],
  ru: ['Агент ждёт ответа на вопрос', 'Требуется твоё разрешение', 'Агент завершил ответ и ждёт ввода', 'Агент остановился с ошибкой'],
};
for (const [field, value, message] of [
  ['language', 'de', 'language must be auto, en, or ru'],
  ['enabled', null, 'enabled must be a boolean'],
  ['nativeNotifications', null, 'nativeNotifications must be a boolean'],
  ['delayMs', -1, 'delayMs must be a finite nonnegative number'],
  ['notificationBackend', 'other', 'notificationBackend must be terminal or macos-fallback'],
  ['macosHostBundleId', '', 'macosHostBundleId must be a nonempty application bundle ID'],
] as const) {
  test(`${field}: invalid options report an English TypeError`, () => {
    assert.throws(() => readOptions({ [field]: value }), { name: 'TypeError', message });
  });
}
function harness(language: unknown, backend = 'terminal', locale = 'ru-RU', deferred = false, platform = 'darwin') {
  const sent: any[] = [], processes: any[] = [];
  let runtimeQueries = 0;
  const dependencies: any = { platform, locale: () => { runtimeQueries++; return locale; }, exec: (file: string, args: string[], options: any, cb: any) => {
    processes.push({ file, args, options, cb });
    if (args[3].includes('Foundation')) { if (!deferred) cb(null, locale); }
    else cb(null, 'com.apple.finder');
  } };
  const notify = createNotifier({ notify: async (value: any) => { sent.push(value); } } as any,
    readOptions({ language, notificationBackend: backend, nativeNotifications: true, macosHostBundleId: 'com.jetbrains.pycharm' }), dependencies);
  return { notify, sent, processes, dependencies, runtimeQueries: () => runtimeQueries };
}

test('language defaults to auto and rejects unsupported or non-string values', () => {
  assert.equal((readOptions({}) as any).language, 'auto');
  for (const language of [null, '', 'de', 'RU', 1, false, {}, []]) assert.throws(() => readOptions({ language }), TypeError);
});
for (const language of ['en', 'ru'] as const) for (const backend of ['terminal', 'macos-fallback']) {
  test(`${language}/${backend}: four translated messages, unchanged title/sounds, no locale query`, async () => {
    const h = harness(language, backend);
    for (const name of names) await h.notify(name, new AbortController().signal);
    assert.deepEqual(h.sent.map(x => x.message), expected[language]);
    assert.deepEqual(h.sent.map(x => x.title), names.map(() => 'OpenCode'));
    assert.deepEqual(h.sent.map(x => x.sound), names.map(name => ({ name, when: 'always' })));
    assert.equal(h.processes.filter(p => p.args[3].includes('Foundation')).length, 0);
    assert.equal(h.runtimeQueries(), 0);
    if (backend === 'macos-fallback') {
      assert.deepEqual(h.processes.filter(p => p.args.length > 4).map(p => p.args.slice(4)), expected[language].map(text => ['com.jetbrains.pycharm', 'OpenCode', text]));
      for (const p of h.processes) assert.ok(p.options.signal instanceof AbortSignal);
    } else assert.equal(h.processes.length, 0);
  });
}
for (const [locale, language] of [['ru-RU', 'ru'], ['ru_RU', 'ru'], ['en-US', 'en'], ['de-DE', 'en'], ['', 'en'], ['unknown', 'en'], ['ru-???', 'en']]) {
  for (const platform of ['darwin', 'linux']) test(`auto ${platform}/${locale || 'empty'} resolves once`, async () => {
    const h = harness(undefined, 'terminal', locale, false, platform);
    for (const name of names) await h.notify(name, new AbortController().signal);
    assert.deepEqual(h.sent.map(x => x.message), expected[language as 'en' | 'ru']);
    assert.equal(h.processes.length, platform === 'darwin' ? 1 : 0);
    assert.equal(h.runtimeQueries(), platform === 'darwin' ? 0 : 1);
  });
}
test('macOS query is bounded, reads only first preferred language, not first supported language', async () => {
  const h = harness('auto');
  assert.equal(h.processes.length, 1);
  const p = h.processes[0];
  assert.equal(p.file, '/usr/bin/osascript');
  assert.deepEqual(p.args.slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.equal(p.options.timeout, 1000); assert.equal(p.options.maxBuffer, 1024);
  assert.equal(p.options.shell, undefined);
  const sandbox = vm.createContext({ ObjC: { import() {} }, $: { NSLocale: { preferredLanguages: { count: 2, objectAtIndex: (i: number) => ({ js: ['de-DE', 'ru-RU'][i] }) } } } });
  assert.equal(vm.runInContext(`${p.args[3]}; run()`, sandbox), 'de-DE');
  await h.notify('done', new AbortController().signal);
});
for (const backend of ['terminal', 'macos-fallback']) test(`${backend}: cancellation while resolving cannot deliver late or poison shared locale`, async () => {
  const h = harness('auto', backend, 'ru-RU', true);
  const controller = new AbortController();
  const first = h.notify('question', controller.signal);
  controller.abort();
  assert.equal(h.sent.length, 0);
  h.processes[0].cb(null, 'ru-RU');
  await first;
  assert.equal(h.sent.length, 0);
  await h.notify('permission', new AbortController().signal);
  assert.equal(h.sent[0].message, expected.ru[1]);
  assert.equal(h.processes.filter(p => p.args[3].includes('Foundation')).length, 1);
});
test('failed macOS lookup falls back to English without unhandled rejection', async () => {
  const h = harness('auto', 'terminal', '', true);
  h.processes[0].cb(new Error('timeout'));
  await new Promise(resolve => setImmediate(resolve));
  await h.notify('error', new AbortController().signal);
  assert.equal(h.sent[0].message, expected.en[3]);
});
test('throwing Intl locale lookup falls back to English', async () => {
  const sent: any[] = [];
  const notify = createNotifier({ notify: async (value: any) => { sent.push(value); } } as any, readOptions({}),
    { platform: 'linux', exec: () => assert.fail('no OS process'), locale: () => { throw new Error('Intl'); } } as any);
  await notify('question', new AbortController().signal);
  assert.equal(sent[0].message, expected.en[0]);
});
test('disabled auto plugin does not query OS or subscribe', () => {
  const stop = startNotifications({ options: { enabled: false }, attention: {}, data: {} } as any,
    { platform: 'darwin', exec: () => assert.fail('disabled locale query') } as any);
  stop();
});

test('auto native backend uses the same English text for SDK and all four banners', async () => {
  const h = harness('auto', 'macos-fallback', 'de-DE');
  for (const name of names) await h.notify(name, new AbortController().signal);
  assert.deepEqual(h.sent.map(x => x.message), expected.en);
  assert.deepEqual(h.processes.filter(p => p.args.length > 4).map(p => p.args[6]), expected.en);
  assert.equal(h.processes.filter(p => p.args[3].includes('Foundation')).length, 1);
});
test('synchronous process launch failure falls back to English', async () => {
  const sent: any[] = [];
  const notify = createNotifier({ notify: async (value: any) => { sent.push(value); } } as any, readOptions({}),
    { platform: 'darwin', exec: () => { throw new Error('spawn'); } } as any);
  await notify('done', new AbortController().signal);
  assert.equal(sent[0].message, expected.en[2]);
});
test('already aborted delivery does not wait for locale or send anything', async () => {
  const h = harness('auto', 'terminal', '', true);
  const controller = new AbortController(); controller.abort();
  await h.notify('question', controller.signal);
  assert.deepEqual(h.sent, []);
  h.processes[0].cb(null, 'ru-RU');
});
