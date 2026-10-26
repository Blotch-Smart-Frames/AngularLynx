import {
  bootstrapApplication,
  registerDataProcessors,
} from '@blotch/angular-lynx';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// Add sample GlobalData for the web preview and Lynx Explorer, merged under
// whatever the host already sent so its values win. LynxGlobalData reads them
// when it's created, so this must run before bootstrapApplication().
if (typeof lynx !== 'undefined') {
  (lynx as any).__globalProps = {
    theme: 'dark',
    locale: 'en-US',
    ...lynx.__globalProps,
  };
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
