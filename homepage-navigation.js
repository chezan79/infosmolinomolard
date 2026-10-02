(() => {
  'use strict';

  const copy = {
    fr: { employeeOfTheMonth: 'Collaborateur du mois', monthlyWinners: 'Collaborateurs distingués' },
    it: { employeeOfTheMonth: 'Collaboratore del mese', monthlyWinners: 'Collaboratori del mese' },
    en: { employeeOfTheMonth: 'Employee of the Month', monthlyWinners: 'Monthly recognition' },
  };

  const browserLocale = String(navigator.language || '').slice(0, 2).toLowerCase();
  const locale = copy[browserLocale] ? browserLocale : 'fr';

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const translated = copy[locale][element.dataset.i18n];
    if (translated) element.textContent = translated;
  });
})();