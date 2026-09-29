// Crear la cuenta de ejGames, entrar o recuperarla: una tarjeta con lo que
// desbloquea a la izquierda y el formulario a la derecha. Tras crearla, el
// código de recuperación y un «ya está» con lo siguiente que hacer. La usan
// el diálogo de la cuenta (AccountAuthOverlay), el onboarding y Ajustes.

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, AtSign, Award, Bell, Check, Cloud, Eye, EyeOff, Gamepad2, KeyRound, Lock, MessageSquare, Palette, Sparkles, UserRound, Users, X } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import { openSocial } from "../host/social";
import { RecoveryCodeBox } from "../overlays/RecoveryCode";
import { useApp } from "../store/app";
import { cx } from "./ui";
import "./account-card.css";

type Mode = "register" | "login" | "recover";
type Step = { kind: "form" } | { kind: "code"; code: string; username: string } | { kind: "done"; fresh: boolean };
export type AccountStep = Step["kind"];

const USERNAME = /^[A-Za-z0-9_.-]{3,20}$/;

const PERKS: [ReactNode, string, string, boolean?][] = [
  [<Users size={18} />, "Amigos", "Quién está en línea y a qué juega."],
  [<Bell size={18} />, "Avisos en el juego", "Cuando un amigo se conecta o se pone a jugar."],
  [<Sparkles size={18} />, "Actividad", "Partidas, logros y juegos completados de tu gente."],
  [<Palette size={18} />, "Perfil como el de Steam", "Avatar con marco, fondo, tema y vitrinas."],
  [<Award size={18} />, "Nivel e insignias", "Se ganan jugando: horas, logros, juegos al 100 %."],
  [<MessageSquare size={18} />, "Comentarios", "En tu perfil y en el de tus amigos."],
  [<Cloud size={18} />, "Guardado en la nube", "Tus partidas guardadas, en todos tus PC.", true],
];

/** Fuerza de la contraseña: 0–4 (muy débil → fuerte). */
function strength(pw: string) {
  if (!pw) return -1;
  let n = 0;
  if (pw.length >= 8) n++;
  if (pw.length >= 12) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) n++;
  return pw.length < 8 ? 0 : Math.min(4, n);
}
const STRENGTH = ["Muy débil", "Débil", "Aceptable", "Buena", "Fuerte"];

function Field({ icon, label, hint, ok, children }: { icon: ReactNode; label: string; hint?: ReactNode; ok?: boolean | null; children: ReactNode }) {
  return (
    <label className="ac-field">
      <span className="ac-label">{label}</span>
      <span className={cx("ac-input", ok === true && "is-ok", ok === false && "is-bad")}>
        <span className="ac-input-ico">{icon}</span>
        {children}
        {ok === true && <Check size={16} className="ac-input-ok" />}
      </span>
      {hint && <span className="ac-hint">{hint}</span>}
    </label>
  );
}

/** Lo que desbloquea la cuenta, con un par de amigos de ejemplo detrás. */
function Art({ promo }: { promo?: boolean }) {
  return (
    <aside className="ac-art">
      <div className="ac-art-bg" />
      <div className="ac-brand">
        <Gamepad2 size={22} />
        <span>ejGames</span>
        {promo && <span className="ac-new">Novedad</span>}
      </div>
      <h2 className="ac-art-title">Juega con tus amigos</h2>
      <p className="ac-art-sub">
        Una cuenta de ejGames es <b>gratis</b> y <b>opcional</b>: sin ella, todo funciona igual. Con ella desbloqueas:
      </p>
      <ul className="ac-perks">
        {PERKS.map(([icon, title, text, soon]) => (
          <li key={title} className={soon ? "is-soon" : undefined}>
            <span className="ac-perk-ico">{icon}</span>
            <span>
              <b>
                {title}
                {soon && <span className="ac-soon">Próximamente</span>}
              </b>
              <small>{text}</small>
            </span>
          </li>
        ))}
      </ul>
      <div className="ac-mock" aria-hidden="true">
        <div className="ac-mock-row is-playing">
          <i style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>A</i>
          <span>
            <b>Ana</b>
            <small>Jugando a Hollow Knight</small>
          </span>
        </div>
        <div className="ac-mock-row is-online">
          <i style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)" }}>B</i>
          <span>
            <b>Beto</b>
            <small>En línea</small>
          </span>
        </div>
      </div>
    </aside>
  );
}

export function AccountCard({
  mode: initial = "register",
  promo,
  onClose,
  onFinish,
  closeLabel = "Ahora no",
  skipDone,
  onStep,
  className,
}: {
  mode?: "register" | "login";
  /** Aviso de «Novedad» (la primera vez que se enseña). */
  promo?: boolean;
  /** «Ahora no» / cerrar. Sin él no hay botón de cerrar. */
  onClose?: () => void;
  /** Al terminar (cuenta creada o sesión iniciada). */
  onFinish?: () => void;
  closeLabel?: string;
  /** Sin la pantalla final («ya está»): directo a onFinish. */
  skipDone?: boolean;
  /** Cambia de paso (form → code → done). Llega antes de que cambie la cuenta. */
  onStep?: (kind: AccountStep) => void;
  className?: string;
}) {
  const account = useApp((s) => s.account);
  const set = useApp((s) => s.set);
  const open = useApp((s) => s.open);
  const [mode, setMode] = useState<Mode>(account?.needsLogin ? "login" : initial);
  const [step, setStepState] = useState<Step>({ kind: "form" });
  const setStep = (s: Step) => {
    onStep?.(s.kind);
    setStepState(s);
  };
  const [username, setUsername] = useState(account?.needsLogin ? (account.username ?? "") : "");
  const [name, setName] = useState(useApp.getState().profile?.name ?? "");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userOk = username ? USERNAME.test(username.trim()) : null;
  const score = strength(password);
  const match = password2 ? password === password2 : null;
  const needs2 = mode !== "login";

  const finish = (fresh: boolean) => {
    if (skipDone) onFinish?.();
    else setStep({ kind: "done", fresh });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    try {
      if (!USERNAME.test(username.trim())) throw new Error("El nombre de usuario lleva de 3 a 20 letras, números, «.», «_» o «-».");
      if (password.length < 8) throw new Error("La contraseña tiene que tener al menos 8 caracteres.");
      if (needs2 && password !== password2) throw new Error("Las contraseñas no coinciden.");
      if (mode === "recover" && code.replace(/[\s-]/g, "").length < 20) throw new Error("El código de recuperación tiene 20 letras y números.");
      setBusy(true);
      if (mode === "register") {
        const r = await api.accountRegister(username.trim(), password, name.trim());
        // Primero el paso (quien contenga la tarjeta la mantiene) y luego la cuenta.
        setStep({ kind: "code", code: r.recoveryCode, username: username.trim() });
        set({ account: r.state });
      } else if (mode === "login") {
        const a = await api.accountLogin(username.trim(), password);
        finish(false);
        set({ account: a });
      } else {
        const r = await api.accountRecover(username.trim(), code, password);
        setStep({ kind: "code", code: r.recoveryCode, username: username.trim() });
        set({ account: r.state });
      }
    } catch (x) {
      setError(errMsg(x));
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword("");
    setPassword2("");
  };

  const me = account?.social?.me;
  const friendCode = useMemo(() => (me?.friendCode ? me.friendCode.replace(/(\d{3})(?=\d)/g, "$1 ") : null), [me?.friendCode]);

  let main: ReactNode;
  if (step.kind === "code") {
    main = (
      <div className="ac-step">
        <h3 className="ac-title">Guarda tu código de recuperación</h3>
        <div className="ac-code">
          <RecoveryCodeBox code={step.code} username={step.username} onDone={() => finish(true)} />
        </div>
      </div>
    );
  } else if (step.kind === "done") {
    const shown = me?.profile.name || name || username;
    const done = (fn?: () => void) => () => {
      onFinish?.();
      fn?.();
    };
    main = (
      <div className="ac-step ac-done">
        <div className="ac-done-ico">
          <Check size={34} />
        </div>
        <h3 className="ac-title">{step.fresh ? `¡Ya tienes cuenta, ${shown}!` : `Hola de nuevo, ${shown}`}</h3>
        <p className="ac-sub">
          {friendCode ? (
            <>
              Tu código de amigo es <b className="ac-mono">{friendCode}</b>. Pásaselo a tus amigos o búscalos por su nombre de usuario.
            </>
          ) : (
            "Ya puedes añadir amigos y ver a qué juegan."
          )}
        </p>
        <div className="ac-done-actions">
          <button type="button" data-nav data-autofocus className="ac-btn is-primary" onClick={done(() => open("profile-editor"))}>
            <Palette size={17} /> Personalizar mi perfil
          </button>
          <button type="button" data-nav className="ac-btn" onClick={done(() => openSocial("friends"))}>
            <Users size={17} /> Añadir amigos
          </button>
        </div>
        <button type="button" data-nav className="ac-link" onClick={done()}>
          Seguir a lo mío
        </button>
      </div>
    );
  } else {
    main = (
      <form className="ac-step" onSubmit={(e) => void submit(e)}>
        {mode === "recover" ? (
          <button type="button" data-nav className="ac-back" onClick={() => switchMode("login")}>
            <ArrowLeft size={16} /> Volver a entrar
          </button>
        ) : (
          <div className="ac-seg" role="tablist">
            {(["register", "login"] as const).map((m) => (
              <button key={m} type="button" data-nav data-tab aria-selected={mode === m} className={cx("ac-seg-btn", mode === m && "is-on")} onClick={() => switchMode(m)}>
                {m === "register" ? "Crear cuenta" : "Iniciar sesión"}
              </button>
            ))}
          </div>
        )}
        <h3 className="ac-title">{mode === "register" ? "Crea tu cuenta" : mode === "login" ? (account?.needsLogin ? "Tu sesión ha caducado" : "Bienvenido de nuevo") : "Recupera tu cuenta"}</h3>
        <p className="ac-sub">
          {mode === "register"
            ? "Un minuto y listo. Solo te pedimos un nombre de usuario y una contraseña: nada de correos."
            : mode === "login"
              ? account?.needsLogin
                ? `Vuelve a entrar como ${account.username} para ver a tus amigos.`
                : "Entra con tu nombre de usuario de ejGames."
              : "Con el código de recuperación que guardaste al crearla, pon una contraseña nueva."}
        </p>
        <fieldset disabled={busy} className="ac-fields">
          <Field
            icon={<AtSign size={17} />}
            label="Nombre de usuario"
            ok={mode === "register" ? userOk : null}
            hint={mode === "register" ? (userOk === false ? "De 3 a 20 letras, números, «.», «_» o «-»." : "Con él te encuentran tus amigos.") : undefined}
          >
            <input data-nav data-autofocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20} spellCheck={false} placeholder="tu_usuario" />
          </Field>
          {mode === "register" && (
            <Field icon={<UserRound size={17} />} label="Nombre visible" hint="El que ven los demás. Lo cambias cuando quieras.">
              <input data-nav value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Cómo te llamas" />
            </Field>
          )}
          {mode === "recover" && (
            <Field icon={<KeyRound size={17} />} label="Código de recuperación">
              <input data-nav value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" className="ac-mono uppercase" spellCheck={false} />
            </Field>
          )}
          <Field icon={<Lock size={17} />} label={mode === "recover" ? "Contraseña nueva" : "Contraseña"}>
            <input
              data-nav
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "login" ? "" : "Al menos 8 caracteres"}
            />
            <button type="button" className="ac-eye" tabIndex={-1} title={show ? "Ocultar" : "Enseñar"} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </Field>
          {needs2 && score >= 0 && (
            <div className={cx("ac-meter", `is-${score}`)}>
              <span>
                <i />
                <i />
                <i />
                <i />
              </span>
              <small>{STRENGTH[score]}</small>
            </div>
          )}
          {needs2 && (
            <Field icon={<Lock size={17} />} label="Repite la contraseña" ok={match}>
              <input data-nav type={show ? "text" : "password"} value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
            </Field>
          )}
        </fieldset>
        {error && (
          <p className="ac-error">
            <X size={16} /> {error}
          </p>
        )}
        <button type="submit" data-nav className="ac-btn is-primary is-big" disabled={busy}>
          {busy ? "Un momento…" : mode === "register" ? "Crear mi cuenta" : mode === "login" ? "Entrar" : "Cambiar la contraseña"}
        </button>
        {mode === "login" && (
          <button type="button" data-nav className="ac-link" onClick={() => switchMode("recover")}>
            ¿Has olvidado la contraseña?
          </button>
        )}
        <p className="ac-fine">
          <Lock size={12} /> Tu contraseña se cifra en tu PC (Argon2) antes de salir de él. Si la olvidas, el código de recuperación te deja poner otra.
        </p>
      </form>
    );
  }

  return (
    <div className={cx("ac", className)}>
      <Art promo={promo} />
      <main className="ac-main">
        {onClose && step.kind === "form" && (
          <button type="button" data-nav className="ac-close" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        )}
        {main}
        {onClose && step.kind === "form" && (
          <button type="button" data-nav className="ac-later" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </main>
    </div>
  );
}
