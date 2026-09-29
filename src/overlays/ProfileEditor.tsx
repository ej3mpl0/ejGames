// Editor del perfil de la cuenta (común a todos los temas, como Ajustes):
// nombre, bio, avatar y marco, fondo animado o imagen, color, vitrinas,
// insignia destacada y privacidad, con la página de perfil de verdad al lado.

import { useMemo, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, Eye, Image as ImageIcon, LayoutGrid, Lock, Palette, UserRound } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { SocialProfile, SocialShowcase } from "../api/types";
import { ProfilePreview } from "../components/social";
import { Button, Cycle, Field, Modal, Tabs, TextInput, Toggle, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";
import { BACKGROUNDS, BADGES, COLORS, FRAMES, SHOWCASES, TIERS, avatar } from "../../sdk/kit/social.js";

type Sec = "general" | "avatar" | "background" | "showcases" | "privacy";

const SECS: { value: Sec; label: string; icon: ReactNode }[] = [
  { value: "general", label: "General", icon: <UserRound size={17} /> },
  { value: "avatar", label: "Avatar y marco", icon: <ImageIcon size={17} /> },
  { value: "background", label: "Fondo y color", icon: <Palette size={17} /> },
  { value: "showcases", label: "Vitrinas", icon: <LayoutGrid size={17} /> },
  { value: "privacy", label: "Privacidad", icon: <Lock size={17} /> },
];

type Draft = SocialProfile;

const IMAGE_FILTERS = [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }];

/** Un elemento del DOM del kit (avatar con marco) dentro de React. */
function KitNode({ node }: { node: HTMLElement }) {
  return <span ref={(el) => void (el && el.replaceChildren(node))} className="contents" />;
}

export function ProfileEditorOverlay({ onClose }: { onClose: () => void }) {
  const account = useApp((s) => s.account);
  const games = useApp((s) => s.games);
  const toast = useApp((s) => s.toast);
  const me = account?.social?.me;
  const [sec, setSec] = useState<Sec>("general");
  const [draft, setDraft] = useState<Draft | null>(me ? structuredClone(me.profile) : null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  const played = useMemo(() => games.filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime), [games]);

  // La página de perfil tal cual la verán los demás (con la biblioteca local para las portadas).
  const preview = useMemo(() => {
    if (!me || !draft) return null;
    return {
      id: me.id,
      username: me.username,
      name: draft.name,
      avatarUrl: draft.avatarUrl,
      frame: draft.frame,
      level: me.level,
      relation: "self",
      memberSince: me.createdAt,
      background: draft.background,
      backgroundImageUrl: draft.backgroundImage ? draft.backgroundImageUrl : undefined,
      color: draft.color,
      country: draft.country,
      profile: { ...draft, featuredBadge: draft.featuredBadge },
      xp: me.xp,
      badges: me.badges,
      presence: { status: "online" },
      friends: account?.social?.friends.length ?? 0,
      summary: {
        games: played.map((g) => ({
          title: g.title,
          minutes: Math.floor(g.playtime / 60),
          last: g.lastPlayed,
          ach: g.achievements ? [g.achievements.unlocked, g.achievements.total] : null,
          coverUrl: g.media.header || g.media.cover,
        })),
        stats: {
          minutes: Math.floor(played.reduce((s, g) => s + g.playtime, 0) / 60),
          achievements: games.reduce((s, g) => s + (g.achievements?.unlocked ?? 0), 0),
          perfect: games.filter((g) => g.achievements && g.achievements.total > 0 && g.achievements.unlocked === g.achievements.total).length,
        },
      },
      activity: [],
    };
  }, [me, draft, played, games, account?.social?.friends.length]);

  if (!me || !draft || !preview) {
    return (
      <Modal ref={ref} title="Editar perfil" onClose={onClose} width="min(560px, 94vw)" height="auto">
        <p className="p-6 text-sm text-muted">Entra en tu cuenta de ejGames (Ajustes → Cuenta y amigos) para editar tu perfil.</p>
      </Modal>
    );
  }

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const showcases = draft.showcases;
  const setShowcases = (list: SocialShowcase[]) => set({ showcases: list });
  const hasType = (t: SocialShowcase["type"]) => showcases.findIndex((s) => s.type === t);

  async function upload(kind: "avatar" | "background" | "shot") {
    const path = await openDialog({ multiple: false, filters: IMAGE_FILTERS });
    if (typeof path !== "string") return null;
    setBusy(kind);
    try {
      return await api.accountImage(kind, path);
    } catch (e) {
      toast("error", errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const orig = me!.profile;
      const patch: Record<string, unknown> = {};
      const keys: (keyof Draft)[] = ["name", "realName", "country", "bio", "avatar", "backgroundImage", "frame", "background", "color", "showcases", "featuredBadge", "privacy", "comments"];
      for (const k of keys) {
        if (JSON.stringify(draft![k] ?? null) !== JSON.stringify(orig[k] ?? null)) {
          // Las vitrinas van sin las URL (el servidor guarda hashes).
          patch[k] = k === "showcases" ? draft!.showcases.map(({ urls: _u, ...s }) => s) : draft![k] ?? null;
        }
      }
      if (Object.keys(patch).length) await api.accountProfile(patch);
      toast("ok", "Perfil guardado");
      onClose();
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const gameOptions = [{ value: "", label: "— Ninguno —" }, ...played.map((g) => ({ value: g.title, label: g.title }))];

  let body: ReactNode;
  switch (sec) {
    case "general":
      body = (
        <>
          <Field label="Nombre visible">
            <TextInput value={draft.name} maxLength={32} onChange={(e) => set({ name: e.target.value })} data-autofocus />
          </Field>
          <Field label="Nombre real" hint="Opcional.">
            <TextInput value={draft.realName} maxLength={60} onChange={(e) => set({ realName: e.target.value })} />
          </Field>
          <Field label="País" hint="Código de 2 letras (ES, MX, AR…).">
            <TextInput value={draft.country} maxLength={2} className="w-24 uppercase" onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Sobre ti">
            <textarea
              data-nav
              value={draft.bio}
              maxLength={1000}
              rows={5}
              onChange={(e) => set({ bio: e.target.value })}
              className="w-full rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 p-3 text-sm outline-none ring-1 ring-line focus:ring-2 focus:ring-accent"
            />
          </Field>
        </>
      );
      break;
    case "avatar":
      body = (
        <>
          <div className="flex items-center gap-4 px-3 py-3">
            <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: draft.frame, name: draft.name }, { size: "l" })} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy === "avatar"}
                onClick={() =>
                  void upload("avatar").then((r) => {
                    if (r) set({ avatar: r.hash, avatarUrl: r.url ?? undefined });
                  })
                }
              >
                {busy === "avatar" ? "Subiendo…" : "Subir imagen"}
              </Button>
              {draft.avatar && (
                <Button size="sm" onClick={() => set({ avatar: null, avatarUrl: undefined })}>
                  Quitar
                </Button>
              )}
            </div>
          </div>
          <p className="px-3 pb-2 text-xs text-muted">Se recorta en cuadrado (184 × 184).</p>
          <div className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted">Marco</div>
          <div className="grid grid-cols-4 gap-2 px-3">
            {FRAMES.map((f: { id: string; name: string }) => (
              <button
                key={f.id || "none"}
                data-nav
                onClick={() => set({ frame: f.id })}
                className={cx("flex flex-col items-center gap-2 rounded-lg p-3 text-xs cursor-pointer", draft.frame === f.id ? "bg-accent/15 ring-1 ring-accent" : "bg-surface-3/50 hover:bg-surface-3")}
              >
                <KitNode node={avatar({ avatarUrl: draft.avatarUrl, frame: f.id, name: draft.name }, { size: "m" })} />
                {f.name}
              </button>
            ))}
          </div>
        </>
      );
      break;
    case "background":
      body = (
        <>
          <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">Fondo animado</div>
          <div className="grid grid-cols-3 gap-2 px-3">
            {BACKGROUNDS.map((b: { id: string; name: string }) => (
              <button
                key={b.id || "none"}
                data-nav
                onClick={() => set({ background: b.id, backgroundImage: null, backgroundImageUrl: undefined })}
                className={cx(
                  "s-view s-skin relative h-20 overflow-hidden rounded-lg text-xs font-semibold cursor-pointer",
                  b.id && `s-bg-${b.id}`,
                  !draft.backgroundImage && draft.background === b.id ? "ring-2 ring-accent" : "ring-1 ring-line",
                )}
              >
                <span className="s-backdrop" />
                <span className="absolute bottom-1.5 left-2 text-white drop-shadow">{b.name}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 pt-4">
            <Button
              size="sm"
              disabled={busy === "background"}
              onClick={() =>
                void upload("background").then((r) => {
                  if (r) set({ backgroundImage: r.hash, backgroundImageUrl: r.url ?? undefined });
                })
              }
            >
              {busy === "background" ? "Subiendo…" : "Usar una imagen propia"}
            </Button>
            {draft.backgroundImage && (
              <Button size="sm" onClick={() => set({ backgroundImage: null, backgroundImageUrl: undefined })}>
                Quitar la imagen
              </Button>
            )}
          </div>
          <p className="px-3 pt-1 text-xs text-muted">1920 × 1080, se recorta para llenar.</p>
          <div className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted">Color del perfil</div>
          <div className="flex flex-wrap gap-2 px-3">
            {COLORS.map((c: { id: string; name: string; accent: string }) => (
              <button
                key={c.id || "blue"}
                data-nav
                title={c.name}
                onClick={() => set({ color: c.id })}
                className={cx("flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-xs cursor-pointer", draft.color === c.id ? "ring-2 ring-accent bg-surface-3" : "bg-surface-3/50")}
              >
                <span className="h-5 w-5 rounded-full" style={{ background: c.accent }} />
                {c.name}
              </button>
            ))}
          </div>
        </>
      );
      break;
    case "showcases": {
      const badgeOptions = [{ value: "", label: "La primera" }, ...me.badges.map((b) => ({ value: b.id, label: `${BADGES[b.id as keyof typeof BADGES]?.name ?? b.id} (${TIERS[b.tier] ?? ""})` }))];
      body = (
        <>
          <p className="px-3 pb-2 text-sm text-muted">Elige qué enseña tu perfil y en qué orden (hasta 6).</p>
          {(SHOWCASES as { type: SocialShowcase["type"]; name: string }[]).map((def) => {
            const i = hasType(def.type);
            const on = i >= 0;
            const s = on ? showcases[i] : null;
            const toggle = (v: boolean) => {
              if (v && showcases.length >= 6) return toast("info", "Como mucho 6 vitrinas");
              setShowcases(v ? [...showcases, { type: def.type }] : showcases.filter((x) => x.type !== def.type));
            };
            const move = (d: number) => {
              const j = i + d;
              if (j < 0 || j >= showcases.length) return;
              const copy = [...showcases];
              [copy[i], copy[j]] = [copy[j], copy[i]];
              setShowcases(copy);
            };
            const patch = (p: Partial<SocialShowcase>) => setShowcases(showcases.map((x, k) => (k === i ? { ...x, ...p } : x)));
            return (
              <div key={def.type} className={cx("mx-2 mb-1 rounded-lg", on && "bg-surface-3/40")}>
                <div className="flex items-center">
                  <div className="flex-1">
                    <Toggle label={on ? `${i + 1}. ${def.name}` : def.name} checked={on} onChange={toggle} />
                  </div>
                  {on && (
                    <div className="flex gap-1 pr-2">
                      <Button size="sm" variant="ghost" aria-label="Subir" onClick={() => move(-1)}>
                        <ArrowUp size={15} />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Bajar" onClick={() => move(1)}>
                        <ArrowDown size={15} />
                      </Button>
                    </div>
                  )}
                </div>
                {s && (def.type === "featured" || def.type === "favorite") && (
                  <Cycle label="Juego" value={s.game ?? ""} options={gameOptions} onChange={(v) => patch({ game: v })} />
                )}
                {s && def.type === "text" && (
                  <>
                    <Field label="Título">
                      <TextInput value={s.title ?? ""} maxLength={60} onChange={(e) => patch({ title: e.target.value })} />
                    </Field>
                    <Field label="Texto">
                      <textarea
                        data-nav
                        value={s.text ?? ""}
                        maxLength={2000}
                        rows={4}
                        onChange={(e) => patch({ text: e.target.value })}
                        className="w-full rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 p-3 text-sm outline-none ring-1 ring-line focus:ring-2 focus:ring-accent"
                      />
                    </Field>
                  </>
                )}
                {s && def.type === "screenshots" && (
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                    {(s.items ?? []).map((h, k) => (
                      <button
                        key={h}
                        data-nav
                        title="Quitar"
                        onClick={() => patch({ items: (s.items ?? []).filter((x) => x !== h), urls: (s.urls ?? []).filter((_, n) => n !== k) })}
                        className="h-14 w-24 overflow-hidden rounded ring-1 ring-line cursor-pointer"
                      >
                        {s.urls?.[k] && <img src={s.urls[k]} className="h-full w-full object-cover" alt="" />}
                      </button>
                    ))}
                    {(s.items ?? []).length < 4 && (
                      <Button
                        size="sm"
                        disabled={busy === "shot"}
                        onClick={() =>
                          void upload("shot").then((r) => {
                            if (r) patch({ items: [...(s.items ?? []), r.hash], urls: [...(s.urls ?? []), r.url ?? ""] });
                          })
                        }
                      >
                        {busy === "shot" ? "Subiendo…" : "+ Añadir captura"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {me.badges.length > 0 && <Cycle label="Insignia destacada" value={draft.featuredBadge} options={badgeOptions} onChange={(v) => set({ featuredBadge: v })} />}
        </>
      );
      break;
    }
    case "privacy":
      body = (
        <>
          <Cycle
            label="¿Quién ve tu perfil?"
            value={draft.privacy}
            options={[
              { value: "public", label: "Cualquiera" },
              { value: "friends", label: "Solo mis amigos" },
              { value: "private", label: "Solo yo" },
            ]}
            onChange={(v) => set({ privacy: v })}
          />
          <p className="px-3 pb-3 text-xs text-muted">Tus juegos, horas, logros y actividad salen en tu perfil. Si es privado, los demás solo ven tu nombre, tu avatar y tu nivel.</p>
          <Cycle
            label="¿Quién puede comentar?"
            value={draft.comments}
            options={[
              { value: "public", label: "Cualquiera" },
              { value: "friends", label: "Mis amigos" },
              { value: "off", label: "Nadie" },
            ]}
            onChange={(v) => set({ comments: v })}
          />
        </>
      );
      break;
  }

  return (
    <Modal
      ref={ref}
      title="Editar perfil"
      onClose={onClose}
      width="min(1500px, 97vw)"
      height="94vh"
      headerExtra={
        <div className="flex gap-2">
          <Button size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" disabled={busy === "save"} onClick={() => void save()}>
            {busy === "save" ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      }
    >
      <div className="flex h-full min-h-0">
        <aside className="w-52 shrink-0 border-r border-line p-3">
          <Tabs tabs={SECS} value={sec} onChange={setSec} />
          <div className="mt-6 flex items-center gap-2 px-3 text-xs text-muted">
            <Eye size={14} /> Vista previa a la derecha
          </div>
        </aside>
        <div className="w-[440px] shrink-0 overflow-y-auto border-r border-line py-3">{body}</div>
        <div className="min-w-0 flex-1 overflow-hidden p-3">
          <ProfilePreview data={preview} />
        </div>
      </div>
    </Modal>
  );
}
