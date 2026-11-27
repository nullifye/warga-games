# Arked Warga kit

The shared code every game uses to live in Arked Warga: it implements the
[game contract](https://github.com/nullifye/arcade/blob/main/docs/game-contract.md) (version 1).
Games in this repo import it by relative path (`../../shared/…`). A game on another host copies
this whole folder and imports it the same way.

## Rules for the kit

- **Self-contained:** modules here import only from this folder (`./…`), so the folder works
  wherever it is copied. `tests/kit.test.mjs` checks this.
- **No host assumptions:** nothing depends on the page's own address. The hub's address is
  fixed in `arked-link.js`; the Supabase address and key are in `config.js`.
- **Game logic stays in each game.** The kit is what every game does the same way.

## What's in it

| Module | For |
|---|---|
| `board.js` | Papan Markah: the Hari Ini / Keseluruhan / Kampus tabs, loading, empty and error states; `createBoard({ game })`, then `board.open()` when the board screen shows |
| `leaderboard.js`, `config.js` | `arked_record`, `arked_top`, `arked_campus_rank` over plain fetch; the board's list rows |
| `arked-link.js` | `?dari=arked`: the back-to-hub button and going back |
| `shared-store.js` | `arked.profile` and `arked.game.<id>`, kept in AppsWarga's storage |
| `profile.js`, `profile-options.js`, `select.js`, `uuid.js` | the profile chip and form, user types and campuses |
| `appswarga.js`, `theme-boot.js` | the AppsWarga bridge: theme, close, ready, haptics, share |
| `rng.js`, `reload.js` | Malaysia's date (`todayKL`), seeded randomness, the version button's reload |
| `base.css`, `puzzle-page.css` | the shared look: tokens, buttons, bar, dialogs, home, result and board screens |
| `puzzle-page.js`, `puzzle-engines.js`, `puzzle-sound.js`, `memory-icons.js` | a whole page for small grid puzzles (2048, Susun Blok, Memori) |
| `vendor/` | Three.js and Rapier (with their licences), for the 3D games |

Files also copied into the hub (`nullifye/arcade`) must stay identical there: `appswarga.js`,
`select.js`, `profile-options.js`, `config.js`, `shared-store.js`.
