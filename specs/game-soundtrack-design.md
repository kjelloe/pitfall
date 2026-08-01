# Pitfall: Drop-Zone — Soundtrack Design Spec

*For the human composer. Written 2026-08-01. Companion to `v1-plan.md`
(game design) — this spec covers music only; retro blip SFX (move/coin/
hit) stay code-generated per the original design doc and are NOT commissioned
here, except the short stingers listed below.*

## The game in 30 seconds

Up to 16 players fall together down an endless neon shaft, hopping on a 7×7
grid to dodge walls and spikes and grab coins and gems. Flat-shaded low-poly
3D, dark background, bright neon palette (cyan `#2bfcff`, magenta `#ff3df0`,
yellow `#ffe93d`), CRT scanline overlay. Every 10 layers is a level; the
fall gets faster and denser until death is certain. Death drops you to a
hall-of-fame screen; you can always drop back in. Runs are short and
intense: reaching level 50 takes about **4 minutes** of continuous play.

**Aesthetic north star: neon-retro synthwave with chiptune blood.**
Analog-style saw/square leads, arpeggiators, FM bells, gated-reverb snares,
side-chained pump. Think outrun/darksynth, not orchestral, nothing acoustic.
The music should feel like the visuals look: bright shapes on black.

## How music maps to the game

The game has three states (title/join → falling → death board) plus a level
counter. Zones change every 10 levels, and the **level rings the player
falls through already cycle five neon colors** — the five zone tracks are
those colors as sound. Tracks crossfade (~1.5 s) at zone boundaries, so all
zone tracks should be **harmonically compatible** (same key or close
neighbors — e.g. all built around A minor / C major family) and keep a
steady internal BPM for clean looping.

Real dwell times per zone (from the fall-speed ramp, `shared/const.mjs`):

| Zone | Levels | Fall speed | Time spent falling through it |
|---|---|---|---|
| Z1 | 1–10 | 0.8 → 1.6 layers/s | ~87 s |
| Z2 | 11–20 | 1.7 → 2.5 | ~48 s |
| Z3 | 21–30 | 2.6 → 3.2 (cap) | ~34 s |
| Z4 | 31–40 | 3.2 (capped) | ~31 s |
| Z5 | 41–50 | 3.2 | ~31 s |

Beyond level 50 the zone cycle repeats (Z1 → Z2 → …) with the game already
at maximum speed — the "second lap" through the calm Z1 track over a
maxed-out pit is an intentional contrast moment.

## Track list

### Loops

| # | Track | Where it plays | Loop length | BPM | Mood / theme |
|---|---|---|---|---|---|
| 1 | **DROP-IN (title)** | Join screen + quick-start overlay, before the run starts | 60–90 s | ~100 | The invitation. Warm, hooky mid-tempo synthwave; neon sign buzzing over a dark street. Confident, not tense — this screen is where friends type their names. Should contain the game's main melodic motif (see below) |
| 2 | **Z1 — GOLD RIM** (yellow rings, levels 1–10) | First ~90 s of every run | 80–90 s | ~110 | Sunny-side arcade. Playful, bouncy, coin-bright FM bells; the pit still feels like a game. Introduces the motif in its cleanest form |
| 3 | **Z2 — CYAN DEPTHS** (cyan rings, 11–20) | ~48 s | 45–60 s | ~120 | The water line. Cooler, hypnotic; rolling arpeggios, wider stereo, a little pressure in the low end. The fun is getting serious |
| 4 | **Z3 — MAGENTA STATIC** (magenta rings, 21–30) | ~34 s | 40–50 s | ~128 | Darksynth kicks in. Distorted bass, urgent 16th-note drive, alarm-like stabs. First zone at max fall speed — the player is now surviving, not sightseeing |
| 5 | **Z4 — GREEN ABYSS** (green rings, 31–40) | ~31 s | 40–50 s | ~136 | Acid pit. Squelchy 303-style line, relentless drums, dissonant edges. Claustrophobic |
| 6 | **Z5 — EMBER CORE** (orange rings, 41–50) | ~31 s | 40–50 s | ~144 | Peak intensity, the furnace floor. Everything at once but still musical; a triumphant edge — anyone hearing this track is having a great run |
| 7 | **HALL OF FAME** | Death screen / leaderboard | 30–45 s | ~85 | Somber but cool afterglow; the motif slowed and spaced out, tape-warble nostalgia. Should make "DROP BACK IN" feel inevitable, not defeated |

**The motif:** one short (2–4 bar) melodic identity that appears in the
title track, opens Z1, resurfaces mutated in deeper zones, and closes slowed
down in HALL OF FAME. This is what players hum afterwards.

### Stingers (one-shots, layered over whatever loop is playing)

| # | Stinger | Trigger | Length | Notes |
|---|---|---|---|---|
| S1 | Level-up | Crossing a level ring | 0.5–1.5 s | Rising neon whoosh + bell; must layer cleanly over every zone track (motif-neutral, percussive) |
| S2 | Death | Player loses last life | 2–3 s | Descending tone per the original design doc, but produced — the classic "power-down" reimagined in synthwave. Ducks the zone music, hands off into HALL OF FAME |
| S3 | Pit reset | "THE PIT RESETS" (new run after everyone died) | 2–4 s | Riser / rewind — the shaft winding back up |
| S4 | New high score | Death entry lands in the top list | 3–5 s | Small fanfare, plays over HALL OF FAME without fighting it |

## Delivery requirements

- **Masters:** WAV, 44.1 kHz / 24-bit, stereo. Loops delivered
  **pre-trimmed for seamless looping** (no reverb tail past the loop point —
  bake the tail into the loop start). Please verify each loop by playing it
  3× back-to-back.
- We encode to OGG Vorbis + AAC/M4A (Safari) ourselves; whole-soundtrack
  budget over the wire is ~8–10 MB, which the lengths above fit comfortably.
- **Loudness:** loops at **−16 LUFS** integrated, stingers up to −12 LUFS,
  true peak ≤ −1.0 dBTP everywhere. Consistency between zone tracks matters
  more than absolute level (they crossfade mid-play).
- **Tempo/key sheet:** a one-line text note per track (BPM, key, bar count)
  so the integration can beat-align crossfades later if we want to.
- **Nice-to-have (only if the workflow makes it cheap):** stem bounces per
  zone track (drums / bass / music) — a future version may add intensity
  layers within a zone as the fall speed ramps. Not required for v1.

## Priority order

| Priority | Tracks | Rationale |
|---|---|---|
| **P0** | 1 DROP-IN, 2 Z1, 7 HALL OF FAME, S2 death | A complete session loop for most players (join → fall → die → board) — shippable on its own |
| **P1** | 3 Z2, 4 Z3, S1 level-up, S3 reset | Covers everything a good player hears in a typical run |
| **P2** | 5 Z4, 6 Z5, S4 high score, stems | Deep-run rewards and polish |

## Integration notes (our side, not the composer's)

- Browsers block autoplay: music starts on the first user gesture — the
  DROP IN tap. The title track therefore begins *after* the join click on a
  player's very first visit; on revisits it can start from any interaction
  with the join screen.
- Zone crossfades (~1.5 s) trigger on the levelup event; death sting ducks
  music −12 dB then HALL OF FAME fades in; S3 plays on the reset event.
- **REQUIRED (user ruling 2026-08-01): a music ON/OFF toggle for players**,
  in the HUD next to the camera button — default ON, choice persisted in
  localStorage, and it must ship in the same release as the first music
  integration. (A separate SFX toggle arrives with the blip SFX.)
- Audio playback code (WebAudio, dual-format loading, crossfades) is a
  separate implementation task tracked in the roadmap — tracks can be
  delivered and integrated incrementally in priority order.
- A shareable HTML render of this spec for the composer lives at
  `specs/game-soundtrack-design.html` — keep both files in sync.
