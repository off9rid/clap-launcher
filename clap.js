// Double-clap listener: two sharp claps -> Terminal opens, runs `cd 2nd-brain` then `claude`.
const { spawn, execFile } = require('child_process');

const RATE = 16000;
const CHUNK = RATE / 50;          // 20ms windows
let THRESHOLD = 0.35;             // peak amplitude (0-1) that counts as a clap
let QUIET = 0.12;                 // the room must be quieter than this right before a clap
// While another app has the mic in echo-cancel mode (Cortex HUD, FaceTime, Meet), macOS runs every
// mic reader through the noise suppressor: claps arrive at ~0.07-0.6 instead of near 1, but the room
// reads as dead silent and speaker sound is cancelled out, so a lower bar is still safe (tested 10-04).
// 0.06 let desk thumps and coughs through (false launches 10-05), so the bar is now 0.12
const VP_THRESHOLD = 0.12, VP_QUIET = 0.04;
let vp = false;
const MIN_GAP = 150, MAX_GAP = 700; // ms between the two claps
const COOLDOWN = 20000;           // ms before it can fire again (4s let one noisy stretch open several Terminals)
const TYPING_GRACE = 1500;        // ms since last key/trackpad input during which claps are ignored
const PRE_QUIET = 300;            // ms of quiet required before the first clap
const POST_QUIET = 500;           // ms of quiet required after the second clap (music keeps going, you don't)
const DECAY = 250;                // ms a clap's own echo is allowed to ring (room reverb takes ~150-250ms to fade)

// clapmic (Swift) instead of sox `rec`: when another app takes the mic it switches to a multi-channel
// mode, and rec kept reading the old format (garbage, or no audio at all). clapmic rebuilds itself.
const rec = spawn(require('path').join(__dirname, 'clapmic'));
rec.stderr.on('data', d => process.stderr.write(d));

let clapPeak = 0, pendingPeaks = '';
const ts = () => new Date().toLocaleString();
let buf = Buffer.alloc(0), prevPeak = 0, prevPeak2 = 0, postChunks = 0, postLoud = 0, lastClap = 0, lastFire = 0, loudUntil = 0, lastLoud = 0, pending = 0;

rec.stdout.on('data', data => {
  lastData = Date.now();
  buf = Buffer.concat([buf, data]);
  while (buf.length >= CHUNK * 2) {
    const chunk = buf.subarray(0, CHUNK * 2); buf = buf.subarray(CHUNK * 2);
    let peak = 0;
    for (let i = 0; i < chunk.length; i += 2) peak = Math.max(peak, Math.abs(chunk.readInt16LE(i)) / 32768);
    const now = Date.now();
    if (process.env.DEBUG && peak > 0.05) console.log("peak", peak.toFixed(3), "prev", prevPeak.toFixed(3));
    // Double clap heard: wait for the room to stay quiet, since a song keeps playing after its beats
    // Echo fades, music doesn't: only reject if most of the window after the echo stays loud
    if (pending) {
      if (now - pending > DECAY) { postChunks++; if (peak > QUIET) postLoud++; }
      if (now - pending >= POST_QUIET) {
        if (postLoud > postChunks / 2) console.log(ts(), `ignored: sound kept going (music?) ${postLoud}/${postChunks} loud`);
        else { lastFire = now; fireUnlessBusy(); }
        pending = 0;
      }
    }
    // A clap is a sudden spike out of relative quiet (filters out music/talking).
    // Check two chunks back too, in case the clap's first millisecond landed at the end of the previous chunk.
    if (peak > THRESHOLD && Math.min(prevPeak, prevPeak2) < QUIET && now > loudUntil && !pending) {
      loudUntil = now + 100;
      const gap = now - lastClap;
      if (gap > MIN_GAP && gap < MAX_GAP && now - lastFire > COOLDOWN) {
        pendingPeaks = `${clapPeak.toFixed(2)} + ${peak.toFixed(2)}, ${gap}ms apart${vp ? ', echo-cancel' : ''}`;
        lastClap = 0; pending = now; postChunks = postLoud = 0;
      } else {
        if (lastClap && gap <= MIN_GAP) console.log(ts(), `near miss: claps ${gap}ms apart (too fast)`);
        else if (lastClap && gap < 1200 && gap >= MAX_GAP) console.log(ts(), `near miss: claps ${gap}ms apart (too slow)`);
        lastClap = now - lastLoud > PRE_QUIET ? now : 0; // first clap must come out of real silence
        clapPeak = peak;
      }
    }
    if (peak > QUIET) lastLoud = now;
    prevPeak2 = prevPeak; prevPeak = peak;
  }
});

// Skip if an app is playing sound (music beats can look like claps). An app that is ALSO using the mic
// is a call or a recording (e.g. him filming the clap in Google Vids), not music, so it doesn't count.
// Echo-cancel mode skips this: it already cancels speaker sound out of the mic.
// soundcheck lists "<pid> <in> <out> <name>" from Core Audio; pmset's audio-out couldn't tell these apart.
function fireUnlessBusy() {
  if (vp) return fireUnlessTyping();
  execFile(require('path').join(__dirname, 'soundcheck'), (err, out) => {
    const players = err ? [] : out.trim().split('\n').map(l => l.split(' ')).filter(([pid, i, o]) => o === '1' && i === '0' && +pid !== rec.pid);
    if (players.length) {
      console.log(ts(), `ignored: ${players.map(p => p.slice(3).join(' ')).join(', ')} playing audio`);
      lastFire = 0;
    } else fireUnlessTyping();
  });
}

// Keystrokes look just like claps to the mic, so skip if the keyboard/trackpad was used recently
function fireUnlessTyping() {
  execFile('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'], (err, out) => {
    const m = !err && out.match(/"HIDIdleTime" = (\d+)/);
    if (!m) {
      console.log(ts(), 'ignored: could not read input idle time', err ? err.message : '');
      lastFire = 0;
      return;
    }
    const idleMs = Number(m[1]) / 1e6;
    if (idleMs < TYPING_GRACE) {
      console.log(ts(), `ignored: input ${Math.round(idleMs)}ms ago (typing)`);
      lastFire = 0;
    } else fire();
  });
}

// Is another app using the mic in echo-cancel mode? (coreaudiod names its assertion after the VP aggregate device)
function checkVP() {
  execFile('/usr/bin/pmset', ['-g', 'assertions'], (err, out) => {
    const now = !err && /VPAUAggregate/.test(out);
    if (now === vp) return;
    vp = now;
    THRESHOLD = vp ? VP_THRESHOLD : 0.35; QUIET = vp ? VP_QUIET : 0.12;
    console.log(ts(), vp ? 'mic shared (echo-cancel mode): low clap threshold' : 'mic back to normal');
  });
}
setInterval(checkVP, 1500); checkVP();

function fire() {
  console.log(ts(), `double clap -> launching (claps ${pendingPeaks})`);
  if (process.env.DRYRUN) return;
  execFile('osascript', ['-e', `
    tell application "Terminal"
      if it is running then
        set w to do script "cd ~/2nd-brain"
      else
        -- a cold launch opens its own window; reuse it instead of making a second
        activate
        repeat until (count of windows) > 0
          delay 0.1
        end repeat
        set w to do script "cd ~/2nd-brain" in window 1
      end if
      activate
      delay 0.4
      do script "claude" in w
    end tell`]);
}

rec.on('exit', c => { console.error('clapmic exited', c); process.exit(1); });

// Watchdog: after the Mac sleeps, the mic reader can keep running but stop delivering audio (deaf, no error).
// Restart if audio stops flowing, or if the timer skipped ahead (the Mac just woke up).
// Exiting is enough: the launcher respawns node, and SIGKILL makes sure a hung clapmic doesn't linger.
const WATCH_EVERY = 2000, STALL = 5000;
let lastData = Date.now(), lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const why = now - lastTick > WATCH_EVERY * 5 ? `woke from sleep (${Math.round((now - lastTick) / 1000)}s gap)`
            : now - lastData > STALL ? `no audio for ${Math.round((now - lastData) / 1000)}s`
            : '';
  lastTick = now;
  if (!why) return;
  console.log(ts(), `restarting: ${why}`);
  rec.removeAllListeners('exit');
  rec.kill('SIGKILL');
  process.exit(1);
}, WATCH_EVERY);
console.log('Listening for a double clap...');
