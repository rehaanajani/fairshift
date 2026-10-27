# Accessibility

FairShift is built for workers who may read little, speak one of many Indian languages, and use a basic phone.

- **No reading or typing required:** one hold-to-talk button; answers are spoken (Cloud Text-to-Speech, or the phone's voice); hazards can be reported with just a photo.
- **16 languages, end to end:** interface, pay explanations, fatigue warnings and error messages, each tested for completeness (`test/i18n.test.ts`); Urdu switches to right-to-left layout.
- **Icons with every label**, large 44 px+ touch targets and a bottom tab bar reachable by thumb.
- **Contrast:** WCAG AA text contrast in both Light and Dark themes (Light / Dark / Auto toggle, remembered per device).
- **Keyboard and screen readers:** visible focus rings; skip links that move focus to the main content without leaving the page; dialogs trap focus, close on Escape and restore focus; every control has a label; live regions (`aria-live`) announce replies, alerts and results; the talk button works with Space or Enter.
- **Motion:** animations are switched off for people who prefer reduced motion.
- **Low-end phones:** about 116 KB of compressed JavaScript; photos are shrunk on the phone before upload.
- **No smartphone at all:** a supervisor can check the whole crew in and out; each worker still gets their own receipt.
