# Feature Comparison: AngularLynx vs React Lynx vs Vue Lynx

## Core Renderer

| Feature                                    | AngularLynx |  React Lynx   |     Vue Lynx     |
| ------------------------------------------ | :---------: | :-----------: | :--------------: |
| Element creation (view, text, image, etc.) |     ✅      |      ✅       |        ✅        |
| Text nodes                                 |     ✅      |      ✅       |        ✅        |
| Comment/anchor nodes                       |     ✅      |      ✅       |        ✅        |
| Tree manipulation (append, insert, remove) |     ✅      |      ✅       |        ✅        |
| Inline styles                              |     ✅      |      ✅       |        ✅        |
| Classes                                    |     ✅      |      ✅       |        ✅        |
| Attributes                                 |     ✅      |      ✅       |        ✅        |
| Scoped CSS (component encapsulation)       |     ✅      |      ✅       |        ✅        |
| Dual-thread architecture                   |     ✅      |      ✅       |        ✅        |
| Background-thread virtual tree             |     ✅      | ✅ (snapshot) | ✅ (shadow tree) |

## Events

| Feature                                                |           AngularLynx            |            React Lynx             |         Vue Lynx         |
| ------------------------------------------------------ | :------------------------------: | :-------------------------------: | :----------------------: |
| Basic event binding (`bindtap`, etc.)                  |                ✅                |                ✅                 |            ✅            |
| Event prefixes (bind/catch/capture-bind/capture-catch) |                ✅                |                ✅                 |   ✅ (.stop modifier)    |
| Global events                                          |    ✅ (`global-bind` prefix)     | ✅ (`useLynxGlobalEventListener`) |  ✅ (`bindGlobalEvent`)  |
| Event modifiers                                        | N/A (Angular doesn't have these) |                N/A                | ✅ (.once, .stop, .self) |

## List Virtualization

| Feature                        |      AngularLynx      |       React Lynx        | Vue Lynx |
| ------------------------------ | :-------------------: | :---------------------: | :------: |
| `<list>` with componentAtIndex |          ✅           |           ✅            |    ✅    |
| Item recycling                 | ✅ (reuse-identifier) |  ✅ (reuse-identifier)  |    ✅    |
| Diff-based updates             |          ✅           |           ✅            |    ✅    |
| Deferred list items            |  ✅ (`defer` input)   | ✅ (`DeferredListItem`) |    ❌    |
| Batch update scheduling        |          ✅           |           ✅            |    ✅    |

## Gestures

| Feature                                         |                   AngularLynx                    |                    React Lynx                    |     Vue Lynx     |
| ----------------------------------------------- | :----------------------------------------------: | :----------------------------------------------: | :--------------: |
| Gesture system                                  | ✅ (TAP, PAN, FLING, PINCH, ROTATION, LONGPRESS) | ✅ (TAP, PAN, FLING, PINCH, ROTATION, LONGPRESS) | ❌ (events only) |
| Gesture composition (waitFor, simultaneousWith) |        ✅ (Exclusive, Simultaneous, Race)        |                        ✅                        |        ❌        |
| Worklet-based gesture callbacks                 |         ⚠️ (background-thread callbacks)         |                        ✅                        |        ❌        |

## Animations

| Feature                               |               AngularLynx                |     React Lynx     |                   Vue Lynx                    |
| ------------------------------------- | :--------------------------------------: | :----------------: | :-------------------------------------------: |
| `element.animate()` (JS keyframe API) |                    ✅                    |         ✅         |              ❌ (no direct API)               |
| CSS transitions                       |          ✅ (`LynxTransition`)           | ❌ (worklet-based) |         ✅ (`<Transition>` component)         |
| CSS `@keyframes` animations           |                    ✅                    |         ❌         |               ✅ (class-based)                |
| Transition component                  |          ✅ (`LynxTransition`)           |         ❌         | ✅ (experimental, needs explicit `:duration`) |
| TransitionGroup                       | ✅ (`LynxTransitionGroup`, no move/FLIP) |         ❌         |               ⚠️ (no move/FLIP)               |

## Main Thread Scripting (MTS)

| Feature                | AngularLynx |       React Lynx        |         Vue Lynx          |
| ---------------------- | :---------: | :---------------------: | :-----------------------: |
| `runOnMainThread()`    |     ✅      |           ✅            |            ❌             |
| `runOnBackground()`    |     ✅      |           ✅            |       ✅ (limited)        |
| Main thread refs       |     ✅      | ✅ (`useMainThreadRef`) |  ✅ (`:main-thread-ref`)  |
| Worklet event handlers |     ✅      |           ✅            | ✅ (`:main-thread-bind*`) |

## Routing / Navigation

| Feature                               |     AngularLynx      |       React Lynx       |            Vue Lynx             |
| ------------------------------------- | :------------------: | :--------------------: | :-----------------------------: |
| In-memory router                      |     ✅ (custom)      | ❌ (uses native pages) | ✅ (vue-router + memoryHistory) |
| Lazy-loaded routes                    |          ✅          |           ❌           |               ✅                |
| Route reuse / element pool management | ✅ (custom strategy) |           ❌           |               ❌                |
| History stack                         |          ✅          |           ❌           |               ✅                |

## Data Flow / Platform Integration

| Feature                 |           AngularLynx            |       React Lynx        | Vue Lynx |
| ----------------------- | :------------------------------: | :---------------------: | :------: |
| InitData pattern        |    ✅ (`LynxInitDataService`)    |  ✅ (provider + hook)   |    ❌    |
| GlobalData pattern      |   ✅ (`LynxGlobalDataService`)   |  ✅ (provider + hook)   |    ❌    |
| Data processors         |  ✅ (`registerDataProcessors`)   |           ✅            |    ❌    |
| Native module bridge    |  ✅ (`LynxNativeModuleService`)  | ✅ (`lynx.getJSModule`) |    ❌    |
| Session storage service | ✅ (`LynxSessionStorageService`) |      ❌ (raw API)       |    ❌    |
| System info service     |   ✅ (`LynxSystemInfoService`)   |      ❌ (raw API)       |    ❌    |

## Lazy Loading / Code Splitting

| Feature                        |      AngularLynx      |      React Lynx       |          Vue Lynx           |
| ------------------------------ | :-------------------: | :-------------------: | :-------------------------: |
| Route-level lazy loading       |          ✅           |          ❌           |             ✅              |
| Component-level lazy loading   | ✅ (`loadLazyBundle`) | ✅ (`loadLazyBundle`) | ✅ (`defineAsyncComponent`) |
| Suspense / async boundaries    |     ✅ (`@defer`)     |          ✅           |             ✅              |
| First-screen sync optimization |          ❌           |    ✅ (Lepus mode)    |             ❌              |

## SSR / Hydration

| Feature                   |             AngularLynx             |             React Lynx              | Vue Lynx |
| ------------------------- | :---------------------------------: | :---------------------------------: | :------: |
| Server-side rendering     |     ✅ (snapshot serialization)     |     ✅ (snapshot serialization)     |    ❌    |
| Hydration                 |  ✅ (`LynxHydrateDocument` queue)   |                 ✅                  |    ❌    |
| First-screen optimization | ✅ (`__FIRST_SCREEN_SYNC_TIMING__`) | ✅ (`__FIRST_SCREEN_SYNC_TIMING__`) |    ❌    |

## Error Handling

| Feature                        |               AngularLynx                |       React Lynx        |        Vue Lynx        |
| ------------------------------ | :--------------------------------------: | :---------------------: | :--------------------: |
| Error boundary / recovery      |     🚫 (won't do — `@error` coming)      | ✅ (`useErrorBoundary`) | ✅ (`onErrorCaptured`) |
| Global unhandled error capture | ✅ (`LynxErrorHandler` + `_ReportError`) | ✅ (`lynx.reportError`) |           ✅           |
| Component-level error UI       |                    ❌                    |           ✅            |           ✅           |

## Testing

| Feature                      | AngularLynx |        React Lynx        |             Vue Lynx              |
| ---------------------------- | :---------: | :----------------------: | :-------------------------------: |
| Testing library              |     ✅      | ✅ (testing-library API) |     ✅ (@vue/testing-library)     |
| Component rendering in tests |     ✅      |            ✅            | ✅ (dual-thread pipeline + JSDOM) |
| Event simulation             |     ✅      |            ✅            |         ✅ (`fireEvent`)          |
| Test runner integration      |     ✅      |   ✅ (Vitest, Rstest)    |            ✅ (Vitest)            |

## Developer Experience

| Feature                                  |                     AngularLynx                      |         React Lynx          |         Vue Lynx         |
| ---------------------------------------- | :--------------------------------------------------: | :-------------------------: | :----------------------: |
| Project scaffolding CLI                  |              ✅ (`create-angular-lynx`)              |             ❌              |  ✅ (`create-vue-lynx`)  |
| IDE type support for Lynx elements       |                 ✅ (directive stubs)                 |             ✅              |    ✅ (Volar plugin)     |
| HMR                                      |          ⚠️ (module HMR, re-bootstraps app)          |        ❌ (unclear)         |            ✅            |
| Build diagnostics (invalid elements/CSS) |                          ✅                          |             ❌              |            ❌            |
| DevTools integration                     | ✅ (`LynxPerformanceService`, `LynxDevToolsService`) | ⚠️ (profile hooks, logging) | ⚠️ (Vue devtools option) |
| Documentation site                       |                     ✅ (Rspress)                     |             ❌              |   ✅ (vue.lynxjs.org)    |
| Example gallery                          |                   ✅ (12 examples)                   |             ❌              |     ✅ (26 examples)     |

## Build Plugin

| Feature                               |          AngularLynx           |   React Lynx    |       Vue Lynx       |
| ------------------------------------- | :----------------------------: | :-------------: | :------------------: |
| AOT compilation                       |               ✅               |       N/A       |         N/A          |
| JIT compilation                       |               ✅               |       N/A       |         N/A          |
| Tailwind CSS                          |       ✅ (auto-detected)       |       ✅        |          ✅          |
| CSS Modules                           |               ✅               |       ✅        |          ✅          |
| Dual-thread entry splitting           |               ✅               |       ✅        |          ✅          |
| Auto CUSTOM_ELEMENTS_SCHEMA injection |               ✅               |       N/A       |  N/A (isNativeTag)   |
| Worklet transform                     | ✅ (`"main thread"` directive) | ✅ (SWC plugin) | ✅ (worklet loaders) |

## Accessibility

| Feature                       | AngularLynx |    React Lynx    |     Vue Lynx     |
| ----------------------------- | :---------: | :--------------: | :--------------: |
| a11y attributes on directives |     ✅      | ❌ (passthrough) | ❌ (passthrough) |
| Screen reader API wrapper     |     ✅      |        ❌        |        ❌        |
| `enableA11y` build option     |     ✅      |        ❌        |        ❌        |

## Summary

### AngularLynx strengths (unique or best-in-class)

- Custom route reuse strategy that manages Lynx's element pool
- Build-time diagnostics catching invalid HTML elements and unsupported CSS
- Auto CUSTOM_ELEMENTS_SCHEMA injection (zero config for template type-checking)
- Tailwind auto-detection
- Typed a11y attributes on every Lynx element directive (React/Vue only passthrough)
- Full testing library: `render()`, `fireEvent`, `screen` queries, Vitest integration

### Biggest gaps vs React Lynx

1. ~~Main thread scripting / worklets~~ — implemented (`mainThreadFn`, `LynxMainThreadEvent`, `LynxMainThreadService`)
2. ~~Lazy bundle loading (non-route)~~ — implemented (`loadLazyBundle`)
3. ~~SSR / hydration / first-screen optimization~~ — implemented (`ssrEncode`/`ssrHydrate` callbacks, `LynxHydrateDocument`, opcode-based snapshot serialization)

### Biggest gaps vs Vue Lynx

1. HMR (Vue has component-level state preservation; Angular re-bootstraps the whole app)
2. ~~`<Transition>` / animation component abstraction~~ — implemented (`LynxTransition`)
3. ~~Project scaffolding CLI~~ — implemented (`create-angular-lynx`)
4. ~~Documentation site & example gallery~~ — implemented (Rspress docs site + 12 standalone examples)

### Both React & Vue have, Angular doesn't

- ~~Component-level error boundaries with recovery UI~~ — won't do (Angular's `@error` control flow will handle this natively)
- ~~Main thread refs and worklet event handlers~~ — implemented (`MainThreadRef`, `LynxMainThreadEvent`)
