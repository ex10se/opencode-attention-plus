import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import plugin from '../src/tui.ts';

test('package exposes only the TUI entrypoint and pins the SDK', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(pkg.exports), ['./tui']);
  assert.equal(pkg.dependencies['@opencode/plugin'], '2.2.5');
  assert.notEqual(pkg.private, true, 'package must allow npm publication');
  assert.equal(pkg.license, 'MIT');
  assert.equal(plugin.id, 'opencode-attention-plus');
  assert.equal(typeof plugin.setup, 'function');
});

test('tarball installs in isolation and imports with the real SDK', { skip: !process.env.ATTENTION_PACK_TEST }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'attention-pack-'));
  try {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { encoding: 'utf8' });
    const [pack] = JSON.parse(output.slice(output.indexOf('[\n')));
    t.diagnostic(`tarball: ${pack.files.length} files`);
    const packedPaths = new Set(pack.files.map((file: { path: string }) => file.path));
    for (const path of ['LICENSE', 'README.md', 'README.ru.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'docs/releasing.md', 'docs/verification.md', 'docs/design.md', 'docs/assets/demo.gif']) {
      assert.ok(packedPaths.has(path), `tarball is missing ${path}`);
    }
    assert.ok(pack.files.some((file: { path: string }) => file.path === 'dist/tui.js'));
    assert.ok(!pack.files.some((file: { path: string }) => /^(src|test|\.idea|node_modules)\//.test(file.path)));
    execFileSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', join(dir, pack.filename)], { stdio: 'pipe' });
    assert.equal(readFileSync(join(dir, 'node_modules/opencode-attention-plus/LICENSE'), 'utf8'), `MIT License

Copyright (c) 2026 Mikhail Belyakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
    const smoke = `import assert from 'node:assert/strict';
      const plugin = (await import('opencode-attention-plus/tui')).default;
      assert.equal(plugin.id, 'opencode-attention-plus');
      const { mock } = await import('node:test');
      mock.timers.enable({ apis: ['setTimeout'] });
      const handlers = new Map();
      const sent = [];
      const context = {
        options: { language: 'ru' },
        attention: { notify: async value => { sent.push(value); return { ok: false, notification: false, sound: false }; } },
        data: {
          on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
          session: { get: id => ({ id }), root: id => id, family: () => [], status: () => 'idle' },
        },
      };
      const stop = plugin.setup(context);
      assert.equal(typeof stop, 'function');
      assert.ok(handlers.size > 0);
      handlers.get('permission.asked')({ data: { id: 'p', sessionID: 'r' } });
      mock.timers.tick(1999); assert.equal(sent.length, 0);
      mock.timers.tick(1);
      assert.deepEqual(sent, [{ title: 'OpenCode', message: 'Требуется твоё разрешение', notification: { when: 'blurred' }, sound: { name: 'permission', when: 'always' } }]);
      handlers.get('form.created')({ data: { form: { id: 'q', sessionID: 'r' } } });
      stop(); assert.equal(handlers.size, 0);
      mock.timers.tick(2000); assert.equal(sent.length, 1);
      const stopEnglish = plugin.setup({ ...context, options: { language: 'en' } });
      handlers.get('permission.asked')({ data: { id: 'p-en', sessionID: 'r' } });
      mock.timers.tick(2000);
      assert.equal(sent.at(-1).message, 'Permission required');
      stopEnglish(); assert.equal(handlers.size, 0);
      mock.timers.reset();
      await assert.rejects(import('opencode-attention-plus'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      console.log('packed TUI import OK');`;
    assert.match(execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: resolve(dir), encoding: 'utf8' }), /packed TUI import OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
