import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * A sign-up card written as it would be for the browser, with HTML tags,
 * DOM events and type selectors. Each tag renders as the Lynx element it maps
 * to: the `<main>`, `<div>`, `<ul>` and `<li>` are views, the `<h1>`, `<p>`,
 * `<label>` and `<button>` are texts, and the `<img>` is an image. The text
 * straight inside each `<li>` is drawn in a `<text>` that takes the list's
 * color, and the terms line runs its link on with its text, as on the web.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS],
  template: `
    <main>
      <div class="card">
        <img
          src="https://angular.dev/assets/images/press-kit/angular_icon_gradient.gif"
          alt="Angular logo"
        />
        <h1>Join the beta</h1>
        <p>
          This card is written with <strong>HTML tags</strong>. Each one renders
          as a Lynx element.
        </p>
        <label>Your name</label>
        <input
          placeholder="Ada Lovelace"
          (input)="name.set($any($event.target).value)"
          (keyup.enter)="join()"
        />
        <button (click)="join()">Join</button>
        <p class="welcome" [hidden]="!joined()">
          Welcome aboard, {{ name() || 'friend' }}!
        </p>
        <ul>
          <li>No account needed</li>
          <li>Leave any time</li>
        </ul>
        <div class="terms">
          By joining, you agree to the <a>terms</a> and <a>privacy policy</a>.
        </div>
      </div>
    </main>
  `,
  styles: `
    main {
      height: 100%;
      padding: 24px;
      background-color: #f4f4f5;
    }
    .card {
      padding: 20px;
      border: 1px solid #e4e4e7;
      border-radius: 16px;
      background-color: #ffffff;
    }
    img {
      width: 56px;
      height: 56px;
      margin-bottom: 16px;
    }
    h1 {
      margin-bottom: 4px;
      font-size: 24px;
      font-weight: 700;
      color: #18181b;
    }
    p {
      margin-bottom: 20px;
      font-size: 15px;
      line-height: 22px;
      color: #52525b;
    }
    strong {
      font-weight: 700;
      color: #18181b;
    }
    label {
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #3f3f46;
    }
    input {
      margin-bottom: 12px;
      padding: 10px 12px;
      border: 1px solid #d4d4d8;
      border-radius: 8px;
      font-size: 15px;
    }
    button {
      padding: 12px;
      border-radius: 8px;
      background-color: #4f46e5;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
      color: #ffffff;
    }
    ul {
      margin-top: 16px;
      font-size: 14px;
      color: #3f3f46;
    }
    li {
      padding: 8px 0;
      border-top: 1px solid #e4e4e7;
    }
    .terms {
      margin-top: 12px;
      font-size: 12px;
      text-align: center;
      color: #71717a;
    }
    a {
      text-decoration: underline;
      color: #4f46e5;
    }
    .welcome {
      margin-top: 16px;
      margin-bottom: 0;
      color: #4338ca;
    }
  `,
})
export class App {
  readonly name = signal('');
  readonly joined = signal(false);

  join(): void {
    this.joined.set(true);
  }
}
