const { shell } = require('electron');

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

async function openSafeExternal(url) {
  if (!isSafeExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
}

module.exports = { isSafeExternalUrl, openSafeExternal };
