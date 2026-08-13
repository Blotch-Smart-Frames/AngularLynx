import { ElementRef, Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { LynxExposure } from './exposure';

/**
 * Builds a directive instance with a fake element injected via DI.
 */
const createDirective = (nativeElement: object): LynxExposure => {
  const injector = Injector.create({
    providers: [
      { provide: ElementRef, useValue: new ElementRef(nativeElement) },
    ],
  });
  return runInInjectionContext(injector, () => new LynxExposure());
};

/**
 * Creates a mock BaseLynxElement with an addEventListener that captures callbacks.
 */
const createMockElement = () => {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const removers: Record<string, ReturnType<typeof vi.fn>> = {};

  const addEventListener = vi.fn((name: string, cb: () => void) => {
    listeners[name] = cb;
    const remover = vi.fn();
    removers[name] = remover;
    return remover;
  });

  return { addEventListener, listeners, removers };
};

describe('LynxExposure', () => {
  it('registers a binduiappear listener on construction', () => {
    const el = createMockElement();

    createDirective(el);

    expect(el.addEventListener).toHaveBeenCalledWith(
      'binduiappear',
      expect.any(Function),
    );
  });

  it('registers a binduidisappear listener on construction', () => {
    const el = createMockElement();

    createDirective(el);

    expect(el.addEventListener).toHaveBeenCalledWith(
      'binduidisappear',
      expect.any(Function),
    );
  });

  it('initializes visible to false', () => {
    const el = createMockElement();
    const directive = createDirective(el);

    expect(directive.visible()).toBe(false);
  });

  it('sets visible to true when binduiappear fires', () => {
    const el = createMockElement();
    const directive = createDirective(el);

    el.listeners['binduiappear']();

    expect(directive.visible()).toBe(true);
  });

  it('sets visible to false when binduidisappear fires after appear', () => {
    const el = createMockElement();
    const directive = createDirective(el);

    el.listeners['binduiappear']();
    el.listeners['binduidisappear']();

    expect(directive.visible()).toBe(false);
  });

  it('calls remover functions on ngOnDestroy', () => {
    const el = createMockElement();
    const directive = createDirective(el);

    directive.ngOnDestroy();

    expect(el.removers['binduiappear']).toHaveBeenCalledOnce();
    expect(el.removers['binduidisappear']).toHaveBeenCalledOnce();
  });

  it('does not throw if addEventListener returns undefined', () => {
    const el = {
      addEventListener: vi.fn(() => undefined),
    };

    const directive = createDirective(el);

    expect(() => directive.ngOnDestroy()).not.toThrow();
  });
});
