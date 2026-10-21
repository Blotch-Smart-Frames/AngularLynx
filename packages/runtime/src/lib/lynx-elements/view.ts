import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * General-purpose container element, equivalent to HTML `<div>`. Its
 * attributes (`flatten`, the pan-intercept ones, …) work on every element, so
 * they live on {@link LynxElementBase}.
 */
@Directive({ selector: 'view' })
export class LynxView extends LynxElementBase {}
