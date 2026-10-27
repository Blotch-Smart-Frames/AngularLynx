/**
 * The queries a test gets from `render()`, `screen` and `within()`: Testing
 * Library's, with `*ByRole` replaced by the Lynx-aware version and the
 * `*ByAccessibilityLabel` queries added.
 */

import {
  type BoundFunction,
  type BoundFunctions,
  type FindAllByBoundAttribute,
  type FindByBoundAttribute,
  type GetByBoundAttribute,
  type AllByBoundAttribute,
  type Queries,
  type QueryByBoundAttribute,
  type Screen,
  getQueriesForElement as getDomQueriesForElement,
  queries as domQueries,
  screen as domScreen,
} from '@testing-library/dom';
import {
  findAllByAccessibilityLabel,
  findByAccessibilityLabel,
  getAllByAccessibilityLabel,
  getByAccessibilityLabel,
  queryAllByAccessibilityLabel,
  queryByAccessibilityLabel,
} from './accessibility-label-queries.js';
import {
  findAllByRole,
  findByRole,
  getAllByRole,
  getByRole,
  queryAllByRole,
  queryByRole,
} from './role-queries.js';

/**
 * The queries this library adds to Testing Library's or replaces in them.
 */
const lynxQueries = {
  queryAllByRole,
  queryByRole,
  getAllByRole,
  getByRole,
  findAllByRole,
  findByRole,
  queryAllByAccessibilityLabel,
  queryByAccessibilityLabel,
  getAllByAccessibilityLabel,
  getByAccessibilityLabel,
  findAllByAccessibilityLabel,
  findByAccessibilityLabel,
};

/**
 * Every query, unbound: Testing Library's, with the Lynx-aware `*ByRole` and
 * the `*ByAccessibilityLabel` queries. Spread it into your own queries to
 * keep these next to them, as with Testing Library's `queries`.
 */
export const queries = { ...domQueries, ...lynxQueries };

export type LynxQueries = typeof queries;

/**
 * The `*ByAccessibilityLabel` queries bound to a container. Declared like
 * Testing Library's bound queries, so each takes an element type:
 * `getByAccessibilityLabel<MyElement>('Close')`.
 */
export type BoundAccessibilityLabelQueries = {
  queryAllByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<AllByBoundAttribute<T>>>
  ): ReturnType<AllByBoundAttribute<T>>;
  queryByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<QueryByBoundAttribute<T>>>
  ): ReturnType<QueryByBoundAttribute<T>>;
  getAllByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<AllByBoundAttribute<T>>>
  ): ReturnType<AllByBoundAttribute<T>>;
  getByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<GetByBoundAttribute<T>>>
  ): ReturnType<GetByBoundAttribute<T>>;
  findAllByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<FindAllByBoundAttribute<T>>>
  ): ReturnType<FindAllByBoundAttribute<T>>;
  findByAccessibilityLabel<T extends HTMLElement = HTMLElement>(
    ...args: Parameters<BoundFunction<FindByBoundAttribute<T>>>
  ): ReturnType<FindByBoundAttribute<T>>;
};

/**
 * Every query, bound to a container.
 */
export type BoundLynxQueries = BoundAccessibilityLabelQueries &
  BoundFunctions<LynxQueries>;

/**
 * `screen`: every query bound to `document.body`, plus Testing Library's
 * `debug()` and `logTestingPlaygroundURL()`.
 */
export type LynxScreen = BoundAccessibilityLabelQueries & Screen<LynxQueries>;

/**
 * Binds `toBind` to `document.body`, looked up on each call rather than when
 * this module loads, so importing the library doesn't need a document.
 */
const bindToBody = <Q extends Queries>(toBind: Q): BoundFunctions<Q> =>
  Object.fromEntries(
    Object.entries(toBind).map(([key, query]) => [
      key,
      (...args: unknown[]) => query(document.body, ...args),
    ]),
  ) as BoundFunctions<Q>;

/**
 * Testing Library's `screen` with the Lynx queries in place of its own
 * `*ByRole`, and the `*ByAccessibilityLabel` queries added.
 */
export const screen: LynxScreen = {
  ...domScreen,
  ...bindToBody(lynxQueries),
} as LynxScreen;

type Within = {
  (element: HTMLElement): BoundLynxQueries;
  <Q extends Queries>(
    element: HTMLElement,
    queriesToBind: Q,
  ): BoundFunctions<Q>;
};

/**
 * Binds every query (or the ones you pass) to `element`, like Testing
 * Library's `within()`, so a test can look inside one part of the tree.
 */
export const within = ((
  element: HTMLElement,
  queriesToBind: Queries = queries,
) => getDomQueriesForElement<Queries>(element, queriesToBind)) as Within;

/**
 * The same as `within()`, under Testing Library's other name for it.
 */
export const getQueriesForElement = within;
