import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fireLynxEvent } from './fire-lynx-event';

/**
 * An element stand-in that records the events dispatched on it.
 */
const target = () => {
  const element = new EventTarget();
  const events: Event[] = [];
  for (const type of ['bindEvent:mouseleave', 'catchEvent:tap']) {
    element.addEventListener(type, (event) => events.push(event));
  }
  return { element, events };
};

describe('fireLynxEvent', () => {
  it('dispatches a bindEvent with its name, as Lynx does', () => {
    const { element, events } = target();
    expect(fireLynxEvent(element, 'mouseleave')).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'bindEvent:mouseleave',
      eventType: 'bindEvent',
      eventName: 'mouseleave',
    });
  });

  it("puts the fields on the event, for the listener's kind", () => {
    const { element, events } = target();
    fireLynxEvent(element, 'tap', { detail: { x: 1 } }, 'catchEvent');
    expect(events[0]).toMatchObject({
      type: 'catchEvent:tap',
      eventType: 'catchEvent',
      detail: { x: 1 },
    });
  });

  it('is the helper the component tests import from packages/ui', () => {
    // Copied tests import `../../../test-utils/fire-lynx-event`, which dolan
    // rewrites to this file. A copy that drifted would test differently in an
    // app than in the library.
    const shipped = readFileSync(
      new URL('./fire-lynx-event.ts', import.meta.url),
      'utf-8',
    );
    const library = readFileSync(
      new URL('../../../ui/src/test-utils/fire-lynx-event.ts', import.meta.url),
      'utf-8',
    );
    expect(shipped).toBe(library);
  });
});
