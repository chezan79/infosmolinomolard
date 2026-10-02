(() => {
  'use strict';

  const endpoint = '/api/v1/public/election-results/latest';
  const region = document.getElementById('results-region');
  const loading = document.getElementById('loading-panel');
  const message = document.getElementById('message-panel');
  const messageTitle = document.getElementById('message-title');
  const messageCopy = document.getElementById('message-copy');
  const retryButton = document.getElementById('retry-button');
  const content = document.getElementById('results-content');
  const monthLabel = document.getElementById('month-label');

  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  }

  function formatMonth(value) {
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  }

  function safePhotoUrl(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 500) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || url.username || url.password) return null;
      if (!/^\/api\/v1\/public\/winner-photos\/\d{4}-(0[1-9]|1[0-2])\.[a-f0-9-]{36}$/.test(url.pathname)) return null;
      if (url.search || url.hash) return null;
      return url.pathname;
    } catch (_) {
      return null;
    }
  }

  function validateWinner(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return null;
    if (!(value.role === null || value.role === undefined || (typeof value.role === 'string' && value.role.length <= 200))) return null;
    if (!(value.photoUrl === null || typeof value.photoUrl === 'string')) return null;
    if (typeof value.photoUrl === 'string' && safePhotoUrl(value.photoUrl) === null) return null;
    return { name: value.name.trim(), role: typeof value.role === 'string' ? value.role.trim() : '', photoUrl: safePhotoUrl(value.photoUrl) };
  }

  function validatePayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.code !== 'PUBLISHED_RESULT' || !validMonth(value.month) ||
        typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt)) ||
        !value.categories || typeof value.categories !== 'object' || Array.isArray(value.categories)) return null;
    const categories = {};
    for (const key of ['CUISINE', 'SERVICE']) {
      const entry = value.categories[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      if (entry.outcome === 'NO_WINNER' && Array.isArray(entry.winners) && entry.winners.length === 0) {
        categories[key] = { outcome: entry.outcome, winners: [] };
      } else if (entry.outcome === 'WINNERS' && Array.isArray(entry.winners) && entry.winners.length > 0 && entry.winners.length <= 30) {
        const winners = entry.winners.map(validateWinner);
        if (winners.some((winner) => !winner)) return null;
        categories[key] = { outcome: entry.outcome, winners };
      } else return null;
    }
    return { month: value.month, publishedAt: value.publishedAt, categories };
  }

  function showMessage(title, copy, retry) {
    loading.hidden = true;
    content.hidden = true;
    message.hidden = false;
    messageTitle.textContent = title;
    messageCopy.textContent = copy;
    retryButton.hidden = !retry;
    region.setAttribute('aria-busy', 'false');
  }

  function fallbackInitials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => Array.from(part)[0] || '').join('').toLocaleUpperCase('fr');
  }

  function renderCategory(targetId, category) {
    const target = document.getElementById(targetId);
    target.replaceChildren();
    if (category.outcome === 'NO_WINNER') {
      const empty = document.createElement('div');
      empty.className = 'no-winner';
      const title = document.createElement('strong');
      title.textContent = 'Pas de distinction ce mois-ci';
      const copy = document.createElement('span');
      copy.textContent = 'Cette catégorie ne compte pas de personne distinguée pour cette période.';
      empty.append(title, copy);
      target.append(empty);
      return;
    }
    const tied = category.winners.length > 1;
    for (const person of category.winners) {
      const article = document.createElement('article');
      article.className = 'winner';
      const portrait = document.createElement('div');
      portrait.className = 'portrait-wrap';
      const fallback = document.createElement('span');
      fallback.className = 'portrait-fallback';
      fallback.textContent = fallbackInitials(person.name);
      fallback.setAttribute('aria-hidden', 'true');
      portrait.append(fallback);
      if (person.photoUrl) {
        const image = document.createElement('img');
        image.className = 'portrait';
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'same-origin';
        image.src = person.photoUrl;
        image.addEventListener('error', () => {
          image.remove();
          fallback.hidden = false;
        }, { once: true });
        fallback.hidden = true;
        portrait.append(image);
      }
      const copy = document.createElement('div');
      copy.className = 'winner-copy';
      const name = document.createElement('h3');
      name.className = 'winner-name';
      name.textContent = person.name;
      copy.append(name);
      if (person.role) {
        const role = document.createElement('p');
        role.className = 'winner-role';
        role.textContent = person.role;
        copy.append(role);
      }
      if (tied) {
        const badge = document.createElement('span');
        badge.className = 'ex-aequo';
        badge.textContent = 'Ex æquo';
        copy.append(badge);
      }
      article.append(portrait, copy);
      target.append(article);
    }
  }

  function render(payload) {
    renderCategory('cuisine-winners', payload.categories.CUISINE);
    renderCategory('service-winners', payload.categories.SERVICE);
    const month = formatMonth(payload.month);
    monthLabel.textContent = `Résultats de ${month}`;
    message.hidden = true;
    loading.hidden = true;
    content.hidden = false;
    region.setAttribute('aria-busy', 'false');
  }

  async function loadResults() {
    loading.hidden = false;
    message.hidden = true;
    content.hidden = true;
    region.setAttribute('aria-busy', 'true');
    retryButton.disabled = true;
    try {
      const response = await fetch(endpoint, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (response.status === 404) {
        showMessage('Un premier rendez-vous à venir.', 'Aucun résultat mensuel n’a encore été publié. Revenez après la prochaine clôture pour découvrir les personnes mises à l’honneur.', false);
        return;
      }
      if (response.status === 503) {
        showMessage('Résultats momentanément indisponibles.', 'La dernière publication n’a pas pu être chargée. Vous pouvez réessayer dans un instant.', true);
        return;
      }
      if (!response.ok) throw new Error('unexpected-response');
      const dto = validatePayload(await response.json());
      if (!dto) throw new Error('invalid-result');
      render(dto);
    } catch (_) {
      showMessage('Impossible de charger les résultats.', 'Un problème de connexion empêche l’affichage des distinctions. Réessayez lorsque votre connexion sera rétablie.', true);
    } finally {
      retryButton.disabled = false;
    }
  }

  retryButton.addEventListener('click', loadResults);
  loadResults();
})();