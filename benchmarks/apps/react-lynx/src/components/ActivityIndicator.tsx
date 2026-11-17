/**
 * React Native's ActivityIndicator is UIKit's UIActivityIndicatorView. Lynx
 * has no spinner element, so this is a ring that a CSS animation turns, the
 * same size and gray (App.css, `.spinner`).
 */
export function ActivityIndicator({ size = 'small' }: { size?: 'small' | 'large' }) {
  return <view className={`spinner spinner-${size}`} />;
}
