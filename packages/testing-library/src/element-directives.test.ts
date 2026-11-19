/**
 * The element directives in LYNX_ELEMENTS (`<view>`, `<text>`, `<image>`…)
 * give the template checker each element's attributes. Under the Lynx
 * renderer, the ones that only do that match no element (#444): Angular
 * hands their bindings to the renderer, which sets them as the directives
 * did, without making a directive for every element of a screen.
 */

import { Component, Directive, inject, signal, type Type } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxImage,
  LynxInput,
  LynxText,
  LynxView,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, waitForUpdate } from './index.js';

const ELEMENT_DIRECTIVES: readonly Type<unknown>[] = [
  LynxView,
  LynxText,
  LynxImage,
  LynxInput,
];

/** Each probe made, in the order Angular made them. */
const probes: Probe[] = [];

/**
 * Finds the element directives Angular made for the element it's on, as a
 * directive of an app's own would inject one.
 */
@Directive({ selector: '[probe]' })
class Probe {
  readonly found = ELEMENT_DIRECTIVES.filter((type) =>
    inject(type, { optional: true, self: true }),
  );

  constructor() {
    probes.push(this);
  }
}

@Component({
  selector: 'profile-card',
  imports: [LYNX_ELEMENTS, Probe],
  template: `
    <view
      probe
      class="card"
      flatten="false"
      ignore-focus
      pan-intercept-scope="5"
    >
      <text probe class="name" [accessibility-label]="label()">Ada</text>
      <image probe class="avatar" mode="aspectFill" [src]="avatar()" />
      <input probe class="field" value="Lovelace" />
    </view>
  `,
})
class ProfileCard {
  readonly label = signal<string | undefined>('Ada Lovelace');
  readonly avatar = signal('https://example.com/a.png');
}

/** Each Announce made. */
const announcers: Announce[] = [];

/**
 * A directive of an app's own that takes the element's
 * `accessibility-label` as its input.
 */
@Directive({ selector: '[announce]', inputs: ['accessibility-label'] })
class Announce {
  declare 'accessibility-label'?: string;

  constructor() {
    announcers.push(this);
  }
}

@Component({
  selector: 'announced-card',
  imports: [LYNX_ELEMENTS, Announce],
  template: `<view
    announce
    class="card"
    [accessibility-label]="label()"
  ></view>`,
})
class AnnouncedCard {
  readonly label = signal('New message');
}

describe('element directives under the Lynx renderer', () => {
  it('makes no directive for an element whose directive only declares its attributes', async () => {
    probes.length = 0;
    await render(ProfileCard);

    expect(probes.map((probe) => probe.found)).toEqual([
      [],
      [],
      [],
      // A field's directive shows its value as its text, so it's still made.
      [LynxInput],
    ]);
  });

  it('sets static attributes as the directives read them', async () => {
    const { container } = await render(ProfileCard);
    const view = container.querySelector('.card')!;

    expect(view.getAttribute('flatten')).toBe('false');
    // A bare attribute is true, as the directive's input reads it.
    expect(view.getAttribute('ignore-focus')).toBe('true');
    expect(view.getAttribute('pan-intercept-scope')).toBe('5');
    expect(container.querySelector('.avatar')!.getAttribute('mode')).toBe(
      'aspectFill',
    );
  });

  it('sets bound attributes, follows them, and removes one bound to undefined', async () => {
    const { container, componentRef } = await render(ProfileCard);
    const text = container.querySelector('.name')!;
    const image = container.querySelector('.avatar')!;

    expect(text.getAttribute('accessibility-label')).toBe('Ada Lovelace');
    expect(image.getAttribute('src')).toBe('https://example.com/a.png');

    componentRef.instance.label.set('Countess');
    componentRef.instance.avatar.set('https://example.com/b.png');
    await waitForUpdate();
    expect(text.getAttribute('accessibility-label')).toBe('Countess');
    expect(image.getAttribute('src')).toBe('https://example.com/b.png');

    componentRef.instance.label.set(undefined);
    await waitForUpdate();
    expect(text.hasAttribute('accessibility-label')).toBe(false);
  });

  // Angular gives a binding to the directives that declare it as an input,
  // and to the element only when none does (setPropertyAndInputs), as on the
  // web: `<div announce [id]="x">` doesn't set the div's id either. LynxView
  // no longer declares it alongside, so the element doesn't get it.
  it("gives a binding an app's own directive declares as an input to that directive alone", async () => {
    announcers.length = 0;
    const { container } = await render(AnnouncedCard);

    expect(announcers[0]['accessibility-label']).toBe('New message');
    expect(
      container.querySelector('.card')!.hasAttribute('accessibility-label'),
    ).toBe(false);
  });
});
