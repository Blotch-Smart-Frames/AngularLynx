import { Component, computed, inject, signal } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import {
  UiButtonGroup,
  UiButtonGroupItem,
} from '../components/ui/button-group';
import { injectGlassDesign } from '../components/ui/glass';
import { UiIcon } from '../components/ui/icon';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButtonGroup, UiButtonGroupItem, UiIcon],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Button Group</text>
        <text class="text-sm text-muted-foreground">
          A set of related actions rendered as a single, connected control. Each
          item is an independent action — unlike a toggle group, nothing stays
          selected.
        </text>

        <!-- Basic -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Basic</text>
          <ui-button-group>
            <ui-button-group-item (pressed)="run('Copy')">
              Copy
            </ui-button-group-item>
            <ui-button-group-item (pressed)="run('Cut')">
              Cut
            </ui-button-group-item>
            <ui-button-group-item (pressed)="run('Paste')">
              Paste
            </ui-button-group-item>
          </ui-button-group>
        </view>

        <!-- Glass: one glass background for a group of actions, as iOS
             groups toolbar items. Glass belongs to controls that float over
             content, so these sit on a colorful card for it to bend. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Glass</text>
          <text class="text-xs text-muted-foreground">{{ status() }}</text>
          <text class="text-xs text-muted-foreground">
            Last action: {{ lastAction() || 'none yet' }}
          </text>
          <view
            class="flex-row items-start gap-4 rounded-[20px] p-4 flex overflow-hidden"
            [style.background-image]="ocean"
          >
            <view class="flex-1 flex-col items-start gap-4 flex">
              <ui-button-group variant="glass" size="icon">
                <ui-button-group-item
                  accessibility-label="Undo"
                  (pressed)="run('Undo')"
                >
                  <ui-icon name="undo-2" />
                </ui-button-group-item>
                <ui-button-group-item
                  accessibility-label="Redo"
                  (pressed)="run('Redo')"
                >
                  <ui-icon name="redo-2" />
                </ui-button-group-item>
                <ui-button-group-item
                  accessibility-label="Share"
                  (pressed)="run('Share')"
                >
                  <ui-icon name="share-2" />
                </ui-button-group-item>
              </ui-button-group>
              <ui-button-group variant="glass">
                <ui-button-group-item (pressed)="run('Copy')">
                  Copy
                </ui-button-group-item>
                <ui-button-group-item (pressed)="run('Cut')">
                  Cut
                </ui-button-group-item>
                <ui-button-group-item (pressed)="run('Paste')">
                  Paste
                </ui-button-group-item>
              </ui-button-group>
            </view>
            <!-- A vertical group, like a map's zoom controls -->
            <ui-button-group variant="glass" size="icon" orientation="vertical">
              <ui-button-group-item
                accessibility-label="Zoom in"
                (pressed)="run('Zoom in')"
              >
                <ui-icon name="plus" />
              </ui-button-group-item>
              <ui-button-group-item
                accessibility-label="Zoom out"
                (pressed)="run('Zoom out')"
              >
                <ui-icon name="minus" />
              </ui-button-group-item>
            </ui-button-group>
          </view>
        </view>

        <!-- Clear glass, for a group over photos and video, on a dimming
             layer so its white icons stay legible over bright content. -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Clear glass</text>
          <view
            class="h-[160px] flex-col items-center rounded-[20px] p-4 flex justify-end overflow-hidden"
            [style.background-image]="photo"
          >
            <ui-button-group
              variant="glass-clear"
              size="icon"
              class="self-center"
            >
              <ui-button-group-item
                accessibility-label="Favorite"
                (pressed)="run('Favorite')"
              >
                <ui-icon name="heart" />
              </ui-button-group-item>
              <ui-button-group-item
                accessibility-label="Share photo"
                (pressed)="run('Share photo')"
              >
                <ui-icon name="share-2" />
              </ui-button-group-item>
              <ui-button-group-item
                accessibility-label="Delete"
                (pressed)="run('Delete')"
              >
                <ui-icon name="trash-2" />
              </ui-button-group-item>
            </ui-button-group>
          </view>
        </view>

        <!-- Variants -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Variants</text>
          <view class="flex-col gap-3 flex">
            <ui-button-group variant="default">
              <ui-button-group-item (pressed)="run('Left')">
                Left
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Center')">
                Center
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Right')">
                Right
              </ui-button-group-item>
            </ui-button-group>
            <ui-button-group variant="outline">
              <ui-button-group-item (pressed)="run('Left')">
                Left
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Center')">
                Center
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Right')">
                Right
              </ui-button-group-item>
            </ui-button-group>
          </view>
        </view>

        <!-- Sizes -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Sizes</text>
          <view class="flex-col items-start gap-3 flex">
            <ui-button-group size="sm">
              <ui-button-group-item (pressed)="run('One')">
                One
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Two')">
                Two
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Three')">
                Three
              </ui-button-group-item>
            </ui-button-group>
            <ui-button-group size="default">
              <ui-button-group-item (pressed)="run('One')">
                One
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Two')">
                Two
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Three')">
                Three
              </ui-button-group-item>
            </ui-button-group>
            <ui-button-group size="lg">
              <ui-button-group-item (pressed)="run('One')">
                One
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Two')">
                Two
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Three')">
                Three
              </ui-button-group-item>
            </ui-button-group>
          </view>
        </view>

        <!-- Vertical -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Vertical</text>
          <ui-button-group orientation="vertical" variant="outline">
            <ui-button-group-item (pressed)="run('Profile')">
              Profile
            </ui-button-group-item>
            <ui-button-group-item (pressed)="run('Settings')">
              Settings
            </ui-button-group-item>
            <ui-button-group-item (pressed)="run('Sign out')">
              Sign out
            </ui-button-group-item>
          </ui-button-group>
        </view>

        <!-- Disabled -->
        <view class="flex-col gap-3 flex">
          <text class="text-lg font-semibold text-foreground">Disabled</text>
          <view class="flex-col items-start gap-3 flex">
            <!-- Whole group disabled -->
            <ui-button-group [disabled]="true">
              <ui-button-group-item (pressed)="run('A')">
                A
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('B')">
                B
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('C')">
                C
              </ui-button-group-item>
            </ui-button-group>
            <!-- Single item disabled -->
            <ui-button-group variant="outline">
              <ui-button-group-item (pressed)="run('Undo')">
                Undo
              </ui-button-group-item>
              <ui-button-group-item [disabled]="true" (pressed)="run('Redo')">
                Redo
              </ui-button-group-item>
              <ui-button-group-item (pressed)="run('Reset')">
                Reset
              </ui-button-group-item>
            </ui-button-group>
          </view>
        </view>

        <!-- Live state -->
        <view class="rounded-md border border-border bg-muted p-4">
          <text class="mb-2 text-sm font-medium text-foreground">
            Last action
          </text>
          <text class="text-xs text-muted-foreground">
            {{ lastAction() || 'None yet — tap an item above.' }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);
  readonly #design = injectGlassDesign();

  readonly ocean = 'linear-gradient(135deg, #22d3ee, #6366f1 55%, #a855f7)';
  /** A bright "photo", the kind clear glass needs its dimming layer over. */
  readonly photo =
    'linear-gradient(160deg, #fef9c3, #fde68a 30%, #fb923c 65%, #be185d)';

  readonly lastAction = signal('');

  /** What the glass groups draw here, and the settings they follow. */
  readonly status = computed(() => {
    const on = (value: boolean) => (value ? 'on' : 'off');
    const os = `${this.#system.platform} ${this.#system.osVersion}`.trim();
    return [
      `Design: ${this.#design()} on ${os}`,
      `Reduce Motion: ${on(this.#settings.reduceMotion())}`,
      `Reduce Transparency: ${on(this.#settings.reduceTransparency())}`,
      `Increase Contrast: ${on(this.#settings.increaseContrast())}`,
    ].join(' · ');
  });

  run(action: string): void {
    this.lastAction.set(action);
  }
}
