import {
  bootstrapApplication,
  registerDataProcessors,
} from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// GlobalData has no host to send it in the web preview or Lynx Explorer, so set
// sample values. LynxGlobalData reads them when it's created, so this must run
// before bootstrapApplication().
if (typeof lynx !== 'undefined') {
  (lynx as any).__globalProps = { theme: 'dark', locale: 'en-US' };
}

registerDataProcessors({
  // InitData can't be faked on `lynx` the same way: the engine hands the page
  // its InitData as it starts, which would replace it. The default processor
  // runs on that data first, so start from sample values and let anything a
  // real host sends win.
  defaultDataProcessor: (raw) => ({
    userId: 'user_42',
    theme: 'light',
    cardId: 101,
    ...raw,
    timestamp: Date.now(),
  }),
});

bootstrapApplication(App, appConfig);
