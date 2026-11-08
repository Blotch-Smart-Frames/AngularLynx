/**
 * Text fields: a test reads what an `<input>` or `<textarea>` shows in its
 * `value`, as a device's field shows it: a value it has from its first
 * render, bound or a form's, a value set later, and the text
 * `fireEvent.input` types (issue #339).
 */

import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { form, FormField } from '@angular/forms/signals';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';

/**
 * A field of each kind. A Signal Forms field on a component (`ui-input`) is
 * covered by ui-input's own specs, under `ng test`: these compile just in
 * time, where Angular doesn't register a component's `value` model as one
 * (see render-inputs.test.ts).
 */
@Component({
  selector: 'widget-settings',
  imports: [LYNX_ELEMENTS, FormField, ReactiveFormsModule],
  template: `
    <input class="name" [value]="name()" />
    <textarea class="notes" [value]="notes()"></textarea>
    <input class="title" [formField]="settings.title" />
    <input class="city" [formControl]="city" />
  `,
})
class WidgetSettings {
  readonly name = signal('Ada');
  readonly notes = signal('Leeds');
  readonly model = signal({ title: 'Clock' });
  readonly settings = form(this.model);
  readonly city = new FormControl('Leeds', { nonNullable: true });
}

const field = (container: Element, selector: string): HTMLInputElement =>
  container.querySelector(selector) as HTMLInputElement;

describe('text fields', () => {
  it('have the value they render with', async () => {
    const { container } = await render(WidgetSettings);

    expect(field(container, 'input.name').value).toBe('Ada');
    expect(field(container, 'textarea.notes').value).toBe('Leeds');
    expect(field(container, 'input.title').value).toBe('Clock');
    expect(field(container, 'input.city').value).toBe('Leeds');
  });

  it('have a value set later', async () => {
    const { container, componentRef } = await render(WidgetSettings);

    componentRef.instance.name.set('Grace');
    componentRef.instance.model.set({ title: 'Weather' });
    componentRef.instance.city.reset('');
    await waitForUpdate();

    expect(field(container, 'input.name').value).toBe('Grace');
    expect(field(container, 'input.title').value).toBe('Weather');
    expect(field(container, 'input.city').value).toBe('');
  });

  it('have the text fireEvent.input types, which their form gets', async () => {
    const { container, componentRef } = await render(WidgetSettings);
    const title = field(container, 'input.title');

    fireEvent.input(title, { detail: { value: 'Clocks' } });
    await waitForUpdate();

    expect(title.value).toBe('Clocks');
    expect(componentRef.instance.model().title).toBe('Clocks');

    // The form taking it back.
    componentRef.instance.model.set({ title: 'Clock' });
    await waitForUpdate();
    expect(title.value).toBe('Clock');
  });

  it('leave a non-field element without a value for an input event', async () => {
    @Component({
      imports: [LYNX_ELEMENTS],
      template: `<view class="box" (bindinput)="(0)"></view>`,
    })
    class Box {}
    const { container } = await render(Box);
    const box = container.querySelector('.box') as Element & {
      value?: string;
    };

    fireEvent.input(box, { detail: { value: 'x' } });

    expect(box.value).toBeUndefined();
  });
});
