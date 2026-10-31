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

@Component({
  imports: [UiCardContent, UiCardTitle, LYNX_ELEMENTS],
  template: `
    <ui-card-content class="pt-6"><text>Body</text></ui-card-content>
    <ui-card-content class="p-2"><text>Tight</text></ui-card-content>
    <ui-card-title class="mb-2">Title</ui-card-title>
  `,
})
class StaticClassHost {}

/**
 * The card: its host, found by the card's class rather than by being the
 * first view (the test host renders as a view too).
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

  // Angular gives a component's host every static attribute written on it,
  // so a part that also styled a view inside its host applied the class
  // twice: double the padding (issue #181).
  it('puts a class written on a part on that one element', async () => {
    const { container, getByText } = await render(StaticClassHost);
    expect(container.querySelectorAll('.pt-6')).toHaveLength(1);
    expect(container.querySelectorAll('.mb-2')).toHaveLength(1);
    // The title is a single <text>, with the class.
    expect(getByText('Title').tagName.toLowerCase()).toBe('text');
    expect(getByText('Title').getAttribute('class')).toContain('mb-2');
  });

  it("lets a part's class override its own", async () => {
    const { getByText } = await render(StaticClassHost);
    const tight = getByText('Tight').parentElement!;
    expect(tight.getAttribute('class')).toContain('p-2');
    expect(tight.getAttribute('class')).not.toContain('p-6');
    const body = getByText('Body').parentElement!;
    expect(body.getAttribute('class')).toContain('p-6');
    expect(body.getAttribute('class')).toContain('pt-6');
    expect(body.getAttribute('class')).not.toContain('pt-0');
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
