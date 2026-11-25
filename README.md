# Warga Games

The games of [Arked Warga](https://nullifye.github.io/arcade/), the game hub in UiTM's
AppsWarga app (hub repo: `nullifye/arcade`). Static site on GitHub Pages, no build step.

| Game | Path | Live |
|---|---|---|
| Teka Kata (cryptogram) | [`teka-kata/`](teka-kata/) | https://nullifye.github.io/warga-games/teka-kata/ |
| Ular (snake) | [`ular/`](ular/) | https://nullifye.github.io/warga-games/ular/ |
| Duga Kata (5-letter word guess) | [`duga-kata/`](duga-kata/) | https://nullifye.github.io/warga-games/duga-kata/ |
| Kejar Lapan (3D voxel runner) | [`kejar-lapan/`](kejar-lapan/) | https://nullifye.github.io/warga-games/kejar-lapan/ |
| 2048 (number merge) | [`2048/`](2048/) | https://nullifye.github.io/warga-games/2048/ |
| Susun Blok (block puzzle) | [`blok/`](blok/) | https://nullifye.github.io/warga-games/blok/ |
| Memori (memory pairs) | [`memori/`](memori/) | https://nullifye.github.io/warga-games/memori/ |
| Congkak (3D, against the AI) | [`congkak/`](congkak/) | https://nullifye.github.io/warga-games/congkak/ |
| 9-Ball (pool, against the AI or a friend) | [`9balls/`](9balls/) | https://nullifye.github.io/warga-games/9balls/ |

The site root redirects to the hub. Each game shows its version at the bottom of its home
screen (tap it for a fresh reload); bump it when the game changes.

## Run locally

```sh
npm run serve   # http://localhost:8080/warga-games/ular/  (the hub at /arcade/ from ../arked)
npm test        # node --test on tests/*.test.mjs and every game's */tests/*.test.mjs
node tools/preload.mjs   # after changing a game's imports, stylesheets or scripts
```

## Shared code (`shared/`)

One copy for every game; games import it from `../shared/` (or `../../shared/` from `js/`).

| File | What |
|---|---|
| `appswarga.js` | AppsWarga bridge: theme, close button, `ready`, haptic, share, user-type lock |
| `shared-store.js` | Profile and progress shared with the hub, across hosts (AppsWarga bridge storage). Keep identical to the hub's copy |
| `arked-link.js` | `?dari=arked`: the ‹ back-to-Arked button, and share links without it |
| `profile.js` | The profile chip and dialog (shared `arked.profile`) |
| `leaderboard.js` | `arked_record` / `arked_top` / `arked_campus_rank` and the board lists |
| `rng.js` | Seeded PRNG, shuffle and Malaysia-time dates, for daily puzzles everyone shares |
| `base.css` | Tokens, buttons, header, top bar, leaderboard, dialogs, dropdown, toast |
| `select.js`, `profile-options.js`, `config.js`, `uuid.js`, `reload.js` | Dropdown, user types and campuses, Supabase settings, ids, fresh reload |
| `puzzle-page.js`, `puzzle-page.css` | The one page shell behind 2048, Susun Blok and Memori (each page sets `<html data-game>`) |
| `puzzle-engines.js` | Their rules: `Game2048`, `BlockGame`, `MemoryGame` (unit-tested in `tests/`) |
| `puzzle-sound.js`, `memory-icons.js` | Their synthesised sound effects, and Memori's card pictures |

The hub keeps its own copies of `appswarga.js`, `select.js`, `profile-options.js`,
`config.js` and `shared-store.js`; change both when they change.

## Conventions every game follows

- **Screens and history.** Each game routes on the URL hash (`#/main`, `#/tamat`, `#/papan`…).
  A screen above home is pushed, so the phone's Back returns home; going home steps back
  instead of pushing, and the result screen replaces the game screen. So no game entry is left
  under home, and ‹ back to Arked never passes through (or flashes) the game screen. Use the
  game's `go()` helper rather than setting `location.hash`.
- **Leaving mid-round** with points ends the round and records it; with no points it is dropped.
- **Settings** use the same switches and words everywhere: **Bunyi** ("Kesan bunyi" / "Senyap")
  and **Butang arah** ("Butang arah di skrin" / "Leret sahaja").
- **Help** (Cara Bermain) is a short numbered list.
- **Reduced motion** turns animations off.
- **Fast start.** The home screen is visible in the HTML (not waiting for the script), and each
  page lists its modules as `<link rel="modulepreload">` so they download together instead of one
  import level at a time. `tools/preload.mjs` writes those lists and `preload.json` (each game's
  files, which the hub fetches into the cache while idle); `npm test` fails if either is stale.
- **Theme.** `shared/theme-boot.js` applies the last AppsWarga theme before the first paint, and
  `ready` waits for the theme, so pages never flash the default colours inside AppsWarga.

## Adding a game

1. Make a folder (e.g. `kuiz/`) with `index.html` linking `../shared/base.css`; see `ular/` for
   the profile chip, dialog, ‹ button and board markup. A simple puzzle can reuse the puzzle
   shell instead: copy `2048/index.html`, set `data-game`, and add its rules and config.
2. In its script: `initFromArked()`, `initAppsWarga()`, `initProfile()`; write
   `arked.game.<id>` when a round starts; send each round with `recordRound()`; show boards
   with `topPlayers()` / `topCampuses()`.
3. Supabase (hub repo `supabase/arked.sql`): add the game to `arked_games` with its point bounds,
   explaining in a comment how they follow from the rules.
4. Hub: add it to `js/games.js` with `url: 'https://nullifye.github.io/warga-games/<folder>/'`
   and an icon in `icons/<id>.svg`.

[`docs/arcade-integration.md`](docs/arcade-integration.md) records the hub and leaderboard setup
for 2048, Susun Blok and Memori.

## Score limits

`arked_record` rejects a round above `max_points`, or above `max_points_per_sec` × its seconds.
The hub's `supabase/arked.sql` explains each limit; keep it in step with any scoring change.

| Game | Max points | Max per second |
|---|---|---|
| Teka Kata | 6,000 | 6,000 |
| Ular | 6,000 | 75 |
| Duga Kata | 2,000 | 1,400 |
| Kejar Lapan | 100,000 | 300 |
| 2048 | 100,000 | 500 |
| Susun Blok | 100,000 | 200 |
| Memori | 100,000 | 500 |
| Congkak | 1,000 | 60 |
| 9-Ball | 2,000 | 400 |

## Teka Kata

- A cryptogram: every letter of a phrase is a number, and the same letter always has the same
  number. Some letters start revealed; tap a blank and type a letter, and ◀ ▶ move between blanks.
- 133 phrases in three categories (UiTM, Malaysia, Peribahasa), in `teka-kata/js/phrases.js`.
- **Cabaran Harian**: the same phrase for everyone, new at midnight Malaysia time, walking a
  fixed shuffle so phrases don't repeat until the list is used up. Its clock keeps running if you
  leave. **Main Bebas**: random phrases, avoiding ones already solved on this device.
- Three mistakes end the round. Score: 50 a hidden letter plus 10 a second saved under
  8 seconds a letter, × 100 / 70 / 40 % for 0 / 1 / 2 mistakes.
- Rules in `teka-kata/js/game.js`, score in `score.js` (both unit-tested).

## Ular

- 20×20 board; the snake speeds up from 140 ms to 75 ms a step as it eats.
- **Dinding** on: hitting the edge ends the game, 15 points a food. Off: the snake wraps
  around, 10 points a food. Hitting itself always ends it.
- **Butang arah** (on-screen D-pad) on or off; swiping on the board and arrow keys / WASD always work.
- Pauses when the page is hidden or AppsWarga goes to the background.
- Rules in `ular/js/snake.js` (unit-tested); every round with points goes to `arked_record`.

## Duga Kata

- Guess a 5-letter Malay word in 6 tries. Each guess is marked tile by tile: **hijau** (right
  letter, right place), **kuning** (in the word, elsewhere), **kelabu** (not in the word).
  Repeated letters are marked only as often as the answer has them.
- **Cabaran Harian**: the same word for everyone, new at midnight Malaysia time (`dk.daily`
  resumes it after a reload; the clock keeps running). **Main Bebas**: random words, no limit.
- A guess must be in `duga-kata/js/words.js` (`ANSWERS` + `GUESSES`); a word not in the lists
  shakes the row and doesn't use a try. **The lists are a hand-written draft: have them reviewed
  before launch.** Changing `ANSWERS` reshuffles which word falls on which day.
- Score: 1,000 / 800 / 600 / 450 / 300 / 200 for a win in 1–6 guesses, plus 2 a second under
  3 minutes; a loss is 0 and still counts as a play. Every round goes to `arked_record`.
- Rules in `duga-kata/js/logic.js`, score in `score.js` (both unit-tested).

## Kejar Lapan

A three-lane voxel runner through UiTM Shah Alam (Three.js 0.170.0, vendored in
`kejar-lapan/vendor/` with its licence; no CDN, no build step).

**Play**

- The campus clock runs from 07:55 to 8:00. After the starting gate (Pintu Utama), fourteen
  campus landmarks repeat as checkpoints that add time: +16 s, one less each time, at least
  +8 s. Crash or reach 8:00 and the run ends.
- Lompat (jump) kon, lubang, monyet; tunduk (slide) under palang; go round bas and kereta.
  Swipe, arrow keys / WASD / Space, or the on-screen buttons (**Butang arah**).
- Items: points (+25), boost (5 s, smashes obstacles), shield (10 active seconds or one hit;
  refreshes on pickup, blinks and fades in its last 3 seconds), jam (+5 s). Every 12 obstacle
  rows, one guaranteed +5 s clock appears in a seeded lane with a 60 m gap to steer in and out,
  even while boosted; missing it grants nothing. A clock-seeking test player clears 12 km on all
  30 audited endless seeds; ignoring clocks runs out of time first.
- The character comes from the profile (Pelajar, Staf, Alumni, Awam) and can be switched;
  items only change look.
- Score: a point a metre, plus items, plus 200 a checkpoint; every run with points goes to
  `arked_record`. Distance shows in m, then km.

**Modes**

- **Harian** (default): Pelajar, Staf, Alumni and Awam each get a different daily destination.
  Each day picks four neighbouring checkpoints from PTAR onwards (1.44–7.84 km) and shuffles them
  between the roles, so the longest route that day is at most about twice the shortest.
  Destinations and seeded courses stay fixed for that user type all day and refresh at midnight
  Malaysia time. Arrive before 8:00 to win; the finish awards checkpoint points but no extra
  time. Saved Tepat Masa selections open Harian.
- **Larian Jauh**: run as far as possible on a random course; no destination or distance cap.
- **Bayang rekod**: an optional translucent replay of the best attempt on the same route, stored
  on this device (the latest daily record for each user type). Finished runs rank by fastest
  finish, unfinished ones by furthest distance, then score. The ghost replays sparse inputs at
  fixed simulation ticks, doesn't advance while paused, and can't collide or take items.
- Course identities are versioned in `js/modes.js` (now `kl-8`); bump `COURSE_VERSION` after
  physics, tuning or generation changes, which retires older ghosts. Leaderboards add up all modes.

**Almari Gaya (wardrobe)**

- Eighteen milestone rewards on this device, shared by all roles and modes: backpacks, outfits,
  trails and accessories, one per body position (head, face, body, back, hand, foot effects),
  or the original look. Milestones live in `js/cosmetics.js`:
  - single-run distance: 5 km (glasses), 10 km (stars trail), 12 km (robe);
  - completed games: 100 / 150 / 300 / 500; successful arrivals: 50 / 100;
  - active play time: 60 / 120 / 240 minutes; plus cumulative distance, checkpoints and items.
- New players start with all 18 locked; a locked card shows a question mark and its progress.
  Totals for games, distance, minutes, checkpoints, arrivals and pickups are shown; completed runs
  record simulation seconds, so pauses, menus and background time don't count.
- Cosmetics only reach the renderer: speed, jumps, collisions, power-ups, scores and replays are
  unchanged. Headwear replaces default hats, the wand replaces handheld props, and katanas share
  the back slot with bags. The rotating preview and the 48 px cards use the same models as the
  game (one shared thumbnail renderer); trails use the same mesh emitter; reduced motion hides
  effects.
- A hidden rotation code (left, right, right, left, left, left, right within ten seconds)
  unlocks every cosmetic for this page session only, without touching stats or scores.
  `COSMETICS_TEST_UNLOCK` stays `false`.

**Sharing**

- **Kongsi** exports a 1080×1350 PNG card of the run (player, equipped avatar in an action pose,
  outcome, mode, campus clock, score, distance, time, checkpoints); the avatar card's share icon
  exports the player's totals without a run. Inside AppsWarga the native `share` handler gets a
  pre-encoded PNG; elsewhere Web Share files or a PNG download. Footers show the player's
  campus (omitted for public or non-UiTM profiles). `js/share-card.js` owns rendering and delivery.

**Sound and screen**

- Each of the nine scenery types has an original 90-second retro score (64–160 BPM) that loops
  and crossfades, follows **Bunyi**, and stops on pause, results or navigation. Boost plays it at
  1.35× with pitch preserved; the shield adds a short room reverb (only connected while
  shielded). Tracks are 72 kbps MP3s (about 0.7 MB each); only the current area's loads. Listen
  at [`kejar-lapan/music.html`](kejar-lapan/music.html); regenerate with
  `python3 tools/compose-kejar-music.py` (NumPy and FFmpeg).
- The HUD, controls and overlays respect browser safe areas and AppsWarga's inset variables
  (including the legacy `--appswarga-safe-top`), combined with `max()`; the 3D scene stays edge
  to edge. Buttons fire once on touch release without the delayed compatibility click.

**Code**

- `js/sim.js` (fixed 60 Hz steps, swept collision) and `js/course.js` (seeded rows that always
  leave a way through) are pure and unit-tested, including a bot that clears 4 km of 30 courses.
  `js/render.js` draws the sim's state with merged voxel models and pools, so memory stays flat.
- Tuning lives in `js/config.js`. `?debug` exposes `window.__kl` for browser tests.

## 2048

- Slide all tiles with a swipe, the arrow keys or the on-screen D-pad (**Butang arah**, placed
  like Ular's). Equal tiles merge, adding the new tile's value to the score; each move adds a 2
  (90 %) or a 4. Reach 2048, then keep going or press ‹ to save. The round ends when no move is
  left.
- The header shows the score and the time played; the move count sits above the board.
- Tiles slide, merges pop, and new tiles zoom in from their own cell. Sounds: a swoosh on slides,
  merge blips that rise in pitch with the tile, a fanfare at 2048, a game-over tune.

## Susun Blok

- An 8×8 board and three pieces at a time (no rotation). Drag a piece onto the board, or select
  it and tap a cell (that cell becomes the piece's top-left square). While dragging or hovering,
  the landing cells show green (fits) or red (doesn't), and lines it would clear get a gold ring.
- Score: 1 a cell, 10 a cleared row or column, +10 for each extra line cleared at once, and a
  combo bonus of +5 per earlier clear in a streak of clearing placements (at most +50). A greedy
  player averages about 7 points a placement (tested under 20).
- Full lines flash gold and sweep away while their cells stay; placed blocks pop in. Pieces with
  no room anywhere fade out. With no room left, the board shakes and dims ("Tiada ruang lagi!")
  before the result. Sounds for picking, placing, clearing (longer and higher with combos), a
  failed drop and game over, with a **Bunyi** switch.

## Memori

- Turn two cards to find a pair; clear every pair to go up a level. Level 1 has 4 pairs and one
  more each level, up to 12 pairs (24 cards) at level 9; after that the cards stay at 24 and the
  time limit shrinks by 2 s every 4 levels, down to 25 s. There is no last level.
- Score: 100 a pair, −10 for each miss in the level (not below 0), and +50 × the level for
  clearing it.
- Cards turn over in 3D; a found pair turns green; a cleared level stays face up for a moment
  (clock paused). While a wrong pair shows, tapping a third card turns it back at once.
- The 12 pictures are UiTM campus objects drawn as SVG (`shared/memory-icons.js`), so they look
  the same on iOS and Android. Sounds for flips, pairs, misses, levels, the last five seconds and
  time up, with a **Bunyi** switch.

## Congkak

- The traditional board against the AI: 7 holes a side with 7 marbles each, a store (rumah) at
  each end. Osom (batu, gunting, kain) decides who starts. Sowing goes round the board,
  skipping the opponent's store; the last marble in your own store gives another turn, in a
  filled hole you pick them all up and carry on, in your own empty hole you capture it and the
  hole opposite (tembak). The round ends when a row is empty. Rules and the AI are in
  `congkak/js/rules.js` (unit-tested).
- AI levels: Mudah plays at random; Sederhana, Susah and Pakar look 1, 2 and 4 moves ahead.
  Only a win scores: 55–100% of the level's maximum (100, 500, 800, 1,000), more for a fuller
  store.
- 3D with Three.js (Kejar Lapan's `vendor/` copy, fetched while the home screen shows): a maroon
  lacquered board with carved stars and ferns, glass marbles, and a hand that scoops and sows
  them one by one while the camera follows it. Each hole's and store's count sits beside it,
  off the board; the marbles in hand show under the status line. Swipe or the arrow keys turn
  the view (kept between games); ↺ or 0 puts it back. Settings: AI level, camera follow, fast
  sowing, sound.

## 9-Ball

- Pool on an upright table in a real 7 ft (bar) table's proportions (a 2:1 playing area, balls
  5.8% of its width, a 58 in cue; pockets a touch generous for a phone): hit the lowest-numbered ball first; pot the 9 legally to win (on
  the break too: a golden break). A legal pot keeps the turn. Fouls (cue ball potted, no
  contact, wrong ball first, or no pot and no cushion after contact) give the other player the
  cue ball in hand, placed anywhere; a 9 potted on a foul goes back on the spot. The shot after
  the break may be a **push-out** (Tolak keluar): the cue ball may go anywhere, only a scratch is
  a foul, nothing potted counts (a 9 is re-spotted), and the opponent then plays from there or
  hands it back. **Three fouls in a row** by one player lose the rack (with a warning after two).
- Against the AI (Mudah, Sederhana, Susah: more accurate aim, and Susah plays its best few shots
  out in the physics first, with a centre, follow or draw strike, keeping the one that leaves the
  cue ball best placed for the next ball; Sederhana sometimes adds a little follow or draw; the
  AI's strike point shows on the Putaran button while it plays; Sederhana and Susah place the
  cue ball well with ball in hand, and play safe when no pot is likely (Sederhana: when its pot
  is blocked; Susah: when none of its tries pots): a legal shot that leaves the opponent the
  worst shot (`planSafety`). They also push out after the break rather than play a blocked shot,
  and hand back a push-out that leaves them nothing (`planPushOut`, `acceptPush`)), or
  two players taking turns on one phone. Only rounds against the AI are recorded: 100 a ball
  the player pots, plus 200, 500 or 900 for a win by level.
- Drag on the table to aim (the guide shows the ghost ball, the target's path, and red for the
  wrong ball), or tap where to aim; hold Kiri/Kanan to fine-tune. To shoot, press and hold on
  the table until a power gauge appears beside the finger, pull down (the cue draws back with
  it) and let go; back up to 0% cancels. The
  **Laluan lanjutan** setting extends the guide: the cue ball's and the struck ball's paths to
  their first cushion bounce (a pocket the struck ball heads for ringed in green), and where the
  cue ball glances off (`tracePath` in rules.js). **Putaran** (the small cue ball at the bottom)
  sets where the cue strikes: high to follow through, low to draw back, to a side for english
  that turns the rebound off a cushion (and squirts the ball very slightly); it goes back to the
  centre after each shot. Keyboard:
  ← → aim (Shift for fine), ↓ ↑ power, Space or Enter to shoot.
- The physics runs at a fixed 60 ticks a second, so shots play out the same on 60 Hz and 120 Hz
  screens, and a ball can't slip off the table at a pocket's jaw. It follows a real table: a
  struck ball slides, then rolls at 5/7 of its speed and slows steadily; balls trade speed but
  keep their spin, so a sliding cue ball stops on a full hit (stun) and a rolling one follows
  through; cushions return 80% across, grip a little along, and briefly check the spin. The
  drawn balls turn with their actual spin (a sliding ball doesn't roll). A potted ball slides
  into the pocket, shrinking and darkening as it sinks. For battery life the table is drawn once
  into an offscreen canvas and copied each frame, and each ball's image is only redrawn while it
  turns. The game screen is
  dark slate round the table, whatever the theme. Rules, physics and AI are in
  `9balls/js/rules.js` (unit-tested); based on PR #4 by mzulhelmi87.
