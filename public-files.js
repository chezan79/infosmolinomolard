const express = require('express');
const path = require('node:path');

const PUBLIC_ROOT_EXTENSIONS = new Set(['.html', '.css', '.jpg', '.jpeg', '.png', '.svg', '.zip']);
const PUBLIC_ROOT_SCRIPTS = new Set([
  'collaborateur-du-mois.js',
  'firebase-client.js',
  'firebase-config.js',
  'gestion-photos-collaborateurs.js',
  'gestion-photos-login.js',
]);

function publicRootFile(reqPath) {
  let decoded = reqPath;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(`/${decoded}`).replace(/^\/+/, '');
  if (!normalized || normalized.includes('/')) return null;
  if (normalized === 'gestion-photos-collaborateurs.html') return null;
  const extension = path.extname(normalized).toLowerCase();
  return PUBLIC_ROOT_EXTENSIONS.has(extension) || PUBLIC_ROOT_SCRIPTS.has(normalized)
    ? normalized
    : null;
}

function mountPublicFiles(app, rootDirectory) {
  app.use('/assets', express.static(path.join(rootDirectory, 'assets')));
  app.use('/attached_assets', express.static(path.join(rootDirectory, 'attached_assets')));
  app.use('/public', express.static(path.join(rootDirectory, 'public')));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const filename = publicRootFile(req.path);
    if (!filename) return next();
    return res.sendFile(path.join(rootDirectory, filename), (error) => {
      if (error && !res.headersSent) next();
    });
  });
}

module.exports = { mountPublicFiles, publicRootFile };