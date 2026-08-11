import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  type ExposureEventDetail,
  LYNX_ELEMENTS,
  LynxExposure,
  LynxGlobalExposure,
} from '@blotch/angular-lynx';
import { UiCard, UiCardContent } from '../../components/ui/card';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type FeedItem = {
  /** Value bound to `exposure-id`; also the key shown in the "on screen" chips. */
  readonly id: string;
  /** Short leading label (fake avatar) so the feed reads like real content. */
  readonly tag: string;
  readonly title: string;
  readonly subtitle: string;
};

@Component({
  selector: 'app-exposure-demo',
  standalone: true,
  // ScreenHost makes the host claim the routed area's full height so the feed's
  // scroll-view has a definite height to scroll within (see ScreenHost).
  hostDirectives: [ScreenHost],
  imports: [
    LYNX_ELEMENTS,
    LynxExposure,
    UiText,
    UiBadge,
    UiButton,
    UiCard,
    UiCardContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './exposure-demo.html',
})
export class ExposureDemo {
  readonly #exposure = inject(LynxGlobalExposure);

  /** Whether the global exposure stream is running (toggled by pause/resume). */
  readonly active = this.#exposure.active;

  // --- Live, accumulated state -------------------------------------------------
  //
  // Why we accumulate here instead of reading the service signals directly: the
  // service replaces exposures()/disexposures() with only the MOST RECENT batch
  // on every tick. Reading `.length` off that shows a transient number that is
  // usually 0 — which is exactly why the old demo looked broken ("0 exposed, 0
  // disexposed, never changes"). Folding each batch into a running tally + a live
  // set gives numbers that visibly climb as the user scrolls, which is the point.

  /** exposure-ids currently intersecting the viewport. */
  readonly #visibleIds = signal<ReadonlySet<string>>(new Set());

  /** Cumulative count of exposure (enter) events across the whole session. */
  readonly totalExposures = signal(0);

  /** Cumulative count of disexposure (leave) events across the whole session. */
  readonly totalDisexposures = signal(0);

  readonly visibleCount = computed(() => this.#visibleIds().size);
  readonly visibleList = computed(() => [...this.#visibleIds()]);

  /**
   * The tracked "impression feed". Deliberately longer than one screen so that
   * scrolling forces cards in and out of the viewport — that is what fires the
   * exposure/disexposure events this demo is showing off.
   */
  readonly feedItems: readonly FeedItem[] = [
    {
      id: 'hero-banner',
      tag: 'AD',
      title: 'Hero banner',
      subtitle: 'Top-of-feed promo slot',
    },
    {
      id: 'story-01',
      tag: '01',
      title: 'Morning digest',
      subtitle: 'Editorial story',
    },
    {
      id: 'story-02',
      tag: '02',
      title: 'Trending now',
      subtitle: 'Ranked by engagement',
    },
    {
      id: 'promo-01',
      tag: 'AD',
      title: 'Sponsored: Nimbus',
      subtitle: 'Paid placement',
    },
    {
      id: 'story-03',
      tag: '03',
      title: 'Deep dive',
      subtitle: 'Long-read feature',
    },
    {
      id: 'story-04',
      tag: '04',
      title: 'Around the web',
      subtitle: 'Link roundup',
    },
    {
      id: 'video-01',
      tag: '▶',
      title: 'Watch: highlights',
      subtitle: 'Autoplay when visible',
    },
    {
      id: 'story-05',
      tag: '05',
      title: 'Community picks',
      subtitle: 'Reader favorites',
    },
    {
      id: 'promo-02',
      tag: 'AD',
      title: 'Sponsored: Atlas',
      subtitle: 'Paid placement',
    },
    {
      id: 'story-06',
      tag: '06',
      title: 'Weekend guide',
      subtitle: 'Curated events',
    },
    {
      id: 'story-07',
      tag: '07',
      title: 'The wrap-up',
      subtitle: 'End-of-feed summary',
    },
    {
      id: 'footer-cta',
      tag: '★',
      title: 'You are all caught up',
      subtitle: 'End of feed',
    },
  ];

  constructor() {
    // Fold every exposure/disexposure batch into the running tally + visible set.
    // Two effects (one per stream) so we always know whether a batch means
    // "entered" or "left". The batch is read tracked (so the effect re-runs on
    // each new batch); everything else runs untracked so writing our own signals
    // never feeds back into the effect's dependencies.
    effect(() => {
      const batch = this.#exposure.exposures();
      untracked(() => this.#fold(batch, true));
    });
    effect(() => {
      const batch = this.#exposure.disexposures();
      untracked(() => this.#fold(batch, false));
    });
  }

  /**
   * Pause/resume the global exposure stream.
   */
  toggle(): void {
    if (this.active()) {
      // sendEvent: false — don't emit a disexposure for every currently-visible
      // element on pause; we just want the stream to freeze cleanly.
      this.#exposure.stopExposure({ sendEvent: false });
    } else {
      this.#exposure.resumeExposure();
    }
  }

  #fold(batch: readonly ExposureEventDetail[], entering: boolean): void {
    // The initial signal value is an empty array; ignore empty batches so the
    // very first effect run doesn't churn state.
    if (batch.length === 0) return;

    // The Lynx engine emits both camelCase (exposureID) and kebab (exposure-id);
    // read whichever is present so we work across engine versions.
    const ids = batch
      .map((e) => e.exposureID ?? e['exposure-id'] ?? '')
      .filter((id) => id !== '');
    if (ids.length === 0) return;

    const next = new Set(this.#visibleIds());
    for (const id of ids) {
      if (entering) next.add(id);
      else next.delete(id);
    }
    this.#visibleIds.set(next);

    if (entering) this.totalExposures.update((n) => n + ids.length);
    else this.totalDisexposures.update((n) => n + ids.length);
  }
}
