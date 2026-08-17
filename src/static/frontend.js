import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const frontendDist = path.join(projectRoot, 'frontend', 'dist');

export function shouldServeFrontend() {
  return (
    process.env.SERVE_STATIC === 'true' ||
    process.env.NODE_ENV === 'production'
  );
}

export function installFrontendStatic(app) {
  if (!shouldServeFrontend()) {
    return false;
  }

  if (!fs.existsSync(frontendDist)) {
    console.warn(
      `[static] frontend/dist not found at ${frontendDist}. Run "npm run build" first.`
    );
    return false;
  }

  app.use(express.static(frontendDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    return res.sendFile(path.join(frontendDist, 'index.html'));
  });

  console.log(`[static] Serving frontend from ${frontendDist}`);
  return true;
}

export { frontendDist };
