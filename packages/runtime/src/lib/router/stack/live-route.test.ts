import '@angular/compiler';
import { ActivatedRoute, type Params, UrlSegment } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { liveRoute } from './live-route';

/**
 * A stand-in ActivatedRoute: the router makes the real ones, and liveRoute
 * only reads them.
 */
const route = (
  values: {
    params?: Params;
    queryParams?: Params;
    data?: Params;
    url?: string[];
    fragment?: string | null;
    title?: string;
  } = {},
): ActivatedRoute =>
  Object.assign(Object.create(ActivatedRoute.prototype), {
    params: new BehaviorSubject(values.params ?? {}),
    queryParams: new BehaviorSubject(values.queryParams ?? {}),
    data: new BehaviorSubject(values.data ?? {}),
    url: new BehaviorSubject(
      (values.url ?? []).map((path) => new UrlSegment(path, {})),
    ),
    fragment: new BehaviorSubject(values.fragment ?? null),
    title: new BehaviorSubject(values.title),
    snapshot: { values },
    outlet: 'primary',
  }) as ActivatedRoute;

const emitted = <T>(subscribe: (next: (value: T) => void) => void): T[] => {
  const values: T[] = [];
  subscribe((value) => values.push(value));
  return values;
};

describe('liveRoute', () => {
  it('is an ActivatedRoute with the current route’s properties', () => {
    const first = route({ params: { id: '1' } });
    const live = liveRoute(first);
    expect(live.route).toBeInstanceOf(ActivatedRoute);
    expect(live.route.snapshot).toBe(first.snapshot);

    const second = route({ params: { id: '1' } });
    live.follow(second);
    expect(live.route.snapshot).toBe(second.snapshot);
    expect(live.route.toString()).toBe(second.toString());
  });

  it('writes to the current route', () => {
    const first = route();
    const live = liveRoute(first);
    const second = route();
    live.follow(second);
    live.route.outlet = 'side';
    expect(second.outlet).toBe('side');
    expect(first.outlet).toBe('primary');
  });

  it('switches its observables to the current route without repeating what they had', () => {
    const live = liveRoute(
      route({
        params: { id: '1' },
        queryParams: { q: 'a' },
        data: { title: 'Notes' },
        url: ['notes', '1'],
        fragment: 'top',
        title: 'Note',
      }),
    );
    const params = emitted<Params>((next) => live.route.params.subscribe(next));
    const queryParams = emitted<Params>((next) =>
      live.route.queryParams.subscribe(next),
    );
    const paramMap = emitted<string | null>((next) =>
      live.route.paramMap.subscribe((map) => next(map.get('id'))),
    );
    const queryParamMap = emitted<string | null>((next) =>
      live.route.queryParamMap.subscribe((map) => next(map.get('q'))),
    );
    const data = emitted<Params>((next) => live.route.data.subscribe(next));
    const url = emitted<string>((next) =>
      live.route.url.subscribe((segments) => next(segments.join('/'))),
    );
    const fragment = emitted<string | null>((next) =>
      live.route.fragment.subscribe(next),
    );
    const title = emitted<string | undefined>((next) =>
      live.route.title.subscribe(next),
    );

    // The same values again, as the router activates the page's route again
    // on the way back to it.
    live.follow(
      route({
        params: { id: '1' },
        queryParams: { q: 'a' },
        data: { title: 'Notes' },
        url: ['notes', '1'],
        fragment: 'top',
        title: 'Note',
      }),
    );
    // Then others.
    live.follow(
      route({
        params: { id: '1', extra: 'x' },
        queryParams: { q: 'b' },
        data: { title: 'Other' },
        url: ['notes', '2'],
        fragment: 'end',
        title: 'Other note',
      }),
    );

    expect(params).toEqual([{ id: '1' }, { id: '1', extra: 'x' }]);
    expect(queryParams).toEqual([{ q: 'a' }, { q: 'b' }]);
    expect(paramMap).toEqual(['1', '1']);
    expect(queryParamMap).toEqual(['a', 'b']);
    expect(data).toEqual([{ title: 'Notes' }, { title: 'Other' }]);
    expect(url).toEqual(['notes/1', 'notes/2']);
    expect(fragment).toEqual(['top', 'end']);
    expect(title).toEqual(['Note', 'Other note']);
  });

  it('tells params with a different value apart from the same ones', () => {
    const live = liveRoute(route({ params: { id: '1' } }));
    const params = emitted<Params>((next) => live.route.params.subscribe(next));
    live.follow(route({ params: { id: '2' } }));
    expect(params).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('ignores following the route it already follows', () => {
    const first = route({ params: { id: '1' } });
    const live = liveRoute(first);
    const params = emitted<Params>((next) => live.route.params.subscribe(next));
    live.follow(first);
    expect(params).toEqual([{ id: '1' }]);
  });
});
