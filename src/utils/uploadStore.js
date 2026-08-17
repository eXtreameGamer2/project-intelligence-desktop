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

export async function saveUploadedFile({ userId, projectId, originalname, buffer }) {
  const dir = path.join(uploadsRoot(), String(userId || 'user'), String(projectId || 'project'));
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${safeFileName(originalname)}`);
  await fs.promises.writeFile(dest, buffer);
  return dest;
}

export async function loadSavedUpload(filePath, originalname) {
  const buffer = await fs.promises.readFile(filePath);
  return { buffer, originalname };
}

export async function removeSavedUpload(filePath) {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => {});
}

export async function removeSavedUploadsForFile({ userId, projectId, originalname }) {
  const dir = path.join(uploadsRoot(), String(userId || 'user'), String(projectId || 'project'));
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
  const dir = path.join(uploadsRoot(), String(userId || 'user'), String(projectId || 'project'));
  await fs.promises.rm(dir, { recursive: true, force: true });
}
