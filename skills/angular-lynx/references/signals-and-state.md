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
    this.showDetails.update((v) => !v);
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

Every `@defer` trigger works. The ones that watch an element use the placeholder's single root element, or the one a template reference names (`on interaction(more)`):

- **`on interaction`** fires on a tap on it, or on anything inside it.
- **`on hover`** fires when a finger touches it, as a phone's browser fires it for a tap (the mouse moving over it, in the web preview).
- **`on viewport`** fires when it first comes on screen, through `IntersectionObserver` (see Coming into view in events-and-interactions.md). Give it a size: an element with no width or height never counts as on screen.

By default the deferred code is in the main bundle, so `prefetch` gains nothing; with lazy bundles (`experimental_isLazyBundle`, see build-configuration.md) it starts the download early. In a spec, `fireEvent.tap()`, `fireEvent.touchstart(el, { changedTouches: [{ identifier: 0 }] })` and `fireEvent.uiappear()` on the placeholder fire the three.

## Event Handler Patterns

```typescript
// Handlers set signals directly, whether the change is text or structure
onInput({ detail }: LynxEvent<InputDetail>) {
  this.inputValue.set(detail.value);
}

// An @if that adds or removes elements is fine too: no setTimeout needed
togglePanel(): void {
  this.showPanel.update(v => !v);
}
```

## Service State

```typescript
@Injectable({ providedIn: 'root' })
export class AppState {
  currentUser = signal<User | null>(null);
  isAuthenticated = computed(() => this.currentUser() !== null);
}

@Component({/* ... */})
export class HeaderComponent {
  #state = inject(AppState);
  user = this.#state.currentUser;
  isAuth = this.#state.isAuthenticated;
}
```
