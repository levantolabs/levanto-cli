// Key format and masking. The key itself is never printed.

export const KEY_PATTERN = /^lv_live_[0-9a-f]{48}$/;
export const KEYS_URL = 'https://platform.levanto.ai/intelligence/keys';
export const ENV_NAME = 'LEVANTO_API_KEY';

export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/** `lv_live_…abcd`: enough to recognise the key, never enough to use it. */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length < 12) return 'lv_live_…';
  return `lv_live_…${key.slice(-4)}`;
}
