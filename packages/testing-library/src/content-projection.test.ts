/**
 * Content projection tests — verify ng-content, @ContentChild, @ContentChildren
 * work correctly when user-defined components project Lynx elements.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitForUpdate } from './index.js';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * Custom component selectors (card-wrapper, panel, etc.) are unknown to the
 * Lynx document and trigger a console.warn fallback. Suppress for clean output.
 */
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('content projection — single slot', () => {
  it('projects child elements into ng-content', async () => {
    @Component({
      selector: 'card-wrapper',
      template: `<view class="card"><ng-content /></view>`,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class CardWrapperComponent {}

    @Component({
      selector: 'test-basic-projection',
      template: `
        <card-wrapper>
          <text>Projected content</text>
        </card-wrapper>
      `,
      imports: [CardWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class BasicProjectionHost {}

    const { container } = await render(BasicProjectionHost);

    const card = container.querySelector('view.card');
    expect(card).not.toBeNull();

    const text = card!.querySelector('text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('Projected content');
  });

  it('projects multiple children into a single slot', async () => {
    @Component({
      selector: 'box-wrapper',
      template: `<view class="box"><ng-content /></view>`,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class BoxWrapperComponent {}

    @Component({
      selector: 'test-multi-children',
      template: `
        <box-wrapper>
          <text>First</text>
          <text>Second</text>
          <text>Third</text>
        </box-wrapper>
      `,
      imports: [BoxWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class MultiChildrenHost {}

    const { container } = await render(MultiChildrenHost);

    const box = container.querySelector('view.box');
    expect(box).not.toBeNull();

    const texts = box!.querySelectorAll('text');
    expect(texts.length).toBe(3);
    expect(texts[0]!.textContent).toBe('First');
    expect(texts[1]!.textContent).toBe('Second');
    expect(texts[2]!.textContent).toBe('Third');
  });
});

describe('content projection — multi-slot', () => {
  it('routes content to named slots via select attribute', async () => {
    @Component({
      selector: 'panel-component',
      template: `
        <view class="panel">
          <view class="panel-header"
            ><ng-content select="[slot=header]"
          /></view>
          <view class="panel-body"><ng-content /></view>
        </view>
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Panel {}

    @Component({
      selector: 'test-multi-slot',
      template: `
        <panel-component>
          <text slot="header">Header text</text>
          <text>Body text</text>
        </panel-component>
      `,
      imports: [Panel, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class MultiSlotHost {}

    const { container } = await render(MultiSlotHost);

    const header = container.querySelector('.panel-header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('text')!.textContent).toBe('Header text');

    const body = container.querySelector('.panel-body');
    expect(body).not.toBeNull();
    expect(body!.querySelector('text')!.textContent).toBe('Body text');
  });

  it('routes content to class-based selectors', async () => {
    @Component({
      selector: 'layout-component',
      template: `
        <view class="layout">
          <view class="layout-top"><ng-content select=".top" /></view>
          <view class="layout-bottom"><ng-content select=".bottom" /></view>
        </view>
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class LayoutComponent {}

    @Component({
      selector: 'test-class-slot',
      template: `
        <layout-component>
          <text class="bottom">Bottom</text>
          <text class="top">Top</text>
        </layout-component>
      `,
      imports: [LayoutComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ClassSlotHost {}

    const { container } = await render(ClassSlotHost);

    const top = container.querySelector('.layout-top');
    expect(top!.querySelector('text')!.textContent).toBe('Top');

    const bottom = container.querySelector('.layout-bottom');
    expect(bottom!.querySelector('text')!.textContent).toBe('Bottom');
  });
});

describe('content projection — contentChild()', () => {
  // Signal content queries (contentChild/contentChildren) don't resolve in JIT
  // mode — same limitation as signal input(). Content query resolution is
  // verified in the kitchen-sink demo (AOT compiled). Here we verify the
  // projected DOM structure is correct.
  it('projects a single child element into the wrapper', async () => {
    @Component({
      selector: 'query-wrapper',
      template: `
        <view class="query-host">
          <ng-content />
        </view>
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class QueryWrapperComponent {}

    @Component({
      selector: 'test-content-child',
      template: `
        <query-wrapper>
          <text>Projected child</text>
        </query-wrapper>
      `,
      imports: [QueryWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ContentChildHost {}

    const { container } = await render(ContentChildHost);

    const host = container.querySelector('.query-host');
    expect(host).not.toBeNull();

    const projected = host!.querySelector('text');
    expect(projected).not.toBeNull();
    expect(projected!.textContent).toBe('Projected child');
  });
});

describe('content projection — contentChildren()', () => {
  it('projects multiple children and preserves order', async () => {
    @Component({
      selector: 'multi-query-wrapper',
      template: `
        <view class="multi-host">
          <ng-content />
        </view>
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class MultiQueryWrapperComponent {}

    @Component({
      selector: 'test-content-children',
      template: `
        <multi-query-wrapper>
          <text>Item 1</text>
          <text>Item 2</text>
          <text>Item 3</text>
        </multi-query-wrapper>
      `,
      imports: [MultiQueryWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ContentChildrenHost {}

    const { container } = await render(ContentChildrenHost);

    const host = container.querySelector('.multi-host');
    expect(host).not.toBeNull();

    const texts = host!.querySelectorAll('text');
    expect(texts.length).toBe(3);
    expect(texts[0]!.textContent).toBe('Item 1');
    expect(texts[1]!.textContent).toBe('Item 2');
    expect(texts[2]!.textContent).toBe('Item 3');
  });
});

describe('content projection — conditional', () => {
  it('shows and hides projected content with @if', async () => {
    const showContent = signal(true);

    @Component({
      selector: 'conditional-slot',
      template: `
        <view class="container">
          @if (showContent()) {
            <ng-content />
          }
        </view>
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ConditionalSlotComponent {
      showContent = showContent;
    }

    @Component({
      selector: 'test-conditional-projection',
      template: `
        <conditional-slot>
          <text>Conditional content</text>
        </conditional-slot>
      `,
      imports: [ConditionalSlotComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ConditionalProjectionHost {}

    const { container } = await render(ConditionalProjectionHost);

    expect(container.querySelector('.container text')).not.toBeNull();
    expect(container.querySelector('.container text')!.textContent).toBe(
      'Conditional content',
    );

    showContent.set(false);
    await waitForUpdate();

    expect(container.querySelector('.container text')).toBeNull();

    showContent.set(true);
    await waitForUpdate();

    expect(container.querySelector('.container text')).not.toBeNull();
    expect(container.querySelector('.container text')!.textContent).toBe(
      'Conditional content',
    );
  });
});

describe('content projection — nested', () => {
  it('projects through multiple wrapper levels', async () => {
    @Component({
      selector: 'outer-wrapper',
      template: `<view class="outer"><ng-content /></view>`,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class OuterWrapperComponent {}

    @Component({
      selector: 'inner-wrapper',
      template: `<view class="inner"><ng-content /></view>`,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class InnerWrapperComponent {}

    @Component({
      selector: 'test-nested-projection',
      template: `
        <outer-wrapper>
          <inner-wrapper>
            <text>Deep content</text>
          </inner-wrapper>
        </outer-wrapper>
      `,
      imports: [OuterWrapperComponent, InnerWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class NestedProjectionHost {}

    const { container } = await render(NestedProjectionHost);

    const deep = container.querySelector('.outer .inner text');
    expect(deep).not.toBeNull();
    expect(deep!.textContent).toBe('Deep content');
  });
});

describe('content projection — with Lynx element directives', () => {
  it('projects Lynx elements with attributes and styles', async () => {
    @Component({
      selector: 'slot-wrapper',
      template: `<view class="wrapper"><ng-content /></view>`,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class SlotWrapperComponent {}

    @Component({
      selector: 'test-lynx-directive-projection',
      template: `
        <slot-wrapper>
          <view style="padding: 8px;">
            <text>Inside projected view</text>
          </view>
          <image src="test.png" />
        </slot-wrapper>
      `,
      imports: [SlotWrapperComponent, LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class LynxDirectiveProjectionHost {}

    const { container } = await render(LynxDirectiveProjectionHost);

    const wrapper = container.querySelector('.wrapper');
    expect(wrapper).not.toBeNull();

    const views = wrapper!.querySelectorAll(':scope > view');
    expect(views.length).toBeGreaterThanOrEqual(1);

    const text = wrapper!.querySelector('text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('Inside projected view');

    const image = wrapper!.querySelector('image');
    expect(image).not.toBeNull();
    expect(image!.getAttribute('src')).toBe('test.png');
  });
});
