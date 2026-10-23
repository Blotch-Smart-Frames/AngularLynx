import '@angular/compiler';
import { registerLocaleData } from '@angular/common';
import localeZh from '@angular/common/locales/zh';
import {
  inject,
  Injector,
  LOCALE_ID,
  runInInjectionContext,
  ɵunregisterLocaleData as unregisterLocaleData,
} from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LynxGlobalData } from '../data-flow/global-data';
import { getLynxAppLocale, LynxLocale } from './lynx-locale';
import { provideLocale } from './providers';

const createInjector = () =>
  Injector.create({
    providers: [
      { provide: LynxGlobalData },
      { provide: LynxLocale },
      provideLocale(),
    ],
  });

describe('getLynxAppLocale', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  it('returns undefined when lynx is not defined', () => {
    expect(getLynxAppLocale()).toBeUndefined();
  });

  it('returns undefined when appLocale is not set', () => {
    (globalThis as any).lynx = { __globalProps: {} };

    expect(getLynxAppLocale()).toBeUndefined();
  });

  it('returns undefined when appLocale is an empty string', () => {
    (globalThis as any).lynx = { __globalProps: { appLocale: '' } };

    expect(getLynxAppLocale()).toBeUndefined();
  });

  it('reads appLocale from lynx.__globalProps', () => {
    (globalThis as any).lynx = { __globalProps: { appLocale: 'fr' } };

    expect(getLynxAppLocale()).toBe('fr');
  });
});

describe('LynxLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).lynx;
  });

  it('returns en-US when lynx is not defined and no compile-time constant', () => {
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', undefined);
    const injector = createInjector();

    const locale = runInInjectionContext(injector, () =>
      inject(LynxLocale).locale(),
    );

    expect(locale).toBe('en-US');
  });

  it('returns the compile-time source locale when lynx is not defined', () => {
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', 'fr');
    const injector = createInjector();

    const locale = runInInjectionContext(injector, () =>
      inject(LynxLocale).locale(),
    );

    expect(locale).toBe('fr');
  });

  it('reads appLocale from lynx.__globalProps', () => {
    (globalThis as any).lynx = {
      __globalProps: { appLocale: 'ja-JP' },
    };
    const injector = createInjector();

    const locale = runInInjectionContext(injector, () =>
      inject(LynxLocale).locale(),
    );

    expect(locale).toBe('ja-JP');
  });

  it('prefers appLocale over compile-time constant', () => {
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', 'fr');
    (globalThis as any).lynx = {
      __globalProps: { appLocale: 'de' },
    };
    const injector = createInjector();

    const locale = runInInjectionContext(injector, () =>
      inject(LynxLocale).locale(),
    );

    expect(locale).toBe('de');
  });

  it('falls back when appLocale is empty string', () => {
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', 'es');
    (globalThis as any).lynx = {
      __globalProps: { appLocale: '' },
    };
    const injector = createInjector();

    const locale = runInInjectionContext(injector, () =>
      inject(LynxLocale).locale(),
    );

    expect(locale).toBe('es');
  });
});

describe('provideLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    unregisterLocaleData();
    delete (globalThis as any).lynx;
  });

  it('provides LOCALE_ID from the locale service', () => {
    registerLocaleData(localeZh);
    (globalThis as any).lynx = {
      __globalProps: { appLocale: 'zh-CN' },
    };
    const injector = createInjector();

    const localeId = injector.get(LOCALE_ID);

    expect(localeId).toBe('zh-CN');
  });

  it('keeps an English appLocale, whose data Angular always has', () => {
    (globalThis as any).lynx = {
      __globalProps: { appLocale: 'en-GB' },
    };

    expect(createInjector().get(LOCALE_ID)).toBe('en-GB');
  });

  // The generated native apps send the phone's language, which the app may
  // not support; Angular's pipes would throw for it (issue #58).
  it('falls back to the source locale when Angular has no data for appLocale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', 'en-GB');
    (globalThis as any).lynx = {
      __globalProps: { appLocale: 'ja-JP' },
    };

    expect(createInjector().get(LOCALE_ID)).toBe('en-GB');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ja-JP"'));
  });

  it('keeps the source locale without checking its data', () => {
    const warn = vi.spyOn(console, 'warn');
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', 'fr');

    expect(createInjector().get(LOCALE_ID)).toBe('fr');
    expect(warn).not.toHaveBeenCalled();
  });

  it('provides en-US as LOCALE_ID by default', () => {
    vi.stubGlobal('__LYNX_SOURCE_LOCALE__', undefined);
    const injector = createInjector();

    const localeId = injector.get(LOCALE_ID);

    expect(localeId).toBe('en-US');
  });
});
