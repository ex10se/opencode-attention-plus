import type { Plugin } from '@opencode/plugin/tui';
import { readOptions } from './options.ts';
import { createNotifier, type NotifierDependencies } from './notifier.ts';

export type NotificationContext = Pick<Plugin.Context, 'options' | 'attention' | 'data'>;

export function startNotifications(ctx: NotificationContext, dependencies?: NotifierDependencies): () => void {
  const options = readOptions(ctx.options);
  if (!options.enabled) return () => {};
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const deliveries = new Map<string, AbortController>();
  const deliver = createNotifier(ctx.attention, options, dependencies);
  const seen = new Set<string>();
  const pending = new Map<string, string>();
  const waiting = new Set<string>();
  const failed = new Set<string>();
  const interrupted = new Set<string>();
  const ended = new Set<string>();
  let disposed = false;
  const cancel = (key: string) => {
    clearTimeout(timers.get(key)); timers.delete(key);
    deliveries.get(key)?.abort(); deliveries.delete(key);
  };
  const schedule = (key: string, callback: () => void, remaining = options.delayMs) => {
    // Node/Bun clamp overflowing timeouts to 1 ms; split large finite delays.
    const chunk = Math.min(remaining, 2 ** 31 - 1);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      if (disposed) return;
      if (remaining > chunk) { schedule(key, callback, remaining - chunk); return; }
      callback();
    }, chunk));
  };
  const notify = (key: string, name: 'question' | 'permission' | 'done' | 'error') => {
    const controller = new AbortController();
    deliveries.set(key, controller);
    void deliver(name, controller.signal).finally(() => {
      if (deliveries.get(key) === controller) deliveries.delete(key);
    }).catch(() => {});
  };
  const ready = (root: string) => {
    const session = ctx.data.session.get(root);
    const family = new Set([root, ...ctx.data.session.family(root)]);
    return session && !session.parentID && waiting.has(root) && !interrupted.has(root)
      && ![...family].some(id => ctx.data.session.status(id) === 'running')
      && ![...pending.values()].some(id => family.has(id));
  };
  const completion = (root: string) => {
    const key = `done:${root}`;
    if (!ready(root)) { cancel(key); return; }
    if (timers.has(key)) return;
    schedule(key, () => {
      if (!ready(root)) return;
      waiting.delete(root);
      notify(key, failed.has(root) ? 'error' : 'done');
    });
  };
  const request = (kind: 'question' | 'permission', data: { id: string; sessionID: string }) => {
    const key = `${kind}:${data.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    pending.set(key, data.sessionID);
    cancel(`done:${ctx.data.session.root(data.sessionID)}`);
    schedule(key, () => notify(key, kind));
  };
  const answer = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    const session = pending.get(key);
    seen.add(key); cancel(key); pending.delete(key);
    if (session) completion(ctx.data.session.root(session));
  };
  const inSubtree = (sessionID: string, ancestor: string) => {
    const visited = new Set<string>();
    let current: string | undefined = sessionID;
    while (current && !visited.has(current)) {
      if (current === ancestor) return true;
      visited.add(current);
      current = ctx.data.session.get(current)?.parentID;
    }
    return false;
  };
  const offs = [
    ctx.data.on('form.created', ({ data }) => request('question', data.form)),
    ctx.data.on('form.replied', ({ data }) => answer('question', data.id)),
    ctx.data.on('form.cancelled', ({ data }) => answer('question', data.id)),
    ctx.data.on('permission.asked', ({ data }) => request('permission', data)),
    ctx.data.on('permission.replied', ({ data }) => answer('permission', data.requestID)),
    ctx.data.on('session.execution.succeeded', ({ data }) => {
      if (ended.has(data.sessionID)) return;
      ended.add(data.sessionID);
      const root = ctx.data.session.root(data.sessionID);
      if (root === data.sessionID) waiting.add(root);
      completion(root);
    }),
    ctx.data.on('session.execution.failed', ({ data }) => {
      if (ended.has(data.sessionID)) return;
      ended.add(data.sessionID);
      const root = ctx.data.session.root(data.sessionID);
      failed.add(root);
      if (root === data.sessionID) waiting.add(root);
      completion(root);
    }),
    ctx.data.on('session.execution.interrupted', ({ data }) => {
      ended.add(data.sessionID);
      const root = ctx.data.session.root(data.sessionID);
      interrupted.add(root);
      waiting.delete(root);
      cancel(`done:${root}`);
      // Silence delivery, not the unresolved request: only reply/cancel resolves it.
      for (const [key, sessionID] of pending) {
        if (inSubtree(sessionID, data.sessionID)) cancel(key);
      }
    }),
    ctx.data.on('session.execution.started', ({ data }) => {
      const root = ctx.data.session.root(data.sessionID);
      cancel(`done:${root}`);
      // An ancestor can resume while a child's request still needs an answer.
      for (const [key, sessionID] of pending) {
        if (sessionID === data.sessionID) cancel(key);
      }
      ended.delete(data.sessionID);
      if (root === data.sessionID) {
        waiting.delete(root); failed.delete(root); interrupted.delete(root);
        for (const child of ctx.data.session.family(root)) ended.delete(child);
      }
    }),
  ];
  return () => {
    if (disposed) return;
    disposed = true;
    offs.reverse().forEach(off => off());
    for (const key of timers.keys()) cancel(key);
    for (const key of deliveries.keys()) cancel(key);
    seen.clear(); pending.clear(); waiting.clear();
    failed.clear(); interrupted.clear(); ended.clear();
  };
}
