const DB_NAME = 'cpid-secure-vault';
const STORE = 'keys';
const DEVICE_KEY_ID = 'ai-provider-aes-v1';

let memoryKey = '';
let memoryUserId = '';

function bytesToB64(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  view.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function canUseSubtle() {
  return Boolean(globalThis.crypto?.subtle);
}

function openVaultDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(mode, execute) {
  return openVaultDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = execute(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      })
  );
}

async function getOrCreateDeviceKey() {
  const existing = await idbRequest('readonly', (store) => store.get(DEVICE_KEY_ID));
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await idbRequest('readwrite', (store) => store.put(key, DEVICE_KEY_ID));
  return key;
}

function aadForUser(userId) {
  return new TextEncoder().encode(String(userId || 'local'));
}

export function getMemoryApiKey() {
  return memoryKey;
}

export function setMemoryApiKey(value, userId = '') {
  memoryKey = String(value || '');
  memoryUserId = String(userId || '');
}

export function clearApiKeyMemory() {
  memoryKey = '';
  memoryUserId = '';
}

export function memoryKeyUserId() {
  return memoryUserId;
}

export async function encryptSecret(plaintext, userId) {
  if (!plaintext) return null;
  if (!canUseSubtle()) {
    throw new Error('Cannot encrypt API keys on this device.');
  }

  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadForUser(userId) },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    v: 1,
    iv: bytesToB64(iv),
    data: bytesToB64(data),
  };
}

export async function decryptSecret(payload, userId) {
  if (!payload?.iv || !payload?.data) return '';
  if (!canUseSubtle()) {
    throw new Error('Cannot decrypt API keys on this device.');
  }

  const key = await getOrCreateDeviceKey();
  const encoded = b64ToBytes(payload.data);
  const iv = b64ToBytes(payload.iv);

  const tryDecrypt = async (additionalData) => {
    const bytes = await crypto.subtle.decrypt(
      additionalData
        ? { name: 'AES-GCM', iv, additionalData }
        : { name: 'AES-GCM', iv },
      key,
      encoded
    );
    return new TextDecoder().decode(bytes);
  };

  try {
    return await tryDecrypt(aadForUser(userId));
  } catch {
    // Legacy blobs encrypted without AAD only decrypt for the empty / local user id.
    if (userId) return '';
    return tryDecrypt();
  }
}
