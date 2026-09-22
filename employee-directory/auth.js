function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function cookieValue(req, name) {
  const cookies = String(req.get('cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(parts.join('='));
      } catch {
        return '';
      }
    }
  }
  return '';
}

function hasAdministrationAccess(decoded, siteId, administratorUid) {
  if (!siteId || !administratorUid) return false;
  return decoded.siteId === siteId && decoded.uid === administratorUid;
}

function createAdministrationAuthorization({ firebaseAuth, siteId, administratorUid }) {
  return async function authorizeAdministration(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    try {
      const decoded = await firebaseAuth.verifyIdToken(token, true);
      if (!hasAdministrationAccess(decoded, siteId, administratorUid)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      req.administrator = { uid: decoded.uid, siteId: decoded.siteId };
      return next();
    } catch {
      return res.status(401).json({ error: 'INVALID_AUTH' });
    }
  };
}

function createAdministrationSessionAuthorization({ firebaseAuth, siteId, administratorUid }) {
  return async function authorizeAdministrationSession(req, res, next) {
    const sessionCookie = cookieValue(req, '__session');
    if (!sessionCookie) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    try {
      const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, true);
      if (!hasAdministrationAccess(decoded, siteId, administratorUid)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      req.administrator = { uid: decoded.uid, siteId: decoded.siteId };
      return next();
    } catch {
      res.clearCookie('__session', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      return res.status(401).json({ error: 'INVALID_SESSION' });
    }
  };
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'ORIGIN_REQUIRED' });
  try {
    const parsed = new URL(origin);
    if (parsed.host !== req.get('host') || parsed.protocol !== `${req.protocol}:`) {
      return res.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
    }
  } catch {
    return res.status(403).json({ error: 'ORIGIN_FORBIDDEN' });
  }
  return next();
}

function createAdministrationPageAuthorization({ firebaseAuth, siteId, administratorUid, loginPath = '/gestion-photos-login.html' }) {
  return async function authorizeAdministrationPage(req, res, next) {
    const sessionCookie = cookieValue(req, '__session');
    if (!sessionCookie) return res.redirect(302, loginPath);
    try {
      const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, true);
      if (!hasAdministrationAccess(decoded, siteId, administratorUid)) {
        return res.redirect(302, `${loginPath}?error=access`);
      }
      req.administrator = { uid: decoded.uid, siteId: decoded.siteId };
      return next();
    } catch {
      res.clearCookie('__session', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      return res.redirect(302, `${loginPath}?error=session`);
    }
  };
}

module.exports = {
  bearerToken,
  cookieValue,
  createAdministrationAuthorization,
  createAdministrationSessionAuthorization,
  createAdministrationPageAuthorization,
  hasAdministrationAccess,
  requireSameOrigin,
};