/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computes a deterministic device ID using canvas and hardware fingerprinting.
 * Even if the user clears cookies, localStorage, and site data, this function
 * generates the exact same device ID on the same browser/device combination,
 * allowing the app to restore their cloud-saved "Mi Lista" from Supabase!
 */
export function getStableDeviceId(): string {
  try {
    // 1. First check if cached in localStorage for ultra-fast response
    const stored = localStorage.getItem('hk_device_id');
    if (stored && stored.length > 10) {
      return stored;
    }

    // 2. Build deterministic hardware & environment signature
    const components: string[] = [
      navigator.userAgent || '',
      navigator.language || '',
      String(screen.width || 0),
      String(screen.height || 0),
      String(screen.colorDepth || 0),
      String(new Date().getTimezoneOffset() || 0),
      String(navigator.hardwareConcurrency || 0),
    ];

    // Canvas fingerprinting (creates a unique visual render hash per GPU/browser)
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px "Arial", sans-serif';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('KuzeHentai_Archive_v1', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('KuzeHentai_Archive_v1', 4, 17);
        components.push(canvas.toDataURL());
      }
    } catch (e) {
      // Ignore canvas errors
    }

    const rawStr = components.join('###');

    // FNV-1a 32-bit hash function converted to hexadecimal string
    let hash = 2166136261;
    for (let i = 0; i < rawStr.length; i++) {
      hash ^= rawStr.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const hexHash = (hash >>> 0).toString(16).padStart(8, '0');
    const deviceId = `dev_${hexHash}`;

    // Cache in localStorage
    try {
      localStorage.setItem('hk_device_id', deviceId);
    } catch (e) {
      // Ignore storage errors
    }

    return deviceId;
  } catch (e) {
    return 'dev_default_user';
  }
}
