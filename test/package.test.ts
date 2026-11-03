import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import plugin from '../src/tui.ts';

test('пакет имеет только TUI export и закреплённый SDK', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(pkg.exports), ['./tui']);
  assert.equal(pkg.dependencies['@opencode/plugin'], '2.2.5');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(plugin.id, 'opencode-attention-plus');
  assert.equal(typeof plugin.setup, 'function');
});

test('tarball устанавливается отдельно и импортируется с настоящим SDK', { skip: !process.env.ATTENTION_PACK_TEST }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'attention-pack-'));
  try {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { encoding: 'utf8' });
    const [pack] = JSON.parse(output.slice(output.indexOf('[\n')));
    assert.ok(pack.files.some((file: { path: string }) => file.path === 'dist/tui.js'));
    assert.ok(!pack.files.some((file: { path: string }) => /^(src|test|\.idea|node_modules)\//.test(file.path)));
    execFileSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', join(dir, pack.filename)], { stdio: 'pipe' });
    const smoke = `import assert from 'node:assert/strict';
      const plugin = (await import('opencode-attention-plus/tui')).default;
      assert.equal(plugin.id, 'opencode-attention-plus');
      const { mock } = await import('node:test');
      mock.timers.enable({ apis: ['setTimeout'] });
      const handlers = new Map();
      const sent = [];
      const stop = plugin.setup({
        options: {},
        attention: { notify: async value => { sent.push(value); return { ok: false, notification: false, sound: false }; } },
        data: {
          on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
          session: { get: id => ({ id }), root: id => id, family: () => [], status: () => 'idle' },
        },
      });
      assert.equal(typeof stop, 'function');
      assert.ok(handlers.size > 0);
      handlers.get('permission.asked')({ data: { id: 'p', sessionID: 'r' } });
      mock.timers.tick(1999); assert.equal(sent.length, 0);
      mock.timers.tick(1);
      assert.deepEqual(sent, [{ title: 'OpenCode', message: 'Требуется твоё разрешение', notification: { when: 'blurred' }, sound: { name: 'permission', when: 'always' } }]);
      handlers.get('form.created')({ data: { form: { id: 'q', sessionID: 'r' } } });
      stop(); assert.equal(handlers.size, 0);
      mock.timers.tick(2000); assert.equal(sent.length, 1);
      mock.timers.reset();
      await assert.rejects(import('opencode-attention-plus'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      console.log('packed TUI import OK');`;
    assert.match(execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: resolve(dir), encoding: 'utf8' }), /packed TUI import OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
