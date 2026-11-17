// Expo's runtime: its fetch, whose response streams a body, and URL, TextDecoderStream and
// structuredClone. Metro runs it before this file only when something imports it, and nothing
// else does in a release build, which would then get React Native's fetch, with no body.
import 'expo';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { withComponentInputBinding } from '@angular/router';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { registerExpoViews } from '@ng-native/expo';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { SvgImages } from '@ng-native/icons';
import { mount } from '@ng-native/platform';
import { provideNativeHttpClient } from '@ng-native/platform/http';
import { provideNativeRouter, withSvgIcons } from '@ng-native/router';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { routes } from './app/app.routes.ts';
import { App } from './app/app.ts';

registerPlatformComponents(Platform.OS);
// The reference draws every image with expo-image; <expo-image> is its native view by name.
registerExpoViews('expo-image');

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    // What `@media` resolves against.
    conditions: currentConditions(),
    // The hairline width and the other values only the device knows.
    tokens: deviceTokens(),
    // Turns a `require('./x.png')` into something native can load.
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
    providers: [
      // Route params (`pokemon/:id`) and query params (`bench/mount?kind=`) arrive as inputs.
      // The tab bar cannot draw SVG, so SvgImages draws the reference's icons into images.
      provideNativeRouter(routes, withComponentInputBinding(), withSvgIcons(SvgImages)),
      // HttpClient on React Native's XMLHttpRequest, whatever the global fetch is.
      provideNativeHttpClient(),
      // The reference's React Query client, on TanStack Query's Angular adapter: a cached answer is
      // fresh for five minutes, a failed request is tried twice more, and nothing refetches on focus.
      provideTanStackQuery(
        new QueryClient({
          defaultOptions: {
            queries: { staleTime: 1000 * 60 * 5, retry: 2, refetchOnWindowFocus: false },
          },
        }),
      ),
    ],
  });

  // Re-resolves the conditions when the device rotates or the theme changes.
  const stopWatching = watchConditions(app.engine);
  app.applicationRef.onDestroy(stopWatching);
});
