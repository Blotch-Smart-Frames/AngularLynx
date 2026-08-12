// @vitest-environment jsdom
//
// These directive classes (view, text, image, frame, overlay, refresh,
// scroll-view, svg, viewpager, misc, scroll-coordinator, list) declare no
// logic of their own — they only extend LynxElementBase with a typed `inputs`
// list for the Angular template checker. ngOnChanges behavior is already
// covered by base.spec.ts (and input.spec.ts for the two overrides). All that
// is left to exercise here is the inherited `inject(ElementRef)` constructor
// path for each exported class, so a single parametrized loop suffices.
import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LynxFrame } from './frame';
import { LynxImage } from './image';
import { LynxList, LynxListItem } from './list';
import { LynxBlock, LynxFor, LynxIf } from './misc';
import { LynxOverlay } from './overlay';
import { LynxRefresh, LynxRefreshHeader } from './refresh';
import {
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorToolbar,
} from './scroll-coordinator';
import { LynxScrollView } from './scroll-view';
import { LynxSvg } from './svg';
import { LynxText } from './text';
import { LynxView } from './view';
import { LynxViewPager, LynxViewPagerItem } from './viewpager';

const DIRECTIVE_CLASSES = [
  LynxView,
  LynxText,
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
  LynxList,
  LynxListItem,
] as const;

describe('declaration-only Lynx element directives', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: { nativeElement: {} } },
      ],
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
