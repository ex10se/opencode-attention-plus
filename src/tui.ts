import { Plugin } from '@opencode/plugin/tui';
import { startNotifications } from './notifications.ts';
import type { NotifierDependencies } from './notifier.ts';

export function setup(ctx: Plugin.Context, dependencies?: NotifierDependencies): () => void {
  return startNotifications(ctx, dependencies);
}

export default Plugin.define({
  id: 'opencode-attention-plus',
  setup,
});
