function extraOrigins() {
  return String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

/**
 * Same-origin production traffic does not need CORS. Cross-origin browser
 * calls are limited to explicit CORS_ORIGIN values, plus localhost during
 * development so the Vite app can reach the API.
 */
export function reflectAllowedOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (extraOrigins().includes(origin)) {
    callback(null, true);
    return;
  }

  if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(null, false);
}
