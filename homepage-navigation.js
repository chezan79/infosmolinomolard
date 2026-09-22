(() => {
  'use strict';

  const copy = {
    fr: { employeeOfTheMonth: 'Collaborateur du mois' },
    it: { employeeOfTheMonth: 'Collaboratore del mese' },
    en: { employeeOfTheMonth: 'Employee of the Month' },
  };

  const browserLocale = String(navigator.language || '').slice(0, 2).toLowerCase();
  const locale = copy[browserLocale] ? browserLocale : 'fr';

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const translated = copy[locale][element.dataset.i18n];
    if (translated) element.textContent = translated;
  });
})();