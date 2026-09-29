// La cuenta de ejGames del perfil: crear una, entrar, recuperarla con el
// código y, ya dentro, estado, avisos, contraseña, perfil y cerrar sesión.
// Lo usan Ajustes → Cuenta y el paso «Tu cuenta» del onboarding.

import { useState, type FormEvent, type ReactNode } from "react";
import { api, errMsg } from "../api/tauri";
import type { AccountState, AccountStatus } from "../api/types";
import { openSocial } from "../host/social";
import { useApp } from "../store/app";
import { Button, Cycle, Field, Section, TextInput, Toggle, cx } from "./ui";

type Mode = "register" | "login" | "recover";

const USERNAME = /^[A-Za-z0-9_.-]{3,20}$/;

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

/**
 * Crear cuenta, entrar o recuperarla. `onDone` tras entrar (onboarding).
 * `onCode`: dónde enseñar el código de recuperación (si no, en una ventana).
 */
export function AccountAuth({ onDone, onCode, compact }: { onDone?: () => void; onCode?: (code: string, username: string) => void; compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("register");
  const [username, setUsername] = useState("");
  const [name, setName] = useState(useApp.getState().profile?.name ?? "");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const set = useApp((s) => s.set);
  const open = useApp((s) => s.open);

  const showCode = (recoveryCode: string) => (onCode ? onCode(recoveryCode, username.trim()) : open("recovery-code", { code: recoveryCode, username }));

  const check = () => {
    if (!USERNAME.test(username.trim())) throw new Error("El nombre de usuario lleva de 3 a 20 letras, números, «.», «_» o «-».");
    if (password.length < 8) throw new Error("La contraseña tiene que tener al menos 8 caracteres.");
    if ((mode === "register" || mode === "recover") && password !== password2) throw new Error("Las contraseñas no coinciden.");
  };

  const submit = async () => {
    check();
    if (mode === "register") {
      const r = await api.accountRegister(username.trim(), password, name.trim());
      set({ account: r.state });
      showCode(r.recoveryCode);
      if (!onCode) onDone?.();
    } else if (mode === "login") {
      set({ account: await api.accountLogin(username.trim(), password) });
      onDone?.();
    } else {
      const r = await api.accountRecover(username.trim(), code, password);
      set({ account: r.state });
      showCode(r.recoveryCode);
      if (!onCode) onDone?.();
    }
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      data-nav
      onClick={() => setMode(m)}
      className={cx("h-9 rounded-md px-3 text-sm cursor-pointer", mode === m ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface-3 hover:text-fg")}
    >
      {label}
    </button>
  );

  return (
    <div className={compact ? "" : "max-w-xl"}>
      <div className="mb-2 flex flex-wrap gap-1 px-3">
        {tab("register", "Crear cuenta")}
        {tab("login", "Ya tengo cuenta")}
        {tab("recover", "He olvidado la contraseña")}
      </div>
      <Form onSubmit={submit}>
        <Field label="Nombre de usuario" hint={mode === "register" ? "Con él te encuentran tus amigos. De 3 a 20 letras, números, «.», «_» o «-»." : undefined}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20} data-autofocus />
        </Field>
        {mode === "register" && (
          <Field label="Nombre visible" hint="El que ven los demás. Lo puedes cambiar cuando quieras.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          </Field>
        )}
        {mode === "recover" && (
          <Field label="Código de recuperación" hint="El de 20 letras y números que guardaste al crear la cuenta.">
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" className="font-mono uppercase" />
          </Field>
        )}
        <Field label={mode === "recover" ? "Contraseña nueva" : "Contraseña"} hint={mode !== "login" ? "Al menos 8 caracteres." : undefined}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        {mode !== "login" && (
          <Field label="Repite la contraseña">
            <TextInput type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        <div className="px-3 pt-2">
          <Button type="submit" variant="primary">
            {mode === "register" ? "Crear cuenta" : mode === "login" ? "Entrar" : "Cambiar la contraseña"}
          </Button>
        </div>
      </Form>
    </div>
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
  if (!a) return <p className="px-3 text-sm text-muted">Cargando…</p>;
  if (!a.enabled) return <p className="px-3 text-sm text-muted">Esta versión de ejGames no tiene cuentas.</p>;
  if (a.linked && !a.needsLogin) return <Linked a={a} />;
  return (
    <div className="max-w-xl">
      <Section title={a.needsLogin ? "Tu sesión ha caducado" : "Cuenta de ejGames"}>
        <p className="px-3 pb-2 text-sm text-muted">
          {a.needsLogin
            ? `Vuelve a entrar como ${a.username} para ver a tus amigos.`
            : "Con una cuenta puedes añadir amigos, ver a qué juegan, recibir avisos dentro del juego y tener un perfil con tus juegos, logros e insignias. Es opcional: todo lo demás funciona sin ella."}
        </p>
        <AccountAuth />
      </Section>
    </div>
  );
}
