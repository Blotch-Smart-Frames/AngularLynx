import { type ErrorDetails, inject, Injectable, signal } from '@angular/core';
import { LynxErrorHandler } from '@blotch/angular-lynx';

export type BoundaryLogEntry = {
  readonly id: number;
  readonly name: string;
  readonly message: string;
};

/**
 * In-app feed of errors caught by `@boundary` blocks, newest first.
 */
@Injectable({ providedIn: 'root' })
export class BoundaryLog {
  readonly #entries = signal<readonly BoundaryLogEntry[]>([]);
  readonly entries = this.#entries.asReadonly();
  #nextId = 0;

  add(error: Error): void {
    const entry = {
      id: this.#nextId++,
      name: error.name,
      message: error.message,
    };
    // Keep the feed short so it fits on a phone screen.
    this.#entries.update((list) => [entry, ...list].slice(0, 4));
  }

  clear(): void {
    this.#entries.set([]);
  }
}

/**
 * Extends the default Lynx handler so caught errors still reach native
 * reporting (as warnings), then mirrors them into the on-screen log.
 */
@Injectable()
export class BoundaryReportingErrorHandler extends LynxErrorHandler {
  readonly #log = inject(BoundaryLog);

  override onViewError(error: Error, details: ErrorDetails): void {
    super.onViewError(error, details);

    // Angular calls onViewError synchronously in the middle of rendering.
    // Writing a signal here would throw NG0600 and break the boundary, so the
    // write is deferred until the current render pass has finished.
    queueMicrotask(() => this.#log.add(error));
  }
}
