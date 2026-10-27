/**
 * Queries that find an element by its `accessibility-label`, the text a
 * screen reader reads for it on Lynx.
 *
 * Testing Library's `*ByLabelText` reads `<label>` elements and the ARIA
 * label attributes, none of which Lynx has: a Lynx element gets its
 * accessible name from `accessibility-label`. Like `*ByTitle` and
 * `*ByAltText`, which also match one attribute, these take a TextMatch with
 * MatcherOptions (`exact`, `normalizer`), throw errors worded the same way,
 * and their `find*` variants retry for `waitFor`'s timeout.
 */

import {
  type AllByBoundAttribute,
  type FindAllByBoundAttribute,
  type FindByBoundAttribute,
  type GetByBoundAttribute,
  type Matcher,
  type MatcherOptions,
  type QueryByBoundAttribute,
  buildQueries,
  queryHelpers,
} from '@testing-library/dom';

/**
 * Every element in `container` whose `accessibility-label` matches `label`.
 * `buildQueries` names the other variants' suggestions after this function,
 * so it keeps Testing Library's `queryAllBy*` name.
 */
const queryAllByAccessibilityLabel = (
  container: HTMLElement,
  label: Matcher,
  options?: MatcherOptions,
): HTMLElement[] =>
  queryHelpers.queryAllByAttribute(
    'accessibility-label',
    container,
    label,
    options,
  );

const [queryBy, getAllBy, getBy, findAllBy, findBy] = buildQueries(
  queryAllByAccessibilityLabel,
  (_container, label) =>
    `Found multiple elements with the accessibility-label: ${label}`,
  (_container, label) =>
    `Unable to find an element with the accessibility-label: ${label}`,
);

// buildQueries returns HTMLElement-typed functions. Testing Library declares
// its own queries generic over the element type, so these are cast to the
// same shape: getByAccessibilityLabel<TextElement>(...) works like
// getByTitle<TextElement>(...).

/**
 * Finds every element whose `accessibility-label` matches, or none.
 */
const queryAll = queryAllByAccessibilityLabel as <
  T extends HTMLElement = HTMLElement,
>(
  ...args: Parameters<AllByBoundAttribute<T>>
) => ReturnType<AllByBoundAttribute<T>>;

/**
 * Finds the element whose `accessibility-label` matches, or null. Throws when
 * more than one does.
 */
const query = queryBy as <T extends HTMLElement = HTMLElement>(
  ...args: Parameters<QueryByBoundAttribute<T>>
) => ReturnType<QueryByBoundAttribute<T>>;

/**
 * Finds every element whose `accessibility-label` matches. Throws when none
 * does.
 */
const getAll = getAllBy as <T extends HTMLElement = HTMLElement>(
  ...args: Parameters<AllByBoundAttribute<T>>
) => ReturnType<AllByBoundAttribute<T>>;

/**
 * Finds the element whose `accessibility-label` matches. Throws when none or
 * more than one does.
 */
const get = getBy as <T extends HTMLElement = HTMLElement>(
  ...args: Parameters<GetByBoundAttribute<T>>
) => ReturnType<GetByBoundAttribute<T>>;

/**
 * Waits for elements whose `accessibility-label` matches, as `getAll` finds
 * them.
 */
const findAll = findAllBy as <T extends HTMLElement = HTMLElement>(
  ...args: Parameters<FindAllByBoundAttribute<T>>
) => ReturnType<FindAllByBoundAttribute<T>>;

/**
 * Waits for the element whose `accessibility-label` matches, as `get` finds
 * it.
 */
const find = findBy as <T extends HTMLElement = HTMLElement>(
  ...args: Parameters<FindByBoundAttribute<T>>
) => ReturnType<FindByBoundAttribute<T>>;

export {
  queryAll as queryAllByAccessibilityLabel,
  query as queryByAccessibilityLabel,
  getAll as getAllByAccessibilityLabel,
  get as getByAccessibilityLabel,
  findAll as findAllByAccessibilityLabel,
  find as findByAccessibilityLabel,
};
