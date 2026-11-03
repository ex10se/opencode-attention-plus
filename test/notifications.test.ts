import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startNotifications } from '../src/notifications.ts';
import { readOptions } from '../src/options.ts';

function harness(t: any, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: any[] = [];
  const handlers = new Map<string, (event: any) => void>();
  const sessions = new Map<string, { id: string; parentID?: string }>([['r', { id: 'r' }]]);
  const running = new Set<string>();
  const root = (id: string): string => sessions.get(id)?.parentID ? root(sessions.get(id)!.parentID!) : id;
  const ctx = { options, attention: { notify: async (value: any) => { sent.push(value); return { ok: false, notification: false, sound: false }; } }, data: {
    on: (name: string, handler: (event: any) => void) => { handlers.set(name, handler); return () => { handlers.delete(name); }; },
    session: { get: (id: string) => sessions.get(id), root, family: (id: string) => [...sessions.keys()].filter(key => root(key) === id && key !== id), status: (id: string) => running.has(id) ? 'running' : 'idle' },
  } };
  const stop = startNotifications(ctx);
  const emit = (name: string, data: any) => handlers.get(name)?.({ data });
  const execution = (id: string, outcome: string) => {
    if (outcome === 'started') running.add(id); else running.delete(id);
    emit(`session.execution.${outcome}`, { sessionID: id });
  };
  t.after(stop);
  return { sent, emit, execution, sessions, running, stop, handlers, ctx, tick: (ms = 2000) => t.mock.timers.tick(ms) };
}

test('разрешение: быстрый ответ и поздний дубль не уведомляют', (t) => {
  const h = harness(t);
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.tick(100);
  h.emit('permission.replied', { requestID: 'p', sessionID: 'r' });
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.tick();
  assert.deepEqual(h.sent, []);
  h.emit('permission.asked', { id: 'p2', sessionID: 'r' });
  h.tick();
  assert.equal(h.sent[0]?.sound.name, 'permission');
});

test('завершение корня ждёт потомков и отвеченного уже доставленного вопроса', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.sessions.set('g', { id: 'g', parentID: 'c' });
  h.execution('r', 'started'); h.execution('g', 'started');
  h.emit('form.created', { form: { id: 'q', sessionID: 'g' } });
  h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['question']);
  h.execution('g', 'succeeded'); h.tick();
  assert.equal(h.sent.length, 1);
  h.emit('form.replied', { id: 'q', sessionID: 'g' });
  h.tick(1999); assert.equal(h.sent.length, 1);
  h.tick(1); assert.deepEqual(h.sent.map(x => x.sound.name), ['question', 'done']);
});

test('ошибка потомка не превращается в успех корня', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.execution('r', 'started'); h.execution('c', 'started');
  h.execution('c', 'failed'); h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['error']);
});

test('прерывание корня отменяет ожидающий успех и поздние события потомков', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.execution('r', 'started'); h.execution('r', 'succeeded'); h.tick(1000);
  h.execution('r', 'interrupted'); h.execution('c', 'succeeded'); h.tick();
  h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent, []);
});

test('прерывание корня через 100 мс отменяет таймеры вопроса и разрешения всей семьи', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.emit('form.created', { form: { id: 'root-q', sessionID: 'r' } });
  h.emit('form.created', { form: { id: 'q', sessionID: 'c' } });
  h.tick(100); h.execution('r', 'interrupted');
  h.tick(1900); assert.deepEqual(h.sent, []);
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.emit('form.created', { form: { id: 'q', sessionID: 'c' } });
  h.tick(); assert.deepEqual(h.sent, []);
  h.execution('r', 'started'); h.execution('r', 'succeeded');
  h.tick(); assert.deepEqual(h.sent, []);
  h.emit('permission.replied', { requestID: 'p', sessionID: 'r' });
  h.tick(); assert.deepEqual(h.sent, []);
  h.emit('form.replied', { id: 'root-q', sessionID: 'r' });
  h.tick(); assert.deepEqual(h.sent, []);
  h.emit('form.cancelled', { id: 'q', sessionID: 'c' });
  h.tick(); assert.deepEqual(h.sent.map(x => x.sound.name), ['done']);
});

test('новый запуск отменяет старый таймер и сбрасывает результат; дубли завершения подавляются', (t) => {
  const h = harness(t);
  h.execution('r', 'started'); h.execution('r', 'failed'); h.tick(1000);
  h.execution('r', 'started'); h.tick(); assert.deepEqual(h.sent, []);
  h.execution('r', 'succeeded'); h.tick();
  h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['done']);
  h.execution('r', 'started'); h.execution('r', 'interrupted'); h.tick();
  h.execution('r', 'started'); h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['done', 'done']);
});

test('прерывание ребёнка глушит только его поддерево, не соседей и другие корни', (t) => {
  const h = harness(t);
  for (const [id, parentID] of [['c', 'r'], ['g', 'c'], ['sibling', 'r']]) h.sessions.set(id, { id, parentID });
  h.sessions.set('other', { id: 'other' });
  h.emit('permission.asked', { id: 'child-p', sessionID: 'c' });
  h.emit('form.created', { form: { id: 'grand-q', sessionID: 'g' } });
  h.emit('permission.asked', { id: 'sibling-p', sessionID: 'sibling' });
  h.emit('form.created', { form: { id: 'other-q', sessionID: 'other' } });
  h.tick(100); h.execution('c', 'interrupted'); h.execution('r', 'succeeded');
  h.tick(1900);
  assert.deepEqual(h.sent.map(x => x.sound.name), ['permission', 'question']);
  h.emit('permission.asked', { id: 'child-p', sessionID: 'c' });
  h.emit('form.created', { form: { id: 'grand-q', sessionID: 'g' } });
  h.tick(); assert.equal(h.sent.length, 2);
});

test('доставленный запрос остаётся блокером после прерывания и нового запуска до ответа', (t) => {
  const h = harness(t);
  h.emit('permission.asked', { id: 'p', sessionID: 'r' }); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['permission']);
  h.execution('r', 'interrupted');
  h.execution('r', 'started'); h.execution('r', 'succeeded'); h.tick();
  assert.equal(h.sent.length, 1);
  h.emit('permission.asked', { id: 'p', sessionID: 'r' }); h.tick();
  assert.equal(h.sent.length, 1);
  h.emit('permission.replied', { requestID: 'p', sessionID: 'r' }); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['permission', 'done']);
});

test('enabled=false отключает подписки и уведомления', (t) => {
  const h = harness(t, { enabled: false });
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent, []);
  assert.equal(h.handlers.size, 0);
});

test('опции валидируются, пользовательская задержка применяется', (t) => {
  assert.deepEqual(readOptions({}), { enabled: true, delayMs: 2000, notificationBackend: 'terminal', nativeNotifications: false, macosHostBundleId: undefined });
  for (const delayMs of [-1, NaN, Infinity, '2', null]) assert.throws(() => readOptions({ delayMs }), TypeError);
  assert.throws(() => readOptions({ enabled: 'false' }), TypeError);
  const h = harness(t, { delayMs: 10 });
  h.execution('r', 'succeeded'); h.tick(9); assert.equal(h.sent.length, 0);
  h.tick(1); assert.equal(h.sent.length, 1);
});

test('ошибка корня уведомляет один раз, включая поздний дубль', (t) => {
  const h = harness(t);
  h.execution('r', 'failed'); h.execution('r', 'failed'); h.tick();
  h.execution('r', 'failed'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['error']);
});

test('большая конечная задержка не переполняет системный таймер', (t) => {
  const h = harness(t, { delayMs: 2 ** 31 + 10 });
  h.execution('r', 'succeeded'); h.tick(2000);
  assert.deepEqual(h.sent, []);
});

for (const kind of ['question', 'permission']) {
  for (const owner of ['c', 'g']) {
    test(`${kind}: старт предка через 1331 мс сохраняет дедлайн запроса ${owner}`, t => {
      const h = harness(t);
      h.sessions.set('c', { id: 'c', parentID: 'r' });
      h.sessions.set('g', { id: 'g', parentID: 'c' });
      h.execution('r', 'started'); h.execution(owner, 'started');
      h.emit(kind === 'question' ? 'form.created' : 'permission.asked', kind === 'question' ? { form: { id: 'x', sessionID: owner } } : { id: 'x', sessionID: owner });
      h.tick(1331); h.execution('r', 'succeeded'); h.execution('r', 'started');
      if (owner === 'g') h.execution('c', 'started');
      h.tick(668); assert.deepEqual(h.sent, []);
      h.tick(1); assert.deepEqual(h.sent.map(x => x.sound.name), [kind]);
      h.execution('r', 'succeeded'); h.execution(owner, 'succeeded');
      if (owner === 'g') h.execution('c', 'succeeded');
      h.tick(); assert.equal(h.sent.length, 1);
      h.emit(kind === 'question' ? 'form.replied' : 'permission.replied', { id: 'x', requestID: 'x', sessionID: owner });
      h.tick(1999); assert.equal(h.sent.length, 1);
      h.tick(1); assert.deepEqual(h.sent.map(x => x.sound.name), [kind, 'done']);
    });
  }
  test(`${kind}: новый запуск владельца отменяет собственный запрос без повторной доставки`, t => {
    const h = harness(t);
    const create = () => h.emit(kind === 'question' ? 'form.created' : 'permission.asked', kind === 'question' ? { form: { id: 'x', sessionID: 'r' } } : { id: 'x', sessionID: 'r' });
    create(); h.tick(1331); h.execution('r', 'started');
    h.tick(); create(); h.execution('r', 'succeeded'); h.tick();
    assert.deepEqual(h.sent, []);
    h.emit(kind === 'question' ? 'form.replied' : 'permission.replied', { id: 'x', requestID: 'x', sessionID: 'r' });
    h.tick(); assert.deepEqual(h.sent.map(x => x.sound.name), ['done']);
  });
  test(`${kind}: дубли до/после доставки; ответ после доставки разблокирует корень`, (t) => {
    const h = harness(t);
    const create = () => h.emit(kind === 'question' ? 'form.created' : 'permission.asked', kind === 'question' ? { form: { id: 'x', sessionID: 'r' } } : { id: 'x', sessionID: 'r' });
    create(); h.tick(1000); create(); h.tick(999); assert.equal(h.sent.length, 0);
    h.tick(1); create(); h.tick(); assert.equal(h.sent.length, 1);
    h.execution('r', 'succeeded'); h.tick(); assert.equal(h.sent.length, 1);
    h.emit(kind === 'question' ? 'form.replied' : 'permission.replied', { id: 'x', requestID: 'x', sessionID: 'r' });
    create(); h.tick(); assert.deepEqual(h.sent.map(x => x.sound.name), [kind, 'done']);
  });
}

test('отмена формы и ответ до создания подавляют устаревший вопрос', (t) => {
  const h = harness(t);
  h.emit('form.created', { form: { id: 'q', sessionID: 'r' } });
  h.execution('r', 'succeeded');
  h.emit('form.cancelled', { id: 'q', sessionID: 'r' });
  h.emit('form.created', { form: { id: 'q', sessionID: 'r' } });
  h.emit('form.replied', { id: 'early', sessionID: 'r' });
  h.emit('form.created', { form: { id: 'early', sessionID: 'r' } });
  h.tick(); assert.deepEqual(h.sent.map(x => x.sound.name), ['done']);
});

test('поздний старт потомка переносит завершение на полные 2 секунды после его конца', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.execution('r', 'succeeded'); h.tick(1999);
  h.execution('c', 'started'); h.tick(); assert.equal(h.sent.length, 0);
  h.execution('c', 'succeeded'); h.tick(1999); assert.equal(h.sent.length, 0);
  h.tick(1); assert.equal(h.sent.length, 1);
});

test('прерванный потомок не даёт успех; конец потомка без конца корня молчит', (t) => {
  const h = harness(t);
  h.sessions.set('c', { id: 'c', parentID: 'r' });
  h.execution('c', 'succeeded'); h.tick(); assert.deepEqual(h.sent, []);
  h.execution('c', 'started'); h.execution('c', 'interrupted');
  h.execution('r', 'succeeded'); h.tick(); assert.deepEqual(h.sent, []);
});

test('два корня независимы, отсутствующая сессия не уведомляет о завершении', (t) => {
  const h = harness(t);
  h.sessions.set('other', { id: 'other' });
  h.emit('form.created', { form: { id: 'q', sessionID: 'r' } });
  h.execution('r', 'succeeded'); h.execution('other', 'failed'); h.execution('missing', 'succeeded');
  h.tick(); assert.deepEqual(h.sent.map(x => x.sound.name), ['question', 'error']);
  h.emit('form.replied', { id: 'q', sessionID: 'r' }); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['question', 'error', 'done']);
});

test('cleanup снимает подписки и таймеры, reload не дублирует уведомление', (t) => {
  const h = harness(t);
  h.emit('permission.asked', { id: 'p', sessionID: 'r' });
  h.stop(); h.stop(); assert.equal(h.handlers.size, 0);
  h.tick(); assert.deepEqual(h.sent, []);
  const stop = startNotifications(h.ctx);
  h.execution('r', 'succeeded'); h.tick();
  assert.deepEqual(h.sent.map(x => x.sound.name), ['done']);
  stop(); assert.equal(h.handlers.size, 0);
});

test('отклонённый attention promise обработан', async (t) => {
  const h = harness(t);
  h.ctx.attention.notify = async () => { throw new Error('transport'); };
  h.execution('r', 'succeeded'); h.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent, []);
});

test('вопрос доставляется через 2000 мс, не через 1999', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: unknown[] = [];
  const handlers = new Map<string, (event: any) => void>();
  const stop = startNotifications({
    options: {},
    attention: { notify: async (value: unknown) => { sent.push(value); } },
    data: {
      on: (name: string, handler: (event: any) => void) => { handlers.set(name, handler); return () => handlers.delete(name); },
      session: { get: () => ({ id: 'root' }), root: () => 'root', family: () => [], status: () => 'idle' },
    },
  });
  handlers.get('form.created')!({ data: { form: { id: 'q', sessionID: 'root' } } });
  t.mock.timers.tick(1999);
  assert.equal(sent.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(sent, [{ title: 'OpenCode', message: 'Агент ждёт ответа на вопрос', notification: { when: 'blurred' }, sound: { name: 'question', when: 'always' } }]);
  stop();
});
