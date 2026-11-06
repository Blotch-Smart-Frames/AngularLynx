import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LYNX_ELEMENTS,
  type ListScrollDetail,
  LynxMainThreadEvent,
  MainThreadElement,
} from '@blotch/angular-lynx';
import { GALLERY_PICTURES, type Picture } from '../data/pictures';
import { NavBar } from '../nav-bar';
import { LikeImageCard } from './like-image-card';

/** The gallery's fixed styles, which the item-height estimate needs. */
const GALLERY_PADDING = 20;
const GALLERY_GAP = 10;
const GALLERY_COLUMNS = 2;

/**
 * The first tutorial's screen: a two-column waterfall of furniture that
 * scrolls by itself, with a glowing scrollbar that follows it. Tap a picture
 * to open it.
 */
@Component({
  selector: 'app-gallery',
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent, NavBar, LikeImageCard],
  host: { class: 'screen' },
  template: `
    <app-nav-bar title="Popular Furniture" />
    <view class="gallery">
      <!-- The scrollbar: a strip the scroll handler sizes and moves. Its glow
           is a CSS animation that runs on its own. -->
      <view #scrollbar class="scrollbar">
        <view class="scrollbar-effect glow" />
      </view>
      <!-- list-type="waterfall" puts each picture into the shorter column.
           The scroll handler is a main-thread script, bound with
           [mainThreadBindscroll]: it moves the scrollbar on every scroll
           event without a change-detection pass, and
           [scroll-event-throttle]="0" asks for every event. -->
      <list
        #gallery
        class="list"
        list-type="waterfall"
        [span-count]="2"
        scroll-orientation="vertical"
        [scroll-event-throttle]="0"
        [mainThreadBindscroll]="onScroll"
      >
        @for (picture of pictures; track $index) {
          <list-item
            [attr.item-key]="$index"
            [attr.estimated-main-axis-size-px]="estimatedHeight(picture)"
          >
            <app-like-image-card
              [picture]="picture"
              accessibility-element="true"
              accessibility-traits="button"
              [accessibility-label]="'Picture ' + ($index + 1)"
              (bindtap)="open($index)"
            />
          </list-item>
        }
      </list>
    </view>
  `,
  styles: `
    .gallery {
      position: relative;
      flex: 1;
      width: 100%;
    }

    .list {
      width: 100%;
      height: 100%;
      padding: 0 20px 20px;
      list-main-axis-gap: 10px;
      list-cross-axis-gap: 10px;
    }

    .scrollbar {
      position: absolute;
      right: 7px;
      z-index: 1000;
      width: 4px;
      border-radius: 5px;
      overflow: hidden;
      background: linear-gradient(to bottom, #ff6448, #ccddff, #3deae7);
      box-shadow:
        0px 0px 4px 1px rgba(12, 205, 223, 0.4),
        0px 0px 16px 5px rgba(12, 205, 223, 0.5);
    }

    .scrollbar-effect {
      width: 100%;
      height: 80%;
    }

    .glow {
      border-radius: 4px;
      background: linear-gradient(
        45deg,
        rgba(255, 255, 255, 0) 20%,
        rgba(255, 255, 255, 0.8) 50%,
        rgba(255, 255, 255, 0) 80%
      );
      animation: flow 3s linear infinite;
    }

    @keyframes flow {
      0% {
        transform: translateY(-100%);
      }
      100% {
        transform: translateY(100%);
      }
    }
  `,
})
export class GalleryPage {
  readonly pictures = GALLERY_PICTURES;
  readonly list = viewChild.required('gallery', { read: ElementRef });
  readonly scrollbar = viewChild.required('scrollbar', { read: ElementRef });
  readonly #router = inject(Router);

  constructor() {
    // autoScroll is one of the list's UI methods: it scrolls the list 60px a
    // second until it reaches the end, or the reader scrolls it.
    afterNextRender(() => {
      this.list().nativeElement.invoke('autoScroll', {
        rate: '60px',
        start: true,
      });
    });
  }

  /**
   * How tall a picture will be in its column. The list lays its items out
   * with this before they render, so the scrollbar is right from the start.
   * innerWidth is the LynxView's width: the screen's on a phone.
   */
  estimatedHeight(picture: Picture): number {
    const columnWidth =
      (innerWidth - GALLERY_PADDING * 2 - GALLERY_GAP) / GALLERY_COLUMNS;
    return (columnWidth / picture.width) * picture.height;
  }

  /**
   * Sizes and moves the scrollbar from the scroll position, on the main
   * thread. `listHeight` is the list's own box; Lynx for Web doesn't report
   * it, but there the element's getBoundingClientRect() measures it.
   */
  readonly onScroll = (event: { detail: ListScrollDetail }) => {
    'main thread';
    const { scrollTop, scrollHeight } = event.detail;
    const listHeight =
      event.detail.listHeight ||
      this.list().nativeElement.getBoundingClientRect().height;
    // The scrollbar's main-thread handle, the kind a script gets as
    // event.currentTarget, so the style lands without change detection.
    const scrollbar = new MainThreadElement(
      this.scrollbar().nativeElement.element,
    );
    scrollbar.setStyleProperties({
      height: `${listHeight * (listHeight / scrollHeight)}px`,
      top: `${listHeight * (scrollTop / scrollHeight)}px`,
    });
  };

  open(index: number): void {
    this.#router.navigate(['/product', index]);
  }
}
