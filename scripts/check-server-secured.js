/**
 * Server secured — defensive config + secure-behavior probes.
 *
 * Does NOT run exploits, fuzzers, or attack payloads. Only checks that
 * expected secure behavior is present (auth required, TLS on public URLs,
 * CORS deny for unknown origins, safe health payload).
 *
 * Usage:
 *   npm run security:server
 *   npm run security:server -- --base http://127.0.0.1:3001
 *   npm run security:server -- --profile cloud --base https://example.com
 *   npm run security:server -- --profile local --base http://127.0.0.1:4310
 */
import 'dotenv/config';

const PROBE_ORIGIN = 'https://security-probe.invalid';
const TIMEOUT_MS = 12_000;

function parseArgs(argv) {
  const out = { base: process.env.BASE_URL || process.env.SECURITY_BASE_URL || '', profile: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' && argv[i + 1]) {
      out.base = argv[++i];
    } else if (arg.startsWith('--base=')) {
      out.base = arg.slice('--base='.length);
    } else if (arg === '--profile' && argv[i + 1]) {
      out.profile = argv[++i].toLowerCase();
    } else if (arg.startsWith('--profile=')) {
      out.profile = arg.slice('--profile='.length).toLowerCase();
    }
  }
  return out;
}

function detectProfile(explicit) {
  if (explicit === 'cloud' || explicit === 'local') return explicit;
  if (process.env.CPID_DESKTOP === '1') return 'local';
  if (process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim()) return 'cloud';
  return process.env.NODE_ENV === 'production' ? 'cloud' : 'local';
}

function isTruthyFlag(value) {
  return value === '1' || String(value || '').toLowerCase() === 'true';
}

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function looksLikeSecretLeak(text) {
  const s = String(text || '');
  if (/sk-[a-zA-Z0-9]{20,}/.test(s)) return true;
  if (/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./.test(s)) return true;
  if (/"stack"\s*:/.test(s) || /\bat\s+\S+\s+\(/.test(s)) return true;
  return false;
}

function result(ok, id, detail) {
  return { ok, id, detail };
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

function printRow(item) {
  const mark = item.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${item.id}: ${item.detail}`);
}

async function fetchSafe(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

function runConfigChecks(profile) {
  const items = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowDevAuth = isTruthyFlag(process.env.ALLOW_DEV_AUTH);
  const host =
    process.env.HOST ||
    (profile === 'local' ? '127.0.0.1' : nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
  const corsOrigin = String(process.env.CORS_ORIGIN || '').trim();
  const supabaseConfigured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim(),
  );
  const trustProxy = isTruthyFlag(process.env.TRUST_PROXY);

  if (profile === 'cloud') {
    if (nodeEnv === 'production' && allowDevAuth) {
      items.push(result(false, 'allow-dev-auth', 'ALLOW_DEV_AUTH must not be enabled in production Cloud'));
    } else if (supabaseConfigured && allowDevAuth) {
      items.push(result(false, 'allow-dev-auth', 'ALLOW_DEV_AUTH must stay off when Supabase JWT auth is configured'));
    } else {
      items.push(result(true, 'allow-dev-auth', allowDevAuth ? 'dev header auth allowed (non-prod, no Supabase)' : 'dev header auth disabled'));
    }

    if (nodeEnv === 'production' && !supabaseConfigured) {
      items.push(result(false, 'supabase-auth', 'Cloud production should configure SUPABASE_URL and SUPABASE_ANON_KEY'));
    } else {
      items.push(
        result(
          true,
          'supabase-auth',
          supabaseConfigured ? 'Supabase auth env present' : 'Supabase not required for this local/demo env',
        ),
      );
    }

    if (nodeEnv === 'production' && !corsOrigin) {
      items.push(
        result(
          true,
          'cors-origin',
          'CORS_ORIGIN unset (OK for same-origin; set it if the browser app is on another host)',
        ),
      );
    } else if (corsOrigin === '*') {
      items.push(result(false, 'cors-origin', 'CORS_ORIGIN must not be *'));
    } else {
      items.push(result(true, 'cors-origin', corsOrigin ? `allowlist set (${corsOrigin.split(',').length} origin(s))` : 'unset (same-origin / dev localhost policy)'));
    }

    items.push(
      result(
        true,
        'bind-host',
        `HOST=${host} (Cloud may bind 0.0.0.0 behind a trusted proxy; ensure TLS at the edge)`,
      ),
    );
  } else {
    if (!isLoopbackHost(host) && host !== '0.0.0.0') {
      items.push(result(false, 'bind-host', `Local profile expects loopback HOST; got ${host}`));
    } else if (host === '0.0.0.0') {
      items.push(
        result(
          false,
          'bind-host',
          'Local API must not bind 0.0.0.0 without a stronger session model; use 127.0.0.1',
        ),
      );
    } else {
      items.push(result(true, 'bind-host', `HOST=${host || '127.0.0.1 (default)'}`));
    }

    items.push(
      result(
        true,
        'desktop-auth',
        'Local/desktop may use loopback header auth; keep the process off the LAN',
      ),
    );
  }

  items.push(
    result(
      true,
      'trust-proxy',
      trustProxy
        ? 'TRUST_PROXY=1 (only enable behind a trusted reverse proxy)'
        : 'TRUST_PROXY unset (direct connect)',
    ),
  );

  const masterKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  items.push(
    result(true, 'secrets-env', masterKey ? 'OPENAI_API_KEY present in env (not printed)' : 'OPENAI_API_KEY unset'),
  );

  return items;
}

async function runLiveProbes(profile, baseUrl) {
  const items = [];
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return [result(false, 'base-url', `Invalid --base URL: ${baseUrl}`)];
  }

  const origin = parsed.origin.replace(/\/$/, '');
  const isPublicHttpsRequired =
    profile === 'cloud' && !isLoopbackHost(parsed.hostname) && parsed.hostname !== '0.0.0.0';

  if (isPublicHttpsRequired && parsed.protocol !== 'https:') {
    items.push(result(false, 'tls', `Public Cloud base must use https:; got ${parsed.protocol}`));
  } else {
    items.push(
      result(
        true,
        'tls',
        isPublicHttpsRequired ? 'https base URL' : `scheme ${parsed.protocol} OK for this target`,
      ),
    );
  }

  if (profile === 'local' && !isLoopbackHost(parsed.hostname)) {
    items.push(
      result(false, 'local-target', `Local profile probes must target loopback; got ${parsed.hostname}`),
    );
  } else if (profile === 'local') {
    items.push(result(true, 'local-target', `loopback target ${parsed.hostname}`));
  }

  // Health: public, non-sensitive
  try {
    const { res, text } = await fetchSafe(`${origin}/api/health`);
    let bodyOk = res.status === 200;
    let detail = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      bodyOk = bodyOk && json.status === 'ok';
      if (looksLikeSecretLeak(text)) {
        bodyOk = false;
        detail = 'health body looks like it leaks secrets or stacks';
      } else {
        detail = `HTTP ${res.status}, status=${json.status}`;
      }
    } catch {
      bodyOk = false;
      detail = 'health response was not JSON';
    }
    items.push(result(bodyOk, 'health', detail));
  } catch (error) {
    items.push(result(false, 'health', `unreachable: ${error.message}`));
    return items;
  }

  const authProbes = [
    { id: 'auth-projects', method: 'GET', path: '/api/projects' },
    { id: 'auth-me', method: 'GET', path: '/api/auth/me' },
    { id: 'auth-overview-feed', method: 'GET', path: '/api/overview/feed' },
    { id: 'auth-ai', method: 'DELETE', path: '/api/ai/training' },
  ];

  for (const probe of authProbes) {
    try {
      const { res, text } = await fetchSafe(`${origin}${probe.path}`, { method: probe.method });
      const ok = res.status === 401 && !looksLikeSecretLeak(text);
      items.push(
        result(
          ok,
          probe.id,
          ok ? `unauthenticated → 401` : `expected 401 without credentials; got ${res.status}`,
        ),
      );
    } catch (error) {
      items.push(result(false, probe.id, `request failed: ${error.message}`));
    }
  }

  // Spoofable headers must not authenticate Cloud when Supabase is configured / production.
  if (profile === 'cloud') {
    try {
      const { res, text } = await fetchSafe(`${origin}/api/projects`, {
        method: 'GET',
        headers: {
          'x-user-id': 'security-probe-user',
          'x-user-tier': 'paid',
        },
      });
      const ok = res.status === 401 && !looksLikeSecretLeak(text);
      items.push(
        result(
          ok,
          'reject-header-spoof',
          ok
            ? 'x-user-id alone does not authenticate'
            : `header spoof unexpected status ${res.status} (Cloud must require JWT)`,
        ),
      );
    } catch (error) {
      items.push(result(false, 'reject-header-spoof', `request failed: ${error.message}`));
    }
  }

  // CORS: unknown origin must not be reflected
  try {
    const { res } = await fetchSafe(`${origin}/api/health`, {
      method: 'GET',
      headers: { Origin: PROBE_ORIGIN },
    });
    const allow = res.headers.get('access-control-allow-origin');
    const ok = !allow || allow === 'null' || allow !== PROBE_ORIGIN;
    items.push(
      result(
        ok,
        'cors-deny-unknown',
        ok
          ? 'unknown Origin not allowlisted'
          : `ACA-Origin unexpectedly reflected ${allow}`,
      ),
    );
  } catch (error) {
    items.push(result(false, 'cors-deny-unknown', `request failed: ${error.message}`));
  }

  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = detectProfile(args.profile);
  const base = String(args.base || '').trim();

  console.log(`Server secured check`);
  console.log(`Profile: ${profile}`);
  console.log(`Live base: ${base || '(config only — pass --base to probe a running API)'}`);

  printSection('Config / env');
  const configItems = runConfigChecks(profile);
  configItems.forEach(printRow);

  let liveItems = [];
  if (base) {
    printSection('Live probes');
    liveItems = await runLiveProbes(profile, base);
    liveItems.forEach(printRow);
  } else {
    console.log('\n(skip live probes — no --base / BASE_URL)');
  }

  const all = [...configItems, ...liveItems];
  const failed = all.filter((item) => !item.ok);
  printSection('Summary');
  console.log(`${all.length - failed.length}/${all.length} passed`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.id).join(', '));
    console.log(
      'Residual: host OS, firewall, DB isolation, and shared rate limits remain ops responsibilities.',
    );
    process.exit(1);
  }
  console.log(
    'Config/behavior gates passed for this profile. Residual: host OS, firewall, DB isolation, shared rate limits.',
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('[security:server]', error.message || error);
  process.exit(1);
});
