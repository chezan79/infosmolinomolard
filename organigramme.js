(() => {
  'use strict';

  const FALLBACK_PHOTO = '/assets/avatar-neutral.svg';
  const status = document.getElementById('organization-status');
  const chart = document.getElementById('organization-chart');

  function personCard(person) {
    const article = document.createElement('article');
    article.className = 'person-card';
    const image = document.createElement('img');
    image.src = person.photoUrl || FALLBACK_PHOTO;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      if (!image.src.endsWith(FALLBACK_PHOTO)) image.src = FALLBACK_PHOTO;
    });
    const name = document.createElement('h5');
    name.textContent = person.displayName;
    const title = document.createElement('p');
    title.textContent = person.jobTitle;
    article.append(image, name, title);
    return article;
  }

  function renderLevel(level, parent) {
    const section = document.createElement('section');
    section.className = 'organization-level';
    section.dataset.level = level.id;
    const heading = document.createElement('h4');
    heading.textContent = level.label;
    const grid = document.createElement('div');
    grid.className = 'people-grid';
    if (level.members.length) {
      level.members.forEach((person) => grid.append(personCard(person)));
    } else {
      const empty = document.createElement('p');
      empty.className = 'empty-level';
      empty.textContent = 'Aucun collaborateur affiché à ce niveau.';
      grid.append(empty);
    }
    section.append(heading, grid);
    parent.append(section);
  }

  function render(data) {
    const levels = Array.isArray(data?.levels) ? [...data.levels].sort((a, b) => a.order - b.order) : [];
    const manager = levels.find((level) => level.id === 'manager');
    const managerGrid = document.getElementById('level-manager');
    if (manager?.members.length) manager.members.forEach((person) => managerGrid.append(personCard(person)));
    else {
      const empty = document.createElement('p');
      empty.className = 'empty-level';
      empty.textContent = 'Aucun collaborateur affiché à ce niveau.';
      managerGrid.append(empty);
    }
    levels.filter((level) => level.branch === 'service').forEach((level) =>
      renderLevel(level, document.getElementById('service-levels')));
    levels.filter((level) => level.branch === 'cuisine').forEach((level) =>
      renderLevel(level, document.getElementById('cuisine-levels')));
    status.hidden = true;
    chart.hidden = false;
  }

  fetch('/api/v1/public/organization', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    })
    .then(render)
    .catch(() => {
      status.dataset.state = 'error';
      status.textContent = 'L’organigramme est momentanément indisponible. Veuillez réessayer plus tard.';
    });
})();