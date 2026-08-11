import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiButtonGroup,
  UiButtonGroupItem,
} from '../components/ui/button-group';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButtonGroup, UiButtonGroupItem],
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
  readonly lastAction = signal('');

  run(action: string): void {
    this.lastAction.set(action);
  }
}
