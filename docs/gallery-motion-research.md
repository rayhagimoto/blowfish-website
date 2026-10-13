# Gallery loading motion research

Research date: 2026-10-13. Scope: the local gallery experiment, without changing its implementation. Recommendations below are design judgments to test, not an industry standard for photography galleries.

## Observed behavior before the restrained experiment

`assets/gallery-overhaul/gallery.css` slides each photograph upward by its full height inside a stationary clipped frame over 1200ms. The containing link fades over 1500ms, an 8px blur clears over 1500ms, and a background-colored bottom gradient waits 1000ms before fading over 500ms. `gallery.js` independently reveals each card after its responsive preview is decoded and intersects the viewport. Preview requests start up to 400px below the viewport; constrained connections skip that buffer. Reserved aspect ratios prevent layout shifts.

## Why the experiment can feel unpolished

- **Too much travel for a loading cue.** The movement now reads like a photograph being pushed into a frame, rather than content quietly becoming available. A portrait moves farther than a landscape in the same 1200ms. CSS vertical translation percentages are relative to the transformed reference box's height, so this difference follows directly from `translateY(100%)`. [CSS Transforms specification](https://www.w3.org/TR/css-transforms-1/#transform-functions)
- **Several different endings.** The slide ends at 1200ms while opacity and blur continue until 1500ms. The gradient starts a second change near the end of the slide. My assessment: the eye notices the photograph arriving, sharpening, and brightening as separate events, rather than one settled reveal.
- **The photo remains visually unavailable after loading.** The preview has already decoded when the animation starts. Blur, partial opacity, clipping, and the gradient then obscure that ready photograph for another 1.5 seconds. My assessment: this resembles continued loading even though there is no further preview-quality download. A blur is not evidence that a higher-resolution version is pending.
- **Network order becomes choreography.** Each card starts independently when ready. Different completion times can produce a scattered pattern across the masonry grid. Adding a long stagger on top would increase waiting, especially for later cards.
- **The gradient is a colored cover, not a transparency mask.** It approximates fading into the page only where its color matches the actual background. While the image moves underneath the stationary gradient, details change brightness as well as position. This is a plausible visual contributor, not a measured rendering defect.

## What primary sources actually say

- Apple recommends purposeful motion that supports rather than overshadows the experience, and brief, precise feedback that does not make people wait to enjoy content. This supports a quieter loading treatment; Apple does not prescribe a photography-grid duration. [Apple Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- Fluent recommends quick, natural durations based on element size and travel distance. Its choreography guidance recommends short stagger offsets and accounting for the total sequence duration. It also supports synchronized grouping where prominence is unnecessary. These principles favor bounded choreography rather than delays proportional to every item's album index. [Fluent 2: Motion](https://fluent2.microsoft.design/motion)
- Google's older Material guidance ties duration to distance and velocity, warns against slow transitions, and documents a deceleration entry curve, `cubic-bezier(0, 0, 0.2, 1)`. Its historical desktop timing examples are not a universal rule or a current photography standard. Current Material 3 introduced a spring-based motion system in May 2025 that replaces the previous easing/duration system; this does not mean a photography gallery needs springs or bounce. [Historical Material: Duration and easing](https://m1.material.io/motion/duration-easing.html), [Current Material 3: Motion physics](https://m3.material.io/styles/motion/overview/how-it-works)
- Google recommends favoring `transform` and `opacity` and profiling other effects. Blur can require more expensive painting. That is a performance risk to measure, not proof this particular `filter` animation drops frames on every browser. [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide)
- Browser-level lazy-loading guidance recommends eager loading initial-viewport images and reserving image dimensions. Preserve the existing dimension reservation and selective offscreen loading; initial discovery delay should be assessed separately from visual polish. [web.dev: Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)
- W3C describes disabling nonessential interaction-triggered motion, including scroll-related examples, and identifies reduced-motion media queries as a sufficient technique. Retain the existing reduced-motion behavior. [W3C: Animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## Local browser observations

Measured in desktop Chrome at a 1440 × 1000 viewport with preview responses held, then released. Times start when the first card receives its reveal class, after decoding. Its displayed image height was 496px. These are samples from one run, not a frame-rate benchmark or a user study.

| Time after reveal | Vertical displacement remaining | Link opacity | Image blur | Gradient layer opacity |
| --- | ---: | ---: | ---: | ---: |
| 308ms | 308px | 0.31 | 5.53px | 1.00 |
| 608ms | 156px | 0.57 | 3.43px | 1.00 |
| 1008ms | 22px | 0.84 | 1.25px | 1.00 |
| 1208ms | 0px | 0.94 | 0.50px | 0.43 |
| 1524ms | 0px | 1.00 | none | 0.00 |

This confirms that a downloaded, decoded image remains substantially displaced and obscured more than half a second into the entrance. It does not establish that rendering performance is poor. The aesthetic diagnosis is that the effect competes with viewing the photograph.

## Recommended experiment

Start with a single restrained reveal: fade from transparent while moving upward **12–20px**, over **450–600ms**, with deceleration easing. Remove the gradient and blur first. These numbers are a proposed starting range for this gallery, not consensus values; compare them visually with fade-only. Use the same short displacement regardless of aspect ratio. Keep the photo frame and masonry position stationary.

If desired after that comparison, test a very light **1–2px blur** clearing early, within roughly **200–300ms**. It should not keep an already-loaded photograph looking soft until the rest of the reveal finishes. Prefer no blur if it adds little or causes frame drops.

For multiple cards ready together, order them by visual position and stagger by approximately **40–70ms**, capped at **120–180ms total additional delay**. Schedule only ready, visible cards; never wait for a missing/slow preview to release others. Late arrivals get their own immediate reveal. Later scroll reveals can use the same treatment with little or no stagger, because scrolling already supplies motion.

Keep responsive previews, decode-before-reveal, limited lookahead, one-time reveals, reserved dimensions, and reduced-motion support. Check cold and cached loads, mixed portrait/landscape rows, fast scrolling, mobile, light/dark backgrounds, and reduced motion. Use a browser performance recording before claiming any blur-induced stutter. The criterion is that photos become readable promptly, with coherent motion that does not compete with their composition.

## Implementation after local comparison

The local gallery now uses a 16px rise and fade over 1200ms with `cubic-bezier(.22, 1, .36, 1)`, without reveal blur or a bottom gradient. Ready, visible previews are collected for one animation frame and ordered by their position, with 50ms stagger offsets capped at 100ms. A late preview gets its own immediate reveal instead of blocking others. Reduced motion skips movement, transitions, and stagger delays. The initial 550ms trial was increased to 1200ms after visual comparison at the user’s request.
