import type { Routes } from '@angular/router';

/**
 * The two tutorial apps as two routes: the gallery first, and the product
 * page a tap away. The product page loads lazily, so the gallery's bundle
 * doesn't carry the swiper.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./gallery/gallery').then((m) => m.GalleryPage),
  },
  {
    path: 'product/:index',
    loadComponent: () =>
      import('./product-detail/product-detail').then(
        (m) => m.ProductDetailPage,
      ),
  },
];
