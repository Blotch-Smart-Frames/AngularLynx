// @vitest-environment jsdom
//
// runComingTick() against Angular's own zoneless scheduler: the internals the
// renderer factory reads (the scheduler's pendingRenderTaskId and tick(), and
// ApplicationRef's dirtyFlags) are still there, under the same names. If a
// later Angular renames them, no tick runs early, which only this test sees.
import '@angular/compiler';
import {
  ApplicationRef,
  effect,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { runComingTick } from '../lynx-render-lifecycle';
import { InMemoryDocument } from '../testing/in-memory-document';
import { LynxRendererFactory2 } from './lynx-renderer-factory2';
import { LYNX_DOCUMENT } from './token';

describe("runComingTick with Angular's scheduler", () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  it('runs the tick the zoneless scheduler scheduled, once', () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LYNX_DOCUMENT, useValue: new InMemoryDocument() },
        LynxRendererFactory2,
      ],
    });
    TestBed.inject(LynxRendererFactory2);
    TestBed.inject(ApplicationRef);
    const count = signal(0);
    let seen = -1;
    // A root effect schedules a tick to run it.
    TestBed.runInInjectionContext(() =>
      effect(() => {
        seen = count();
      }),
    );
    expect(seen).toBe(-1);

    expect(runComingTick()).toBe(true);
    expect(seen).toBe(0);
    // The tick it ran was the one scheduled: none is left.
    expect(runComingTick()).toBe(false);
  });
});
