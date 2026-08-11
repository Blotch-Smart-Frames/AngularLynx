import type { LynxElement } from '../../lynx-element';

/**
 * Returns the existing root page element — does NOT create a new one.
 * Only one <page> element is allowed per application. The page element's
 * isRootPageElement guard prevents Angular from reparenting or removing it.
 */
export const createPageElement = (
  page: LynxElement,
  pageElementRequested: boolean,
): { element: LynxElement; pageElementRequested: boolean } => {
  if (pageElementRequested) {
    console.warn(
      'Multiple <page> elements detected. Only one <page> is allowed per application.',
    );
  }
  return { element: page, pageElementRequested: true };
};
