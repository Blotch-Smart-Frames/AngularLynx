import { Location } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import favoriteIcon from '../../assets/icons/heart.png';
import { PRODUCT_PICTURES } from '../data/pictures';
import { NavBar } from '../nav-bar';
import { Swiper } from './swiper';

/**
 * The second tutorial's screen: the product's photos in a swiper, its price
 * card over them, and the Order button. Opened from a gallery picture, it
 * starts on the photo that matches it.
 */
@Component({
  selector: 'app-product-detail',
  imports: [LYNX_ELEMENTS, NavBar, Swiper],
  host: { class: 'screen' },
  template: `
    <app-nav-bar showBack (back)="back()" />
    <view class="page-container">
      <app-swiper
        [pictures]="pictures"
        [start]="start()"
        [duration]="300"
        [easing]="easeInOut"
      />
      <view class="card-detail-container">
        <view class="card-detail">
          <view class="card-detail-title">
            <text class="card-detail-title-price">￥1314</text>
            <text class="card-detail-amount">Sold 1000+</text>
          </view>
          <view class="card-detail-desc">
            <text class="card-detail-desc-text">Single leather seat</text>
            <image
              class="favorite-icon"
              mode="aspectFill"
              [src]="favoriteIcon"
            />
          </view>
        </view>
      </view>
      <view
        class="order-button"
        accessibility-element="true"
        accessibility-traits="button"
        accessibility-label="Order Now"
      >
        <text class="order-text">Order Now</text>
      </view>
    </view>
  `,
  styles: `
    .page-container {
      position: relative;
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      width: 100%;
      padding-bottom: calc(30px + env(safe-area-inset-bottom));
      background-color: #000;
    }

    /* The card floats over the photo's foot, on a gradient into the page's
       black, 75px above the bottom: the Order button's row. */
    .card-detail-container {
      position: absolute;
      bottom: calc(75px + env(safe-area-inset-bottom));
      width: 100%;
      background: linear-gradient(
        180deg,
        rgba(17, 17, 19, 0) 29.47%,
        #111113 99.97%
      );
    }

    .card-detail {
      width: calc(100% - 40px);
      margin: 0 20px 18px 20px;
      padding: 21px;
      border-radius: 12px;
      background-color: #282e38;
      box-sizing: border-box;
    }

    .card-detail-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 15px;
    }

    .card-detail-title-price {
      color: #ff6740;
      font-size: 24px;
    }

    .card-detail-amount {
      color: rgba(255, 255, 255, 0.85);
      font-size: 12px;
      text-align: right;
    }

    .card-detail-desc {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-detail-desc-text {
      color: rgba(255, 255, 255, 0.85);
      font-size: 17px;
    }

    .favorite-icon {
      width: 20px;
      height: 20px;
    }

    .order-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: calc(100% - 40px);
      margin: 0 20px;
      padding: 13px 0;
      border-radius: 8px;
      background-color: #ff6740;
    }

    .order-text {
      color: #fff;
      font-size: 17px;
    }
  `,
})
export class ProductDetailPage {
  /** The gallery picture that was tapped: the route's `:index`. */
  readonly index = input('0');
  readonly pictures = PRODUCT_PICTURES;
  /** The product has eight photos; the gallery picture picks the first. */
  readonly start = computed(
    () => (Number(this.index()) || 0) % PRODUCT_PICTURES.length,
  );
  readonly favoriteIcon = favoriteIcon;
  readonly #location = inject(Location);

  /**
   * The snap's curve: ease in, ease out. A plain function: the swiper calls
   * it from its main-thread scripts, and in an Angular app those run where
   * the rest of the app does.
   */
  readonly easeInOut = (x: number): number =>
    x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  back(): void {
    this.#location.back();
  }
}
