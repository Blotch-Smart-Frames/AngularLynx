# Signals & State Management

## Why Signals

AngularLynx uses `provideZonelessChangeDetection()` — Zone.js is not available. All change detection is signal-driven. When a signal's value changes, Angular automatically updates the template bindings that read it.

## Core Patterns

### Component State

```typescript
@Component({
  template: `
    <view (bindtap)="toggle()">
      <text>Count: {{ count() }}</text>
    </view>
    @if (showDetails()) {
      <text>Details visible</text>
    }
  `,
  imports: [LYNX_ELEMENTS],
})
export class CounterComponent {
  count = signal(0);
  showDetails = signal(false);

  toggle(): void {
    this.count.update((n) => n + 1);
    // Structural changes (adding/removing elements) need setTimeout
    setTimeout(() => this.showDetails.update((v) => !v), 0);
  }
}
```

### Derived State

```typescript
items = signal<Item[]>([]);
selectedId = signal<number | null>(null);
selectedItem = computed(() =>
  this.items().find((i) => i.id === this.selectedId()),
);
itemCount = computed(() => this.items().length);
```

### Linked State

```typescript
// linkedSignal resets when the source changes
page = signal(1);
offset = linkedSignal(() => (this.page() - 1) * 10);
```

### Side Effects

```typescript
constructor() {
  effect(() => {
    const item = this.selectedItem();
    if (item) {
      this.logger.log('Selected:', item.name);
    }
  });
}
```

## Control Flow

Use Angular's built-in control flow with signals:

```html
@if (isLoading()) {
<text>Loading...</text>
} @else if (error()) {
<text class="error">{{ error() }}</text>
} @else {
<view class="content">
  @for (item of items(); track item.id) {
  <view class="item">
    <text>{{ item.name }}</text>
  </view>
  }
</view>
}
```

## Event Handler Patterns

```typescript
// Safe without setTimeout — only changes text content, no structural changes
onInput(event: { detail: { value: string } }) {
  this.inputValue.set(event.detail.value);
}

// Needs setTimeout — @if block adds/removes elements
togglePanel(): void {
  setTimeout(() => this.showPanel.update(v => !v), 0);
}
```

## Service State

```typescript
@Injectable({ providedIn: 'root' })
export class AppState {
  currentUser = signal<User | null>(null);
  isAuthenticated = computed(() => this.currentUser() !== null);
}

@Component({
  /* ... */
})
export class HeaderComponent {
  #state = inject(AppState);
  user = this.#state.currentUser;
  isAuth = this.#state.isAuthenticated;
}
```
