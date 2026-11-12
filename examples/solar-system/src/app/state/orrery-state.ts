import { Injectable, computed, signal } from '@angular/core';
import { BODIES, type BodyId, bodyById } from '../sky/bodies';

const DAY_MS = 86_400_000;

/**
 * What the orrery shows: the moment (the dial), and the body flown in to,
 * if any. Everything else (positions, figures, labels) derives from these.
 */
@Injectable({ providedIn: 'root' })
export class OrreryState {
  /** Today, when the app opened: the dial's verdigris mark. */
  readonly today = Date.now();
  /** The moment shown, as a JavaScript time. */
  readonly time = signal(this.today);
  /** The body flown in to; null over the whole orrery. */
  readonly focus = signal<BodyId | null>(null);

  readonly body = computed(() => {
    const id = this.focus();
    return id ? bodyById(id) : null;
  });

  /** Whole days from today to the moment shown. */
  readonly offsetDays = computed(() =>
    Math.round((this.time() - this.today) / DAY_MS),
  );
  readonly isToday = computed(() => this.offsetDays() === 0);

  turn(days: number): void {
    this.time.update((time) => time + days * DAY_MS);
  }

  backToToday(): void {
    this.time.set(this.today);
  }

  /**
   * The next or previous body, in order from the Sun, wrapping round.
   */
  step(by: 1 | -1): void {
    const id = this.focus();
    if (!id) return;
    const index = BODIES.findIndex((body) => body.id === id);
    const next = BODIES[(index + by + BODIES.length) % BODIES.length]!;
    this.focus.set(next.id);
  }
}
