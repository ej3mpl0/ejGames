// Ajustes → Cuenta: sin cuenta, la tarjeta para crearla o entrar
// (AccountCard); ya dentro, estado, avisos, contraseña, perfil y cerrar sesión.

import { useState, type FormEvent, type ReactNode } from "react";
import { Cloud } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { AccountState, AccountStatus } from "../api/types";
import { openSocial } from "../host/social";
import { useApp } from "../store/app";
import { AccountCard } from "./AccountCard";
import { Button, Cycle, Field, Section, TextInput, Toggle } from "./ui";

function Form({ onSubmit, children }: { onSubmit: () => Promise<void>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (x) {
      setError(errMsg(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-1">
      <fieldset disabled={busy} className="space-y-1">
        {children}
      </fieldset>
      {error && <p className="mx-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {busy && <p className="mx-3 text-sm text-muted">Un momento…</p>}
    </form>
  );
}

const STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
  { value: "online", label: "En línea" },
  { value: "away", label: "Ausente" },
  { value: "invisible", label: "Invisible" },
];

function Linked({ a }: { a: AccountState }) {
  const set = useApp((s) => s.set);
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const me = a.social?.me;
  const [pw, setPw] = useState<null | "password" | "code" | "delete">(null);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");

  const prefs = async (p: Parameters<typeof api.accountPrefs>[0]) => set({ account: await api.accountPrefs(p) });

  return (
    <div className="max-w-2xl">
      <Section title="Tu cuenta">
        <div className="flex items-center gap-4 px-3 py-3">
          {me?.profile.avatarUrl ? (
            <img src={me.profile.avatarUrl} className="h-16 w-16 rounded-lg object-cover" alt="" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-lg bg-surface-3 text-xl font-bold">{(me?.profile.name || a.username || "?")[0]?.toUpperCase()}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{me?.profile.name || a.username}</div>
            <div className="text-sm text-muted">
              @{a.username}
              {me && (
                <>
                  {" · código de amigo "}
                  <b className="font-mono text-fg">{me.friendCode}</b>
                </>
              )}
            </div>
            {a.offline && <div className="mt-1 text-xs text-amber-300">Sin conexión con el servidor de ejGames.</div>}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="primary" onClick={() => open("profile-editor")}>
              Editar perfil
            </Button>
            <Button size="sm" onClick={() => openSocial("friends")}>
              Amigos
            </Button>
          </div>
        </div>
        <Cycle label="Estado" value={a.status} options={STATUS_OPTIONS} onChange={(v) => void prefs({ status: v })} />
        <Toggle label="Avisar cuando un amigo se conecte" checked={a.notifyOnline} onChange={(v) => void prefs({ notifyOnline: v })} />
        <Toggle label="Avisar cuando un amigo empiece a jugar" hint="Dentro del juego, con el overlay." checked={a.notifyPlaying} onChange={(v) => void prefs({ notifyPlaying: v })} />
      </Section>

      <Section title="Guardado en la nube">
        <div className="flex items-center gap-4 px-3 py-3 opacity-80">
          <Cloud size={22} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Tus partidas guardadas, en todos tus PC</div>
            <div className="text-xs text-muted">Irá con tu cuenta de ejGames, sin hacer nada.</div>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-line text-muted">Próximamente</span>
        </div>
      </Section>

      <Section title="Seguridad">
        {pw === null && (
          <div className="flex flex-wrap gap-2 px-3 py-2">
            <Button size="sm" onClick={() => setPw("password")}>
              Cambiar la contraseña
            </Button>
            <Button size="sm" onClick={() => setPw("code")}>
              Nuevo código de recuperación
            </Button>
            <Button size="sm" onClick={() => void api.accountLogout().then((s) => set({ account: s }))}>
              Cerrar sesión
            </Button>
            <Button size="sm" variant="danger" onClick={() => setPw("delete")}>
              Borrar la cuenta
            </Button>
          </div>
        )}
        {pw === "password" && (
          <Form
            onSubmit={async () => {
              if (p2.length < 8) throw new Error("La contraseña nueva tiene que tener al menos 8 caracteres.");
              if (p2 !== p3) throw new Error("Las contraseñas no coinciden.");
              await api.accountPassword(p1, p2);
              toast("ok", "Contraseña cambiada. Las demás sesiones se han cerrado.");
              setPw(null);
            }}
          >
            <Field label="Contraseña actual">
              <TextInput type="password" value={p1} onChange={(e) => setP1(e.target.value)} data-autofocus />
            </Field>
            <Field label="Contraseña nueva">
              <TextInput type="password" value={p2} onChange={(e) => setP2(e.target.value)} />
            </Field>
            <Field label="Repite la contraseña nueva">
              <TextInput type="password" value={p3} onChange={(e) => setP3(e.target.value)} />
            </Field>
            <div className="flex gap-2 px-3 pt-2">
              <Button type="submit" variant="primary" size="sm">
                Cambiar
              </Button>
              <Button type="button" size="sm" onClick={() => setPw(null)}>
                Cancelar
              </Button>
            </div>
          </Form>
        )}
        {(pw === "code" || pw === "delete") && (
          <Form
            onSubmit={async () => {
              if (pw === "code") {
                const code = await api.accountNewCode(p1);
                open("recovery-code", { code, username: a.username });
              } else {
                set({ account: await api.accountDelete(p1) });
                toast("ok", "Cuenta borrada.");
              }
              setPw(null);
              setP1("");
            }}
          >
            <p className="px-3 text-sm text-muted">
              {pw === "code"
                ? "El código viejo dejará de valer."
                : "Se borran tu perfil, tus amigos, tus comentarios y tu actividad. Tu biblioteca y tus partidas no se tocan. No se puede deshacer."}
            </p>
            <Field label="Tu contraseña">
              <TextInput type="password" value={p1} onChange={(e) => setP1(e.target.value)} data-autofocus />
            </Field>
            <div className="flex gap-2 px-3 pt-2">
              <Button type="submit" variant={pw === "delete" ? "danger" : "primary"} size="sm">
                {pw === "code" ? "Crear código nuevo" : "Borrar mi cuenta"}
              </Button>
              <Button type="button" size="sm" onClick={() => setPw(null)}>
                Cancelar
              </Button>
            </div>
          </Form>
        )}
      </Section>
    </div>
  );
}

export function AccountPanel() {
  const a = useApp((s) => s.account);
  // Creando la cuenta o recién entrado: la tarjeta sigue hasta que termine.
  const [flow, setFlow] = useState(false);
  if (!a) return <p className="px-3 text-sm text-muted">Cargando…</p>;
  if (!a.enabled) return <p className="px-3 text-sm text-muted">Esta versión de ejGames no tiene cuentas.</p>;
  if (a.linked && !a.needsLogin && !flow) return <Linked a={a} />;
  return (
    <div className="max-w-5xl px-3 pb-4">
      <AccountCard onStep={(k) => setFlow(k !== "form")} onFinish={() => setFlow(false)} />
    </div>
  );
}
