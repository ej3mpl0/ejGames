<p align="center">
  <img src="docs/images/logo-light.png#gh-light-mode-only" alt="ejGames" height="64" />
  <img src="docs/images/logo-dark.png#gh-dark-mode-only" alt="ejGames" height="64" />
</p>

<p align="center">
  A lightweight, fully customizable game launcher for Windows.
</p>

<p align="center">
  <a href="https://github.com/ej3mpl0/ejGames/releases/latest"><b>Download</b></a> ·
  <a href="https://ej3mplo.mintlify.site">Documentation</a> ·
  <a href="CHANGELOG.md">Changelog (Spanish)</a> ·
  <a href="README.md">Léeme en español</a>
</p>

---

ejGames follows Windows by default, and the language can be changed in Settings → System → Language.

* **Your local games**: detects the games in your folders (and their right `.exe`), the `.exe` files you add by hand and
  what you install from Downloads.
* **Explore and Downloads**: a repack store with a built-in torrent client and an **Install** button that puts the game
  in your library. A notice appears when a newer repack version is out.
* **Achievements** from Steam and from standalone games, with **in-game notices** styled like each platform. A yearly recap,
  **Your year in ejGames**.
* **Homebrew**: your emulators and console games in their own tab, with ROM catalogs that download and extract on
  their own (`.rar` too), RetroArch, PCSX2, Dolphin, PPSSPP, DuckStation, Cemu, RPCS3, Eden or your own emulator.
* **In-game overlay** with community guides, **cheats** (FLiNG trainers you choose to install), interactive **maps**,
  notes, screenshots, music, volume, performance and optional **FPS**, with no injection into the game.
* **Saved-game backups** after every session, **library backups** you can carry to another PC through OneDrive or Drive,
  a **game mode** (power plan and notifications), desktop shortcuts and **Add to Steam**.
* **Its own theme**, Moneda: clear and one tap away, built from three shapes in the logo (the red disc is Play, the
  ring is progress and the slot shows where you are). Tweak it without code, or build your own with HTML, CSS and
  JavaScript.
* **Controller and Big Picture**, profiles, statistics, Discord Rich Presence and automatic updates (with a way back to
  an earlier version).
* **Light**: while you play it can stay in the tray using about 5 MB.

## Install

Download `ejGames_<version>_Setup.exe` from the [latest release](https://github.com/ej3mpl0/ejGames/releases/latest) and
open it. If you already have ejGames, the same installer updates it without touching your library. Windows 10/11, 64-bit.

## Translating a theme

Themes are written in Spanish. The other languages come from dictionaries in `<theme>/i18n/`, with no code changes. See
[Languages](https://ej3mplo.mintlify.site/referencia/idiomas) and `pnpm i18n:check`.

## Build

See [`docs/desarrollo/compilar.mdx`](docs/desarrollo/compilar.mdx).

MIT license.
