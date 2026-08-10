# Add Lynx Element

Add support for a new Lynx element to the runtime.

## Steps

1. **Check the Lynx API** — Verify the element type exists in `packages/runtime/src/lib/types/lynx.ts`. Look for an interface like `NewElementRef extends ElementRef` and a creation function like `__CreateNewElement(parentComponentUniId: number, info?: ElementInfo): NewElementRef`.

2. **Update LynxDocument** — Add a new case in the `createElement` method of `LynxDocument` in `packages/runtime/src/lib/lynx-document.ts`:

```typescript
case 'x-new-element': {
  element = __CreateNewElement(this.pageId);
  // Set default properties if needed
  __SetConfig(element, {
    propertyA: valueA,
    propertyB: valueB
  });
  break;
}
```

3. **Update the README** — Add the element to the support table in `packages/runtime/README.md`:

```markdown
- [x] [new-element](https://lynxjs.org/api/elements/built-in/new-element.html) _(basic support)_
```

4. **Update ELEMENTS.md** — Add documentation for the element in `packages/runtime/docs/ELEMENTS.md` including what it does, example usage, supported attributes/properties, and common use cases.

5. **Create an example component** — Add a demo component in `packages/kitchen-sink-app/` showing how to use the element. Use `CUSTOM_ELEMENTS_SCHEMA` and standalone components:

```typescript
@Component({
  selector: 'app-new-element-example',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <x-view>
      <x-new-element [property]="value">
        <!-- Content -->
      </x-new-element>
    </x-view>
  `,
})
export class NewElementExampleComponent {}
```

6. **Add routing** — Add the example to `app.routes.ts` and add a navigation link in the main app.

7. **For complex elements** (like `x-list`), also implement callback functions for event handling, add `__SetConfig` options, handle lifecycle events, and add custom event handlers.

## Currently Supported Elements

`x-view`, `x-text`, `x-raw-text`, `x-image`, `x-scroll-view`, `x-list`, `x-block`, `x-if`, `x-for`

Unknown tags fall back to `x-view` with a console warning.
