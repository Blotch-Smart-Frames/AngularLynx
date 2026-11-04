import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture for the styles of a prebuilt library's components (issue
 * #240). scaffold.ts compiles this the way ng-packagr does (`ngc` with
 * `compilationMode: "partial"`) into `dist`, and the app imports it from
 * there through tsconfig `paths`, as an Angular CLI workspace library is.
 * So the build gets the components already compiled, with their styles in
 * their definitions, like a package from npm.
 *
 * The label's own class rule colors its words, and the frame styles its
 * `:host` and the label through a type selector, which are the three kinds
 * of rule a library's styles used to lose on Lynx.
 */
@Component({
  selector: 'e2e-library-label',
  imports: [LYNX_ELEMENTS],
  template: `<text class="words">Styled by a prebuilt library</text>`,
  styles: `
    .words {
      color: rgb(200, 30, 90);
    }
  `,
})
export class LibraryLabel {}

@Component({
  selector: 'e2e-library-frame',
  imports: [LYNX_ELEMENTS, LibraryLabel],
  template: `<e2e-library-label />`,
  styles: `
    :host {
      display: flex;
      margin-top: 8px;
      padding: 4px;
      background-color: rgb(30, 60, 90);
    }
    e2e-library-label {
      display: flex;
      padding: 4px;
      background-color: rgb(240, 200, 40);
    }
  `,
})
export class LibraryFrame {}
