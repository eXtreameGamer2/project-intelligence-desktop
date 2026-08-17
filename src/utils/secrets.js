const SECRET_PATTERNS = [
  [/sk-ant-[a-zA-Z0-9_-]{8,}/g, 'sk-ant-[redacted]'],
  [/sk-proj-[a-zA-Z0-9_-]{8,}/g, 'sk-proj-[redacted]'],
  [/sk-[a-zA-Z0-9]{16,}/g, 'sk-[redacted]'],
  [/Bearer\s+\S+/gi, 'Bearer [redacted]'],
];

const SECRET_KEY_NAMES = /api[_-]?key|authorization|secret|password|x-user-api-key/i;

export function redactSecrets(value) {
  if (typeof value !== 'string' || !value) return value;
  return SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
}

export function redactDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSecrets(value);
  if (!value || typeof value !== 'object') return value;

  if (value instanceof Error) {
    const error = new Error(redactSecrets(value.message));
    error.name = value.name;
    error.stack = redactSecrets(value.stack || '');
    error.statusCode = value.statusCode;
    error.status = value.status;
    error.code = value.code;
    return error;
  }

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen));
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_NAMES.test(key) && typeof item === 'string' && item) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactDeep(item, seen);
    }
  }
  return out;
}
