/**
 * fireEvent tests — verify Lynx events reach Angular event handlers.
 */

import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, eventMap, waitForUpdate } from './index.js';

describe('fireEvent', () => {
  it('dispatches tap event to bindtap handler', async () => {
    @Component({
      selector: 'test-tap',
      template: `<view (bindtap)="onTap()"
        ><text>{{ count() }}</text></view
      >`,
      changeDetection: ChangeDetectionStrategy.OnPush,
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
          ng-version="22.0.2"
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
          ng-version="22.0.2"
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
      changeDetection: ChangeDetectionStrategy.OnPush,
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
      changeDetection: ChangeDetectionStrategy.OnPush,
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
      changeDetection: ChangeDetectionStrategy.OnPush,
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

  it('defaults to bindEvent as the event type prefix', () => {
    const el = document.createElement('div');
    let received: Event | null = null;
    el.addEventListener('bindEvent:tap', (e) => {
      received = e;
    });

    fireEvent.tap(el);

    expect(received).not.toBeNull();
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
});

describe('fireEvent — every event in eventMap dispatches', () => {
  for (const eventName of Object.keys(eventMap)) {
    it(`dispatches ${eventName}`, () => {
      const el = document.createElement('div');
      let received = false;
      el.addEventListener(`bindEvent:${eventName}`, () => {
        received = true;
      });
      (fireEvent as any)[eventName](el);
      expect(received).toBe(true);
    });
  }
});
