import { loadTranslations } from '@angular/localize';
import { bootstrapApplication, getLynxAppLocale } from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

if (getLynxAppLocale() === 'fr') {
  // cspell:disable
  loadTranslations({
    'app.greeting': 'Bonjour le monde !',
    'app.welcome': 'Bienvenue, {$userName} !',
    'app.description':
      "Ceci est un exemple d'internationalisation avec Angular sur Lynx.",
    'app.counter': 'Compteur : {$count}',
    'app.tap_button': 'Appuyez pour incrémenter',
  });
  // cspell:enable
}

bootstrapApplication(App, appConfig);
