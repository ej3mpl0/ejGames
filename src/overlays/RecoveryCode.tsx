// El código de recuperación de la cuenta: solo se enseña una vez (el
// servidor no lo guarda). Copiar, guardar en un .txt y confirmar.

import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api/tauri";
import { Button, Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";

export function RecoveryCodeBox({ code, username, onDone }: { code: string; username: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const toast = useApp((s) => s.toast);

  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    toast("ok", "Código copiado");
  };
  const download = async () => {
    const path = await save({ defaultPath: `ejGames-recuperacion-${username || "cuenta"}.txt`, filters: [{ name: "Texto", extensions: ["txt"] }] });
    if (!path) return;
    await api
      .saveTextFile(
        path,
        `Cuenta de ejGames: ${username}\nCódigo de recuperación: ${code}\n\nCon este código puedes poner una contraseña nueva si olvidas la tuya.\nGuárdalo en un sitio seguro. ejGames no lo puede recuperar.\n`,
      )
      .then(() => toast("ok", "Guardado"))
      .catch((e) => toast("error", String(e)));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Si olvidas la contraseña, este código es la única forma de recuperar la cuenta. <b className="text-fg">Solo se enseña ahora</b>: guárdalo en
        un sitio seguro.
      </p>
      <div className="rounded-[var(--h-radius)] bg-surface-3/70 px-4 py-5 text-center font-mono text-2xl tracking-[0.12em] ring-1 ring-line select-all">{code}</div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>Copiar</Button>
        <Button onClick={() => void download()}>Guardar en un .txt</Button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" data-nav checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5 accent-[var(--h-accent)]" />
        Lo he guardado
      </label>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          Listo
        </Button>
      </div>
    </div>
  );
}

export function RecoveryCodeOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const code = String(args?.code ?? "");
  const username = String(args?.username ?? "");
  const ref = useOverlayNav<HTMLDivElement>({});
  return (
    <Modal ref={ref} title="Tu código de recuperación" onClose={() => {}} hideClose width="min(620px, 94vw)" height="auto" hints={[["accept", "Elegir"]]}>
      <div className="p-6">
        <RecoveryCodeBox code={code} username={username} onDone={onClose} />
      </div>
    </Modal>
  );
}
