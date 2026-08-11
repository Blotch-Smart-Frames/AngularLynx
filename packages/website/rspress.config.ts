import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@rspress/core';
import { pluginSass } from '@rsbuild/plugin-sass';
import {
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers';
import mermaid from 'rspress-plugin-mermaid';

const apiSidebar = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'api-sidebar.json'), 'utf-8'),
);

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
        icon: 'github',
        content: 'https://github.com/lynx-family/angular-lynx',
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
      },
      {
        text: '@blotch/dolan',
        link: '/dolan/',
      },
      {
        text: 'API',
        link: '/guide/api/angular-lynx/',
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
        {
          text: 'Lynx Elements',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/elements/' },
            { text: '<view>', link: '/guide/elements/view' },
            { text: '<text>', link: '/guide/elements/text' },
            { text: '<image>', link: '/guide/elements/image' },
            { text: '<scroll-view>', link: '/guide/elements/scroll-view' },
            { text: '<refresh>', link: '/guide/elements/refresh' },
            {
              text: '<scroll-coordinator>',
              link: '/guide/elements/scroll-coordinator',
            },
            { text: '<list>', link: '/guide/elements/list' },
            { text: '<input>', link: '/guide/elements/input' },
            { text: '<textarea>', link: '/guide/elements/textarea' },
            { text: '<overlay>', link: '/guide/elements/overlay' },
            { text: '<viewpager>', link: '/guide/elements/viewpager' },
            { text: '<frame>', link: '/guide/elements/frame' },
            { text: '<block>', link: '/guide/elements/block' },
            { text: '<svg>', link: '/guide/elements/svg' },
            {
              text: '<title-bar-view>',
              link: '/guide/elements/title-bar-view',
            },
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
            { text: 'mainThreadFn', link: '/guide/main-thread/main-thread-fn' },
            {
              text: 'LynxMainThreadEvent',
              link: '/guide/main-thread/main-thread-event',
            },
            {
              text: 'MainThreadRef',
              link: '/guide/main-thread/main-thread-ref',
            },
            {
              text: 'LynxMainThread',
              link: '/guide/main-thread/main-thread-service',
            },
            { text: 'backgroundFn', link: '/guide/main-thread/background-fn' },
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
            {
              text: 'Event Reference',
              link: '/guide/testing/event-reference',
            },
          ],
        },
        {
          dividerType: 'solid',
        },
        {
          sectionHeaderText: 'API Reference',
        },
        ...apiSidebar,
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
      tags: [
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: '/web-core/static/css/client.css',
          },
          head: true,
        },
        {
          tag: 'script',
          attrs: { src: '/web-core/static/js/client.js' },
          head: true,
        },
      ],
    },
    source: {
      alias: {
        '@comp': path.join(__dirname, 'src/components'),
        '@lynx-js/web-core/client': path.join(
          __dirname,
          'src/web-core-shim.ts',
        ),
        '@lynx-js/web-elements/all': path.join(
          __dirname,
          'src/web-core-shim.ts',
        ),
        '@lynx-js/web-elements': path.join(__dirname, 'src/web-core-shim.ts'),
      },
      include: [/[\\/]node_modules[\\/]@lynx-js[\\/]go-web[\\/]/],
    },
    server: {
      open: 'http://localhost:<port>/',
    },
  },
});
