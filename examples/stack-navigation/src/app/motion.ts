import { Injectable, signal } from '@angular/core';
import type { StackAnimation } from '@blotch/angular-lynx';

/**
 * The motion the outlet uses, which the first screen lets you change, so you
 * can compare iOS's with Android's on any device. Unset, the outlet picks the
 * platform's.
 */
@Injectable({ providedIn: 'root' })
export class Motion {
  readonly animation = signal<StackAnimation | undefined>(undefined);
}
