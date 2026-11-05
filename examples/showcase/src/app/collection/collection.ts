import { Component, computed, inject, signal } from '@angular/core';
import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';
import { UiDockScroll } from '../../components/ui/dock';
import { Ground } from '../ground/ground';
import { UiIcon } from '../../components/ui/icon';
import {
  UiSheet,
  UiSheetFooter,
  UiSheetHeader,
} from '../../components/ui/sheet';
import { toast } from '../../components/ui/toast';
import { facetMapSvg } from '../cut/facet-map';
import { formatCarat, formatMoney } from '../data/format';
import { CUTS, type Cut, type Gem, cutName, gemById } from '../data/gems';
import type { Lot } from '../data/lots';
import { AtlasState } from '../state/atlas-state';

/** Each tile's diagram, drawn once per cut. */
const TILE_MAPS: Record<Cut, string> = Object.fromEntries(
  CUTS.map((cut) => [
    cut.id,
    facetMapSvg(cut.id, 104, 'rgba(246, 243, 236, 0.75)'),
  ]),
) as Record<Cut, string>;

/**
 * The collection: the parcel's forty lots in a virtualized two-column list.
 * Tap a lot for its sheet; hold it to keep it.
 */
@Component({
  selector: 'app-collection',
  imports: [
    LYNX_ELEMENTS,
    Ground,
    UiDockScroll,
    UiIcon,
    UiSheet,
    UiSheetHeader,
    UiSheetFooter,
  ],
  host: { class: 'relative h-full w-full flex-col bg-background flex' },
  template: `
    <!-- The ruled paper under the list, not in it: an absolute child of a
         list would take its scroll gesture. -->
    <view appGround class="absolute top-0 right-0 bottom-0 left-0"></view>
    <view class="flex h-full w-full flex-col">
      <view
        class="flex flex-row items-end justify-between border-b border-foreground px-5 pt-safe-3 pb-3"
        style="min-height: 92px"
      >
        <text
          class="shrink-0 font-wide text-[26px] leading-[30px] text-foreground"
          [text-maxline]="1"
          >COLLECTION</text
        >
        <view class="flex flex-col items-end">
          <text
            class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >{{ summary() }}</text
          >
          <text
            class="font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >HOLD TO KEEP</text
          >
        </view>
      </view>

      @if (lots().length === 0) {
        <view class="flex flex-1 items-center px-8 pt-16">
          <text
            class="text-center font-routed text-[14px] leading-[20px] text-muted-foreground"
          >
            No lot matches “{{ atlas.query() }}”.
          </text>
        </view>
      } @else {
        <!-- Lynx's sizing rule: flex-1 lives on a plain view, and the list
           fills it with h-full. The list's bottom padding clears the dock. -->
        <view class="flex w-full flex-1 flex-col">
          <list
            ui-dock-scroll
            class="h-full w-full px-3 pb-[100px]"
            list-type="flow"
            [span-count]="2"
            scroll-orientation="vertical"
          >
            @for (lot of lots(); track lot.id) {
              <list-item [attr.item-key]="lot.id" class="p-2">
                <view
                  class="relative flex flex-col border border-foreground"
                  accessibility-element="true"
                  accessibility-traits="button"
                  [accessibility-label]="label(lot)"
                  (bindtap)="open(lot)"
                  (bindlongpress)="keep(lot)"
                >
                  <view
                    class="flex items-center justify-center"
                    style="height: 150px"
                    [style.background-color]="gemOf(lot).color"
                  >
                    <svg
                      [attr.content]="tileMap(lot.cut)"
                      style="width: 104px; height: 104px"
                    ></svg>
                  </view>
                  <view
                    class="flex flex-col border-t border-foreground bg-background px-3 pt-2 pb-3"
                  >
                    <text
                      class="font-wide text-[20px] leading-[24px] text-foreground"
                      >{{ formatCarat(lot.carat) }}</text
                    >
                    <text
                      class="font-narrow text-[11px] tracking-[1px] text-muted-foreground"
                      >{{ upper(gemOf(lot).name) }} ·
                      {{ upper(cutShort(lot.cut)) }}</text
                    >
                    <text
                      class="mt-1 font-routed text-[14px] text-foreground"
                      >{{ formatMoney(lot.price) }}</text
                    >
                  </view>
                  @if (atlas.isKept(lot)) {
                    <view
                      class="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground"
                    >
                      <ui-icon
                        name="check"
                        size="sm"
                        color="var(--background)"
                      />
                    </view>
                  }
                </view>
              </list-item>
            }
          </list>
        </view>
      }
    </view>

    <!-- A lot's sheet. -->
    <ui-sheet variant="glass" [(open)]="sheetOpen">
      @if (selected(); as lot) {
        <ui-sheet-header>
          <text class="font-wide text-[22px] leading-[26px] text-foreground"
            >LOT {{ lot.number }} · {{ formatCarat(lot.carat) }}</text
          >
          <text
            class="font-routed text-[14px] leading-[19px] text-glass-muted-foreground"
          >
            {{ gemOf(lot).name }} {{ gemOf(lot).species }},
            {{ cutName(lot.cut) }}, {{ lot.clarity }}.
          </text>
        </ui-sheet-header>
        <view class="flex flex-col gap-3 py-3">
          <view class="flex flex-row justify-between">
            <text
              class="font-narrow text-[11px] tracking-[2px] text-glass-muted-foreground"
              >ORIGIN</text
            >
            <text class="font-routed text-[14px] text-foreground"
              >{{ gemOf(lot).origin }}, {{ gemOf(lot).locality }}</text
            >
          </view>
          <view class="flex flex-row justify-between">
            <text
              class="font-narrow text-[11px] tracking-[2px] text-glass-muted-foreground"
              >PRICE</text
            >
            <text class="font-wide text-[18px] text-foreground">{{
              formatMoney(lot.price)
            }}</text>
          </view>
          <text
            class="font-routed text-[13px] leading-[18px] text-glass-muted-foreground"
            >{{ gemOf(lot).note }}</text
          >
        </view>
        <ui-sheet-footer>
          <!-- A detent: hairline at rest, filled when pressed, so it inverts. -->
          <view
            class="detent flex h-12 items-center justify-center border border-foreground"
            [class.detent-pressed]="pressing()"
            accessibility-element="true"
            accessibility-traits="button"
            [accessibility-label]="
              atlas.isKept(lot) ? 'Release this lot' : 'Keep this lot'
            "
            (bindtouchstart)="pressing.set(true)"
            (bindtouchend)="pressing.set(false)"
            (bindtouchcancel)="pressing.set(false)"
            (bindtap)="keep(lot)"
          >
            <text
              class="font-narrow text-[12px] tracking-[2px]"
              [class.text-foreground]="!pressing()"
              [class.text-background]="pressing()"
            >
              {{ atlas.isKept(lot) ? 'RELEASE' : 'KEEP' }}
            </text>
          </view>
          <view
            class="flex h-12 items-center justify-center"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Show this stone on the plate"
            (bindtap)="showOnPlate(lot)"
          >
            <text
              class="font-narrow text-[12px] tracking-[2px]"
              [style.color]="atlas.color()"
              >SHOW ON THE PLATE</text
            >
          </view>
        </ui-sheet-footer>
      }
    </ui-sheet>
  `,
  styles: [
    `
      .detent {
        background-color: transparent;
        transition: background-color 120ms ease-out;
      }
      .detent-pressed {
        background-color: var(--foreground);
      }
    `,
  ],
})
export class CollectionPage {
  protected readonly atlas = inject(AtlasState);

  protected readonly sheetOpen = signal(false);
  protected readonly selected = signal<Lot | null>(null);
  protected readonly pressing = signal(false);

  protected readonly formatCarat = formatCarat;
  protected readonly formatMoney = formatMoney;
  protected readonly cutName = cutName;

  protected readonly lots = computed(() => {
    const query = this.atlas.query().trim().toLowerCase();
    const lots = this.atlas.lots();
    if (!query) return lots;
    return lots.filter((lot) => {
      const gem = gemById(lot.gemId);
      return [
        gem.name,
        gem.species,
        gem.origin,
        gem.locality,
        cutName(lot.cut),
        lot.number,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  });

  protected readonly summary = computed(() => {
    const kept = this.atlas.kept().length;
    return `${this.lots().length} LOTS · ${kept} KEPT`;
  });

  protected gemOf(lot: Lot): Gem {
    return gemById(lot.gemId);
  }

  protected tileMap(cut: Cut): string {
    return TILE_MAPS[cut];
  }

  protected label(lot: Lot): string {
    const gem = this.gemOf(lot);
    return `Lot ${lot.number}, ${formatCarat(lot.carat)} ${gem.name}, ${cutName(lot.cut)}, ${formatMoney(lot.price)}${this.atlas.isKept(lot) ? ', kept' : ''}`;
  }

  protected cutShort(cut: Cut): string {
    return cut === 'brilliant' ? 'round' : cut === 'step' ? 'step' : cut;
  }

  protected upper(text: string): string {
    return text.toUpperCase();
  }

  protected open(lot: Lot): void {
    this.selected.set(lot);
    this.sheetOpen.set(true);
  }

  protected keep(lot: Lot): void {
    const kept = this.atlas.toggleKept(lot);
    const gem = this.gemOf(lot);
    toast({
      title: kept ? `Kept lot ${lot.number}` : `Released lot ${lot.number}`,
      description: `${formatCarat(lot.carat)} ${gem.name}, ${cutName(lot.cut)}`,
    });
  }

  protected showOnPlate(lot: Lot): void {
    this.atlas.gemId.set(lot.gemId);
    this.atlas.cutOverride.set(lot.cut);
    this.sheetOpen.set(false);
  }
}

registerHostElement(CollectionPage, 'view');
