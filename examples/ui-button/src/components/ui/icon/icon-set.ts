// The icon set, one export per icon, so an app's scripts carry only the icons
// it registers with provideIcons() (icons.ts). A map of every icon, looked up
// by a name known only at runtime, kept all of them in every app's
// main-thread script, about 34 kB, and PrimJS keeps a script's whole bytecode
// on the heap.
//
// Each icon is a plain object, with no function call in it, so a bundler can
// see that leaving an unused one out changes nothing. `body` is what goes
// inside the <svg> (iconSvg() in icons.ts adds the root), and `name` is the
// name templates give it, `name="chevron-right"`: the export names add `Icon`
// so none is a reserved word (`package`) or a common local name (`x`, `map`).
//
// All icons must be built from <path>/<circle>/etc. — never <line>.
//
// Lynx renders the <svg content="..."> string on the native thread via the
// ServalSVG engine. Its <line> handler (SrSVGLine::onDraw) guards drawing on a
// stroke set DIRECTLY on the <line>, whereas <path>/<circle>/<rect> draw
// unconditionally and let the canvas layer resolve stroke/fill. We set
// stroke="currentColor" once on the root <svg> and let children inherit it, so
// a <line>'s own stroke is null and the guard skips it entirely — the line
// silently never paints on device (web renders it fine, so it looks correct in
// a browser preview but disappears on iOS/Android). <path> equivalents avoid
// the bug: e.g. a horizontal <line x1=4 x2=20 y=12> becomes <path d="M4 12h16"/>.
//
// Dots must be a <circle>, never a zero-length "dot" path. Lucide draws the
// dot of an "i"/"!" as a degenerate subpath (e.g. <path d="M12 8h.01"/>) that
// relies on stroke-linecap="round" to paint a disc of diameter = stroke-width.
// ServalSVG's DrawPath does not paint a round cap for a near-zero-length
// stroked subpath, so the dot silently vanishes on device (same failure mode
// as <line>). Replace it with a filled circle of radius = stroke-width/2, which
// routes through the dedicated DrawCircle primitive and always paints:
// <path d="M12 8h.01"/> becomes <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>.

export const checkIcon = {
  name: 'check' as const,
  body: '<path d="M20 6 9 17l-5-5"/>',
};
export const xIcon = {
  name: 'x' as const,
  body: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
export const plusIcon = {
  name: 'plus' as const,
  body: '<path d="M5 12h14"/><path d="M12 5v14"/>',
};
export const minusIcon = {
  name: 'minus' as const,
  body: '<path d="M5 12h14"/>',
};
export const chevronDownIcon = {
  name: 'chevron-down' as const,
  body: '<path d="m6 9 6 6 6-6"/>',
};
export const chevronUpIcon = {
  name: 'chevron-up' as const,
  body: '<path d="m18 15-6-6-6 6"/>',
};
export const chevronLeftIcon = {
  name: 'chevron-left' as const,
  body: '<path d="m15 18-6-6 6-6"/>',
};
export const chevronRightIcon = {
  name: 'chevron-right' as const,
  body: '<path d="m9 18 6-6-6-6"/>',
};
export const arrowLeftIcon = {
  name: 'arrow-left' as const,
  body: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
};
export const arrowRightIcon = {
  name: 'arrow-right' as const,
  body: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};
export const searchIcon = {
  name: 'search' as const,
  body: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};
export const menuIcon = {
  name: 'menu' as const,
  body: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
};
export const infoIcon = {
  name: 'info' as const,
  body: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
};
export const alertTriangleIcon = {
  name: 'alert-triangle' as const,
  body: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
};
export const loaderIcon = {
  name: 'loader' as const,
  body: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
};
export const circleIcon = {
  name: 'circle' as const,
  body: '<circle cx="12" cy="12" r="10"/>',
};
export const ellipsisIcon = {
  name: 'ellipsis' as const,
  body: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};
export const eyeIcon = {
  name: 'eye' as const,
  body: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
};
export const eyeOffIcon = {
  name: 'eye-off' as const,
  body: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
};
export const settingsIcon = {
  name: 'settings' as const,
  body: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};
export const trashIcon = {
  name: 'trash' as const,
  body: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
};
export const heartIcon = {
  name: 'heart' as const,
  body: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};
export const starIcon = {
  name: 'star' as const,
  body: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a.53.53 0 0 0 .4.29l5.16.756a.53.53 0 0 1 .294.904l-3.733 3.638a.53.53 0 0 0-.152.469l.882 5.14a.53.53 0 0 1-.77.56l-4.614-2.426a.53.53 0 0 0-.494 0L6.18 18.73a.53.53 0 0 1-.77-.56l.881-5.139a.53.53 0 0 0-.152-.47L2.406 8.925a.53.53 0 0 1 .294-.906l5.16-.755a.53.53 0 0 0 .4-.29z"/>',
};
export const bellIcon = {
  name: 'bell' as const,
  body: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
};

// Navigation & Arrows
export const arrowUpIcon = {
  name: 'arrow-up' as const,
  body: '<path d="m5 12 7-7 7 7" /> <path d="M12 19V5" />',
};
export const arrowDownIcon = {
  name: 'arrow-down' as const,
  body: '<path d="M12 5v14" /> <path d="m19 12-7 7-7-7" />',
};
export const arrowUpRightIcon = {
  name: 'arrow-up-right' as const,
  body: '<path d="M7 7h10v10" /> <path d="M7 17 17 7" />',
};
export const arrowUpLeftIcon = {
  name: 'arrow-up-left' as const,
  body: '<path d="M7 17V7h10" /> <path d="M17 17 7 7" />',
};
export const arrowDownRightIcon = {
  name: 'arrow-down-right' as const,
  body: '<path d="m7 7 10 10" /> <path d="M17 7v10H7" />',
};
export const arrowDownLeftIcon = {
  name: 'arrow-down-left' as const,
  body: '<path d="M17 7 7 17" /> <path d="M17 17H7V7" />',
};
export const chevronsUpIcon = {
  name: 'chevrons-up' as const,
  body: '<path d="m17 11-5-5-5 5" /> <path d="m17 18-5-5-5 5" />',
};
export const chevronsDownIcon = {
  name: 'chevrons-down' as const,
  body: '<path d="m7 6 5 5 5-5" /> <path d="m7 13 5 5 5-5" />',
};
export const chevronsLeftIcon = {
  name: 'chevrons-left' as const,
  body: '<path d="m11 17-5-5 5-5" /> <path d="m18 17-5-5 5-5" />',
};
export const chevronsRightIcon = {
  name: 'chevrons-right' as const,
  body: '<path d="m6 17 5-5-5-5" /> <path d="m13 17 5-5-5-5" />',
};
export const moveIcon = {
  name: 'move' as const,
  body: '<path d="M12 2v20" /> <path d="m15 19-3 3-3-3" /> <path d="m19 9 3 3-3 3" /> <path d="M2 12h20" /> <path d="m5 9-3 3 3 3" /> <path d="m9 5 3-3 3 3" />',
};
export const maximizeIcon = {
  name: 'maximize' as const,
  body: '<path d="M8 3H5a2 2 0 0 0-2 2v3" /> <path d="M21 8V5a2 2 0 0 0-2-2h-3" /> <path d="M3 16v3a2 2 0 0 0 2 2h3" /> <path d="M16 21h3a2 2 0 0 0 2-2v-3" />',
};
export const minimizeIcon = {
  name: 'minimize' as const,
  body: '<path d="M8 3v3a2 2 0 0 1-2 2H3" /> <path d="M21 8h-3a2 2 0 0 1-2-2V3" /> <path d="M3 16h3a2 2 0 0 1 2 2v3" /> <path d="M16 21v-3a2 2 0 0 1 2-2h3" />',
};
export const externalLinkIcon = {
  name: 'external-link' as const,
  body: '<path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
};
export const refreshCwIcon = {
  name: 'refresh-cw' as const,
  body: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" /> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /> <path d="M8 16H3v5" />',
};
export const rotateCwIcon = {
  name: 'rotate-cw' as const,
  body: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
};
export const undo2Icon = {
  name: 'undo-2' as const,
  body: '<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
};
export const redo2Icon = {
  name: 'redo-2' as const,
  body: '<path d="m15 14 5-5-5-5" /> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
};

// Actions & Editing
export const editIcon = {
  name: 'edit' as const,
  body: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />',
};
export const pencilIcon = {
  name: 'pencil' as const,
  body: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
};
export const copyIcon = {
  name: 'copy' as const,
  body: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
};
export const clipboardIcon = {
  name: 'clipboard' as const,
  body: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />',
};
export const saveIcon = {
  name: 'save' as const,
  body: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />',
};
export const downloadIcon = {
  name: 'download' as const,
  body: '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
};
export const uploadIcon = {
  name: 'upload' as const,
  body: '<path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />',
};
export const share2Icon = {
  name: 'share-2' as const,
  body: '<circle cx="18" cy="5" r="3" /> <circle cx="6" cy="12" r="3" /> <circle cx="18" cy="19" r="3" /> <path d="M8.59 13.51 L15.42 17.49"/> <path d="M15.41 6.51 L8.59 10.49"/>',
};
export const slidersHorizontalIcon = {
  name: 'sliders-horizontal' as const,
  body: '<path d="M10 5H3" /> <path d="M12 19H3" /> <path d="M14 3v4" /> <path d="M16 17v4" /> <path d="M21 12h-9" /> <path d="M21 19h-5" /> <path d="M21 5h-7" /> <path d="M8 10v4" /> <path d="M8 12H3" />',
};
export const zoomInIcon = {
  name: 'zoom-in' as const,
  body: '<circle cx="11" cy="11" r="8" /> <path d="M21 21 L16.65 16.65"/> <path d="M11 8 L11 14"/> <path d="M8 11 L14 11"/>',
};
export const zoomOutIcon = {
  name: 'zoom-out' as const,
  body: '<circle cx="11" cy="11" r="8" /> <path d="M21 21 L16.65 16.65"/> <path d="M8 11 L14 11"/>',
};
export const scissorsIcon = {
  name: 'scissors' as const,
  body: '<circle cx="6" cy="6" r="3" /> <path d="M8.12 8.12 12 12" /> <path d="M20 4 8.12 15.88" /> <circle cx="6" cy="18" r="3" /> <path d="M14.8 14.8 20 20" />',
};
export const trash2Icon = {
  name: 'trash-2' as const,
  body: '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
};
export const pinIcon = {
  name: 'pin' as const,
  body: '<path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />',
};
export const linkIcon = {
  name: 'link' as const,
  body: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
};
export const filterIcon = {
  name: 'filter' as const,
  body: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
};

// Media & Playback
export const playIcon = {
  name: 'play' as const,
  body: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
};
export const pauseIcon = {
  name: 'pause' as const,
  body: '<rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" />',
};
export const squareIcon = {
  name: 'square' as const,
  body: '<rect width="18" height="18" x="3" y="3" rx="2" />',
};
export const circleStopIcon = {
  name: 'circle-stop' as const,
  body: '<circle cx="12" cy="12" r="10" /> <rect x="9" y="9" width="6" height="6" rx="1" />',
};
export const skipForwardIcon = {
  name: 'skip-forward' as const,
  body: '<path d="M21 4v16" /> <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />',
};
export const skipBackIcon = {
  name: 'skip-back' as const,
  body: '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" /> <path d="M3 20V4" />',
};
export const rewindIcon = {
  name: 'rewind' as const,
  body: '<path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z" /> <path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z" />',
};
export const fastForwardIcon = {
  name: 'fast-forward' as const,
  body: '<path d="M12 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 12 18z" /> <path d="M2 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 2 18z" />',
};
export const volume2Icon = {
  name: 'volume-2' as const,
  body: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M16 9a5 5 0 0 1 0 6" /> <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
};
export const volumeXIcon = {
  name: 'volume-x' as const,
  body: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M22 9 L16 15"/> <path d="M16 9 L22 15"/>',
};
export const micIcon = {
  name: 'mic' as const,
  body: '<path d="M12 19v3" /> <path d="M19 10v2a7 7 0 0 1-14 0v-2" /> <rect x="9" y="2" width="6" height="13" rx="3" />',
};
export const micOffIcon = {
  name: 'mic-off' as const,
  body: '<path d="M12 19v3" /> <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /> <path d="M16.95 16.95A7 7 0 0 1 5 12v-2" /> <path d="M18.89 13.23A7 7 0 0 0 19 12v-2" /> <path d="m2 2 20 20" /> <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />',
};
export const cameraIcon = {
  name: 'camera' as const,
  body: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /> <circle cx="12" cy="13" r="3" />',
};
export const videoIcon = {
  name: 'video' as const,
  body: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /> <rect x="2" y="6" width="14" height="12" rx="2" />',
};
export const musicIcon = {
  name: 'music' as const,
  body: '<path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" />',
};
export const headphonesIcon = {
  name: 'headphones' as const,
  body: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />',
};

// Communication
export const mailIcon = {
  name: 'mail' as const,
  body: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /> <rect x="2" y="4" width="20" height="16" rx="2" />',
};
export const messageCircleIcon = {
  name: 'message-circle' as const,
  body: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />',
};
export const messageSquareIcon = {
  name: 'message-square' as const,
  body: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />',
};
export const sendIcon = {
  name: 'send' as const,
  body: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" />',
};
export const phoneIcon = {
  name: 'phone' as const,
  body: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233a14 14 0 0 0 6.392 6.384" />',
};
export const phoneCallIcon = {
  name: 'phone-call' as const,
  body: '<path d="M13 2a9 9 0 0 1 9 9" /> <path d="M13 6a5 5 0 0 1 5 5" /> <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233a14 14 0 0 0 6.392 6.384" />',
};
export const atSignIcon = {
  name: 'at-sign' as const,
  body: '<circle cx="12" cy="12" r="4" /> <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />',
};
export const inboxIcon = {
  name: 'inbox' as const,
  body: '<path d="M22 12 L16 12 L14 15 L10 15 L8 12 L2 12"/> <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />',
};
export const megaphoneIcon = {
  name: 'megaphone' as const,
  body: '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /> <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" /> <path d="M8 6v8" />',
};
export const rssIcon = {
  name: 'rss' as const,
  body: '<path d="M4 11a9 9 0 0 1 9 9" /> <path d="M4 4a16 16 0 0 1 16 16" /> <circle cx="5" cy="19" r="1" />',
};
export const replyIcon = {
  name: 'reply' as const,
  body: '<path d="M20 18v-2a4 4 0 0 0-4-4H4" /> <path d="m9 17-5-5 5-5" />',
};
export const globeIcon = {
  name: 'globe' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
};

// Files & Folders
export const fileIcon = {
  name: 'file' as const,
  body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" />',
};
export const fileTextIcon = {
  name: 'file-text' as const,
  body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
};
export const filePlusIcon = {
  name: 'file-plus' as const,
  body: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M9 15h6" /> <path d="M12 18v-6" />',
};
export const folderIcon = {
  name: 'folder' as const,
  body: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
};
export const folderOpenIcon = {
  name: 'folder-open' as const,
  body: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />',
};
export const bookIcon = {
  name: 'book' as const,
  body: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />',
};
export const bookOpenIcon = {
  name: 'book-open' as const,
  body: '<path d="M12 5v16" /> <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />',
};
export const archiveIcon = {
  name: 'archive' as const,
  body: '<rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" />',
};
export const paperclipIcon = {
  name: 'paperclip' as const,
  body: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />',
};
export const newspaperIcon = {
  name: 'newspaper' as const,
  body: '<path d="M15 18h-5" /> <path d="M18 14h-8" /> <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" /> <rect width="8" height="4" x="10" y="6" rx="1" />',
};
export const databaseIcon = {
  name: 'database' as const,
  body: '<ellipse cx="12" cy="5" rx="9" ry="3" /> <path d="M3 5V19A9 3 0 0 0 21 19V5" /> <path d="M3 12A9 3 0 0 0 21 12" />',
};
export const hardDriveIcon = {
  name: 'hard-drive' as const,
  body: '<circle cx="10" cy="16" r="1" fill="currentColor" stroke="none"/> <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /> <path d="M21.946 12.013H2.054" /> <circle cx="6" cy="16" r="1" fill="currentColor" stroke="none"/>',
};

// Status & Alerts
export const checkCircleIcon = {
  name: 'check-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="m9 12 2 2 4-4" />',
};
export const xCircleIcon = {
  name: 'x-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="m15 9-6 6" /> <path d="m9 9 6 6" />',
};
export const alertCircleIcon = {
  name: 'alert-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M12 8 L12 12"/> <path d="M12 16 L12.01 16"/>',
};
export const plusCircleIcon = {
  name: 'plus-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M8 12h8" /> <path d="M12 8v8" />',
};
export const minusCircleIcon = {
  name: 'minus-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M8 12h8" />',
};
export const shieldIcon = {
  name: 'shield' as const,
  body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />',
};
export const shieldCheckIcon = {
  name: 'shield-check' as const,
  body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" />',
};
export const lockIcon = {
  name: 'lock' as const,
  body: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
};
export const lockOpenIcon = {
  name: 'lock-open' as const,
  body: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 9.9-1" />',
};
export const keyIcon = {
  name: 'key' as const,
  body: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /> <path d="m21 2-9.6 9.6" /> <circle cx="7.5" cy="15.5" r="5.5" />',
};
export const banIcon = {
  name: 'ban' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" />',
};
export const helpCircleIcon = {
  name: 'help-circle' as const,
  body: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
};

// People & Social
export const userIcon = {
  name: 'user' as const,
  body: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" />',
};
export const usersIcon = {
  name: 'users' as const,
  body: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" />',
};
export const userCircleIcon = {
  name: 'user-circle' as const,
  body: '<circle cx="12" cy="12" r="10" /> <circle cx="12" cy="10" r="3" /> <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />',
};
export const userPlusIcon = {
  name: 'user-plus' as const,
  body: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <path d="M19 8 L19 14"/> <path d="M22 11 L16 11"/>',
};
export const userCheckIcon = {
  name: 'user-check' as const,
  body: '<path d="m16 11 2 2 4-4" /> <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" />',
};
export const userXIcon = {
  name: 'user-x' as const,
  body: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <path d="M17 8 L22 13"/> <path d="M22 8 L17 13"/>',
};
export const thumbsUpIcon = {
  name: 'thumbs-up' as const,
  body: '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /> <path d="M7 10v12" />',
};
export const thumbsDownIcon = {
  name: 'thumbs-down' as const,
  body: '<path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /> <path d="M17 14V2" />',
};
export const smileIcon = {
  name: 'smile' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M8 14s1.5 2 4 2 4-2 4-2" /> <path d="M9 9 L9.01 9"/> <path d="M15 9 L15.01 9"/>',
};
export const frownIcon = {
  name: 'frown' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M16 16s-1.5-2-4-2-4 2-4 2" /> <path d="M9 9 L9.01 9"/> <path d="M15 9 L15.01 9"/>',
};
export const handIcon = {
  name: 'hand' as const,
  body: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /> <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /> <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />',
};
export const handshakeIcon = {
  name: 'handshake' as const,
  body: '<path d="m11 17 2 2a1 1 0 1 0 3-3" /> <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" /> <path d="m21 3 1 11h-2" /> <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" /> <path d="M3 4h8" />',
};

// Commerce
export const shoppingCartIcon = {
  name: 'shopping-cart' as const,
  body: '<circle cx="8" cy="21" r="1" /> <circle cx="19" cy="21" r="1" /> <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />',
};
export const shoppingBagIcon = {
  name: 'shopping-bag' as const,
  body: '<path d="M16 10a4 4 0 0 1-8 0" /> <path d="M3.103 6.034h17.794" /> <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />',
};
export const creditCardIcon = {
  name: 'credit-card' as const,
  body: '<rect width="20" height="14" x="2" y="5" rx="2" /> <path d="M2 10 L22 10"/>',
};
export const dollarSignIcon = {
  name: 'dollar-sign' as const,
  body: '<path d="M12 2 L12 22"/> <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />',
};
export const tagIcon = {
  name: 'tag' as const,
  body: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /> <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />',
};
export const tagsIcon = {
  name: 'tags' as const,
  body: '<path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z" /> <path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" /> <circle cx="10.5" cy="6.5" r=".5" fill="currentColor" />',
};
export const giftIcon = {
  name: 'gift' as const,
  body: '<path d="M12 7v14" /> <path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /> <path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" /> <rect x="3" y="7" width="18" height="4" rx="1" />',
};
export const packageIcon = {
  name: 'package' as const,
  body: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /> <path d="M12 22V12" /> <path d="M3.29 7 L12 12 L20.71 7"/> <path d="m7.5 4.27 9 5.15" />',
};
export const truckIcon = {
  name: 'truck' as const,
  body: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /> <path d="M15 18H9" /> <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /> <circle cx="17" cy="18" r="2" /> <circle cx="7" cy="18" r="2" />',
};
export const walletIcon = {
  name: 'wallet' as const,
  body: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /> <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />',
};
export const receiptIcon = {
  name: 'receipt' as const,
  body: '<path d="M12 17V7" /> <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" /> <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />',
};
export const storeIcon = {
  name: 'store' as const,
  body: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" /> <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" /> <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />',
};

// Weather & Nature
export const sunIcon = {
  name: 'sun' as const,
  body: '<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />',
};
export const moonIcon = {
  name: 'moon' as const,
  body: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
};
export const cloudIcon = {
  name: 'cloud' as const,
  body: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />',
};
export const cloudRainIcon = {
  name: 'cloud-rain' as const,
  body: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="M16 14v6" /> <path d="M8 14v6" /> <path d="M12 16v6" />',
};
export const cloudSnowIcon = {
  name: 'cloud-snow' as const,
  body: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/> <circle cx="8" cy="19" r="1" fill="currentColor" stroke="none"/> <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/> <circle cx="12" cy="21" r="1" fill="currentColor" stroke="none"/> <circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/> <circle cx="16" cy="19" r="1" fill="currentColor" stroke="none"/>',
};
export const windIcon = {
  name: 'wind' as const,
  body: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2" /> <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" /> <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />',
};
export const dropletIcon = {
  name: 'droplet' as const,
  body: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />',
};
export const zapIcon = {
  name: 'zap' as const,
  body: '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />',
};
export const snowflakeIcon = {
  name: 'snowflake' as const,
  body: '<path d="m10 20-1.25-2.5L6 18" /> <path d="M10 4 8.75 6.5 6 6" /> <path d="m14 20 1.25-2.5L18 18" /> <path d="m14 4 1.25 2.5L18 6" /> <path d="m17 21-3-6h-4" /> <path d="m17 3-3 6 1.5 3" /> <path d="M2 12h6.5L10 9" /> <path d="m20 10-1.5 2 1.5 2" /> <path d="M22 12h-6.5L14 15" /> <path d="m4 10 1.5 2L4 14" /> <path d="m7 21 3-6-1.5-3" /> <path d="m7 3 3 6h4" />',
};
export const flameIcon = {
  name: 'flame' as const,
  body: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />',
};
export const sunriseIcon = {
  name: 'sunrise' as const,
  body: '<path d="M12 2v8" /> <path d="m4.93 10.93 1.41 1.41" /> <path d="M2 18h2" /> <path d="M20 18h2" /> <path d="m19.07 10.93-1.41 1.41" /> <path d="M22 22H2" /> <path d="m8 6 4-4 4 4" /> <path d="M16 18a4 4 0 0 0-8 0" />',
};
export const sparklesIcon = {
  name: 'sparkles' as const,
  body: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" />',
};

// Devices & Tech
export const homeIcon = {
  name: 'home' as const,
  body: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
};
export const calendarIcon = {
  name: 'calendar' as const,
  body: '<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" />',
};
export const clockIcon = {
  name: 'clock' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" />',
};
export const mapPinIcon = {
  name: 'map-pin' as const,
  body: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />',
};
export const mapIcon = {
  name: 'map' as const,
  body: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" /> <path d="M15 5.764v15" /> <path d="M9 3.236v15" />',
};
export const compassIcon = {
  name: 'compass' as const,
  body: '<circle cx="12" cy="12" r="10" /> <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />',
};
export const wifiIcon = {
  name: 'wifi' as const,
  body: '<circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/> <path d="M2 8.82a15 15 0 0 1 20 0" /> <path d="M5 12.859a10 10 0 0 1 14 0" /> <path d="M8.5 16.429a5 5 0 0 1 7 0" />',
};
export const bluetoothIcon = {
  name: 'bluetooth' as const,
  body: '<path d="m7 7 10 10-5 5V2l5 5L7 17" />',
};
export const batteryIcon = {
  name: 'battery' as const,
  body: '<path d="M 22 14 L 22 10" /> <rect x="2" y="6" width="16" height="12" rx="2" />',
};
export const smartphoneIcon = {
  name: 'smartphone' as const,
  body: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2" /> <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/>',
};
export const monitorIcon = {
  name: 'monitor' as const,
  body: '<rect width="20" height="14" x="2" y="3" rx="2" /> <path d="M8 21 L16 21"/> <path d="M12 17 L12 21"/>',
};
export const laptopIcon = {
  name: 'laptop' as const,
  body: '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" /> <path d="M20.054 15.987H3.946" />',
};
export const serverIcon = {
  name: 'server' as const,
  body: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2" /> <rect width="20" height="8" x="2" y="14" rx="2" ry="2" /> <path d="M6 6 L6.01 6"/> <path d="M6 18 L6.01 18"/>',
};
export const cpuIcon = {
  name: 'cpu' as const,
  body: '<path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" />',
};
export const keyboardIcon = {
  name: 'keyboard' as const,
  body: '<circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/> <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/> <circle cx="14" cy="8" r="1" fill="currentColor" stroke="none"/> <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/> <circle cx="18" cy="8" r="1" fill="currentColor" stroke="none"/> <circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/> <path d="M7 16h10" /> <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/> <rect width="20" height="16" x="2" y="4" rx="2" />',
};
export const powerIcon = {
  name: 'power' as const,
  body: '<path d="M12 2v10" /> <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />',
};

// Layout & Text
export const layoutGridIcon = {
  name: 'layout-grid' as const,
  body: '<rect width="7" height="7" x="3" y="3" rx="1" /> <rect width="7" height="7" x="14" y="3" rx="1" /> <rect width="7" height="7" x="14" y="14" rx="1" /> <rect width="7" height="7" x="3" y="14" rx="1" />',
};
export const layoutDashboardIcon = {
  name: 'layout-dashboard' as const,
  body: '<rect width="7" height="9" x="3" y="3" rx="1" /> <rect width="7" height="5" x="14" y="3" rx="1" /> <rect width="7" height="9" x="14" y="12" rx="1" /> <rect width="7" height="5" x="3" y="16" rx="1" />',
};
export const tableIcon = {
  name: 'table' as const,
  body: '<path d="M12 3v18" /> <rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 9h18" /> <path d="M3 15h18" />',
};
export const columns3Icon = {
  name: 'columns-3' as const,
  body: '<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="M15 3v18" />',
};
export const rows3Icon = {
  name: 'rows-3' as const,
  body: '<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M21 9H3" /> <path d="M21 15H3" />',
};
export const listIcon = {
  name: 'list' as const,
  body: '<circle cx="3" cy="5" r="1" fill="currentColor" stroke="none"/> <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/> <circle cx="3" cy="19" r="1" fill="currentColor" stroke="none"/> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />',
};
export const listChecksIcon = {
  name: 'list-checks' as const,
  body: '<path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <path d="m3 7 2 2 4-4" />',
};
export const listOrderedIcon = {
  name: 'list-ordered' as const,
  body: '<path d="M11 5h10" /><path d="M11 12h10" /><path d="M11 19h10" /><path d="M4 4h1v5" /><path d="M4 9h2" /><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />',
};
export const boldIcon = {
  name: 'bold' as const,
  body: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
};
export const quoteIcon = {
  name: 'quote' as const,
  body: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />',
};
export const alignLeftIcon = {
  name: 'align-left' as const,
  body: '<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>',
};
export const alignCenterIcon = {
  name: 'align-center' as const,
  body: '<path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/>',
};
export const alignRightIcon = {
  name: 'align-right' as const,
  body: '<path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/>',
};
export const typeIcon = {
  name: 'type' as const,
  body: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
};

// Charts & Data
export const chartBarIcon = {
  name: 'chart-bar' as const,
  body: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M7 16h8" /> <path d="M7 11h12" /> <path d="M7 6h3" />',
};
export const chartLineIcon = {
  name: 'chart-line' as const,
  body: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="m19 9-5 5-4-4-3 3" />',
};
export const chartPieIcon = {
  name: 'chart-pie' as const,
  body: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" /> <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />',
};
export const chartColumnIcon = {
  name: 'chart-column' as const,
  body: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" />',
};
export const activityIcon = {
  name: 'activity' as const,
  body: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
};
export const trendingUpIcon = {
  name: 'trending-up' as const,
  body: '<path d="M16 7h6v6" /> <path d="m22 7-8.5 8.5-5-5L2 17" />',
};
export const trendingDownIcon = {
  name: 'trending-down' as const,
  body: '<path d="M16 17h6v-6" /> <path d="m22 17-8.5-8.5-5 5L2 7" />',
};
export const targetIcon = {
  name: 'target' as const,
  body: '<circle cx="12" cy="12" r="10" /> <circle cx="12" cy="12" r="6" /> <circle cx="12" cy="12" r="2" />',
};

// Objects & Fun
export const awardIcon = {
  name: 'award' as const,
  body: '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /> <circle cx="12" cy="8" r="6" />',
};
export const trophyIcon = {
  name: 'trophy' as const,
  body: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" /> <path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" /> <path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" /> <path d="M4 22h16" /> <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" /> <path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />',
};
export const crownIcon = {
  name: 'crown' as const,
  body: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /> <path d="M5 21h14" />',
};
export const rocketIcon = {
  name: 'rocket' as const,
  body: '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /> <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" /> <path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" /> <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />',
};
export const lightbulbIcon = {
  name: 'lightbulb' as const,
  body: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /> <path d="M9 18h6" /> <path d="M10 22h4" />',
};
export const coffeeIcon = {
  name: 'coffee' as const,
  body: '<path d="M10 2v2" /> <path d="M14 2v2" /> <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" /> <path d="M6 2v2" />',
};
export const terminalIcon = {
  name: 'terminal' as const,
  body: '<path d="M12 19h8" /> <path d="m4 17 6-6-6-6" />',
};
export const codeIcon = {
  name: 'code' as const,
  body: '<path d="m16 18 6-6-6-6" /> <path d="m8 6-6 6 6 6" />',
};
export const commandIcon = {
  name: 'command' as const,
  body: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />',
};
export const gitBranchIcon = {
  name: 'git-branch' as const,
  body: '<path d="M15 6a9 9 0 0 0-9 9V3" /> <circle cx="18" cy="6" r="3" /> <circle cx="6" cy="18" r="3" />',
};
export const bugIcon = {
  name: 'bug' as const,
  body: '<path d="M12 20v-9" /> <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" /> <path d="M14.12 3.88 16 2" /> <path d="M21 21a4 4 0 0 0-3.81-4" /> <path d="M21 5a4 4 0 0 1-3.55 3.97" /> <path d="M22 13h-4" /> <path d="M3 21a4 4 0 0 1 3.81-4" /> <path d="M3 5a4 4 0 0 0 3.55 3.97" /> <path d="M6 13H2" /> <path d="m8 2 1.88 1.88" /> <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />',
};
