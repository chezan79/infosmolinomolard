const path = require('node:path');

function mountAdministrationMonitoringPage(app, authorizeAdministrationPage, rootDirectory) {
  app.get(
    ['/suivi-du-vote', '/suivi-du-vote.html'],
    authorizeAdministrationPage,
    (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(rootDirectory, 'private-pages', 'suivi-du-vote.html'));
    },
  );
}

function mountAdministrationHistoryPage(app, authorizeAdministrationPage, rootDirectory) {
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  app.get(['/historique-des-votations', '/historique-des-votations.html'],
    noStore, authorizeAdministrationPage, (_req, res) =>
      res.sendFile(path.join(rootDirectory, 'private-pages', 'election-history.html')));
  for (const file of ['election-history-admin.js', 'election-history-admin.css']) {
    app.get(`/private-pages/${file}`, noStore, authorizeAdministrationPage, (_req, res) =>
      res.sendFile(path.join(rootDirectory, 'private-pages', file)));
  }
}

module.exports = { mountAdministrationMonitoringPage, mountAdministrationHistoryPage };