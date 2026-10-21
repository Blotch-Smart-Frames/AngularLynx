import path from 'node:path';
import { defineConfig } from '@rspress/core';
import { pluginSass } from '@rsbuild/plugin-sass';
import {
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers';
import mermaid from 'rspress-plugin-mermaid';

export default defineConfig({
  plugins: [mermaid()],
  root: 'docs',
  title: 'AngularLynx',
  description: 'Angular framework for building Lynx apps',
  icon: '/logo.png',
  logo: {
    light: '/logo.png',
    dark: '/logo.png',
  },
  logoText: 'AngularLynx',
  lang: 'en',
  markdown: {
    globalComponents: [path.join(__dirname, 'src/components/go/go.tsx')],
    shiki: {
      transformers: [
        transformerNotationDiff(),
        transformerNotationFocus(),
        transformerNotationHighlight(),
      ],
    },
  },
  route: {
    cleanUrls: true,
  },
  themeConfig: {
    socialLinks: [
      {
        // Rspress renders this markup in place of its built-in GitHub SVG.
        icon: { svg: '<i class="fa-brands fa-github" aria-hidden="true"></i>' },
        content: 'https://github.com/Blotch-Smart-Frames/AngularLynx',
        mode: 'link',
      },
    ],
    footer: {
      message: `© ${new Date().getFullYear()} Blotch Smart Frames. All Rights Reserved.`,
    },
    nav: [
      {
        text: 'Guide',
        link: '/guide/quick-start',
        // Highlight Guide on every guide page, as API is on every API page,
        // so readers can tell which half of the docs they're in.
        activeMatch: '^/guide/',
      },
      {
        text: '@blotch/dolan',
        link: '/dolan/',
      },
      {
        text: 'API',
        link: '/api/',
      },
      {
        text: 'Examples',
        link: '/examples/',
      },
    ],
    sidebar: {
      '/dolan/': [
        { text: 'Overview', link: '/dolan/' },
        { text: 'Theming', link: '/dolan/theming' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'General' },
        { text: 'Button', link: '/dolan/button' },
        { text: 'Button Group', link: '/dolan/button-group' },
        { text: 'Icon', link: '/dolan/icon' },
        { text: 'Typography', link: '/dolan/typography' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Layout' },
        { text: 'Card', link: '/dolan/card' },
        { text: 'Separator', link: '/dolan/separator' },
        { text: 'Accordion', link: '/dolan/accordion' },
        { text: 'Collapsible', link: '/dolan/collapsible' },
        { text: 'Tabs', link: '/dolan/tabs' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Data Display' },
        { text: 'Avatar', link: '/dolan/avatar' },
        { text: 'Badge', link: '/dolan/badge' },
        { text: 'Chart', link: '/dolan/chart' },
        { text: 'Line Chart', link: '/dolan/line-chart' },
        { text: 'Area Chart', link: '/dolan/area-chart' },
        { text: 'Bar Chart', link: '/dolan/bar-chart' },
        { text: 'Scatter Chart', link: '/dolan/scatter-chart' },
        { text: 'Candlestick Chart', link: '/dolan/candlestick-chart' },
        { text: 'Progress', link: '/dolan/progress' },
        { text: 'Skeleton', link: '/dolan/skeleton' },
        { text: 'Spinner', link: '/dolan/spinner' },
        { text: 'Empty State', link: '/dolan/empty-state' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Forms' },
        { text: 'Input', link: '/dolan/input' },
        { text: 'Textarea', link: '/dolan/textarea' },
        { text: 'Label', link: '/dolan/label' },
        { text: 'Checkbox', link: '/dolan/checkbox' },
        { text: 'Radio Group', link: '/dolan/radio-group' },
        { text: 'Select', link: '/dolan/select' },
        { text: 'Switch', link: '/dolan/switch' },
        { text: 'Toggle', link: '/dolan/toggle' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Feedback' },
        { text: 'Alert', link: '/dolan/alert' },
        { text: 'Alert Dialog', link: '/dolan/alert-dialog' },
        { text: 'Dialog', link: '/dolan/dialog' },
        { text: 'Sheet', link: '/dolan/sheet' },
        { text: 'Action Sheet', link: '/dolan/action-sheet' },
        { text: 'Toast', link: '/dolan/toast' },
      ],
      '/guide/': [
        { text: 'Quick Start', link: '/guide/quick-start' },
        { text: 'Schematics', link: '/guide/schematics' },
        {
          dividerType: 'solid',
        },
        {
          sectionHeaderText: 'Learn AngularLynx',
        },
        { text: 'What is AngularLynx?', link: '/guide/introduction' },
        {
          text: 'Change Detection',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/change-detection/' },
            { text: 'Signals', link: '/guide/change-detection/signals' },
          ],
        },
        { text: 'Content Projection', link: '/guide/content-projection' },
        { text: 'Accessibility', link: '/guide/accessibility' },
        // Each element's own page is reference, so it lives in the API
        // sidebar. The Guide keeps only the pages that teach the concepts.
        {
          text: 'Lynx Elements',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/elements/' },
            { text: 'Event Handling', link: '/guide/elements/event-handling' },
          ],
        },
        {
          text: 'Gestures',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/guide/gestures/' },
            { text: 'Gesture Types', link: '/guide/gestures/gesture-types' },
            { text: 'Lifecycle', link: '/guide/gestures/lifecycle' },
            { text: 'Composition', link: '/guide/gestures/composition' },
            {
              text: 'Complete Example',
              link: '/guide/gestures/complete-example',
            },
          ],
        },
        {
          text: 'Animations',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/guide/animations/' },
            {
              text: 'CSS Transitions',
              link: '/guide/animations/css-transitions',
            },
            { text: 'CSS @keyframes', link: '/guide/animations/css-keyframes' },
            {
              text: 'Programmatic API',
              link: '/guide/animations/programmatic',
            },
            {
              text: 'Enter/Leave Transitions',
              link: '/guide/animations/enter-leave',
            },
          ],
        },
        { text: '@defer', link: '/guide/defer' },
        { text: 'CSS Colors', link: '/guide/css-colors' },
        {
          text: 'Custom Fonts',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/guide/custom-fonts/' },
            {
              text: 'Dynamic Font Loading',
              link: '/guide/custom-fonts/dynamic-font-loading',
            },
          ],
        },
        { text: 'Safe Area', link: '/guide/safe-area' },
        { text: 'Dark Mode', link: '/guide/dark-mode' },
        { text: 'Internationalization', link: '/guide/i18n' },
        { text: 'Routing', link: '/guide/routing' },
        { text: 'Forms', link: '/guide/forms' },
        { text: 'Error Handling', link: '/guide/error-handling' },
        { text: 'Error Boundaries', link: '/guide/error-boundaries' },
        { text: 'Remote Logging', link: '/guide/remote-logging' },
        { text: 'DevTools', link: '/guide/devtools' },
        {
          text: 'Publishing your App',
          link: '/guide/building-for-production',
        },
        {
          dividerType: 'solid',
        },
        {
          sectionHeaderText: 'Advanced',
        },
        { text: 'Renderer Architecture', link: '/guide/renderer-architecture' },
        {
          text: 'Host Data',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/guide/host-data/' },
            { text: 'InitData', link: '/guide/host-data/init-data' },
            { text: 'GlobalData', link: '/guide/host-data/global-data' },
            {
              text: 'Data Processors',
              link: '/guide/host-data/data-processors',
            },
          ],
        },
        { text: 'Session Storage', link: '/guide/session-storage' },
        { text: 'Portal (Programmatic Overlays)', link: '/guide/portal' },
        { text: 'Exposure Detection', link: '/guide/exposure' },
        { text: 'Text Measurement', link: '/guide/text-measurement' },
        { text: 'Multi-Page Apps', link: '/guide/multi-page' },
        { text: 'CSS Modules', link: '/guide/css-modules' },
        { text: 'SelectorQuery', link: '/guide/selector-query' },
        {
          text: 'Main Thread Scripts',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/guide/main-thread/' },
            {
              text: 'Worklet Transform',
              link: '/guide/main-thread/worklet-transform',
            },
          ],
        },
        {
          dividerType: 'solid',
        },
        {
          sectionHeaderText: 'Ecosystem',
        },
        { text: 'Tailwind CSS', link: '/guide/tailwindcss' },
        { text: '@blotch/dolan', link: '/dolan/' },
        {
          text: 'AngularLynx Testing Library',
          collapsed: true,
          items: [
            { text: 'Getting Started', link: '/guide/testing/' },
            { text: 'Testing Patterns', link: '/guide/testing/patterns' },
          ],
        },
      ],
      // The API reference has its own sidebar, as on lynxjs.org, so the Guide
      // sidebar stays short enough to scan.
      '/api/': [
        { text: 'Overview', link: '/api/' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Packages' },
        {
          text: '@blotch/angular-lynx',
          link: '/api/angular-lynx/',
          collapsed: false,
          items: [
            { text: 'Bootstrap', link: '/api/angular-lynx/bootstrap' },
            { text: 'Routing', link: '/api/angular-lynx/routing' },
            { text: 'Elements', link: '/api/angular-lynx/elements' },
            { text: 'Animation', link: '/api/angular-lynx/animation' },
            { text: 'Services', link: '/api/angular-lynx/services' },
          ],
        },
        { text: '@blotch/angular-lynx-build', link: '/api/build/' },
        {
          text: '@blotch/angular-lynx-testing-library',
          link: '/api/testing-library/',
          collapsed: false,
          items: [
            {
              text: 'Event Reference',
              link: '/api/testing-library/event-reference',
            },
          ],
        },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Elements' },
        { text: '<view>', link: '/api/elements/view' },
        { text: '<text>', link: '/api/elements/text' },
        { text: '<image>', link: '/api/elements/image' },
        { text: '<scroll-view>', link: '/api/elements/scroll-view' },
        { text: '<refresh>', link: '/api/elements/refresh' },
        {
          text: '<scroll-coordinator>',
          link: '/api/elements/scroll-coordinator',
        },
        { text: '<list>', link: '/api/elements/list' },
        { text: '<input>', link: '/api/elements/input' },
        { text: '<textarea>', link: '/api/elements/textarea' },
        { text: '<overlay>', link: '/api/elements/overlay' },
        { text: '<viewpager>', link: '/api/elements/viewpager' },
        { text: '<frame>', link: '/api/elements/frame' },
        { text: '<block>', link: '/api/elements/block' },
        { text: '<svg>', link: '/api/elements/svg' },
        { text: '<blur-view>', link: '/api/elements/blur-view' },
        { text: '<video>', link: '/api/elements/video' },
        { text: '<webview>', link: '/api/elements/webview' },
        { text: '<title-bar-view>', link: '/api/elements/title-bar-view' },
        { text: '<cover-view>', link: '/api/elements/cover-view' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Main Thread' },
        { text: 'mainThreadFn', link: '/api/main-thread/main-thread-fn' },
        {
          text: 'LynxMainThreadEvent',
          link: '/api/main-thread/main-thread-event',
        },
        { text: 'MainThreadRef', link: '/api/main-thread/main-thread-ref' },
        {
          text: 'LynxMainThread',
          link: '/api/main-thread/main-thread-service',
        },
        { text: 'backgroundFn', link: '/api/main-thread/background-fn' },
      ],
      '/examples/': [
        { text: 'Overview', link: '/examples/' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Getting Started' },
        { text: 'Hello World', link: '/examples/hello-world' },
        { text: 'Counter', link: '/examples/counter' },
        { text: 'Todo List', link: '/examples/todo-list' },
        { text: 'Form Input', link: '/examples/form-input' },
        { text: 'Forms', link: '/examples/forms' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'App Patterns' },
        { text: 'Settings Page', link: '/examples/settings-page' },
        { text: 'User Profile', link: '/examples/user-profile' },
        { text: 'Notification Center', link: '/examples/notification-center' },
        { text: 'Checkout Form', link: '/examples/checkout-form' },
        { text: 'FAQ / Help Center', link: '/examples/faq-help-center' },
        { text: 'Loading States', link: '/examples/loading-states' },
        { text: 'Task Manager', link: '/examples/task-manager' },
        { text: 'Media Player', link: '/examples/media-player' },
        { text: 'Onboarding Wizard', link: '/examples/onboarding-wizard' },
        { text: 'Contact List', link: '/examples/contact-list' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Layout & Scrolling' },
        { text: 'Infinite Scroll', link: '/examples/infinite-scroll' },
        { text: 'Pull to Refresh', link: '/examples/pull-to-refresh' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Interaction' },
        { text: 'Gesture Playground', link: '/examples/gesture-playground' },
        { text: 'Gestures', link: '/examples/gestures' },
        { text: 'Modal Dialog', link: '/examples/modal-dialog' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Animation' },
        { text: 'Animated Cards', link: '/examples/animated-cards' },
        { text: 'Animations', link: '/examples/animations' },
        { text: 'Enter/Leave Transitions', link: '/examples/enter-leave' },
        { text: 'Transitions', link: '/examples/transitions' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Styling' },
        { text: 'CSS Modules', link: '/examples/css-modules' },
        { text: 'Custom Fonts', link: '/examples/custom-fonts' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Platform' },
        { text: 'Dark Mode', link: '/examples/dark-mode' },
        { text: 'Data Dashboard', link: '/examples/data-dashboard' },
        { text: 'Data Flow', link: '/examples/data-flow' },
        { text: 'Defer', link: '/examples/defer' },
        { text: 'Error Boundary', link: '/examples/error-boundary' },
        { text: 'Error Handling', link: '/examples/error-handling' },
        { text: 'Internationalization', link: '/examples/i18n' },
        { text: 'Main Thread', link: '/examples/main-thread' },
        { text: 'Session Storage', link: '/examples/session-storage' },
        { text: 'SSR', link: '/examples/ssr' },
        { text: 'Tab Navigation', link: '/examples/tab-navigation' },
        { text: 'Multi-Page', link: '/examples/multi-page' },
        {
          text: 'Multi-Page Workspace',
          link: '/examples/multi-page-workspace',
        },
      ],
    },
  },
  builderConfig: {
    plugins: [pluginSass()],
    html: {
      // Font Awesome Pro, from Blotch's CDN: the site's icons, including the
      // ones theme/icons.tsx swaps in for Rspress's. It goes in the HTML
      // template rather than Rspress's `head` option, which only reaches the
      // pages `rspress build` renders and so leaves `rspress dev` without it.
      tags: [
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://cdn.blotch.app/fonts/font-awesome/css/all.min.css',
          },
        },
      ],
    },
    // `<Go>` imports Lynx for Web (`@lynx-js/web-core/client`, which brings its
    // own CSS) when a preview first mounts, and the bundler emits its workers
    // and WebAssembly like any other chunk.
    source: {
      include: [/[\\/]node_modules[\\/]@lynx-js[\\/]go-web[\\/]/],
    },
    server: {
      open: 'http://localhost:<port>/',
    },
  },
});
