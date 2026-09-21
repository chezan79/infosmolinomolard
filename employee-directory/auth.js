function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function createManagerAuthorization({ firebaseAuth, siteId }) {
  return async function authorizeDirectoryManager(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    try {
      const decoded = await firebaseAuth.verifyIdToken(token, true);
      const roles = Array.isArray(decoded.roles) ? decoded.roles : [decoded.role].filter(Boolean);
      if (decoded.siteId !== siteId || !roles.some((role) => ['manager', 'admin'].includes(role))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      req.manager = { uid: decoded.uid, siteId: decoded.siteId, roles };
      return next();
    } catch {
      return res.status(401).json({ error: 'INVALID_AUTH' });
    }
  };
}

module.exports = { bearerToken, createManagerAuthorization };