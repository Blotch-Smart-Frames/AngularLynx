import furniture0 from '../../assets/furniture/0.jpg';
import furniture1 from '../../assets/furniture/1.jpg';
import furniture2 from '../../assets/furniture/2.jpg';
import furniture3 from '../../assets/furniture/3.jpg';
import furniture4 from '../../assets/furniture/4.jpg';
import furniture5 from '../../assets/furniture/5.jpg';
import furniture6 from '../../assets/furniture/6.jpg';
import furniture7 from '../../assets/furniture/7.jpg';
import furniture8 from '../../assets/furniture/8.jpg';
import furniture9 from '../../assets/furniture/9.jpg';
import furniture10 from '../../assets/furniture/10.jpg';
import furniture11 from '../../assets/furniture/11.jpg';
import furniture12 from '../../assets/furniture/12.jpg';
import furniture13 from '../../assets/furniture/13.jpg';
import furniture14 from '../../assets/furniture/14.jpg';
import product1 from '../../assets/products/1.png';
import product2 from '../../assets/products/2.png';
import product3 from '../../assets/products/3.png';
import product4 from '../../assets/products/4.png';
import product5 from '../../assets/products/5.png';
import product6 from '../../assets/products/6.png';
import product7 from '../../assets/products/7.png';
import product8 from '../../assets/products/8.png';

/**
 * A picture with its pixel size. The gallery lays its waterfall out before
 * the images load, so it needs each one's aspect ratio up front.
 */
export type Picture = {
  src: string;
  width: number;
  height: number;
};

/** The furniture the gallery shows, with the sizes the files have. */
const FURNITURE: Picture[] = [
  { src: furniture0, width: 512, height: 429 },
  { src: furniture1, width: 511, height: 437 },
  { src: furniture2, width: 1024, height: 1589 },
  { src: furniture3, width: 510, height: 418 },
  { src: furniture4, width: 509, height: 438 },
  { src: furniture5, width: 1024, height: 1557 },
  { src: furniture6, width: 509, height: 415 },
  { src: furniture7, width: 509, height: 426 },
  { src: furniture8, width: 1024, height: 1544 },
  { src: furniture9, width: 510, height: 432 },
  { src: furniture10, width: 1024, height: 1467 },
  { src: furniture11, width: 1024, height: 1545 },
  { src: furniture12, width: 512, height: 416 },
  { src: furniture13, width: 1024, height: 1509 },
  { src: furniture14, width: 512, height: 411 },
];

/**
 * The gallery's pictures: the fifteen, five times over, so the list is long
 * enough to scroll through and the `<list>` has something to virtualize.
 */
export const GALLERY_PICTURES: Picture[] = [
  ...FURNITURE,
  ...FURNITURE,
  ...FURNITURE,
  ...FURNITURE,
  ...FURNITURE,
];

/** The product's photos, which the detail page's swiper pages through. */
export const PRODUCT_PICTURES: string[] = [
  product1,
  product2,
  product3,
  product4,
  product5,
  product6,
  product7,
  product8,
];
