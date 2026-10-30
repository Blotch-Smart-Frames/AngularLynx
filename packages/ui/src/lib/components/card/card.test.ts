import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardFooter,
  UiCardHeader,
  UiCardTitle,
} from './card';

@Component({
  imports: [
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardDescription,
    UiCardContent,
    UiCardFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-card [pressable]="pressable()" class="w-full">
      <ui-card-header class="gap-1">
        <ui-card-title class="text-lg">Title</ui-card-title>
        <ui-card-description class="italic">Desc</ui-card-description>
      </ui-card-header>
      <ui-card-content class="pt-2"><text>Body</text></ui-card-content>
      <ui-card-footer class="justify-end"><text>Actions</text></ui-card-footer>
    </ui-card>
  `,
})
class CardHost {
  readonly pressable = signal(false);
}

@Component({
  imports: [UiCard, LYNX_ELEMENTS],
  template: `<ui-card pressable><text>Order</text></ui-card>`,
})
class BarePressableHost {}

/**
 * The card's own view. Each component's host element renders as a view too,
 * so it's found by the card's class rather than by being the first.
 */
const cardView = (container: Element) => container.querySelector('.bg-card')!;

/**
 * Fires a Lynx event `fireEvent` has no shortcut for, as Lynx dispatches it:
 * `mouseleave` is the mouse's `touchcancel`.
 */
const fireLynxEvent = (element: Element, name: string) =>
  fireEvent(
    element,
    Object.assign(new Event(`bindEvent:${name}`), {
      eventType: 'bindEvent',
      eventName: name,
    }),
  );

/**
 * The scale the card's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

describe('UiCard', () => {
  it('renders each part with its projected content', async () => {
    const { getByText } = await render(CardHost);
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Desc')).toBeTruthy();
    expect(getByText('Body')).toBeTruthy();
    expect(getByText('Actions')).toBeTruthy();
  });

  it("merges each part's class with its own", async () => {
    const { container, getByText } = await render(CardHost);
    expect(cardView(container).getAttribute('class')).toContain('bg-card');
    expect(cardView(container).getAttribute('class')).toContain('w-full');
    expect(getByText('Title').getAttribute('class')).toContain('text-lg');
    expect(getByText('Desc').getAttribute('class')).toContain('italic');
  });

  it("doesn't respond to presses unless it's pressable", async () => {
    const { container } = await render(CardHost);
    const view = cardView(container);
    fireEvent.touchstart(view);
    fireEvent.mousedown(view);
    expect(scaleOf(view)).toBe('');
    fireEvent.touchend(view);
    fireEvent.touchcancel(view);
    fireEvent.mouseup(view);
    fireLynxEvent(view, 'mouseleave');
    expect(scaleOf(view)).toBe('');
  });

  it('scales down while pressed by touch, and back on release', async () => {
    const { container, componentRef } = await render(CardHost);
    (componentRef.instance as CardHost).pressable.set(true);
    await waitForUpdate();
    const view = cardView(container);

    fireEvent.touchstart(view);
    expect(scaleOf(view)).toBe('scale(0.985)');
    fireEvent.touchend(view);
    expect(scaleOf(view)).toBe('scale(1)');

    // A scroll that takes the touch over cancels it: the card scales back.
    fireEvent.touchstart(view);
    fireEvent.touchcancel(view);
    expect(scaleOf(view)).toBe('scale(1)');
  });

  it('is pressable with a bare pressable attribute', async () => {
    const { container } = await render(BarePressableHost);
    const view = cardView(container);

    fireEvent.touchstart(view);
    expect(scaleOf(view)).toBe('scale(0.985)');
    fireEvent.touchend(view);
    expect(scaleOf(view)).toBe('scale(1)');
  });

  it('scales down while pressed by mouse, and back on release or leave', async () => {
    const { container, componentRef } = await render(CardHost);
    (componentRef.instance as CardHost).pressable.set(true);
    await waitForUpdate();
    const view = cardView(container);

    fireEvent.mousedown(view);
    expect(scaleOf(view)).toBe('scale(0.985)');
    fireEvent.mouseup(view);
    expect(scaleOf(view)).toBe('scale(1)');

    fireEvent.mousedown(view);
    fireLynxEvent(view, 'mouseleave');
    expect(scaleOf(view)).toBe('scale(1)');
  });
});
