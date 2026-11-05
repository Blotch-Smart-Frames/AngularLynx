import {
  type ApplicationConfig,
  computed,
  inject,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRenderer, provideRouter } from '@blotch/angular-lynx';
import {
  ICON_DARK_COLORS,
  ICON_LIGHT_COLORS,
  UI_ICON_THEME,
  UI_THEME_COLORS,
} from '../components/ui/icon/icon-theme';
import { routes } from './app.routes';
import { AtlasState } from './state/atlas-state';

/** The paper and ink the icons and glass read, as the stylesheet sets them. */
const DAY = {
  background: 'rgba(246, 243, 236, 1)',
  foreground: 'rgba(22, 24, 29, 1)',
  'muted-foreground': 'rgba(92, 95, 102, 1)',
  'glass-foreground': 'rgba(22, 24, 29, 1)',
  'glass-muted-foreground': 'rgba(63, 65, 73, 1)',
};
const NIGHT = {
  background: 'rgba(17, 19, 24, 1)',
  foreground: 'rgba(242, 239, 230, 1)',
  'muted-foreground': 'rgba(166, 164, 156, 1)',
  'glass-foreground': 'rgba(242, 239, 230, 1)',
  'glass-muted-foreground': 'rgba(212, 210, 200, 1)',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderer(),
    // AngularLynx's provideRouter: Angular's router on an in-memory location,
    // since Lynx has no History API.
    provideRouter(routes),
    // Night is the app's own scheme, not only the phone's: the icons and the
    // glass (which draws its own material, dark or light) follow it too.
    {
      provide: UI_ICON_THEME,
      useFactory: () => {
        const atlas = inject(AtlasState);
        return {
          light: { ...ICON_LIGHT_COLORS, ...DAY },
          dark: { ...ICON_DARK_COLORS, ...NIGHT },
          colorScheme: () => (atlas.dark() ? 'dark' : 'light'),
        };
      },
    },
    // The chosen stone is the theme's primary everywhere that reads the
    // token tables: the dock's active icon, a chart's default series.
    {
      provide: UI_THEME_COLORS,
      useFactory: () => {
        const atlas = inject(AtlasState);
        return computed(() => {
          const primary = atlas.color();
          return { light: { primary }, dark: { primary } };
        });
      },
    },
  ],
};
