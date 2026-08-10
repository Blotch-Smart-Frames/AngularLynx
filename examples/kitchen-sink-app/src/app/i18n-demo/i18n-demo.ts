import { Component, computed, inject, signal } from '@angular/core';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { LYNX_ELEMENTS, LynxLocale } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiCard } from '../../components/ui/card';
import { UiIcon } from '../../components/ui/icon';
import { UiSelect, UiSelectItem } from '../../components/ui/select';
import { UiSeparator } from '../../components/ui/separator';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

// cspell:disable
/**
 * Runtime translation tables keyed by the same `@@` message IDs used in the
 * `$localize` templates below. English is intentionally absent: it's the source
 * language, so switching to it just `clearTranslations()`s and lets `$localize`
 * fall back to the literal in each template.
 */
const TRANSLATIONS: Record<string, Record<string, string>> = {
  fr: {
    'kitchen.greeting': 'Bonjour depuis le kitchen sink !',
    'kitchen.welcome': 'Bienvenue dans la démo i18n !',
    'kitchen.tap': 'Appuyez pour compter',
    'kitchen.reset': 'Réinitialiser',
    'kitchen.counter': 'Vous avez appuyé {$count} fois',
  },
  es: {
    'kitchen.greeting': '¡Hola desde el kitchen sink!',
    'kitchen.welcome': '¡Bienvenido a la demo de i18n!',
    'kitchen.tap': 'Pulsa para contar',
    'kitchen.reset': 'Reiniciar',
    'kitchen.counter': 'Has pulsado {$count} veces',
  },
  de: {
    'kitchen.greeting': 'Hallo vom Kitchen Sink!',
    'kitchen.welcome': 'Willkommen zur i18n-Demo!',
    'kitchen.tap': 'Zum Zählen tippen',
    'kitchen.reset': 'Zurücksetzen',
    'kitchen.counter': 'Du hast {$count}-mal getippt',
  },
  ja: {
    'kitchen.greeting': 'キッチンシンクからこんにちは！',
    'kitchen.welcome': 'i18nデモへようこそ！',
    'kitchen.tap': 'タップして数える',
    'kitchen.reset': 'リセット',
    'kitchen.counter': '{$count}回タップしました',
  },
};

type Language = {
  code: string;
  flag: string;
  /** Endonym — the language's name in its own script. */
  native: string;
  /** English exonym, shown as a subtitle for context. */
  english: string;
};

const LANGUAGES: readonly Language[] = [
  { code: 'en', flag: '🇬🇧', native: 'English', english: 'English' },
  { code: 'fr', flag: '🇫🇷', native: 'Français', english: 'French' },
  { code: 'es', flag: '🇪🇸', native: 'Español', english: 'Spanish' },
  { code: 'de', flag: '🇩🇪', native: 'Deutsch', english: 'German' },
  { code: 'ja', flag: '🇯🇵', native: '日本語', english: 'Japanese' },
];
/**
 * cspell:enable
 */

@Component({
  selector: 'app-i18n-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiBadge,
    UiButton,
    UiCard,
    UiIcon,
    UiSelect,
    UiSelectItem,
    UiSeparator,
    UiText,
  ],
  template: `
    <app-demo-screen
      heading="i18n"
      category="Platform"
      description="Runtime localization with @angular/localize. Pick a language to loadTranslations() live — every $localize string on screen re-renders instantly."
    >
      <view class="flex-col gap-4 flex">
        <!--
          Device locale is what the Lynx runtime reports (LynxLocale), distinct
          from the translation table we swap in below. Surfacing both makes the
          difference between "what the device is set to" and "what strings we
          loaded" explicit — a common point of confusion with $localize.
        -->
        <view
          class="flex-row items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 flex"
        >
          <ui-icon name="info" size="xs" color="#a1a1aa" />
          <ui-text variant="small">Device locale</ui-text>
          <view class="flex-1 flex" />
          <ui-badge variant="secondary" [animated]="false">
            {{ localeService.locale() }}
          </ui-badge>
        </view>

        <!-- Hero: the active translation language + the picker that drives it. -->
        <ui-card class="flex-col gap-4 p-4 flex">
          <view class="flex-row items-center gap-4 flex">
            <text class="text-5xl leading-none">{{ currentLang().flag }}</text>
            <view class="flex-1 flex-col gap-0.5 flex">
              <ui-text variant="h3">{{ currentLang().native }}</ui-text>
              <ui-text variant="muted">
                {{ currentLang().english }} · {{ currentLang().code }}
              </ui-text>
            </view>
          </view>
          <ui-select
            [value]="locale()"
            (changed)="switchLocale($event)"
            placeholder="Choose a language"
          >
            @for (lang of languages; track lang.code) {
              <ui-select-item
                [value]="lang.code"
                [label]="lang.flag + '  ' + lang.native"
              />
            }
          </ui-select>
        </ui-card>

        <!-- Static translated strings. -->
        <ui-card class="flex-col gap-3 p-4 flex">
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline" [animated]="false">$localize</ui-badge>
            <ui-text variant="muted">Static messages</ui-text>
          </view>
          <ui-separator />
          <ui-text variant="large">{{ greeting() }}</ui-text>
          <ui-text variant="p">{{ welcome() }}</ui-text>
        </ui-card>

        <!-- Interpolation: a {$count} placeholder resolved per language. -->
        <ui-card class="flex-col gap-3 p-4 flex">
          <view class="flex-row items-center gap-2 flex">
            <ui-badge variant="outline" [animated]="false">{{
              '{$count}'
            }}</ui-badge>
            <ui-text variant="muted">Interpolated placeholder</ui-text>
          </view>
          <ui-separator />
          <view class="items-center gap-1 py-2 flex">
            <ui-text variant="h1">{{ count() }}</ui-text>
            <ui-text variant="muted" class="text-center">
              {{ counterMessage() }}
            </ui-text>
          </view>
          <view class="flex-row gap-2 flex">
            <ui-button class="flex-1" (pressed)="increment()">
              {{ tapLabel() }}
            </ui-button>
            <ui-button class="flex-1" variant="outline" (pressed)="reset()">
              {{ resetLabel() }}
            </ui-button>
          </view>
        </ui-card>
      </view>
    </app-demo-screen>
  `,
})
export class I18nDemo {
  readonly localeService = inject(LynxLocale);

  readonly languages = LANGUAGES;

  // The in-app translation language, independent of the device locale. Every
  // localized string below reads this signal so they recompute the moment it
  // changes — see the note on `switchLocale` for the load-order guarantee.
  readonly locale = signal('en');
  readonly count = signal(0);

  readonly currentLang = computed(
    () =>
      this.languages.find((lang) => lang.code === this.locale()) ??
      this.languages[0],
  );

  // Each message reads `locale()` so it re-runs on a language switch. `$localize`
  // itself is not reactive — it reads whatever `loadTranslations` last installed
  // — so the signal dependency is what makes the template re-render.
  readonly greeting = computed(() => {
    this.locale();
    return $localize`:@@kitchen.greeting:Hello from the kitchen sink!`;
  });

  readonly welcome = computed(() => {
    this.locale();
    return $localize`:@@kitchen.welcome:Welcome to the i18n demo!`;
  });

  readonly tapLabel = computed(() => {
    this.locale();
    return $localize`:@@kitchen.tap:Tap to count`;
  });

  readonly resetLabel = computed(() => {
    this.locale();
    return $localize`:@@kitchen.reset:Reset`;
  });

  readonly counterMessage = computed(() => {
    this.locale();
    const count = this.count();
    return $localize`:@@kitchen.counter:You tapped ${count}:count: times`;
  });

  increment(): void {
    this.count.update((n) => n + 1);
  }

  reset(): void {
    this.count.set(0);
  }

  switchLocale(code: string): void {
    // Install the new table BEFORE the computed signals above re-read
    // `$localize`. They recompute lazily — only when the template reads them
    // during change detection, which runs after this handler returns, so as long as
    // the translations are swapped synchronously here the next render is
    // guaranteed to see them. `clearTranslations` first wipes the previous
    // language's keys so nothing leaks across a switch.
    this.locale.set(code);
    clearTranslations();
    const table = TRANSLATIONS[code];
    if (table) {
      loadTranslations(table);
    }
  }
}
