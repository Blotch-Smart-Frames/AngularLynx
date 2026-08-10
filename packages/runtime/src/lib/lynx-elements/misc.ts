import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Anonymous grouping element with no visual output.
 */
@Directive({ selector: 'block', standalone: true })
export class LynxBlock extends LynxElementBase {}

/**
 * Lynx native conditional element.
 * Note: Angular's `@if` control flow is a separate, unrelated construct.
 */
@Directive({ selector: 'if', standalone: true })
export class LynxIf extends LynxElementBase {}

/**
 * Lynx native iteration element.
 * Note: Angular's `@for` control flow is a separate, unrelated construct.
 */
@Directive({ selector: 'for', standalone: true })
export class LynxFor extends LynxElementBase {}
