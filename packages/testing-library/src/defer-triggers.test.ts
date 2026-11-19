/**
 * Angular's `@defer` triggers that watch an element: `on interaction`, `on
 * hover` and `on viewport` (issue #459). Each asserts in development builds
 * that its trigger is an `Element` before listening to it, which a Lynx
 * element wasn't, so every one of them kept its placeholder.
 */

import { Component, ErrorHandler } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';

/** The errors Angular reported, which the assertion's was. */
const reported: unknown[] = [];

afterEach(() => {
  reported.length = 0;
});

const reportErrors = {
  providers: [
    {
      provide: ErrorHandler,
      useValue: { handleError: (error: unknown) => reported.push(error) },
    },
  ],
};

/**
 * Lets the deferred block render: Angular swaps the placeholder for it
 * after the trigger's callback, once its dependencies have loaded.
 */
const settle = async () => {
  await waitForUpdate();
  await new Promise((resolve) => setTimeout(resolve));
  await waitForUpdate();
};

/** The one finger a touch's events need to make pointer events. */
const finger = { changedTouches: [{ identifier: 0, x: 1, y: 1 }] };

@Component({
  selector: 'test-interaction',
  imports: [LYNX_ELEMENTS],
  template: `
    @defer (on interaction) {
      <text>Comments</text>
    } @placeholder {
      <view><text>Show comments</text></view>
    }
  `,
})
class OnInteraction {}

@Component({
  selector: 'test-interaction-target',
  imports: [LYNX_ELEMENTS],
  template: `
    <view #more><text>More</text></view>
    @defer (on interaction(more)) {
      <text>Details</text>
    } @placeholder {
      <text>Details hidden</text>
    }
  `,
})
class OnInteractionTarget {}

@Component({
  selector: 'test-hover',
  imports: [LYNX_ELEMENTS],
  template: `
    @defer (on hover) {
      <text>Preview</text>
    } @placeholder {
      <view><text>Hold for a preview</text></view>
    }
  `,
})
class OnHover {}

@Component({
  selector: 'test-viewport',
  imports: [LYNX_ELEMENTS],
  template: `
    @defer (on viewport) {
      <text>Related posts</text>
    } @placeholder {
      <view><text>Related</text></view>
    }
  `,
})
class OnViewport {}

describe('@defer triggers on an element', () => {
  it('on interaction renders the block when its placeholder is tapped', async () => {
    const { getByText, queryByText } = await render(
      OnInteraction,
      reportErrors,
    );
    await settle();
    expect(queryByText('Comments')).toBeNull();

    // On the text inside the placeholder: the tap bubbles to the trigger.
    fireEvent.tap(getByText('Show comments'));
    await settle();

    getByText('Comments');
    expect(queryByText('Show comments')).toBeNull();
    expect(reported).toEqual([]);
  });

  it('on interaction(ref) renders the block when the element named is tapped', async () => {
    const { getByText, queryByText } = await render(
      OnInteractionTarget,
      reportErrors,
    );
    await settle();
    fireEvent.tap(getByText('Details hidden'));
    await settle();
    expect(queryByText('Details')).toBeNull();

    fireEvent.tap(getByText('More').parentElement!);
    await settle();

    getByText('Details');
    expect(reported).toEqual([]);
  });

  // A phone's browser fires the mouse events Angular listens for when a
  // finger touches the element; Lynx's touch does the same.
  it('on hover renders the block when a finger touches its placeholder', async () => {
    const { getByText, queryByText } = await render(OnHover, reportErrors);
    await settle();
    expect(queryByText('Preview')).toBeNull();

    fireEvent.touchstart(getByText('Hold for a preview'), finger);
    await settle();

    getByText('Preview');
    expect(reported).toEqual([]);
  });

  it('on viewport renders the block when its placeholder comes into view', async () => {
    const { getByText, queryByText } = await render(OnViewport, reportErrors);
    await settle();
    expect(queryByText('Related posts')).toBeNull();

    fireEvent.uiappear(getByText('Related').parentElement!);
    await settle();

    getByText('Related posts');
    expect(reported).toEqual([]);
  });
});
