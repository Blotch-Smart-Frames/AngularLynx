// JIT-compiles the test components, which registerHostElement reads the
// selectors of.
import '@angular/compiler';
import { Component, Directive } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { hostElementOf, registerHostElement } from './host-elements';

describe('registerHostElement', () => {
  it("makes the component's host the element it names", () => {
    @Component({ selector: 'test-title', template: '' })
    class TestTitle {}

    registerHostElement(TestTitle, 'text');

    expect(hostElementOf('test-title')).toBe('text');
  });

  it('covers each element name in the selector, and nothing else', () => {
    @Component({
      selector: 'test-caption, test-legend, [testCaption], text.caption',
      template: '',
    })
    class TestCaption {}

    registerHostElement(TestCaption, 'text');

    expect(hostElementOf('test-caption')).toBe('text');
    expect(hostElementOf('test-legend')).toBe('text');
    expect(hostElementOf('text.caption')).toBe('text.caption');
  });

  it('leaves every other tag as it is', () => {
    expect(hostElementOf('test-unregistered')).toBe('test-unregistered');
    expect(hostElementOf('view')).toBe('view');
  });

  it('throws for a component that has no element to make', () => {
    @Component({ selector: '[testAttribute]', template: '' })
    class TestAttribute {}

    expect(() => registerHostElement(TestAttribute, 'text')).toThrow(
      "registerHostElement: TestAttribute isn't a component with an element selector",
    );
  });

  it('throws for a directive', () => {
    @Directive({ selector: 'test-directive' })
    class TestDirective {}

    expect(() => registerHostElement(TestDirective, 'text')).toThrow(
      "TestDirective isn't a component",
    );
  });
});
