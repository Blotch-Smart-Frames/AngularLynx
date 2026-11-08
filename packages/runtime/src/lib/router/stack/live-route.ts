import {
  type ActivatedRoute,
  type Params,
  convertToParamMap,
} from '@angular/router';
import {
  type Observable,
  BehaviorSubject,
  distinctUntilChanged,
  map,
  switchMap,
} from 'rxjs';

/**
 * The ActivatedRoute a page in the stack injects, and how to point it at the
 * route the router activates when the app comes back to the page.
 */
export type LiveRoute = {
  readonly route: ActivatedRoute;
  follow(route: ActivatedRoute): void;
};

/**
 * Whether two routes' params, query params or data hold the same values.
 */
const sameValues = (a: Params, b: Params): boolean => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
};

/**
 * Makes the ActivatedRoute a page in the stack injects, which stays the
 * page's route however often the app leaves it and comes back.
 *
 * The router makes a new ActivatedRoute each time it activates a route, and
 * a page in the stack is created once: when the app goes back to it, the
 * router activates its route again, and the page still has the old one,
 * whose observables never emit again. So the page gets this instead: each
 * property is the current route's, and each observable switches to the
 * current route's, without emitting what it already has (a page that loads
 * something for its params doesn't load it again on the way back).
 */
export const liveRoute = (initial: ActivatedRoute): LiveRoute => {
  const current = new BehaviorSubject(initial);
  const follow = <T>(
    read: (route: ActivatedRoute) => Observable<T>,
    same: (a: T, b: T) => boolean = Object.is,
  ): Observable<T> => current.pipe(switchMap(read), distinctUntilChanged(same));

  const params = follow((route) => route.params, sameValues);
  const queryParams = follow((route) => route.queryParams, sameValues);
  const observables = new Map<PropertyKey, Observable<unknown>>([
    ['params', params],
    ['queryParams', queryParams],
    ['paramMap', params.pipe(map(convertToParamMap))],
    ['queryParamMap', queryParams.pipe(map(convertToParamMap))],
    ['data', follow((route) => route.data, sameValues)],
    [
      'url',
      follow(
        (route) => route.url,
        (a, b) => a.join('/') === b.join('/'),
      ),
    ],
    ['fragment', follow((route) => route.fragment)],
    ['title', follow((route) => route.title)],
  ]);

  // A Proxy rather than a copy, so everything else an ActivatedRoute has,
  // its snapshot, its place in the tree and what the router keeps on it, is
  // always the current route's. Its prototype is the target's, so it's
  // still `instanceof ActivatedRoute`.
  const route = new Proxy(initial, {
    get: (_target, key) => {
      const observable = observables.get(key);
      if (observable) return observable;
      const target = current.value;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set: (_target, key, value) => Reflect.set(current.value, key, value),
  });

  return {
    route,
    follow: (next) => {
      if (next !== current.value) current.next(next);
    },
  };
};
