import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiProgress } from '../components/ui/progress';
import { UiSkeleton } from '../components/ui/skeleton';
import { UiSpinner } from '../components/ui/spinner';
import { UiToaster, toast } from '../components/ui/toast';
import {
  UiCard,
  UiCardContent,
  UiCardHeader,
  UiCardTitle,
} from '../components/ui/card';
import { UiButton } from '../components/ui/button';
import { UiBadge } from '../components/ui/badge';
import { UiSeparator } from '../components/ui/separator';

type UploadFile = {
  id: number;
  name: string;
  progress: number;
  done: boolean;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiProgress,
    UiSkeleton,
    UiSpinner,
    UiToaster,
    UiCard,
    UiCardContent,
    UiCardHeader,
    UiCardTitle,
    UiButton,
    UiBadge,
    UiSeparator,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-[28px] font-bold text-zinc-900">File Manager</text>

        <ui-card>
          <ui-card-header>
            <view class="flex-row items-center flex justify-between">
              <ui-card-title>Uploads</ui-card-title>
              @if (syncing()) {
                <view class="flex-row items-center gap-2 flex">
                  <ui-spinner size="sm" />
                  <text class="text-xs text-zinc-400">Syncing...</text>
                </view>
              }
            </view>
          </ui-card-header>
          <ui-card-content>
            <view class="flex-col gap-4 flex">
              @for (file of files(); track file.id) {
                <view class="flex-col gap-1.5 flex">
                  <view class="flex-row items-center flex justify-between">
                    <text class="text-sm text-zinc-900">{{ file.name }}</text>
                    @if (file.done) {
                      <ui-badge variant="secondary">Done</ui-badge>
                    } @else {
                      <text class="text-xs text-zinc-400">
                        {{ file.progress }}%
                      </text>
                    }
                  </view>
                  <ui-progress [value]="file.progress" />
                </view>
              }
              <ui-button
                size="sm"
                (pressed)="startUpload()"
                [disabled]="uploading()"
              >
                @if (uploading()) {
                  <view class="flex-row items-center gap-2 flex">
                    <ui-spinner size="sm" />
                    <text>Uploading...</text>
                  </view>
                } @else {
                  <text>Upload Files</text>
                }
              </ui-button>
            </view>
          </ui-card-content>
        </ui-card>

        <ui-separator />

        <view class="flex-col gap-3 flex">
          <text class="text-sm font-medium text-zinc-900">Recent Files</text>
          @if (loading()) {
            @for (i of [1, 2, 3]; track i) {
              <view class="flex-row items-center gap-3 flex">
                <ui-skeleton class="h-10 w-10 rounded-lg" />
                <view class="flex-1 flex-col gap-2 flex">
                  <ui-skeleton class="h-3.5 w-3/4 rounded" />
                  <ui-skeleton class="h-3 w-1/2 rounded" />
                </view>
              </view>
            }
          } @else {
            @for (file of recentFiles; track file.name) {
              <view
                class="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 flex"
              >
                <view
                  class="h-10 w-10 items-center rounded-lg bg-zinc-100 justify-center"
                >
                  <text class="text-[18px]">{{ file.icon }}</text>
                </view>
                <view class="flex-1 flex-col gap-0.5 flex">
                  <text class="text-sm font-medium text-zinc-900">{{
                    file.name
                  }}</text>
                  <text class="text-xs text-zinc-400">
                    {{ file.size }} · {{ file.date }}
                  </text>
                </view>
              </view>
            }
          }
        </view>

        <ui-button variant="outline" (pressed)="reload()">Reload</ui-button>
      </view>
    </scroll-view>
    <ui-toaster />
  `,
})
export class App {
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly syncing = signal(false);
  readonly files = signal<UploadFile[]>([
    { id: 1, name: 'report.pdf', progress: 100, done: true },
    { id: 2, name: 'photo.jpg', progress: 60, done: false },
    { id: 3, name: 'data.csv', progress: 20, done: false },
  ]);

  readonly recentFiles = [
    { icon: '📄', name: 'project-brief.pdf', size: '2.4 MB', date: 'Today' },
    {
      icon: '🖼️',
      name: 'design-mockup.png',
      size: '5.1 MB',
      date: 'Yesterday',
    },
    { icon: '📊', name: 'analytics.xlsx', size: '820 KB', date: '2 days ago' },
  ];

  constructor() {
    setTimeout(() => this.loading.set(false), 1500);
  }

  startUpload(): void {
    this.uploading.set(true);
    this.syncing.set(true);
    this.files.update((list) =>
      list.map((f) => ({ ...f, progress: f.done ? 100 : 0 })),
    );
    let tick = 0;
    const interval = setInterval(() => {
      tick += 10;
      this.files.update((list) =>
        list.map((f) =>
          f.done
            ? f
            : {
                ...f,
                progress: Math.min(f.progress + 15, 100),
                done: f.progress + 15 >= 100,
              },
        ),
      );
      if (this.files().every((f) => f.done) || tick >= 100) {
        clearInterval(interval);
        this.uploading.set(false);
        this.syncing.set(false);
        toast({ title: 'All files uploaded successfully' });
      }
    }, 400);
  }

  reload(): void {
    this.loading.set(true);
    setTimeout(() => this.loading.set(false), 1200);
  }
}
