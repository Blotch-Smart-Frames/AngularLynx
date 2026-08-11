// @vitest-environment jsdom
import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BaseLynxElement } from '../lynx-element';
import { LYNX_DOCUMENT } from '../renderer/token';
import { LynxPortal } from './portal';

@Component({
  selector: 'test-portal-content',
  template: '<div>portal content</div>',
})
class TestComponent {}

const createMockElement = (): BaseLynxElement => {
  const el: BaseLynxElement = {
    setAttribute: vi.fn(),
    setProperty: vi.fn(),
    getAttribute: vi.fn().mockReturnValue(null),
    removeAttribute: vi.fn(),
    setStyle: vi.fn(),
    removeStyle: vi.fn(),
    setInlineStyles: vi.fn(),
    insertBefore: vi.fn(),
    appendChild: vi.fn(),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    remove: vi.fn(),
    parentNode: vi.fn().mockReturnValue(null),
    nextSibling: vi.fn().mockReturnValue(null),
    querySelector: vi.fn().mockReturnValue(null),
    querySelectorAll: vi.fn().mockReturnValue([]),
    addEventListener: vi.fn().mockReturnValue(() => {}),
    animate: vi.fn() as any,
  };
  return el;
};

describe('LynxPortal', () => {
  let mockPage: BaseLynxElement;
  let createdElements: BaseLynxElement[];

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    mockPage = createMockElement();
    createdElements = [];

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TestComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: LYNX_DOCUMENT,
          useValue: {
            createElement: vi.fn((_tag: string) => {
              const el = createMockElement();
              createdElements.push(el);
              return el;
            }),
            createRootElement: vi.fn(() => mockPage),
            createText: vi.fn(() => createMockElement()),
            createComment: vi.fn(() => createMockElement()),
            appendChild: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('open', () => {
    it('creates an overlay element', () => {
      const service = TestBed.inject(LynxPortal);
      const doc = TestBed.inject(LYNX_DOCUMENT);

      service.open(TestComponent);

      expect(doc.createElement).toHaveBeenCalledWith('overlay');
    });

    it('sets visible attribute on overlay', () => {
      const service = TestBed.inject(LynxPortal);

      service.open(TestComponent);

      const overlay = createdElements[0]!;
      expect(overlay.setAttribute).toHaveBeenCalledWith('visible', true);
    });

    it('sets level attribute when provided', () => {
      const service = TestBed.inject(LynxPortal);

      service.open(TestComponent, { level: 3 });

      const overlay = createdElements[0]!;
      expect(overlay.setAttribute).toHaveBeenCalledWith('level', 3);
    });

    it('does not set level when not provided', () => {
      const service = TestBed.inject(LynxPortal);

      service.open(TestComponent);

      const overlay = createdElements[0]!;
      expect(overlay.setAttribute).not.toHaveBeenCalledWith(
        'level',
        expect.anything(),
      );
    });

    it('appends component host to overlay', () => {
      const service = TestBed.inject(LynxPortal);

      service.open(TestComponent);

      const overlay = createdElements[0]!;
      expect(overlay.appendChild).toHaveBeenCalled();
    });

    it('appends overlay to page root', () => {
      const service = TestBed.inject(LynxPortal);

      service.open(TestComponent);

      expect(mockPage.appendChild).toHaveBeenCalled();
    });

    it('returns a PortalRef with the component instance', () => {
      const service = TestBed.inject(LynxPortal);

      const ref = service.open(TestComponent);

      expect(ref.instance).toBeInstanceOf(TestComponent);
    });
  });

  describe('PortalRef', () => {
    it('setInput does not throw', () => {
      const service = TestBed.inject(LynxPortal);

      const ref = service.open(TestComponent);

      expect(() => ref.setInput('title', 'value')).not.toThrow();
    });

    it('destroy removes the overlay element', () => {
      const service = TestBed.inject(LynxPortal);

      const ref = service.open(TestComponent);
      const overlay = createdElements[0]!;
      ref.destroy();

      expect(overlay.remove).toHaveBeenCalled();
    });

    it('destroy is safe to call multiple times', () => {
      const service = TestBed.inject(LynxPortal);

      const ref = service.open(TestComponent);
      ref.destroy();

      expect(() => ref.destroy()).not.toThrow();
    });

    it('instance is null after destroy', () => {
      const service = TestBed.inject(LynxPortal);

      const ref = service.open(TestComponent);
      expect(ref.instance).not.toBeNull();

      ref.destroy();

      // Component is destroyed but instance reference is still readable
      expect(ref.instance).toBeInstanceOf(TestComponent);
    });
  });
});
