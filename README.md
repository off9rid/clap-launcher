# Clap Launcher

**Double-clap and your terminal opens with Claude Code already running.** A tiny always-on listener for macOS that hears two sharp claps, opens Terminal, `cd`s into your project and starts `claude`.

It is tuned to not fire by accident: it wants quiet before the first clap and after the second, ignores claps while you are typing, gives room echo time to fade, has a cooldown, and adapts when a call or another app puts the mic into echo-cancel mode.

## Files

- `clap.js`: the listener (Node). Clap detection, the quiet/typing/cooldown rules, and the AppleScript that opens Terminal.
- `clapmic.swift`: mic reader. Streams raw 16 kHz mono audio to `clap.js` and rebuilds itself when another app (FaceTime, Meet) switches the mic format, which broke `sox rec`.
- `soundcheck.swift`: lists which apps are using the mic and speakers, so music playing is told apart from a call.

## Setup

macOS, Node 18+, Xcode command line tools.

```bash
git clone https://github.com/off9rid/clap-launcher.git && cd clap-launcher
swiftc -O clapmic.swift -o clapmic
swiftc -O soundcheck.swift -o soundcheck
node clap.js
```

Allow **Microphone** access when asked. To open a different folder, change the two `cd ~/2nd-brain` lines in `clap.js`. Thresholds (`THRESHOLD`, `QUIET`, gaps, cooldown) are at the top of the file.

To run it at login, point a LaunchAgent at `node /path/to/clap.js` (a small app wrapper keeps the mic permission stable).

Built by [@off9rid](https://github.com/off9rid). As seen on [@amirbuildsai](https://instagram.com/amirbuildsai).
