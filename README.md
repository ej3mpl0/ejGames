<p align="center">
  <img src="docs/images/logo-light.png#gh-light-mode-only" alt="ejGames" height="56" />
  <img src="docs/images/logo-dark.png#gh-dark-mode-only" alt="ejGames" height="56" />
</p>

<p align="center">
  Launcher de juegos para Windows, ligero y personalizable al 100 %.
</p>

<p align="center">
  <a href="https://github.com/ej3mpl0/ejGames/releases/latest"><b>Descargar</b></a> ·
  <a href="https://ej3mplo.mintlify.site">Documentación</a> ·
  <a href="https://ej3mplo.mintlify.site/temas">Crear temas</a> ·
  <a href="CHANGELOG.md">Novedades</a>
</p>

---

* **Tus juegos locales**: detecta los juegos de tus carpetas (y su `.exe` bueno), los `.exe` que añades a mano y lo
  que instalas desde Descargas.
* **Explorar y Descargas**: tienda de repacks con torrent integrado y un botón **Instalar** que deja el juego en tu
  biblioteca.
* **Logros** de Steam y de los juegos sueltos, con **avisos dentro del juego** al estilo de cada plataforma.
* **Amigos y perfiles al estilo Steam**: a qué juegan tus amigos (con avisos dentro del juego), su actividad y un
  perfil con marcos, fondos animados, vitrinas, nivel e insignias. La cuenta es opcional: sin ella todo lo demás
  funciona igual, y con ella se desbloquea todo esto.
* **Overlay dentro del juego** con guías de la comunidad de Steam, **trucos** (trainers de FLiNG que tú decides
  instalar) y **mapas interactivos** de Map Genie que se pueden anclar encima del juego.
* **6 temas de serie** (Steam, PS5, Xbox, Switch, Cinema y Retro) que se tunean sin código, o el tuyo desde cero con
  HTML, CSS y JavaScript.
* **Mando y Big Picture**, perfiles, estadísticas, Discord Rich Presence y actualizaciones automáticas.
* **Ligero**: al jugar puede quedarse en la bandeja con unos 5 MB.

Todo con detalle en la [documentación](https://ej3mplo.mintlify.site/funciones).

## Instalar

Descarga `ejGames_<versión>_Setup.exe` de la [última release](https://github.com/ej3mpl0/ejGames/releases/latest) y
ábrelo. Si ya tienes ejGames, el mismo instalador lo actualiza sin tocar tu biblioteca; después, las versiones nuevas
llegan solas. Necesita Windows 10/11 de 64 bits.

## Crear temas

Un tema es una página web normal que dibuja tu biblioteca como quieras, con recarga en vivo. Empieza por la
[guía paso a paso](https://ej3mplo.mintlify.site/guia) (el tema terminado está en
[`examples/ejemplo-tema/`](examples/ejemplo-tema/)) y consulta la
[referencia del SDK](https://ej3mplo.mintlify.site/referencia/sdk).

## Desarrollo

```bash
pnpm install
pnpm tauri dev
cd src-tauri && cargo test --lib
```

Compilar, publicar versiones y la arquitectura: [Desarrollo](https://ej3mplo.mintlify.site/desarrollo/compilar). La
documentación sale de [`docs/`](docs/) (Mintlify: `npx mint dev` dentro de esa carpeta).

## Licencia

[MIT](LICENSE).
