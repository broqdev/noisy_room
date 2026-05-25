/goal $noisy:tmd --new create a task doc for the following goal. then looping $noisy:tmd --continue until task goal achieved
```
## Goal
Port Shattered Pixel Dungeon to the web with TeaVM/gdx-teavm, make it playable in browser, and produce an itch.io-ready release zip.

## Steps
1. Clone `https://github.com/00-Evan/shattered-pixel-dungeon` and inspect the desktop/libGDX structure.
2. Add a `web` Gradle module using TeaVM/gdx-teavm, with dev, serve, release, and release-zip tasks.
3. Add a browser launcher, web platform support, asset copying, save persistence, and an HTML page that starts directly at the game welcome screen.
4. Fix web parity issues found during smoke testing: input/focus, audio startup, WebGL rendering, save/reload, stair transitions, notes icons, and special-room visuals.
5. Add web parity logging for dev builds only; ensure release builds strip debug logs/maps and stay under itch.io’s file-count limit.
6. Smoke-test the browser build through early gameplay, level transitions, reloads, notes, and special rooms; then build the final release zip.
```