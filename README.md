<p align="center">
  <img src="docs/images/logo-light.png#gh-light-mode-only" alt="ejGames" height="56" />
  <img src="docs/images/logo-dark.png#gh-dark-mode-only" alt="ejGames" height="56" />
</p>

<p align="center">
  Launcher de juegos para Windows, ligero y personalizable al 100 %.
</p>

<p align="center">
  <a href="https://github.com/ej3mpl0/ejGames/releases/latest"><b>Descargar</b></a> ·
  <a href="https://ejgames.mintlify.app">Documentación</a> ·
  <a href="https://ejgames.mintlify.app/temas">Crear temas</a> ·
  <a href="CHANGELOG.md">Novedades</a>
</p>

---

* **Toda tu biblioteca en un sitio**: detecta los juegos de tus carpetas (y su `.exe` bueno) e importa Steam, Epic,
  GOG, Ubisoft Connect y EA app, también lo que no tienes instalado.
* **Explorar y Descargas**: tienda de repacks con torrent integrado y un botón **Instalar** que deja el juego en tu
  biblioteca.
* **Logros** de Steam y de los juegos sueltos, con **avisos dentro del juego** al estilo de cada plataforma.
* **6 temas de serie** (Steam, PS5, Xbox, Switch, Cinema y Retro) que se tunean sin código, o el tuyo desde cero con
  HTML, CSS y JavaScript.
* **Mando y Big Picture**, perfiles, estadísticas, Discord Rich Presence y actualizaciones automáticas.
* **Ligero**: al jugar puede quedarse en la bandeja con unos 5 MB.

Todo con detalle en la [documentación](https://ejgames.mintlify.app/funciones).

## Instalar

Descarga `ejGames_<versión>_Setup.exe` de la [última release](https://github.com/ej3mpl0/ejGames/releases/latest) y
ábrelo. Si ya tienes ejGames, el mismo instalador lo actualiza sin tocar tu biblioteca; después, las versiones nuevas
llegan solas. Necesita Windows 10/11 de 64 bits.

## Crear temas

Un tema es una página web normal que dibuja tu biblioteca como quieras, con recarga en vivo. Empieza por la
[guía paso a paso](https://ejgames.mintlify.app/guia) (el tema terminado está en
[`examples/ejemplo-tema/`](examples/ejemplo-tema/)) y consulta la
[referencia del SDK](https://ejgames.mintlify.app/referencia/sdk).

## Desarrollo

```bash
pnpm install
pnpm tauri dev
cd src-tauri && cargo test --lib
```

Compilar, publicar versiones y la arquitectura: [Desarrollo](https://ejgames.mintlify.app/desarrollo/compilar). La
documentación sale de [`docs/`](docs/) (Mintlify: `npx mint dev` dentro de esa carpeta).

## Licencia

[MIT](LICENSE).
