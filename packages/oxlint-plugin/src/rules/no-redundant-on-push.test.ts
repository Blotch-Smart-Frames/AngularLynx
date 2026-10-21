import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';
import rule from './no-redundant-on-push.mjs';

/**
 * Unlike the other rule tests, these parse real source with oxlint's own
 * RuleTester: the fix splices text around commas and line breaks, so the
 * fixed output is what's worth checking, and the import is only removed when
 * oxlint's scope analysis finds no other use of it.
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: 'ts' } },
});

const error = { messageId: 'redundantOnPush' };

tester.run('no-redundant-on-push', rule as never, {
  valid: [
    {
      name: 'a component without changeDetection',
      code: `import { Component } from '@angular/core';
@Component({ selector: 'app-root', template: '' })
class App {}`,
    },
    {
      name: 'opting out with Eager',
      code: `import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({ changeDetection: ChangeDetectionStrategy.Eager })
class App {}`,
    },
    {
      name: 'a ChangeDetectionStrategy that is not imported from @angular/core',
      code: `import { Component } from '@angular/core';
import { ChangeDetectionStrategy } from './strategy';
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
class App {}`,
    },
    {
      name: 'a namespace import of @angular/core',
      code: `import * as ng from '@angular/core';
@ng.Component({ changeDetection: ng.ChangeDetectionStrategy.OnPush })
class App {}`,
    },
    {
      name: 'other decorators',
      code: `import { ChangeDetectionStrategy } from '@angular/core';
@Settings({ changeDetection: ChangeDetectionStrategy.OnPush })
@Bare
class App {}`,
    },
    {
      name: 'metadata that is not an object literal',
      code: `import { ChangeDetectionStrategy, Component } from '@angular/core';
const metadata = { changeDetection: ChangeDetectionStrategy.OnPush };
@Component(metadata)
@Component()
class App {}`,
    },
    {
      name: 'values and keys that are not a plain OnPush',
      code: `import { ChangeDetectionStrategy, Component } from '@angular/core';
const key = 'changeDetection';
const strategy = ChangeDetectionStrategy.Eager;
const base = {};
@Component({
  ...base,
  [key]: ChangeDetectionStrategy.OnPush,
  changeDetection: strategy,
})
@Component({ changeDetection: ChangeDetectionStrategy['OnPush'] })
class App {}`,
    },
  ],
  invalid: [
    {
      name: 'its own line, with the import on its own line',
      code: `import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class App {}`,
      output: `import {
  Component,
} from '@angular/core';

@Component({
  selector: 'app-root',
  template: '',
})
export class App {}`,
      errors: [{ ...error, line: 8 }],
    },
    {
      name: 'the last property, without a trailing comma',
      code: `import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
@Component({
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class App {}`,
      output: `import { Component, signal } from '@angular/core';
@Component({
  template: '',
})
class App {}`,
      errors: [error],
    },
    {
      name: 'the only property',
      code: `import { Component, ChangeDetectionStrategy } from '@angular/core';
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class App {}`,
      output: `import { Component } from '@angular/core';
@Component({
})
class App {}`,
      errors: [error],
    },
    {
      name: 'inline properties',
      code: `import { ChangeDetectionStrategy } from '@angular/core';
import { Component } from '@angular/core';
@Component({ selector: 'a', changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class A {}
@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class B {}
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
class C {}`,
      output: `import { Component } from '@angular/core';
@Component({ selector: 'a', template: '' })
class A {}
@Component({ template: '' })
class B {}
@Component({  })
class C {}`,
      errors: [error, error, error],
    },
    {
      name: 'a string key and an aliased import',
      code: `import { ChangeDetectionStrategy as Strategy, Component } from '@angular/core';
@Component({ 'selector': 'a', 'changeDetection': Strategy.OnPush })
class App {}`,
      output: `import { Component } from '@angular/core';
@Component({ 'selector': 'a' })
class App {}`,
      errors: [error],
    },
    {
      name: 'keeps the import while something else uses it',
      code: `import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class A {}
@Component({ changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class B {}`,
      output: `import { ChangeDetectionStrategy, Component } from '@angular/core';
@Component({ template: '' })
class A {}
@Component({ changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class B {}`,
      errors: [error],
    },
  ],
});
