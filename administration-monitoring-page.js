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

module.exports = { mountAdministrationMonitoringPage };