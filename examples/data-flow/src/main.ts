import {
  bootstrapApplication,
  registerDataProcessors,
} from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

if (typeof lynx !== 'undefined') {
  (lynx as any).__initData = {
    userId: 'user_42',
    theme: 'light',
    cardId: 101,
  };
  (lynx as any).__globalProps = { theme: 'dark', locale: 'en-US' };
}

registerDataProcessors({
  defaultDataProcessor: (raw) => ({
    ...raw,
    theme: raw['theme'] ?? 'light',
    timestamp: Date.now(),
  }),
});

bootstrapApplication(App, appConfig);
