import { Component, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiCheckbox } from '../components/ui/checkbox';
import {
  UiTabs,
  UiTabsList,
  UiTabsTrigger,
  UiTabsContent,
} from '../components/ui/tabs';
import { UiBadge } from '../components/ui/badge';
import {
  UiSheet,
  UiSheetHeader,
  UiSheetTitle,
  UiSheetFooter,
} from '../components/ui/sheet';
import { UiInput } from '../components/ui/input';
import { UiSelect, UiSelectItem } from '../components/ui/select';
import { UiButton } from '../components/ui/button';
import { UiLabel } from '../components/ui/label';
import { UiEmptyState } from '../components/ui/empty-state';
import {
  UiActionSheet,
  UiActionSheetTitle,
  UiActionSheetItem,
  UiActionSheetCancel,
} from '../components/ui/action-sheet';

type Priority = 'high' | 'medium' | 'low';

type Task = {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    NgTemplateOutlet,
    UiCheckbox,
    UiTabs,
    UiTabsList,
    UiTabsTrigger,
    UiTabsContent,
    UiBadge,
    UiSheet,
    UiSheetHeader,
    UiSheetTitle,
    UiSheetFooter,
    UiInput,
    UiSelect,
    UiSelectItem,
    UiButton,
    UiLabel,
    UiEmptyState,
    UiActionSheet,
    UiActionSheetTitle,
    UiActionSheetItem,
    UiActionSheetCancel,
  ],
  template: `
    <view class="h-screen flex-col bg-zinc-50 flex">
      <view
        class="flex-row items-center border-b border-zinc-200 bg-white px-5 py-4 flex justify-between"
      >
        <text class="text-[22px] font-bold text-zinc-900">Tasks</text>
        <ui-button size="sm" (pressed)="newSheetOpen.set(true)"
          >+ New
        </ui-button>
      </view>

      <ui-tabs [(value)]="activeTab" class="flex-1 flex-col flex">
        <ui-tabs-list class="mx-4 mt-3">
          <ui-tabs-trigger value="all">
            All <ui-badge>{{ tasks().length }}</ui-badge>
          </ui-tabs-trigger>
          <ui-tabs-trigger value="active">
            Active
            <ui-badge>{{ activeTasks().length }}</ui-badge>
          </ui-tabs-trigger>
          <ui-tabs-trigger value="done">
            Done
            <ui-badge variant="secondary">{{ doneTasks().length }}</ui-badge>
          </ui-tabs-trigger>
        </ui-tabs-list>

        <ui-tabs-content value="all" class="flex-1">
          <ng-container
            *ngTemplateOutlet="taskList; context: { tasks: tasks() }"
          />
        </ui-tabs-content>
        <ui-tabs-content value="active" class="flex-1">
          <ng-container
            *ngTemplateOutlet="taskList; context: { tasks: activeTasks() }"
          />
        </ui-tabs-content>
        <ui-tabs-content value="done" class="flex-1">
          <ng-container
            *ngTemplateOutlet="taskList; context: { tasks: doneTasks() }"
          />
        </ui-tabs-content>
      </ui-tabs>
    </view>

    <ng-template #taskList let-tasks="tasks">
      <scroll-view scroll-orientation="vertical" class="flex-1">
        <view class="flex-col gap-2 p-4 flex">
          @if (tasks.length === 0) {
            <ui-empty-state
              title="No tasks"
              description="Tap + New to add a task."
            />
          }
          @for (task of tasks; track task.id) {
            <!-- Was (longpress) — same silent-no-op bug as notification-center's
                 card: Lynx requires the bind/catch propagation prefix on event
                 names, and drops unprefixed ones without any error. -->
            <view
              class="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 flex"
              (bindlongpress)="openOptions(task)"
            >
              <ui-checkbox
                [checked]="task.done"
                (checkedChange)="toggle(task.id)"
              />
              <text
                class="flex-1 text-sm text-zinc-900"
                [class.text-zinc-400]="task.done"
                [class.line-through]="task.done"
              >
                {{ task.title }}
              </text>
              <ui-badge [variant]="priorityVariant(task.priority)">{{
                task.priority
              }}</ui-badge>
            </view>
          }
        </view>
      </scroll-view>
    </ng-template>

    <ui-sheet [(open)]="newSheetOpen">
      <ui-sheet-header
        ><ui-sheet-title>New Task</ui-sheet-title>
      </ui-sheet-header>
      <view class="flex-col gap-4 p-4 flex">
        <view class="flex-col gap-1.5 flex">
          <ui-label>Title</ui-label>
          <ui-input [(value)]="newTitle" placeholder="Task title..." />
        </view>
        <view class="flex-col gap-1.5 flex">
          <ui-label>Priority</ui-label>
          <ui-select [(value)]="newPriority">
            <ui-select-item value="high" label="High" />
            <ui-select-item value="medium" label="Medium" />
            <ui-select-item value="low" label="Low" />
          </ui-select>
        </view>
      </view>
      <ui-sheet-footer>
        <ui-button variant="outline" (pressed)="newSheetOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button (pressed)="addTask()">Add Task</ui-button>
      </ui-sheet-footer>
    </ui-sheet>

    @if (selectedTask()) {
      <ui-action-sheet [(open)]="optionsOpen">
        <ui-action-sheet-title>{{
          selectedTask()!.title
        }}</ui-action-sheet-title>
        <ui-action-sheet-item variant="destructive" (pressed)="deleteTask()">
          Delete
        </ui-action-sheet-item>
        <ui-action-sheet-cancel>Cancel</ui-action-sheet-cancel>
      </ui-action-sheet>
    }
  `,
})
export class App {
  readonly activeTab = signal('all');
  readonly newSheetOpen = signal(false);
  readonly optionsOpen = signal(false);
  readonly newTitle = signal('');
  readonly newPriority = signal<Priority>('medium');
  readonly selectedTask = signal<Task | null>(null);
  #nextId = 4;

  readonly tasks = signal<Task[]>([
    {
      id: 1,
      title: 'Set up AngularLynx project',
      done: true,
      priority: 'high',
    },
    { id: 2, title: 'Build settings screen', done: false, priority: 'medium' },
    { id: 3, title: 'Write unit tests', done: false, priority: 'low' },
  ]);

  readonly activeTasks = computed(() => this.tasks().filter((t) => !t.done));
  readonly doneTasks = computed(() => this.tasks().filter((t) => t.done));

  priorityVariant(p: Priority): 'destructive' | 'default' | 'secondary' {
    return p === 'high'
      ? 'destructive'
      : p === 'medium'
        ? 'default'
        : 'secondary';
  }

  toggle(id: number): void {
    this.tasks.update((list) =>
      list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
  }

  addTask(): void {
    const title = this.newTitle().trim();
    if (!title) return;
    this.tasks.update((list) => [
      ...list,
      { id: this.#nextId++, title, done: false, priority: this.newPriority() },
    ]);
    this.newTitle.set('');
    this.newSheetOpen.set(false);
  }

  openOptions(task: Task): void {
    this.selectedTask.set(task);
    this.optionsOpen.set(true);
  }

  deleteTask(): void {
    const id = this.selectedTask()!.id;
    this.tasks.update((list) => list.filter((t) => t.id !== id));
    this.optionsOpen.set(false);
  }
}
