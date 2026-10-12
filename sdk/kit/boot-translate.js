// Arranque del traductor del tema. Lo carga el HTML como módulo, no ejg.js.
//
// El tema corre en un iframe con origen opaco (sandbox, sin allow-same-origin) y
// ejg.js entra como script clásico de otro origen. Desde ahí, import() no
// resuelve ninguna ruta: la URL base queda en about:blank. Un módulo sí tiene
// la URL del propio fichero, y este archivo deja el traductor en window.__ejgTr.

import { makeTranslator, observe } from "./translate.js";

window.__ejgTr = { makeTranslator, observe };
document.dispatchEvent(new Event("ejg-tr"));
