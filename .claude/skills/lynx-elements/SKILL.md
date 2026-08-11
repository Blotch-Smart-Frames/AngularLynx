# Lynx Elements Reference

Reference for using Lynx elements in Angular components. Use this when writing or reviewing component templates.

## Setup

All components using Lynx elements must include `CUSTOM_ELEMENTS_SCHEMA`:

```typescript
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-example',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `...`,
})
export class ExampleComponent {}
```

## Elements

### Basic

- **`<x-view>`** — Container (like div). Basic building block for layouts.
- **`<x-text>`** — Text display. All visible text must be inside `<x-text>`.
- **`<x-image>`** — Image display. Use `[src]="imageUrl"`.
- **`<x-raw-text>`** — Raw text without processing.

### Layout

- **`<x-scroll-view>`** — Scrollable container. Use `scrollY="true"` or `scrollX="true"`.
- **`<x-list>`** — Optimized list container for rendering many items.

### Structural

- **`<x-block>`** — Grouping container.
- **`<x-if>`** / **`<x-for>`** — Conditional/loop rendering (prefer Angular's `@if`/`@for` instead).

## Event Handling

Use `bind` prefix for Lynx events:

```html
<x-view (bindtap)="onTap($event)">
  <x-text>Tap me</x-text>
</x-view>
```

## Styling

Class-based (preferred) or inline styles:

```html
<x-view class="container">
  <x-text class="title">Title</x-text>
</x-view>

<x-view style="display: flex; flex-direction: column;">
  <x-text style="font-size: 18px; color: blue;">Styled</x-text>
</x-view>
```

## Best Practices

1. Use Angular's `@if`/`@for` instead of `<x-if>`/`<x-for>`.
2. Prefer class-based styling over inline styles.
3. Group related elements in `<x-view>` containers.
4. Minimize nesting depth for performance.
5. Use `<x-list>` with `@for` for long lists.

## Complete Example

```typescript
@Component({
  selector: 'app-user-profile',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <x-view class="profile-container">
      <x-view class="header">
        <x-image [src]="user.avatarUrl" class="avatar"></x-image>
        <x-text class="username">{{ user.name }}</x-text>
      </x-view>
      <x-scroll-view scrollY="true" class="posts-container">
        <x-list class="posts-list">
          @for (post of user.posts; track post.id) {
            <x-view class="post-item">
              <x-text class="post-title">{{ post.title }}</x-text>
              <x-text class="post-content">{{ post.content }}</x-text>
              <x-view class="like-button" (bindtap)="likePost(post.id)">
                <x-text>Like</x-text>
              </x-view>
            </x-view>
          }
        </x-list>
      </x-scroll-view>
    </x-view>
  `,
})
export class UserProfileComponent {
  user = {
    name: 'Jane Doe',
    avatarUrl: 'assets/avatar.png',
    posts: [{ id: 1, title: 'First Post', content: 'This is my first post' }],
  };

  likePost(postId: number) {
    console.log(`Liked post ${postId}`);
  }
}
```
