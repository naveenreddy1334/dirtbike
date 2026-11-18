# VYORA Motocross (realistic, 2-player, cycle-controlled)

Three.js (WebGL) game. Pedal cadence = speed; steering, leaning and jumps are automatic.

## Just play (no install except Python)
1. Double-click `start.bat` (Windows) or run `./start.sh`. Opens http://localhost:8080 in Chrome/Edge.
   (Don't open index.html by double-click — browsers block file loading; it must be served.)
2. Click START. Keyboard: **P1 = W, P2 = ↑**, R restart, M mute.
3. Use Chrome/Edge with hardware acceleration on. Add `?q=low|medium|high|ultra` to the URL to force quality
   (e.g. http://localhost:8080/?q=medium). Default is auto-detected.

## Connect your real cycles (2 Hall sensors, 1 Arduino)
1. Flash `bridge/arduino_hall.ino`. Bike 1 sensor -> pin 2, bike 2 sensor -> pin 3 (+5V, GND). Each crank rotation prints a line:
   `1` = bike 1, `2` = bike 2 (9600 baud). Same protocol as your own sketch (this one adds debounce and safe counters).
2. The bridge turns pulses into cadence: RPM = 60 / seconds between two pulses (drops to 0 when you stop).
   Windows: edit the COM port in `start-bridge.bat` (Device Manager -> Ports), then double-click it.
   Mac: `python3 bridge/bridge.py --port /dev/tty.usbmodem14101` (find yours with `ls /dev/tty.usb*`).
   Test without hardware: `python bridge/bridge.py --sim`. More magnets per rotation: `--pulses-per-rev 2`.
3. Keep the bridge running, open the game: "BIKE LINK" appears bottom-right and live cadence replaces the keyboard.
   (To test with W / ↑ again, stop the bridge.) UDP JSON {"rpm":N,"player":0} on 127.0.0.1:5005 is also accepted.
Tuning: `src/config.js` -> `kmhPerRpm` (0.8), `maxKmh` (65), `laps`.

## Edit / rebuild (VS Code)
```
npm install
npm run build      # -> dist/   (node build.mjs)
npm start          # serve dist on :8080
```
Source is in `src/` (main.js boot, game.js race logic, bike.js model, veg.js trees/grass, world.js terrain+track,
post.js post-processing, shaderlib.js shaders). `tools/*.py` regenerate the terrain/sky assets (optional; needs numpy, opencv, scipy).
Assets: Poly Haven / ambientCG (CC0), ez-tree (MIT), Three.js (MIT).
