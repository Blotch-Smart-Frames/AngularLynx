import { Component, computed, input, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { SENTINEL_A, SENTINEL_B } from '../data/bench';

/** A row's state: its own signal, read only by its own component. */
interface Row {
  readonly id: number;
  readonly value: ReturnType<typeof signal<number>>;
}

/**
 * One row, a component of its own, as React's rows are `memo` components:
 * Angular tracks the signals a template reads per component view (an
 * `@for`'s embedded views share their component's), so a signal read in the
 * screen's own `@for` would refresh the whole screen, all 1,000 rows'
 * bindings, for a change to one. Read here, it refreshes only this row.
 */
@Component({
  selector: 'app-update-row',
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="box" [style.background-color]="row().value() % 2 ? sentinelB : sentinelA"></view>
    <text class="name">Row {{ row().id }}</text>
    <text class="value">{{ row().value() }}</text>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: row;
      align-items: center;
      height: 24px;
      padding-left: 16px;
      padding-right: 16px;
    }
    .box {
      width: 16px;
      height: 16px;
      margin-right: 8px;
    }
    .name {
      flex: 1;
      font-size: 14px;
      color: #000;
    }
    .value {
      font-size: 14px;
      color: #000;
    }
  `,
})
export class UpdateRow {
  readonly row = input.required<Row>();

  protected readonly sentinelA = SENTINEL_A;
  protected readonly sentinelB = SENTINEL_B;
}

/**
 * The benchmark's partial-update screen (benchmarks/SPEC.md, "Update"):
 * `rows` rows (1,000 by default) of a box and two texts in a plain
 * scroll-view, so every row is built, over three buttons that change one row,
 * every 10th row, or every row. A changed row counts up and switches its box
 * between the two sentinel colors, which the probe watches for. A build with
 * BENCH_SCREEN=update opens on it at launch (see app.routes.ts).
 *
 * Each row keeps its value in a signal, read by its own component
 * (UpdateRow): Angular refreshes only the component views that read a
 * changed signal, which is what the benchmark measures.
 */
@Component({
  selector: 'app-update',
  imports: [LYNX_ELEMENTS, UpdateRow],
  template: `
    <view class="screen">
      <scroll-view class="rows" scroll-orientation="vertical">
        @for (row of rowList(); track row.id) {
          <app-update-row [row]="row" />
        }
      </scroll-view>
      <view class="buttons">
        @for (button of buttons; track button.every) {
          <view
            class="button"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="button.label"
            (bindtap)="change(button.every)"
          >
            <text class="label">{{ button.label }}</text>
          </view>
        }
      </view>
    </view>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
    }
    .screen {
      display: flex;
      flex-direction: column;
      flex: 1;
      background-color: #fff;
      padding-top: env(safe-area-inset-top);
    }
    .rows {
      flex: 1;
    }
    .buttons {
      display: flex;
      flex-direction: row;
      height: 25%;
    }
    .button {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      background-color: #e3e3e3;
      margin: 1px;
    }
    .label {
      font-size: 16px;
      color: #000;
    }
  `,
})
export class Update {
  /** The query's `rows` (withComponentInputBinding). */
  readonly rowsParam = input<string | undefined>(undefined, { alias: 'rows' });

  protected readonly rowList = computed<readonly Row[]>(() => {
    const count = Number(this.rowsParam());
    return Array.from({ length: count > 0 ? count : 1000 }, (_, id) => ({ id, value: signal(0) }));
  });

  protected readonly buttons = [
    { every: 0, label: '1 row' },
    { every: 10, label: 'Every 10th' },
    { every: 1, label: 'Every row' },
  ] as const;

  /** Counts up row 0 (every = 0), every 10th row, or every row. */
  protected change(every: number): void {
    const rows = this.rowList();
    const step = every || rows.length;
    for (let i = 0; i < rows.length; i += step) {
      rows[i].value.update((n) => n + 1);
    }
  }
}
