/**
 * fireEvent tests — verify Lynx events reach Angular event handlers, along
 * the path Lynx sends them on a device.
 */

import { Component, signal } from '@angular/core';
import { configure, getConfig } from '@testing-library/dom';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, eventMap, screen, waitForUpdate } from './index.js';

/**
 * Registers `handler` for `type:name` on `element` the way the renderer does
 * (LynxElement.addEventListener): a worklet the testing environment runs
 * with a copy of the event.
 */
const addHandler = (
  element: Element,
  type: string,
  name: string,
  handler: (event: any) => void,
): void =>
  (globalThis as any).__AddEvent(element, type, name, {
    type: 'worklet',
    value: handler,
  });

/**
 * The events Lynx sends up the response chain: touch events everywhere, and
 * mouse, wheel and key events on desktop and web.
 */
const BUBBLING_EVENTS = [
  'tap',
  'longtap',
  'touchstart',
  'touchmove',
  'touchcancel',
  'touchend',
  'longpress',
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseclick',
  'mousedblclick',
  'mouselongpress',
  'wheel',
];

describe('fireEvent', () => {
  it('dispatches tap event to bindtap handler', async () => {
    @Component({
      selector: 'test-tap',
      template: `<view (bindtap)="onTap()"
        ><text>{{ count() }}</text></view
      >`,
    })
    class TapComponent {
      count = signal(0);
      onTap() {
        this.count.update((n) => n + 1);
      }
    }

    const { container, asFragment } = await render(TapComponent);
    const view = container.querySelector('view')!;

    expect(container.querySelector('text')!.textContent).toBe('0');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.2.1"
        >
          <view>
            <text>
              0
            </text>
          </view>
        </page>
      </DocumentFragment>
    `);

    fireEvent.tap(view);
    await waitForUpdate();

    expect(container.querySelector('text')!.textContent).toBe('1');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.2.1"
        >
          <view>
            <text>
              1
            </text>
          </view>
        </page>
      </DocumentFragment>
    `);
  });

  it('dispatches raw DOM event', async () => {
    let called = false;

    @Component({
      selector: 'test-raw',
      template: `<view (bindtap)="onTap()"></view>`,
    })
    class RawEventComponent {
      onTap() {
        called = true;
      }
    }

    const { container } = await render(RawEventComponent);
    const view = container.querySelector('view')!;

    fireEvent(view, new Event('bindEvent:tap'));

    expect(called).toBe(true);
  });

  it('dispatches longtap event through Angular handler', async () => {
    let called = false;

    @Component({
      selector: 'test-longtap',
      template: `<view (bindlongtap)="onLongtap()"></view>`,
    })
    class LongtapComponent {
      onLongtap() {
        called = true;
      }
    }

    const { container } = await render(LongtapComponent);
    fireEvent.longtap(container.querySelector('view')!);
    expect(called).toBe(true);
  });

  it('merges custom init properties onto the dispatched event', async () => {
    let receivedEvent: any = null;

    @Component({
      selector: 'test-input-props',
      template: `<view (bindinput)="onInput($event)"></view>`,
    })
    class InputPropsComponent {
      onInput(event: any) {
        receivedEvent = event;
      }
    }

    const { container } = await render(InputPropsComponent);
    fireEvent.input(container.querySelector('view')!, { value: 'typed-text' });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent.value).toBe('typed-text');
  });

  it("gives a handler its kind and the event's name", () => {
    const el = document.createElement('view');
    let received: any = null;
    addHandler(el, 'catchEvent', 'tap', (e) => {
      received = e;
    });

    fireEvent.tap(el, { detail: { x: 4 } });

    expect(received).toMatchObject({
      eventType: 'catchEvent',
      eventName: 'tap',
      detail: { x: 4 },
    });
  });

  it('uses a custom eventType as the event name prefix', () => {
    const el = document.createElement('div');
    let received: Event | null = null;
    el.addEventListener('worklet:tap', (e) => {
      received = e;
    });

    fireEvent.tap(el, { eventType: 'worklet' });

    expect(received).not.toBeNull();
  });
});

describe('eventMap', () => {
  it('contains all expected Lynx event types', () => {
    expect(Object.keys(eventMap)).toEqual([
      // Touch / gesture
      'tap',
      'longtap',
      'touchstart',
      'touchmove',
      'touchcancel',
      'touchend',
      'longpress',
      // Keyboard
      'keydown',
      'keyup',
      // Mouse
      'mousedown',
      'mouseup',
      'mousemove',
      'mouseclick',
      'mousedblclick',
      'mouselongpress',
      'wheel',
      // Scroll / viewport
      'scroll',
      'scrollend',
      'scrolltoupper',
      'scrolltolower',
      'contentsizechanged',
      'scrolltoupperedge',
      'scrolltoloweredge',
      'scrolltonormalstate',
      // Form / focus
      'focus',
      'blur',
      'input',
      'confirm',
      // Layout / image
      'layoutchange',
      'bgload',
      'bgerror',
      // Transition / animation
      'transitionstart',
      'transitionend',
      'transitioncancel',
      'animationend',
    ]);
  });

  it('every entry has a defaultInit object', () => {
    for (const value of Object.values(eventMap)) {
      expect(typeof value.defaultInit).toBe('object');
    }
  });

  it('marks the events Lynx sends up the response chain', () => {
    const bubbling = Object.entries(eventMap)
      .filter(([, value]) => 'bubbles' in value.defaultInit)
      .map(([name]) => name);
    expect(bubbling).toEqual(BUBBLING_EVENTS);
  });
});

describe('fireEvent — every event in eventMap dispatches', () => {
  for (const eventName of Object.keys(eventMap)) {
    it(`dispatches ${eventName}`, () => {
      const el = document.createElement('view');
      let received = false;
      addHandler(el, 'bindEvent', eventName, () => {
        received = true;
      });
      (fireEvent as any)[eventName](el);
      expect(received).toBe(true);
    });
  }
});

describe('fireEvent — the path an event takes', () => {
  it("brings a tap on an accessible row to its card's (click)", async () => {
    /**
     * A pressable card read as one element: getByRole finds the row, which
     * carries the accessibility attributes, and the listener is on the card
     * around it.
     */
    @Component({
      selector: 'test-card',
      template: `
        <view (click)="opened.set(true)">
          <view
            [accessibility-element]="true"
            accessibility-traits="button"
            accessibility-label="Living Room, 3 frames"
          >
            <text>Living Room</text>
          </view>
          @if (opened()) {
            <text>Kitchen</text>
          }
        </view>
      `,
    })
    class CardComponent {
      readonly opened = signal(false);
    }

    await render(CardComponent);
    fireEvent.tap(screen.getByRole('button', { name: /^Living Room/ }));
    await waitForUpdate();

    expect(screen.getByText('Kitchen')).toBeTruthy();
  });

  it('runs a (catchtap) on the way up and stops there', async () => {
    const ran: string[] = [];

    @Component({
      selector: 'test-catch',
      template: `
        <view (bindtap)="ran.push('backdrop')">
          <view (catchtap)="ran.push('panel')">
            <view class="row" (bindtap)="ran.push('row')">
              <text class="label">Row</text>
            </view>
          </view>
        </view>
      `,
    })
    class CatchComponent {
      readonly ran = ran;
    }

    const { container } = await render(CatchComponent);
    fireEvent.tap(container.querySelector('.label')!);

    expect(ran).toEqual(['row', 'panel']);
  });

  it("runs the tapped element's own (catchtap)", async () => {
    let caught = 0;

    @Component({
      selector: 'test-own-catch',
      template: `<view (catchtap)="caught()"></view>`,
    })
    class OwnCatchComponent {
      caught() {
        caught++;
      }
    }

    const { container } = await render(OwnCatchComponent);
    fireEvent.tap(container.querySelector('view')!);

    expect(caught).toBe(1);
  });

  it('runs capture handlers from the page down, then bubbling ones up', async () => {
    const ran: string[] = [];

    @Component({
      selector: 'test-capture',
      template: `
        <view (bindtap)="ran.push('page bubble')">
          <view (capture-bindtap)="ran.push('outer capture')">
            <view (capture-bindtap)="ran.push('inner capture')">
              <view class="target" (bindtap)="ran.push('target')"></view>
            </view>
          </view>
        </view>
      `,
    })
    class CaptureComponent {
      readonly ran = ran;
    }

    const { container } = await render(CaptureComponent);
    fireEvent.tap(container.querySelector('.target')!);

    expect(ran).toEqual([
      'outer capture',
      'inner capture',
      'target',
      'page bubble',
    ]);
  });

  it('stops at a (capture-catchtap) on the way down', async () => {
    const ran: string[] = [];

    @Component({
      selector: 'test-capture-catch',
      template: `
        <view (bindtap)="ran.push('page')">
          <view (capture-catchtap)="ran.push('outer')">
            <view (capture-bindtap)="ran.push('inner')">
              <view class="target" (bindtap)="ran.push('target')"></view>
            </view>
          </view>
        </view>
      `,
    })
    class CaptureCatchComponent {
      readonly ran = ran;
    }

    const { container } = await render(CaptureCatchComponent);
    fireEvent.tap(container.querySelector('.target')!);

    expect(ran).toEqual(['outer']);
  });

  it('keeps an event that is not a touch on its target', async () => {
    const ran: string[] = [];

    @Component({
      selector: 'test-scroll',
      template: `
        <view (capture-bindscroll)="ran.push('outer capture')">
          <view (bindscroll)="ran.push('outer')">
            <scroll-view class="target" (bindscroll)="ran.push('target')" />
          </view>
        </view>
      `,
    })
    class ScrollComponent {
      readonly ran = ran;
    }

    const { container } = await render(ScrollComponent);
    fireEvent.scroll(container.querySelector('.target')!);

    expect(ran).toEqual(['target']);
  });

  it('sends touch, mouse and key events up to the ancestors', () => {
    for (const name of BUBBLING_EVENTS) {
      const parent = document.createElement('view');
      const child = parent.appendChild(document.createElement('view'));
      const ran: string[] = [];
      addHandler(parent, 'bindEvent', name, () => ran.push('parent'));
      addHandler(child, 'bindEvent', name, () => ran.push('child'));

      (fireEvent as any)[name](child);

      expect(ran, name).toEqual(['child', 'parent']);
    }
  });

  it("follows init.bubbles over the event's own", () => {
    const parent = document.createElement('view');
    const child = parent.appendChild(document.createElement('view'));
    const ran: string[] = [];
    for (const name of ['tap', 'scroll']) {
      addHandler(parent, 'bindEvent', name, () => ran.push(`parent ${name}`));
      addHandler(child, 'bindEvent', name, () => ran.push(`child ${name}`));
    }

    fireEvent.tap(child, { bubbles: false });
    fireEvent.scroll(child, { bubbles: true });

    expect(ran).toEqual(['child tap', 'child scroll', 'parent scroll']);
  });

  it("fires an explicit eventType at the element's own handler only", () => {
    const parent = document.createElement('view');
    const child = parent.appendChild(document.createElement('view'));
    const ran: string[] = [];
    addHandler(parent, 'bindEvent', 'tap', () => ran.push('parent'));
    addHandler(child, 'bindEvent', 'tap', () => ran.push('child bind'));
    addHandler(child, 'catchEvent', 'tap', () => ran.push('child catch'));

    fireEvent.tap(child, { eventType: 'bindEvent' });
    fireEvent.tap(child, { eventType: 'catchEvent' });

    expect(ran).toEqual(['child bind', 'child catch']);
  });

  it("runs inside Testing Library's eventWrapper", () => {
    const { eventWrapper } = getConfig();
    const wrapped: string[] = [];
    configure({
      eventWrapper: (cb) => {
        wrapped.push('before');
        cb();
        wrapped.push('after');
      },
    });
    try {
      const el = document.createElement('view');
      addHandler(el, 'bindEvent', 'tap', () => wrapped.push('handler'));

      fireEvent.tap(el);

      expect(wrapped).toEqual(['before', 'handler', 'after']);
    } finally {
      configure({ eventWrapper });
    }
  });

  it('returns false when a handler cancels its event', () => {
    // A handler that isn't a worklet gets the event itself, through the
    // testing environment's publishEvent, rather than a copy.
    const tt = (globalThis as any).lynxCoreInject.tt;
    tt.publishEvent = (_sign: string, event: Event) => event.preventDefault();
    try {
      const el = document.createElement('view');
      (globalThis as any).__AddEvent(el, 'bindEvent', 'tap', 'handler-sign');

      expect(fireEvent.tap(el, { cancelable: true })).toBe(false);
      expect(fireEvent.tap(el)).toBe(true);
    } finally {
      delete tt.publishEvent;
    }
  });

  it('says so when there is no element to fire at', () => {
    expect(() => fireEvent.tap(null as unknown as Element)).toThrow(
      'Unable to fire a "tap" event - please provide a DOM element.',
    );
  });
});
