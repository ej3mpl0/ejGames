# Temas de la comunidad

Los temas de esta lista aparecen en **Ajustes → Apariencia → De la comunidad**, con un botón para instalarlos.

## Cómo añadir el tuyo

1. Exporta tu tema como `.ejtheme` (Ajustes → Apariencia → Exportar `.ejtheme`) y súbelo a una release de tu propio
   repositorio de GitHub.
2. Abre una *pull request* que añada una entrada a [`index.json`](index.json):

```json
{
  "id": "mi-tema",
  "name": "Mi tema",
  "author": "tu-usuario-de-github",
  "description": "Una frase sobre cómo se ve.",
  "version": "1.0.0",
  "preview": "https://raw.githubusercontent.com/tu-usuario/tu-repo/main/preview.png",
  "download": "https://github.com/tu-usuario/tu-repo/releases/download/v1.0.0/mi-tema.ejtheme",
  "sha256": "huella SHA-256 del .ejtheme (Get-FileHash en PowerShell)"
}
```

Reglas: el `id` es el del `theme.json`; la descarga tiene que ser de `github.com` o `raw.githubusercontent.com`; ejGames
comprueba la huella antes de instalar. Se revisa el código del tema antes de aceptarlo (los temas corren en un iframe
aislado, sin red, pero se mira igual). Para actualizarlo, cambia `version`, `download` y `sha256`.
