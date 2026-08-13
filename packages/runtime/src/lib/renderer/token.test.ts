import { InjectionToken, Injector } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LynxBackgroundDocument } from '../lynx-document';
import { LYNX_DOCUMENT } from './token';

describe('LYNX_DOCUMENT', () => {
  it('is an InjectionToken', () => {
    expect(LYNX_DOCUMENT).toBeInstanceOf(InjectionToken);
  });

  it('has the description "lynx-document"', () => {
    expect(LYNX_DOCUMENT.toString()).toBe('InjectionToken lynx-document');
  });

  it('can be used to provide and inject a LynxDocumentBase value', () => {
    const doc = new LynxBackgroundDocument();
    const injector = Injector.create({
      providers: [{ provide: LYNX_DOCUMENT, useValue: doc }],
    });

    expect(injector.get(LYNX_DOCUMENT)).toBe(doc);
  });
});
