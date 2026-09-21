function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function cookieValue(req, name) {
  const cookies = String(req.get('cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function hasManagementAccess(decoded, siteId) {
  const roles = Array.isArray(decoded.roles) ? decoded.roles : [decoded.role].filter(Boolean);
  return decoded.siteId === siteId && roles.some((role) => ['manager', 'admin'].includes(role))
    ? roles
    : null;
}

function createManagerAuthorization({ firebaseAuth, siteId }) {
  return async function authorizeDirectoryManager(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    try {
      const decoded = await firebaseAuth.verifyIdToken(token, true);
      const roles = hasManagementAccess(decoded, siteId);
      if (!roles) return res.status(403).json({ error: 'FORBIDDEN' });
      req.manager = { uid: decoded.uid, siteId: decoded.siteId, roles };
      return next();
    } catch {
      return res.status(401).json({ error: 'INVALID_AUTH' });
    }
  };
}

function createManagerPageAuthorization({ firebaseAuth, siteId }) {
  return async function authorizeManagerPage(req, res, next) {
    const sessionCookie = cookieValue(req, '__session');
    if (!sessionCookie) return res.status(401).send('Authentication required');
    try {
      const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, true);
      const roles = hasManagementAccess(decoded, siteId);
      if (!roles) return res.status(403).send('Forbidden');
      req.manager = { uid: decoded.uid, siteId: decoded.siteId, roles };
      return next();
    } catch {
      return res.status(401).send('Invalid session');
    }
  };
}

module.exports = {
  bearerToken,
  cookieValue,
  createManagerAuthorization,
  createManagerPageAuthorization,
  hasManagementAccess,
};