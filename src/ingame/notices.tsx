// Avisos del overlay con el aspecto de cada plataforma. Cada tema declara el
// suyo en theme.json ("overlay": {"style": "xbox"}) y el usuario puede forzar
// otro en Ajustes → Overlay. Se usan en la ventana del overlay y en la vista
// previa de Ajustes.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { NoticeLook, NoticeStyle, OverlayNotice } from "../api/types";
import "./notices.css";

export const NOTICE_STYLES: { value: NoticeStyle; label: string }[] = [
  { value: "steam", label: "Steam" },
  { value: "playstation", label: "PlayStation" },
  { value: "xbox", label: "Xbox" },
  { value: "switch", label: "Switch" },
  { value: "cinema", label: "Cine" },
  { value: "retro", label: "Arcade retro" },
  { value: "ejgames", label: "ejGames (colores del tema)" },
];

/** Lo que tarda en irse cada aviso (la animación de salida más larga). */
export const LEAVE_MS = 650;

const pct = (p: number) => p.toLocaleString("es", { maximumFractionDigits: p < 10 ? 1 : 0 });
export const isRare = (n: OverlayNotice) => n.kind === "achievement" && n.rarity != null && n.rarity < 10;
const completed = (n: OverlayNotice) => n.kind === "achievement" && !!n.progress && n.progress[1] > 0 && n.progress[0] >= n.progress[1];
/** "3 logros desbloqueados" → 3 (así lo escribe el núcleo en el resumen). */
const summaryCount = (n: OverlayNotice) => parseInt(n.title, 10) || 0;

/** Cuánto se queda en pantalla. Los raros, más (como en Xbox). */
export function noticeMs(n: OverlayNotice) {
  if (n.kind === "summary") return 9000;
  if (n.kind === "info") return 5500;
  if (n.kind === "screenshot") return 4500;
  return isRare(n) ? 9000 : 6500;
}

const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const isShot = (n: OverlayNotice) => n.kind === "screenshot";
/** "C:\Users\x\Pictures\ejGames\Juego" → "Pictures › ejGames › Juego" */
const shortDir = (dir?: string | null) => (dir ? dir.split(/[\\/]/).filter(Boolean).slice(-3).join(" › ") : "");

// ─────────── iconos (propios, sin logos de nadie) ───────────

function Cup({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.5 3h11v5.2a5.5 5.5 0 0 1-4.6 5.43V16.5h3.3v3.5H7.8v-3.5h3.3v-2.87A5.5 5.5 0 0 1 6.5 8.2V3Zm-4 1.2h3v1.9H4.4v.7a2.8 2.8 0 0 0 2 2.68l-.5 1.84A4.7 4.7 0 0 1 2.5 6.8V4.2Zm15.99 0h3V6.8a4.7 4.7 0 0 1-3.4 4.53l-.5-1.84a2.8 2.8 0 0 0 2-2.69v-.7h-1.1V4.2Z"
      />
    </svg>
  );
}

function Gem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 4h10l4 5-9 11L3 9l4-5Z" />
      <path
        fill="none"
        stroke="rgba(0,0,0,.3)"
        strokeWidth="1.1"
        strokeLinejoin="round"
        d="M3 9h18M9.5 9 12 20l2.5-11M7 4l2.5 5L12 4l2.5 5L17 4"
      />
    </svg>
  );
}

function Pad({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 6.5h9.6a4.9 4.9 0 0 1 4.8 5.9l-.9 4.2a2.4 2.4 0 0 1-4.2 1.1l-1.8-2.2H9.3l-1.8 2.2a2.4 2.4 0 0 1-4.2-1.1l-.9-4.2a4.9 4.9 0 0 1 4.8-5.9Zm.6 3v1.6H6.2v1.5h1.6v1.6h1.5v-1.6h1.6v-1.5H9.3V9.5H7.8Zm8.4.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </svg>
  );
}

function Camera({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.6 4.5h6.8l1.5 2.2h2.6A2.5 2.5 0 0 1 22 9.2v8.3a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5V9.2a2.5 2.5 0 0 1 2.5-2.5h2.6l1.5-2.2ZM12 9a4.2 4.2 0 1 0 0 8.4A4.2 4.2 0 0 0 12 9Zm0 2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z"
      />
    </svg>
  );
}

/** Icono del logro; si no hay (o falla), el glifo de la plataforma. */
function Art({ src, className, children }: { src?: string | null; className: string; children: ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img className={className} src={src} alt="" draggable={false} onError={() => setBroken(true)} />;
  return <span className={cls(className, "ph")}>{children}</span>;
}

/** El icono a 16 × 16 y ampliado sin suavizar, como un sprite. */
function Pixel({ src, className, children }: { src?: string | null; className: string; children: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => ref.current?.getContext("2d")?.drawImage(img, 0, 0, 16, 16);
    img.onerror = () => setBroken(true);
    img.src = src;
  }, [src]);
  if (!src || broken) return <span className={cls(className, "ph")}>{children}</span>;
  return <canvas ref={ref} className={className} width={16} height={16} />;
}

type P = { n: OverlayNotice; look: NoticeLook };

// ─────────── Steam: abajo a la derecha, sube desde el borde ───────────

function Steam({ n }: P) {
  const rare = isRare(n);
  if (isShot(n)) {
    return (
      <div className="nt-steam">
        <Art src={n.icon} className="nt-steam-icon is-shot">
          <Camera />
        </Art>
        <div className="nt-steam-txt">
          <div className="nt-steam-head">Captura de pantalla guardada</div>
          <div className="nt-steam-name">{n.game}</div>
          <div className="nt-steam-desc">{shortDir(n.body)}</div>
        </div>
      </div>
    );
  }
  const head =
    n.kind === "summary" ? "Resumen de la partida" : n.kind === "info" ? n.game || "ejGames" : rare ? "Logro raro desbloqueado" : "Logro desbloqueado";
  return (
    <div className={cls("nt-steam", rare && "rare")}>
      <Art src={n.kind === "info" ? null : n.icon} className="nt-steam-icon">
        {n.kind === "info" ? <Pad /> : <Cup />}
      </Art>
      <div className="nt-steam-txt">
        <div className="nt-steam-head">{head}</div>
        <div className="nt-steam-name">{n.title}</div>
        {n.body && <div className="nt-steam-desc">{n.body}</div>}
        {rare && <div className="nt-steam-rarity">Lo tiene el {pct(n.rarity!)} % de los jugadores</div>}
      </div>
      {rare && (
        <span className="nt-steam-sparks" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} />
          ))}
        </span>
      )}
    </div>
  );
}

// ─────────── PlayStation: arriba a la derecha, copa del grado ───────────

type Grade = "bronze" | "silver" | "gold" | "platinum";
const GRADE_NAME: Record<Grade, string> = { bronze: "bronce", silver: "plata", gold: "oro", platinum: "platino" };

function grade(n: OverlayNotice): Grade {
  if (completed(n)) return "platinum";
  const r = n.rarity;
  if (r == null) return "bronze";
  return r < 10 ? "gold" : r < 35 ? "silver" : "bronze";
}

function PlayStation({ n }: P) {
  if (isShot(n)) {
    return (
      <div className="nt-ps info">
        <Art src={n.icon} className="nt-ps-art is-shot">
          <Camera />
        </Art>
        <div className="nt-ps-txt">
          <div className="nt-ps-head">
            <Camera className="nt-ps-cup" />
            <span>Captura de pantalla guardada</span>
          </div>
          <div className="nt-ps-name">{n.game}</div>
        </div>
      </div>
    );
  }
  const g = grade(n);
  const info = n.kind === "info";
  const head =
    n.kind === "summary"
      ? `Has conseguido ${summaryCount(n)} trofeos`
      : info
        ? n.title
        : g === "platinum"
          ? "Has conseguido el trofeo de platino"
          : `Has conseguido un trofeo de ${GRADE_NAME[g]}`;
  return (
    <div className={cls("nt-ps", `g-${g}`, info && "info")}>
      <Art src={info ? null : n.icon} className="nt-ps-art">
        {info ? <Pad /> : <Cup />}
      </Art>
      <div className="nt-ps-txt">
        <div className="nt-ps-head">
          {!info && <Cup className="nt-ps-cup" />}
          <span>{head}</span>
        </div>
        <div className="nt-ps-name">{info ? n.body : n.title}</div>
      </div>
    </div>
  );
}

// ─────────── Xbox: abajo en el centro; el círculo se abre en píldora ───────────

function Xbox({ n, look }: P) {
  const rare = isRare(n);
  const style = look.accent ? ({ "--x-accent": look.accent } as CSSProperties) : undefined;
  if (isShot(n)) {
    return (
      <div className="nt-xbox info" style={style}>
        <div className="nt-x-orb">
          <Camera />
        </div>
        <div className="nt-x-pill">
          <div className="nt-x-txt">
            <div className="nt-x-l1">Captura realizada</div>
            <div className="nt-x-l2">
              <span className="nt-x-name">{n.game}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const info = n.kind === "info";
  const l1 = n.kind === "summary" ? `${summaryCount(n)} logros desbloqueados` : info ? n.title : rare ? "Logro raro desbloqueado" : "Logro desbloqueado";
  return (
    <div className={cls("nt-xbox", rare && "rare", info && "info")} style={style}>
      <div className="nt-x-orb">{info ? <Pad /> : rare ? <Gem /> : <Cup />}</div>
      <div className="nt-x-pill">
        <div className="nt-x-txt">
          <div className="nt-x-l1">{l1}</div>
          <div className="nt-x-l2">
            {info ? (
              n.body
            ) : (
              <>
                {n.score != null && (
                  <>
                    <span className="nt-x-g">G</span>
                    <span className="nt-x-score">{n.score}</span>
                    <span className="nt-x-sep">-</span>
                  </>
                )}
                <span className="nt-x-name">{n.kind === "summary" ? n.body : n.title}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────── Switch: arriba a la izquierda, tarjeta redonda y clara ───────────

function Switch({ n, look }: P) {
  const info = n.kind === "info";
  const head = n.kind === "summary" ? "Resumen de la partida" : info ? n.game || "ejGames" : "Logro desbloqueado";
  const style = look.accent ? ({ "--sw-accent": look.accent } as CSSProperties) : undefined;
  if (isShot(n)) {
    return (
      <div className={cls("nt-switch", look.dark && "dark")} style={style}>
        <Art src={n.icon} className="nt-sw-icon is-shot">
          <Camera />
        </Art>
        <div className="nt-sw-txt">
          <div className="nt-sw-head">Álbum</div>
          <div className="nt-sw-name">Captura guardada</div>
          <div className="nt-sw-desc">{n.game}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cls("nt-switch", look.dark && "dark")} style={style}>
      <Art src={info ? null : n.icon} className="nt-sw-icon">
        {info ? <Pad /> : <Cup />}
      </Art>
      <div className="nt-sw-txt">
        <div className="nt-sw-head">{head}</div>
        <div className="nt-sw-name">{n.title}</div>
        {n.body && <div className="nt-sw-desc">{n.body}</div>}
      </div>
    </div>
  );
}

// ─────────── Cine: rótulo en la parte inferior izquierda ───────────

function Cinema({ n, look }: P) {
  const info = n.kind === "info";
  const shot = isShot(n);
  const kicker = shot ? "Captura guardada" : n.kind === "summary" ? "Resumen de la partida" : info ? n.game || "ejGames" : "Logro desbloqueado";
  const meta = [n.kind === "achievement" ? n.game : null, n.rarity != null ? `${pct(n.rarity)} % de los jugadores` : null].filter(Boolean).join("  ·  ");
  const style = look.accent ? ({ "--c-accent": look.accent } as CSSProperties) : undefined;
  return (
    <div className="nt-cinema" style={style}>
      <i className="nt-c-bar" />
      <Art src={info ? null : n.icon} className={cls("nt-c-icon", shot && "is-shot")}>
        {info ? <Pad /> : shot ? <Camera /> : <Cup />}
      </Art>
      <div className="nt-c-txt">
        <div className="nt-c-kicker">{kicker}</div>
        <div className="nt-c-name">{shot ? n.game : n.title}</div>
        {n.body && <div className="nt-c-desc">{shot ? shortDir(n.body) : n.body}</div>}
        {meta && <div className="nt-c-meta">{meta}</div>}
      </div>
    </div>
  );
}

// ─────────── Arcade retro: cartel pixelado arriba en el centro ───────────

function Retro({ n, look }: P) {
  if (isShot(n)) {
    return (
      <div className={cls("nt-retro", `pal-${look.palette || "arcade"}`)}>
        <div className="nt-r-head">
          <span className="nt-r-star">★</span>
          Foto guardada
          <span className="nt-r-star">★</span>
        </div>
        <div className="nt-r-body">
          <Art src={n.icon} className="nt-r-icon is-shot">
            <Camera />
          </Art>
          <div className="nt-r-txt">
            <div className="nt-r-name">{n.game}</div>
          </div>
        </div>
      </div>
    );
  }
  const info = n.kind === "info";
  const head = n.kind === "summary" ? `${summaryCount(n)} logros` : info ? "Player 1" : isRare(n) ? "Logro raro" : "Logro desbloqueado";
  const meta = info
    ? null
    : [n.score != null ? `+${n.score} pts` : null, n.rarity != null ? `${pct(n.rarity)}%` : null, n.progress ? `${n.progress[0]}/${n.progress[1]}` : null]
        .filter(Boolean)
        .join("  ");
  return (
    <div className={cls("nt-retro", `pal-${look.palette || "arcade"}`)}>
      <div className="nt-r-head">
        <span className="nt-r-star">★</span>
        {head}
        <span className="nt-r-star">★</span>
      </div>
      <div className="nt-r-body">
        <Pixel src={info ? null : n.icon} className="nt-r-icon">
          {info ? <Pad /> : <Cup />}
        </Pixel>
        <div className="nt-r-txt">
          <div className="nt-r-name">{info ? n.body : n.kind === "summary" ? n.body : n.title}</div>
          {meta && <div className="nt-r-meta">{meta}</div>}
        </div>
      </div>
    </div>
  );
}

// ─────────── ejGames: sobrio, con los colores del tema ───────────

function Plain({ n, look }: P) {
  const info = n.kind === "info";
  const shot = isShot(n);
  const head = shot ? "Captura guardada" : n.kind === "summary" ? "Resumen de la partida" : info ? n.game || "ejGames" : "Logro desbloqueado";
  const meta = [
    n.rarity != null ? `${pct(n.rarity)} % de los jugadores` : null,
    n.kind !== "info" && n.progress ? `${n.progress[0]} de ${n.progress[1]}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const vars: Record<string, string> = {};
  if (look.accent) vars["--e-accent"] = look.accent;
  if (look.surface) vars["--e-surface"] = look.surface;
  if (look.text) vars["--e-text"] = look.text;
  if (look.radius) vars["--e-radius"] = look.radius;
  if (look.font) vars["--e-font"] = look.font;
  return (
    <div className={cls("nt-plain", !look.dark && "light")} style={vars as CSSProperties}>
      <Art src={info ? null : n.icon} className={cls("nt-e-icon", shot && "is-shot")}>
        {info ? <Pad /> : shot ? <Camera /> : <Cup />}
      </Art>
      <div className="nt-e-txt">
        <div className="nt-e-head">{head}</div>
        <div className="nt-e-name">{shot ? n.game : n.title}</div>
        {n.body && <div className="nt-e-desc">{shot ? shortDir(n.body) : n.body}</div>}
        {meta && <div className="nt-e-meta">{meta}</div>}
      </div>
    </div>
  );
}

const VIEWS: Record<NoticeStyle, (p: P) => ReactNode> = {
  steam: Steam,
  playstation: PlayStation,
  xbox: Xbox,
  switch: Switch,
  cinema: Cinema,
  retro: Retro,
  ejgames: Plain,
};

export function NoticeView({ n, leaving }: { n: OverlayNotice; leaving?: boolean }) {
  const look = n.look;
  const View = VIEWS[look.style] ?? Plain;
  return (
    <div className={cls("nt", `nt-at-${look.corner}`, leaving && "leaving")} data-style={look.style}>
      <View n={n} look={look} />
    </div>
  );
}

/** Pila de avisos en su esquina (la del aviso más reciente). */
export function NoticeStack({ corner, children }: { corner: NoticeLook["corner"]; children: ReactNode }) {
  return <div className={`nt-stack ${corner}`}>{children}</div>;
}
