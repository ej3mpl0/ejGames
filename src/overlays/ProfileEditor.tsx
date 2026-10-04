// Editor del perfil, como «Editar perfil» de Steam: una página con la
// navegación a la izquierda (General, Avatar, Fondo del perfil, Tema, Insignia
// destacada y Vitrinas destacadas) y cada sección con sus grupos, etiquetas en
// mayúsculas y «Cancelar / Guardar» abajo. Común a todos los temas, como
// Ajustes. Todo se guarda en el PC; el nombre y el avatar son los del perfil
// local.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { locale } from "../lib/i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { ProfileFields, ProfilePage, ProfileShowcase } from "../api/types";
import { ProfilePreview } from "../components/profile";
import { setPage } from "../host/profile";
import { cx } from "../components/ui";
import { autoNav, focusNav, pushNavFilter, useOverlayNav } from "../input/nav";
import { activeTheme, useApp } from "../store/app";
import { BACKGROUNDS, BADGES, COLORS, FRAMES, SHOWCASES, TIERS, avatar, badgeEl } from "../../sdk/kit/profile.js";
import "./profile-editor.css";

type Sec = "general" | "avatar" | "background" | "theme" | "badge" | "showcases";

const SECS: { value: Sec; label: string }[] = [
  { value: "general", label: "General" },
  { value: "avatar", label: "Avatar" },
  { value: "background", label: "Fondo del perfil" },
  { value: "theme", label: "Tema" },
  { value: "badge", label: "Insignia destacada" },
  { value: "showcases", label: "Vitrinas destacadas" },
];

type Draft = ProfileFields;
type Opt<T extends string = string> = { value: T; label: string };

const IMAGE_FILTERS = [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }];

// Países con su nombre en español (Intl), ordenados.
let countries: Opt[] | null = null;
function countryOptions(): Opt[] {
  if (countries) return countries;
  const out: Opt[] = [];
  try {
    const names = new Intl.DisplayNames([locale()], { type: "region" });
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A)
      for (const b of A) {
        const cc = a + b;
        if (/^(Q[M-Z]|X[A-Z]|AA|ZZ|EU|EZ|UN)$/.test(cc)) continue;
        const n = names.of(cc);
        if (n && n !== cc) out.push({ value: cc, label: n });
      }
  } catch {
    /* sin Intl: solo «ninguno» */
  }
  out.sort((x, y) => x.label.localeCompare(y.label, locale()));
  countries = [{ value: "", label: "— No mostrar —" }, ...out];
  return countries;
}

/** Un elemento del DOM del kit (avatar con marco, insignia) dentro de React. */
function KitNode({ node }: { node: HTMLElement | null }) {
  return <span ref={(el) => void (el && node && el.replaceChildren(node))} className="contents" />;
}

/** El desplegable de Steam: botón con ▾ y lista; con mando, ← → lo cambian. */
function Select<T extends string>({ value, options, onChange, className }: { value: T; options: Opt<T>[]; onChange: (v: T) => void; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    const fn = (e: Event) => {
      const next = options[(idx + (e as CustomEvent<number>).detail + options.length) % options.length];
      if (next) onChange(next.value);
    };
    el.addEventListener("cycle", fn);
    return () => el.removeEventListener("cycle", fn);
  }, [idx, options, onChange]);
  // Abierto, «Atrás» lo cierra (y no el editor).
  useEffect(() => {
    if (!open) return;
    return pushNavFilter((a) => {
      if (a !== "back") return false;
      setOpen(false);
      focusNav(btn.current);
      return true;
    });
  }, [open]);
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
    focusNav(btn.current);
  };
  return (
    <div className={cx("pe-select", className)}>
      <button ref={btn} type="button" data-nav data-cycle className="pe-select-btn" onClick={() => setOpen((o) => !o)}>
        <span className="truncate">{options[idx]?.label ?? "—"}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="pe-select-list" onMouseLeave={() => setOpen(false)}>
          {options.map((o) => (
            <button key={o.value} type="button" data-nav ref={o.value === value ? autoNav : undefined} className={cx("pe-select-opt", o.value === value && "is-on")} onClick={() => pick(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Label({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="pe-label">
      <span>{children}</span>
      {extra}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pe-group">
      <h3 className="pe-group-title">{title}</h3>
      {children}
    </section>
  );
}

export function ProfileEditorOverlay({ onClose }: { onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const upsertProfile = useApp((s) => s.upsertProfile);
  // La vista previa con el perfil del tema que usas (cada tema tiene el suyo).
  const themeId = useApp((s) => activeTheme(s)?.id ?? "steam");
  const layout = ["ps5", "xbox", "switch", "cinema", "retro"].includes(themeId) ? themeId : "steam";
  const [sec, setSec] = useState<Sec>("general");
  // Lo guardado (para saber qué ha cambiado) y lo que se está editando.
  const [page, setSaved] = useState<ProfilePage | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  useEffect(() => {
    api
      .profilePage()
      .then((p) => {
        setSaved(p);
        setDraft(structuredClone(p.profile));
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  // Los mismos juegos que salen en el perfil (jugados un minuto o con logros).
  const played = page?.summary.games ?? [];

  // La página de perfil tal cual quedará.
  const preview = useMemo(() => (page && draft ? { ...page, name: draft.name, profile: draft } : null), [page, draft]);

  if (!page || !draft || !preview) {
    return (
      <div ref={ref} className="pe overlay-enter" data-focus-trap>
        <div className="pe-empty">
          <p>{error ?? "Cargando tu perfil…"}</p>
          <button type="button" data-nav className="pe-btn" onClick={onClose}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const KEYS: (keyof Draft)[] = ["name", "avatarUrl", "realName", "country", "bio", "backgroundImageUrl", "frame", "background", "color", "showcases", "featuredBadge"];
  const plain = (d: Draft, k: keyof Draft) => JSON.stringify(d[k] ?? null);
  const changed = KEYS.filter((k) => plain(draft, k) !== plain(page.profile, k));
  const showcases = draft.showcases;
  const setShowcases = (list: ProfileShowcase[]) => set({ showcases: list });

  async function pick(kind: "avatar" | "background" | "shot") {
    const path = await openDialog({ multiple: false, filters: IMAGE_FILTERS });
    if (typeof path !== "string") return null;
    setBusy(kind);
    try {
      return await api.profileImage(kind, path);
    } catch (e) {
      toast("error", errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Guardar no cierra (como en Steam): el perfil de detrás se pone al día solo.
  async function save() {
    if (!changed.length || !draft) return;
    if (!draft.name.trim()) return toast("error", "El nombre no puede estar vacío.");
    setBusy("save");
    try {
      const patch: Record<string, unknown> = {};
      for (const k of changed) patch[k] = draft[k] ?? null;
      const r = await api.profilePageUpdate(patch);
      upsertProfile(r.profile);
      setPage(r.page);
      setSaved(r.page);
      setDraft(structuredClone(r.page.profile));
      toast("ok", "Cambios guardados");
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const gameOptions: Opt[] = [{ value: "", label: "— Elige un juego —" }, ...played.map((g) => ({ value: g.title, label: g.title }))];
  const tile = (on: boolean) => cx("pe-tile", on && "is-on");

  let body: ReactNode;
  switch (sec) {
    case "general":
      body = (
        <>
          <p className="pe-desc">Pon el nombre de tu perfil y tus datos. El nombre y el avatar son los de tu perfil de ejGames (también salen al elegir perfil).</p>
          <Group title="Acerca de">
            <Label>Nombre del perfil</Label>
            <input data-nav data-autofocus className="pe-input" value={draft.name} maxLength={32} onChange={(e) => set({ name: e.target.value })} />
            <Label>Nombre real</Label>
            <input data-nav className="pe-input" value={draft.realName} maxLength={60} placeholder="Opcional" onChange={(e) => set({ realName: e.target.value })} />
          </Group>
          <Group title="Ubicación">
            <Label>País</Label>
            <Select value={draft.country} options={countryOptions()} onChange={(v) => set({ country: v })} className="pe-select-wide" />
          </Group>
          <Group title="Resumen">
            <Label extra={<span className="pe-count">{draft.bio.length} / 1000</span>}>Sobre ti</Label>
            <textarea data-nav className="pe-input pe-textarea" value={draft.bio} maxLength={1000} rows={6} placeholder="No hay información." onChange={(e) => set({ bio: e.target.value })} />
          </Group>
        </>
      );
      break;
    case "avatar":
      body = (
        <>
          <p className="pe-desc">Elige tu avatar. Se admiten JPG, PNG, WEBP y GIF (sin animación); se recorta en cuadrado.</p>
          <div className="pe-avatar-row">
            <div className="pe-avatar-big">
              <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: draft.frame, name: draft.name }, { size: "xl" })} />
            </div>
            <div className="pe-avatar-sizes">
              <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: draft.frame, name: draft.name }, { size: "l" })} />
              <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: draft.frame, name: draft.name }, { size: "s" })} />
            </div>
            <div className="pe-avatar-actions">
              <button
                type="button"
                data-nav
                className="pe-btn is-primary"
                disabled={busy === "avatar"}
                onClick={() =>
                  void pick("avatar").then((url) => {
                    if (url) set({ avatarUrl: url });
                  })
                }
              >
                {busy === "avatar" ? "Cargando…" : "Elegir tu avatar"}
              </button>
              {draft.avatarUrl && (
                <button type="button" data-nav className="pe-btn" onClick={() => set({ avatarUrl: null })}>
                  Quitar el avatar
                </button>
              )}
            </div>
          </div>
          <Group title="Marco del avatar">
            <p className="pe-desc">El marco rodea tu avatar en tu perfil y en los menús de los temas.</p>
            <div className="pe-grid pe-grid-frames">
              {FRAMES.map((f: { id: string; name: string }) => (
                <button key={f.id || "none"} type="button" data-nav className={tile(draft.frame === f.id)} onClick={() => set({ frame: f.id })}>
                  <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: f.id, name: draft.name }, { size: "l" })} />
                  <span className="pe-tile-name">{f.name}</span>
                </button>
              ))}
            </div>
          </Group>
        </>
      );
      break;
    case "background": {
      const cur = draft.backgroundImageUrl ? "image" : draft.background;
      body = (
        <>
          <p className="pe-desc">Elige el fondo de tu perfil: uno animado o una imagen tuya (1920 × 1080; se ve arriba y centrada, como en Steam).</p>
          <div className={cx("pe-bg-preview s-view s-profile", !draft.backgroundImageUrl && draft.background && `s-bg-${draft.background}`, draft.backgroundImageUrl && "has-image", (draft.backgroundImageUrl || draft.background) && "has-bg")}>
            <span className="s-backdrop" style={draft.backgroundImageUrl ? { backgroundImage: `url("${draft.backgroundImageUrl}")` } : undefined} />
          </div>
          <div className="pe-actions-row">
            <button
              type="button"
              data-nav
              className="pe-btn is-primary"
              disabled={busy === "background"}
              onClick={() =>
                void pick("background").then((url) => {
                  if (url) set({ backgroundImageUrl: url });
                })
              }
            >
              {busy === "background" ? "Cargando…" : "Elegir una imagen"}
            </button>
            {(draft.backgroundImageUrl || draft.background) && (
              <button type="button" data-nav className="pe-btn" onClick={() => set({ background: "", backgroundImageUrl: null })}>
                Quitar el fondo
              </button>
            )}
          </div>
          <Group title="Fondos animados">
            <div className="pe-grid pe-grid-bgs">
              {BACKGROUNDS.map((b: { id: string; name: string }) => (
                <button
                  key={b.id || "none"}
                  type="button"
                  data-nav
                  className={tile(cur === b.id)}
                  onClick={() => set({ background: b.id, backgroundImageUrl: null })}
                >
                  <span className={cx("pe-bg-thumb s-view s-profile", b.id && `s-bg-${b.id} has-bg`)}>
                    <span className="s-backdrop" />
                  </span>
                  <span className="pe-tile-name">{b.id ? b.name : "Ninguno"}</span>
                </button>
              ))}
            </div>
          </Group>
        </>
      );
      break;
    }
    case "theme":
      body = (
        <>
          <p className="pe-desc">
            Elige un tema para tu perfil. En el tema Steam cambia los colores de la cabecera, del fondo, de las vitrinas y de los botones; en los demás
            temas, el color de tu perfil (la portada, las barras y los botones).
          </p>
          <div className="pe-grid pe-grid-themes">
            {COLORS.map((t: { id: string; name: string }) => (
              <button key={t.id || "default"} type="button" data-nav className={tile(draft.color === t.id)} onClick={() => set({ color: t.id })}>
                <span className={cx("pe-theme-mock", t.id && `s-theme-${t.id}`)}>
                  <span className="pe-theme-head">
                    <i />
                    <b />
                  </span>
                  <span className="pe-theme-body">
                    <span className="pe-theme-bar" />
                    <span className="pe-theme-block" />
                    <span className="pe-theme-btn" />
                  </span>
                </span>
                <span className="pe-tile-name">{t.name}</span>
              </button>
            ))}
          </div>
          <Group title="Vista previa">
            <div className="pe-live">
              <ProfilePreview data={preview} layout={layout} />
            </div>
          </Group>
        </>
      );
      break;
    case "badge":
      body = (
        <>
          <p className="pe-desc">Elige la insignia que sale en la cabecera de tu perfil, junto a tu nivel.</p>
          {page.badges.length ? (
            <div className="pe-grid pe-grid-badges">
              <button type="button" data-nav className={tile(!draft.featuredBadge)} onClick={() => set({ featuredBadge: "" })}>
                <span className="pe-badge-none">
                  <X size={22} />
                </span>
                <span className="pe-badge-txt">
                  <b>Ninguna</b>
                  <small>No enseñar ninguna insignia</small>
                </span>
              </button>
              {page.badges.map((b) => {
                const def = BADGES[b.id as keyof typeof BADGES];
                return (
                  <button key={b.id} type="button" data-nav className={tile(draft.featuredBadge === b.id)} onClick={() => set({ featuredBadge: b.id })}>
                    <KitNode node={badgeEl(b, "s-")} />
                    <span className="pe-badge-txt">
                      <b>{def?.name ?? b.id}</b>
                      <small>
                        {TIERS[b.tier] ?? ""} · {b.tier * 50} EXP
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="pe-note">Aún no tienes insignias. Se consiguen jugando: horas, logros, juegos al 100 %, juegos distintos y años con tu perfil.</p>
          )}
        </>
      );
      break;
    case "showcases": {
      const free = (SHOWCASES as { type: ProfileShowcase["type"]; name: string }[]).filter((d) => !showcases.some((s) => s.type === d.type));
      body = (
        <>
          <p className="pe-desc">Elige hasta 6 vitrinas y su orden. Salen en tu perfil por encima de la actividad reciente.</p>
          {showcases.map((s, i) => {
            const def = (SHOWCASES as { type: ProfileShowcase["type"]; name: string }[]).find((d) => d.type === s.type);
            const patch = (p: Partial<ProfileShowcase>) => setShowcases(showcases.map((x, k) => (k === i ? { ...x, ...p } : x)));
            const move = (d: number) => {
              const j = i + d;
              if (j < 0 || j >= showcases.length) return;
              const copy = [...showcases];
              [copy[i], copy[j]] = [copy[j], copy[i]];
              setShowcases(copy);
            };
            return (
              <div key={s.type} className="pe-sc">
                <div className="pe-sc-head">
                  <span className="flex-1 truncate">{def?.name ?? s.type}</span>
                  <button type="button" data-nav className="pe-icon" title="Subir" disabled={i === 0} onClick={() => move(-1)}>
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" data-nav className="pe-icon" title="Bajar" disabled={i === showcases.length - 1} onClick={() => move(1)}>
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" data-nav className="pe-icon" title="Quitar la vitrina" onClick={() => setShowcases(showcases.filter((_, k) => k !== i))}>
                    <X size={16} />
                  </button>
                </div>
                <div className="pe-sc-body">
                  {(s.type === "featured" || s.type === "favorite") && (
                    <>
                      <Label>Juego</Label>
                      <Select value={s.game ?? ""} options={gameOptions} onChange={(v) => patch({ game: v })} className="pe-select-wide" />
                    </>
                  )}
                  {s.type === "text" && (
                    <>
                      <Label>Título</Label>
                      <input data-nav className="pe-input" value={s.title ?? ""} maxLength={60} placeholder="Información personalizada" onChange={(e) => patch({ title: e.target.value })} />
                      <Label extra={<span className="pe-count">{(s.text ?? "").length} / 2000</span>}>Texto</Label>
                      <textarea data-nav className="pe-input pe-textarea" value={s.text ?? ""} maxLength={2000} rows={4} onChange={(e) => patch({ text: e.target.value })} />
                    </>
                  )}
                  {s.type === "screenshots" && (
                    <div className="pe-shots">
                      {(s.items ?? []).map((url) => (
                        <button key={url} type="button" data-nav title="Quitar" className="pe-shot" onClick={() => patch({ items: (s.items ?? []).filter((x) => x !== url) })}>
                          <img src={url} alt="" />
                          <X size={14} className="pe-shot-x" />
                        </button>
                      ))}
                      {(s.items ?? []).length < 4 && (
                        <button
                          type="button"
                          data-nav
                          className="pe-shot is-add"
                          disabled={busy === "shot"}
                          onClick={() =>
                            void pick("shot").then((url) => {
                              if (url) patch({ items: [...(s.items ?? []), url] });
                            })
                          }
                        >
                          {busy === "shot" ? "Cargando…" : "+ Añadir captura"}
                        </button>
                      )}
                    </div>
                  )}
                  {(s.type === "stats" || s.type === "recent" || s.type === "achievements" || s.type === "badges") && (
                    <p className="pe-note">Se rellena sola con tu biblioteca: no hay nada que elegir.</p>
                  )}
                </div>
              </div>
            );
          })}
          {showcases.length < 6 && free.length > 0 && (
            <div className="pe-add">
              <button type="button" data-nav className="pe-btn" onClick={() => setAdding((a) => !a)}>
                <Plus size={16} /> Añadir una vitrina
              </button>
              {adding && (
                <div className="pe-add-list">
                  {free.map((d, k) => (
                    <button
                      key={d.type}
                      type="button"
                      data-nav
                      ref={k === 0 ? autoNav : undefined}
                      className="pe-select-opt"
                      onClick={() => {
                        setShowcases([...showcases, { type: d.type }]);
                        setAdding(false);
                      }}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!showcases.length && <p className="pe-note">Sin vitrinas, tu perfil enseña la actividad reciente.</p>}
        </>
      );
      break;
    }
  }

  const title = SECS.find((s) => s.value === sec)!.label;
  return (
    <div ref={ref} className="pe overlay-enter" data-focus-trap>
      <div className="pe-page">
        <header className="pe-top">
          <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: draft.frame, name: draft.name }, { size: "l" })} />
          <div className="pe-crumb">
            <span className="pe-crumb-name">{draft.name || page.name}</span>
            <span className="pe-crumb-sep">»</span>
            <span>Editar perfil</span>
          </div>
          <button type="button" data-nav className="pe-btn" onClick={onClose}>
            Volver a tu perfil
          </button>
        </header>
        <div className="pe-shell">
          <nav className="pe-nav">
            {SECS.map((s) => (
              <button
                key={s.value}
                type="button"
                data-nav
                data-tab
                aria-selected={sec === s.value}
                className={cx("pe-nav-item", sec === s.value && "is-on")}
                onClick={() => {
                  setSec(s.value);
                  setAdding(false);
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <main className="pe-content" key={sec}>
            <h2 className="pe-title">{title}</h2>
            {body}
            <footer className="pe-foot">
              {changed.length > 0 && <span className="pe-dirty">Tienes cambios sin guardar</span>}
              <button type="button" data-nav className="pe-btn" onClick={onClose}>
                {changed.length ? "Cancelar" : "Cerrar"}
              </button>
              <button type="button" data-nav className="pe-btn is-save" disabled={busy === "save" || !changed.length} onClick={() => void save()}>
                {busy === "save" ? "Guardando…" : "Guardar"}
              </button>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
