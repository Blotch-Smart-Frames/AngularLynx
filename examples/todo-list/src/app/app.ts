import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

type Todo = { id: number; text: string; done: boolean };

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS],
  template: `
    <scroll-view class="h-screen bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">Todos</text>
        <text class="mb-5 text-[13px] text-zinc-500">
          {{ remaining() }} remaining
        </text>

        <view class="mb-4 flex-row gap-2 flex">
          <input
            class="flex-1 rounded-[10px] border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            placeholder="What needs to be done?"
            [value]="draft()"
            (bindinput)="onInput($event)"
          />
          <view
            class="items-center rounded-[10px] bg-indigo-500 px-5 py-3 justify-center"
            (bindtap)="addTodo()"
          >
            <text class="text-[15px] font-semibold text-white">Add</text>
          </view>
        </view>

        @for (todo of todos(); track todo.id) {
          <view
            class="mb-2 flex-row items-center rounded-xl border border-zinc-200 bg-white px-4 py-3.5 flex"
            (bindtap)="toggle(todo.id)"
          >
            <view
              class="mr-3 h-[22px] w-[22px] items-center rounded-[6px] border-2 border-zinc-200 justify-center"
              [class.bg-indigo-500]="todo.done"
              [class.border-indigo-500]="todo.done"
            >
              @if (todo.done) {
                <text class="text-[13px] font-bold text-white">✓</text>
              }
            </view>
            <text
              class="flex-1 text-[15px] text-zinc-900"
              [class.text-zinc-400]="todo.done"
              [class.line-through]="todo.done"
            >
              {{ todo.text }}
            </text>
            <view class="px-2 py-1" (catchtap)="remove(todo.id)">
              <text class="text-base text-red-500">✕</text>
            </view>
          </view>
        } @empty {
          <view
            class="items-center rounded-xl border border-zinc-200 bg-white p-10"
          >
            <text class="mb-2 text-[32px]">🎉</text>
            <text class="text-base text-zinc-400">All done!</text>
          </view>
        }
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly draft = signal('');
  readonly todos = signal<Todo[]>([
    { id: 1, text: 'Learn AngularLynx', done: false },
    { id: 2, text: 'Build an app', done: false },
  ]);
  #nextId = 3;

  readonly remaining = computed(
    () => this.todos().filter((t) => !t.done).length,
  );

  onInput(event: Event): void {
    this.draft.set((event as any).detail.value);
  }

  addTodo(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.todos.update((list) => [
      ...list,
      { id: this.#nextId++, text, done: false },
    ]);
    this.draft.set('');
  }

  toggle(id: number): void {
    this.todos.update((list) =>
      list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
  }

  remove(id: number): void {
    this.todos.update((list) => list.filter((t) => t.id !== id));
  }
}
