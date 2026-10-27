/**
 * Fires a Lynx event on an element the way Lynx dispatches it, for the events
 * the testing library's `fireEvent` has no shortcut for: `mouseleave`, an
 * image's `load` and `error`, an accessibility action, and so on. `fields` go
 * on the event, where Lynx puts its `detail`. `eventType` picks the kind of
 * listener: `bindEvent` for `(bindtap)`, `catchEvent` for `(catchtap)`.
 *
 *   fireLynxEvent(view, 'mouseleave');
 *   fireLynxEvent(image, 'error', { detail: { errMsg: 'Not found' } });
 *
 * dolan copies component tests into apps with an import of
 * `@blotch/dolan/testing/fire-lynx-event`, a copy of this file.
 */
export const fireLynxEvent = (
  element: EventTarget,
  name: string,
  fields: Record<string, unknown> = {},
  eventType = 'bindEvent',
): boolean =>
  element.dispatchEvent(
    Object.assign(new Event(`${eventType}:${name}`), {
      eventType,
      eventName: name,
      ...fields,
    }),
  );
