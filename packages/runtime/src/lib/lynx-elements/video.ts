import { Directive } from '@angular/core';
import { LynxElementBase } from './base';

/**
 * Native video player (experimental, Lynx 4.1+). Control playback with the
 * `play` / `pause` / `stop` / `seek` UI methods via SelectorQuery.
 */
@Directive({
  selector: 'video',
  standalone: true,
  inputs: [
    'src',
    'loop',
    'volume',
    'muted',
    'speed',
    'object-fit',
    'mode',
    'timeupdate-interval',
  ],
})
export class LynxVideo extends LynxElementBase {
  /**
   * Video URL. Only online network URLs are supported.
   */
  src?: string;
  /**
   * Whether playback loops. @default false
   */
  loop?: boolean;
  /**
   * Playback volume from 0 to 1. @default 1
   */
  volume?: number;
  /**
   * Whether audio is muted. @default false
   */
  muted?: boolean;
  /**
   * Playback rate from 0.1 to 2.0. @default 1
   */
  speed?: number;
  /**
   * How the video is scaled into the element box. @default 'contain'
   */
  'object-fit'?: 'contain' | 'cover' | 'fill';
  /**
   * How queued UI method calls are executed. @default 'queue'
   */
  mode?: 'queue' | 'direct' | 'latest';
  /**
   * Minimum interval between `bindtimeupdate` events, in seconds. @default 0.33
   */
  'timeupdate-interval'?: number;
}
