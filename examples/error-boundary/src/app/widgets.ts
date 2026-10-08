import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/** Thrown when the (simulated) network is down, so `when` can match on it. */
export class OfflineError extends Error {
  override name = 'OfflineError';
}

/**
 * A price tile that crashes while rendering when its feed sends bad data —
 * the kind of failure a template binding can't recover from on its own.
 */
@Component({
  selector: 'app-price-tile',
  template: `
    <view class="flex-row items-center flex justify-between">
      <text class="text-[15px] font-semibold text-zinc-900">{{
        symbol()
      }}</text>
      <text class="text-[22px] font-bold text-emerald-600">
        {{ formatted() }}
      </text>
    </view>
  `,
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceTile {
  readonly symbol = input.required<string>();
  readonly price = input.required<number>();

  formatted(): string {
    const price = this.price();
    if (!Number.isFinite(price)) {
      throw new Error(`Price feed sent ${price} for ${this.symbol()}`);
    }
    return `$${price.toFixed(2)}`;
  }
}

export type ProfileFailure = 'none' | 'offline' | 'bug';

/**
 * A profile card that can fail in two distinct ways.
 */
@Component({
  selector: 'app-profile-card',
  template: `
    <view class="flex-row items-center flex">
      <view
        class="mr-3 h-10 w-10 items-center rounded-full bg-indigo-100 justify-center"
      >
        <text class="text-[15px] font-bold text-indigo-600">AL</text>
      </view>
      <view>
        <text class="text-[15px] font-semibold text-zinc-900">
          {{ displayName() }}
        </text>
        <text class="text-xs text-zinc-500">Synced just now</text>
      </view>
    </view>
  `,
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCard {
  readonly failure = input<ProfileFailure>('none');

  displayName(): string {
    switch (this.failure()) {
      case 'offline':
        throw new OfflineError('No connection to the profile service');
      case 'bug':
        throw new TypeError(
          "Cannot read properties of undefined (reading 'name')",
        );
      default:
        return 'Ada Lovelace';
    }
  }
}
