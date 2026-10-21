// @vitest-environment jsdom
//
// These directive classes (view, text, image, frame, overlay, refresh,
// scroll-view, svg, viewpager, misc, scroll-coordinator, list, blur-view,
// video, webview, cover-view, title-bar-view) declare no logic of their own —
// they only extend LynxElementBase with a typed `inputs` list for the Angular
// template checker. ngOnChanges behavior is already
// covered by base.test.ts (and input.test.ts for the two overrides). What's
// left to exercise here is the inherited `inject(ElementRef)` constructor
// path for each exported class, and that the inputs they declare are the
// attribute names Lynx reads.
import '@angular/compiler';
import { ElementRef, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LynxBlurView } from './blur-view';
import { LynxCoverView } from './cover-view';
import { LynxFrame } from './frame';
import { LynxImage } from './image';
import { LynxInput, LynxTextarea } from './input';
import { LynxList, LynxListItem } from './list';
import { LynxBlock, LynxFor, LynxIf } from './misc';
import { LynxOverlay } from './overlay';
import { LynxRefresh, LynxRefreshHeader } from './refresh';
import {
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorSlotDrag,
  LynxScrollCoordinatorToolbar,
} from './scroll-coordinator';
import { LynxScrollView } from './scroll-view';
import { LynxSvg } from './svg';
import { LynxInlineTruncation, LynxText } from './text';
import { LynxTitleBarView } from './title-bar-view';
import { LynxVideo } from './video';
import { LynxView } from './view';
import { LynxViewPager, LynxViewPagerItem } from './viewpager';
import { LynxWebView } from './webview';

const DIRECTIVE_CLASSES = [
  LynxView,
  LynxText,
  LynxInlineTruncation,
  LynxImage,
  LynxFrame,
  LynxOverlay,
  LynxRefresh,
  LynxRefreshHeader,
  LynxScrollView,
  LynxSvg,
  LynxViewPager,
  LynxViewPagerItem,
  LynxBlock,
  LynxFor,
  LynxIf,
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorToolbar,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorSlotDrag,
  LynxList,
  LynxListItem,
  LynxBlurView,
  LynxVideo,
  LynxWebView,
  LynxCoverView,
  LynxTitleBarView,
] as const;

describe('declaration-only Lynx element directives', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ElementRef, useValue: { nativeElement: {} } }],
    });
  });

  it.each(DIRECTIVE_CLASSES.map((Cls) => [Cls.name, Cls] as const))(
    'constructs %s via inject(ElementRef)',
    (_name, Cls) => {
      const instance = TestBed.runInInjectionContext(() => new Cls());
      expect(instance).toBeInstanceOf(Cls);
    },
  );
});

/**
 * The input names a directive declares, its own and the ones it inherits.
 */
const inputsOf = (directive: Type<unknown>): string[] =>
  Object.keys((directive as any).ɵdir.inputs);

describe('declared inputs', () => {
  it.each(
    [...DIRECTIVE_CLASSES, LynxInput, LynxTextarea].map(
      (Cls) => [Cls.name, Cls] as const,
    ),
  )('%s takes the attributes Lynx reads on every element', (_name, Cls) => {
    expect(inputsOf(Cls)).toEqual(
      expect.arrayContaining([
        'accessibility-traits',
        'flatten',
        'pan-intercept-direction',
        'pan-intercept-scope',
        'consume-slide-event',
        'enable-touch-pseudo-propagation',
        'enable-exposure-ui-margin',
      ]),
    );
    // iOS, Android and Harmony read only the plural.
    expect(inputsOf(Cls)).not.toContain('accessibility-trait');
  });

  it('leaves list gaps to style, where Lynx reads them', () => {
    expect(inputsOf(LynxList)).not.toContain('list-main-axis-gap');
    expect(inputsOf(LynxList)).not.toContain('list-cross-axis-gap');
  });

  it("doesn't offer React Lynx's defer, which isn't a native attribute", () => {
    expect(inputsOf(LynxListItem)).not.toContain('defer');
  });
});
