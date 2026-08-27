import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../db/config.js';

export function uploadsRoot() {
  const fromEnv = String(process.env.CPID_UPLOAD_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (process.env.CPID_DATA_DIR) {
    return path.join(path.resolve(process.env.CPID_DATA_DIR), 'uploads');
  }
  return path.join(projectRoot, 'uploads');
}

function safeFileName(name) {
  const base = path.basename(String(name || 'upload')).replace(/[^\w.\- ()[\]]+/g, '_');
  return base.slice(0, 120) || 'upload';
}

function safeIdSegment(value, fallback) {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function assertInsideUploads(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(uploadsRoot());
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    const error = new Error('Invalid upload path.');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function uploadDir(userId, projectId) {
  return assertInsideUploads(
    path.join(uploadsRoot(), safeIdSegment(userId, 'user'), safeIdSegment(projectId, 'project'))
  );
}

export async function saveUploadedFile({ userId, projectId, originalname, buffer }) {
  const dir = uploadDir(userId, projectId);
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${safeFileName(originalname)}`);
  await fs.promises.writeFile(dest, buffer);
  return dest;
}

export async function loadSavedUpload(filePath, originalname) {
  const buffer = await fs.promises.readFile(assertInsideUploads(filePath));
  return { buffer, originalname };
}

export async function removeSavedUpload(filePath) {
  if (!filePath) return;
  await fs.promises.unlink(assertInsideUploads(filePath)).catch(() => {});
}

export async function removeSavedUploadsForFile({ userId, projectId, originalname }) {
  const dir = uploadDir(userId, projectId);
  const suffix = `-${safeFileName(originalname)}`;
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(
    names
      .filter((name) => name.endsWith(suffix))
      .map((name) => fs.promises.unlink(path.join(dir, name)).catch(() => {}))
  );
}

export async function removeProjectUploads({ userId, projectId }) {
  const dir = uploadDir(userId, projectId);
  await fs.promises.rm(dir, { recursive: true, force: true });
}
