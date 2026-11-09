---
version: 1
slug: "src-app-app-ts"
primary_target: "src/app/app.ts"
related_targets: []
---

# Darkroom: the second showcase app (examples/darkroom)

## Scope and mode

Experience. A phone-sized Lynx app shown live on the landing page (second tab, after Facet) beside its source, in the docs' Showcase section, and run on iOS and Android. The visitor is a web developer judging whether Angular on Lynx can do real GPU image processing.

## Audience, job, proof, constraints

- Job: drag the before/after line, try a few stocks and a slider, watch the photo develop at frame rate, then open the source and see plain Angular.
- Proof: WebGL2 shaders in a `<canvas>` (ANGLE/Metal on iOS), one canvas developing a whole test strip of stocks at once, gestures, LynxImagePicker, canvas.toBlob() + LynxShare (export a full-size JPEG to the share sheet / Photos), LynxLocalStorage, custom fonts.
- Constraints: CC0 photos only, credited; invented stock names; Lynx Explorer has no canvas (show the photo plain and say why); no `:hover`, `@media`, pseudo-elements; semantic Tailwind colors or explicit rgba.

## Direction contract

THESIS: Darkroom is a proof sheet you mark up. The roll is printed as strips of frames on black film, the chosen frame is enlarged and develops live, and every decision is a red china-marker mark on the sheet. It refuses the category's near-black editor with thin white sliders and a filter-thumbnail tray.

OWN-WORLD: White proof paper (#f4f3f0) as ground, film-base black (#0b0b0b) for every strip and the enlargement's rebate, edge print in pale gray monospace (frame numbers, arrows, codes, values) along the black, and one red: the china marker (#d8282f), which carries every selection, the before/after line, the readout and the Print action, nothing else. Display voices: Permanent Marker for marks and the readout, Share Tech Mono for edge print; body in the system sans. Frames are hard-edged rectangles with sprocket holes; no rounded corners, no cards, no shadows except the loupe's.

STORY: The visitor sees a night street half developed, the red line splitting before from after; drags it; taps a frame on the test strip and the whole strip and the enlargement re-develop together; scrubs a film-edge ruler; prints to the share sheet; opens the source.

FIRST VIEWPORT: Header on paper: wordmark DARKROOM in edge print with the roll's code, actions LOAD, KEEP and PRINT (PRINT circled in marker). The enlargement, full width on black rebate with sprocket holes and edge print above and below, the photo fitted in it, the red split line with its grab ring at 50%. The roll: a strip of the seven photos as positives on black, frame numbers under each, the current one circled in red. The test strip: one canvas showing the current photo developed in every stock, names in edge print, the chosen stock circled. Then the control names written along the paper and one film-edge ruler that scrubs the chosen control, its value in red marker.

FORM: The Contact Sheet: proof sheets marked with a red grease pencil under a loupe (my top-ranked grounded candidate, chosen by the user as the pick card over the assigned Calibration Target). seed:0db038509b354fbb

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Signature interaction and motion grammar

- Signature: dragging the red split line across the enlargement shows before and after, under the finger, every frame (a pan gesture; the shader takes the line as a uniform).
- Marking: choosing a frame or a stock moves the red ring onto it: it scales in from 1.15 with a slight turn and fades up, 240ms ease-out, as if drawn.
- Scrub: the ruler's ticks slide under a fixed red index; release settles on the nearest tick, 160ms.
- Reduced motion: the ring appears without scaling; the ruler snaps.

## Unresolved

- Whether to add `.test.ts` specs for curves.ts and settings.ts.
