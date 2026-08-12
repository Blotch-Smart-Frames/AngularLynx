import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  UiSheet,
  UiSheetDescription,
  UiSheetFooter,
  UiSheetHeader,
  UiSheetTitle,
} from './sheet';

@Component({
  standalone: true,
  imports: [
    UiSheet,
    UiSheetHeader,
    UiSheetTitle,
    UiSheetDescription,
    UiSheetFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-sheet [(open)]="open">
      <ui-sheet-header>
        <ui-sheet-title>Title</ui-sheet-title>
        <ui-sheet-description>Body</ui-sheet-description>
      </ui-sheet-header>
      <ui-sheet-footer><text>Buttons</text></ui-sheet-footer>
    </ui-sheet>
  `,
})
class SheetHost {
  open = true;
}

describe('UiSheet', () => {
  it('renders header, title, description, and footer', async () => {
    const { getByText } = await render(SheetHost);
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Body')).toBeTruthy();
    expect(getByText('Buttons')).toBeTruthy();
  });
});
