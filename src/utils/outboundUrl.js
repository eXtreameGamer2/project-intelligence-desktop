import dns from 'node:dns/promises';
import net from 'node:net';

export function isDesktopRuntime() {
  return process.env.CPID_DESKTOP === '1';
}

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = 'UNSAFE_AI_URL';
  throw error;
}

function ipv4ToInt(ip) {
  const parts = String(ip || '')
    .split('.')
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InRange(ip, start, end) {
  const value = ipv4ToInt(ip);
  const low = ipv4ToInt(start);
  const high = ipv4ToInt(end);
  return value != null && low != null && high != null && value >= low && value <= high;
}

export function isDisallowedIp(ip) {
  const value = String(ip || '').trim().toLowerCase();
  if (!value) return true;

  if (value.startsWith('::ffff:')) {
    return isDisallowedIp(value.slice(7));
  }

  if (net.isIP(value) === 4) {
    return (
      ipv4InRange(value, '0.0.0.0', '0.255.255.255') ||
      ipv4InRange(value, '10.0.0.0', '10.255.255.255') ||
      ipv4InRange(value, '100.64.0.0', '100.127.255.255') ||
      ipv4InRange(value, '127.0.0.0', '127.255.255.255') ||
      ipv4InRange(value, '169.254.0.0', '169.254.255.255') ||
      ipv4InRange(value, '172.16.0.0', '172.31.255.255') ||
      ipv4InRange(value, '192.168.0.0', '192.168.255.255') ||
      ipv4InRange(value, '198.18.0.0', '198.19.255.255') ||
      ipv4InRange(value, '224.0.0.0', '255.255.255.255')
    );
  }

  if (net.isIP(value) === 6) {
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
    if (value.startsWith('ff')) return true;
  }

  return false;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  );
}

/**
 * Reject loopback, link-local, metadata, and private targets before the server
 * fetches a user-supplied AI base URL. Desktop may reach local/LAN models.
 */
export async function assertSafeAiBaseUrl(rawUrl, options = {}) {
  const allowPrivate = options.allowPrivate === true;
  const requireHttps = options.requireHttps ?? !allowPrivate;
  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts : null;

  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    fail('AI endpoint URL is invalid.');
  }

  if (parsed.username || parsed.password) {
    fail('AI endpoint URL must not include credentials.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('AI endpoint must use http or https.');
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    fail('Cloud AI endpoints must use HTTPS.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowPrivate && isPrivateHostname(host)) {
    fail('This AI endpoint is not allowed on Cloud.');
  }

  if (allowedHosts?.length && !allowedHosts.some((allowed) => host === String(allowed).toLowerCase())) {
    fail('This AI provider only allows the official API host.');
  }

  let addresses = [];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      const lookup = await dns.lookup(host, { all: true, verbatim: true });
      addresses = lookup.map((row) => row.address).filter(Boolean);
    } catch {
      fail('Could not resolve the AI endpoint host.');
    }
  }

  if (!addresses.length) {
    fail('Could not resolve the AI endpoint host.');
  }

  if (!allowPrivate && addresses.some((ip) => isDisallowedIp(ip))) {
    fail('AI endpoints cannot target private or local network addresses.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Fetch with redirect disabled. On Cloud, re-validates the URL host immediately
 * before connecting to shrink DNS rebinding / TOCTOU windows.
 */
export async function outboundFetch(url, options = {}) {
  const allowPrivate = options.allowPrivate === true || isDesktopRuntime();
  const { allowPrivate: _ignored, ...fetchOptions } = options;

  if (!allowPrivate) {
    await assertSafeAiBaseUrl(url, { allowPrivate: false });
  }

  return fetch(url, { ...fetchOptions, redirect: 'error' });
}
