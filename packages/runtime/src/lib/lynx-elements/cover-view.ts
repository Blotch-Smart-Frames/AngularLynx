import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Renders its children above embedded native views such as `<webview>`
 * (Clay Windows/macOS only). Has no element-specific attributes.
 */
@Directive({ selector: 'cover-view' })
export class LynxCoverView extends LynxElementBase {}
