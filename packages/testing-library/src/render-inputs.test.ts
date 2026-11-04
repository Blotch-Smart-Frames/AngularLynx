/**
 * render()'s `inputs` and rerender({ inputs }).
 *
 * These specs compile just in time under plain Vitest, where Angular doesn't
 * register input() or model() as inputs, so the components here declare theirs
 * in `inputs` metadata, as LYNX_ELEMENTS does. Both reach the same
 * inputBinding() path; `ng test` covers signal inputs.
 */

import {
  Component,
  type InputSignal,
  type InputSignalWithTransform,
  type ModelSignal,
  numberAttribute,
  type OnChanges,
  type OnInit,
  type OutputEmitterRef,
  type SimpleChanges,
} from '@angular/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type RenderInputs,
  type RenderResult,
  render,
  waitForUpdate,
} from './index.js';

type Change = { previous: unknown; current: unknown; firstChange: boolean };

@Component({
  selector: 'test-greeting',
  inputs: ['name', { name: 'count', transform: numberAttribute }, 'tone: mood'],
  template: `<text>{{ tone }} {{ name }} x{{ count }}</text>`,
})
class Greeting implements OnInit, OnChanges {
  name = 'world';
  count = 0;
  tone = 'calm';
  nameOnInit = '';
  // Angular reuses SimpleChange objects between calls, so keep copies.
  changes: Record<string, Change>[] = [];

  ngOnInit(): void {
    this.nameOnInit = this.name;
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.changes.push(
      Object.fromEntries(
        Object.entries(changes).map(([key, change]) => [
          key,
          {
            previous: change.previousValue,
            current: change.currentValue,
            firstChange: change.firstChange,
          },
        ]),
      ),
    );
  }
}

@Component({
  selector: 'test-no-inputs',
  template: `<text>No inputs</text>`,
})
class NoInputs {}

const text = (result: RenderResult): string | null =>
  result.container.querySelector('text')!.textContent;

describe('options.inputs', () => {
  it('sets inputs before the first change detection', async () => {
    const result = await render(Greeting, { inputs: { name: 'Lynx' } });

    expect(text(result)).toBe('calm Lynx x0');
    expect(result.componentRef.instance.nameOnInit).toBe('Lynx');
    expect(result.componentRef.instance.changes).toEqual([
      { name: { previous: undefined, current: 'Lynx', firstChange: true } },
    ]);
  });

  it("leaves the inputs it isn't given at their defaults", async () => {
    const { componentRef } = await render(Greeting, {
      inputs: { count: 2 },
    });

    expect(componentRef.instance.name).toBe('world');
    expect(componentRef.instance.tone).toBe('calm');
  });

  it("runs an input's transform", async () => {
    // RenderInputs types `count` as its property, a number: a transform in
    // `inputs` metadata (or on an @Input()) isn't in the type. A signal
    // input's is, so `input(0, { transform: numberAttribute })` takes '3'.
    const result = await render(Greeting, {
      inputs: { count: '3' as unknown as number },
    });

    expect(result.componentRef.instance.count).toBe(3);
    expect(text(result)).toBe('calm world x3');
  });

  it('sets an aliased input by its alias', async () => {
    const result = await render(Greeting, { inputs: { mood: 'cheerful' } });

    expect(text(result)).toBe('cheerful world x0');
  });

  it("refuses an aliased input's property name, naming the alias", async () => {
    await expect(
      render(Greeting, { inputs: { tone: 'cheerful' } }),
    ).rejects.toThrowError(
      `render() can't set "tone": it's the property of Greeting's "mood" input. Use "mood", the name a template binds.`,
    );
  });

  it("refuses a name that isn't an input, listing the inputs", async () => {
    await expect(
      render(Greeting, { inputs: { title: 'Lynx' } }),
    ).rejects.toThrowError(
      `render() can't set "title": Greeting has no input by that name. Its inputs are "name", "count", "mood". Plain Vitest compiles components just in time, where Angular sees no input() or model() inputs; ng test compiles them ahead of time.`,
    );
  });

  it('says so when the component has no inputs', async () => {
    await expect(
      render(NoInputs, { inputs: { name: 'Lynx' } }),
    ).rejects.toThrowError(
      `NoInputs has no input by that name. It has no inputs.`,
    );
  });

  it('leaves componentRef.setInput() working when render() sets no inputs', async () => {
    const result = await render(Greeting);

    result.componentRef.setInput('name', 'Lynx');
    await waitForUpdate();

    expect(text(result)).toBe('calm Lynx x0');
  });

  it('types componentRef with the rendered component', async () => {
    const { componentRef } = await render(Greeting);

    expectTypeOf(componentRef.instance).toEqualTypeOf<Greeting>();
  });
});

describe('rerender({ inputs })', () => {
  it('changes an input in place, keeping the component', async () => {
    const result = await render(Greeting, { inputs: { name: 'Lynx' } });
    const instance = result.componentRef.instance;

    await result.rerender({ inputs: { name: 'Angular' } });

    expect(text(result)).toBe('calm Angular x0');
    expect(result.componentRef.instance).toBe(instance);
    expect(instance.changes.at(-1)).toEqual({
      name: { previous: 'Lynx', current: 'Angular', firstChange: false },
    });
  });

  it('keeps the values of the inputs it leaves out', async () => {
    const result = await render(Greeting, {
      inputs: { name: 'Lynx', count: 1 },
    });

    await result.rerender({ inputs: { count: 2 } });

    expect(text(result)).toBe('calm Lynx x2');
    expect(result.componentRef.instance.changes.at(-1)).toEqual({
      count: { previous: 1, current: 2, firstChange: false },
    });
  });

  it('resolves to the same result', async () => {
    const result = await render(Greeting, { inputs: { name: 'Lynx' } });

    await expect(
      result.rerender({ inputs: { name: 'Angular' } }),
    ).resolves.toBe(result);
  });

  it("refuses an input render() didn't set", async () => {
    const { rerender } = await render(Greeting, { inputs: { name: 'Lynx' } });

    await expect(rerender({ inputs: { count: 2 } })).rejects.toThrowError(
      `rerender({ inputs }) can only change inputs render() set, and render() didn't set "count". Give it a starting value in render()'s inputs: Angular sets those through input bindings, and a component with input bindings can't take other inputs.`,
    );
  });

  it("refuses a name that isn't an input", async () => {
    const { rerender } = await render(Greeting, { inputs: { name: 'Lynx' } });

    await expect(
      rerender({ inputs: { title: 'Angular' } }),
    ).rejects.toThrowError(`rerender({ inputs }) can't set "title"`);
  });

  it('refuses once the component is unmounted', async () => {
    const { rerender, unmount } = await render(Greeting, {
      inputs: { name: 'Lynx' },
    });
    unmount();

    await expect(
      rerender({ inputs: { name: 'Angular' } }),
    ).rejects.toThrowError(
      'rerender({ inputs }) has no component to change: it was unmounted, or a later render() replaced it.',
    );
  });

  it('refuses once a later render() replaced the component', async () => {
    const first = await render(Greeting, { inputs: { name: 'Lynx' } });
    await render(NoInputs);

    await expect(
      first.rerender({ inputs: { name: 'Angular' } }),
    ).rejects.toThrowError('rerender({ inputs }) has no component to change');
  });
});

describe('rerender(component, { inputs })', () => {
  it('renders the other component with its inputs', async () => {
    const { rerender } = await render(NoInputs);

    const result = await rerender(Greeting, { inputs: { name: 'Lynx' } });

    expect(text(result)).toBe('calm Lynx x0');
    expect(result.componentRef.instance.nameOnInit).toBe('Lynx');
  });
});

describe('render() of something it cannot bootstrap', () => {
  it("refuses a class that isn't a component", async () => {
    class NotAComponent {}

    await expect(render(NotAComponent)).rejects.toThrowError(
      "render() can't render NotAComponent: it isn't an Angular component. Give it the @Component decorator.",
    );
  });

  it("refuses a component that isn't standalone", async () => {
    @Component({
      selector: 'test-not-standalone',
      standalone: false,
      template: `<text>Declared in an NgModule</text>`,
    })
    class NotStandalone {}

    await expect(render(NotStandalone)).rejects.toThrowError(
      "render() can't render NotStandalone: it isn't standalone, and render() bootstraps it as an app's root component. Remove standalone: false.",
    );
  });
});

describe('RenderInputs', () => {
  // The shape `ng test` sees for input(), a transformed input() and model().
  // These are types only: the JIT compiler here wouldn't register them.
  type SignalInputs = {
    label: InputSignal<string>;
    count: InputSignalWithTransform<number, string | number>;
    value: ModelSignal<boolean>;
    pressed: OutputEmitterRef<void>;
    plain: string;
  };

  it('types a signal input with the value it takes', () => {
    expectTypeOf<RenderInputs<SignalInputs>['label']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<RenderInputs<SignalInputs>['count']>().toEqualTypeOf<
      string | number | undefined
    >();
    expectTypeOf<RenderInputs<SignalInputs>['value']>().toEqualTypeOf<
      boolean | undefined
    >();
  });

  it('types any other property as itself', () => {
    expectTypeOf<RenderInputs<SignalInputs>['plain']>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('allows names that are not properties, such as an alias', () => {
    expectTypeOf<{ class: string }>().toExtend<RenderInputs<SignalInputs>>();
  });

  it("rejects a value an input doesn't take", () => {
    expectTypeOf<{ label: number }>().not.toExtend<
      RenderInputs<SignalInputs>
    >();
  });
});
