// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef, EventEmitter } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LynxRouterLinkActive,
  ROUTER_LINK_ACTIVE_CHANGE,
} from './lynx-router-link-active';

describe('LynxRouterLinkActive', () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Creates the directive on a fake element whose RouterLinkActive reports
   * through `activeChange`, as provideRouter()'s token finds it.
   */
  const create = (activeChange: EventEmitter<boolean> | null | undefined) => {
    const element = { setAccessibilityTrait: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(element) },
        ...(activeChange === undefined
          ? []
          : [
              {
                provide: ROUTER_LINK_ACTIVE_CHANGE,
                useValue: () => activeChange,
              },
            ]),
      ],
    });
    TestBed.runInInjectionContext(() => new LynxRouterLinkActive());
    return element;
  };

  it('marks the element selected while its link is active', () => {
    const activeChange = new EventEmitter<boolean>();
    const element = create(activeChange);

    activeChange.emit(true);
    expect(element.setAccessibilityTrait).toHaveBeenLastCalledWith(
      'selected',
      true,
    );

    activeChange.emit(false);
    expect(element.setAccessibilityTrait).toHaveBeenLastCalledWith(
      'selected',
      false,
    );
  });

  it('stops following the link when it is destroyed', () => {
    const activeChange = new EventEmitter<boolean>();
    const element = create(activeChange);

    TestBed.resetTestingModule();
    activeChange.emit(true);

    expect(element.setAccessibilityTrait).not.toHaveBeenCalled();
  });

  it('does nothing on an element without RouterLinkActive', () => {
    const element = create(null);

    expect(element.setAccessibilityTrait).not.toHaveBeenCalled();
  });

  it('does nothing without the router', () => {
    // No provideRouter(), so nothing provides the token.
    const element = create(undefined);

    expect(element.setAccessibilityTrait).not.toHaveBeenCalled();
  });
});
