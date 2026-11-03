export function readOptions(input: Readonly<Record<string, unknown>>) {
  const enabled = input.enabled === undefined ? true : input.enabled;
  const delayMs = input.delayMs === undefined ? 2000 : input.delayMs;
  const language = input.language === undefined ? 'auto' : input.language;
  if (language !== 'auto' && language !== 'en' && language !== 'ru') {
    throw new TypeError('language must be auto, en, or ru');
  }
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
  const nativeNotifications = input.nativeNotifications === undefined ? false : input.nativeNotifications;
  if (typeof nativeNotifications !== 'boolean') throw new TypeError('nativeNotifications must be a boolean');
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError('delayMs must be a finite nonnegative number');
  }
  const notificationBackend = input.notificationBackend === undefined ? 'terminal' : input.notificationBackend;
  if (notificationBackend !== 'terminal' && notificationBackend !== 'macos-fallback') {
    throw new TypeError('notificationBackend must be terminal or macos-fallback');
  }
  const macosHostBundleId = input.macosHostBundleId;
  if ((notificationBackend === 'macos-fallback' || macosHostBundleId !== undefined)
    && (typeof macosHostBundleId !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(macosHostBundleId))) {
    throw new TypeError('macosHostBundleId must be a nonempty application bundle ID');
  }
  return { enabled, delayMs, language: language as 'auto' | 'en' | 'ru', notificationBackend, nativeNotifications, macosHostBundleId: macosHostBundleId as string | undefined };
}
