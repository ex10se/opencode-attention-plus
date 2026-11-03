export function readOptions(input: Readonly<Record<string, unknown>>) {
  const enabled = input.enabled === undefined ? true : input.enabled;
  const delayMs = input.delayMs === undefined ? 2000 : input.delayMs;
  if (typeof enabled !== 'boolean') throw new TypeError('enabled должен быть boolean');
  const nativeNotifications = input.nativeNotifications === undefined ? false : input.nativeNotifications;
  if (typeof nativeNotifications !== 'boolean') throw new TypeError('nativeNotifications должен быть boolean');
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError('delayMs должен быть конечным неотрицательным числом');
  }
  const notificationBackend = input.notificationBackend === undefined ? 'terminal' : input.notificationBackend;
  if (notificationBackend !== 'terminal' && notificationBackend !== 'macos-fallback') {
    throw new TypeError('notificationBackend должен быть terminal или macos-fallback');
  }
  const macosHostBundleId = input.macosHostBundleId;
  if ((notificationBackend === 'macos-fallback' || macosHostBundleId !== undefined)
    && (typeof macosHostBundleId !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(macosHostBundleId))) {
    throw new TypeError('macosHostBundleId должен быть непустым bundle ID приложения');
  }
  return { enabled, delayMs, notificationBackend, nativeNotifications, macosHostBundleId: macosHostBundleId as string | undefined };
}
