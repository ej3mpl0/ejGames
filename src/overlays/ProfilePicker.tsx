// Selector de perfiles estilo consola. Pantalla de inicio o overlay para cambiar.

import { useState } from "react";
import { Lock, Plus, X } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { Profile } from "../api/types";
import { Button, TextInput, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { playSound } from "../host/sounds";
import { PROFILE_COLORS } from "../lib/format";
import { useApp } from "../store/app";
import { Hints } from "../components/Hints";

export function Avatar({ p, size = 120 }: { p: Pick<Profile, "name" | "avatar" | "color">; size?: number }) {
  return p.avatar ? (
    <img src={p.avatar} alt="" className="rounded-full object-cover shadow-xl" style={{ width: size, height: size }} draggable={false} />
  ) : (
    <div
      className="grid place-items-center rounded-full font-semibold text-white shadow-xl"
      style={{ width: size, height: size, background: p.color, fontSize: size * 0.4 }}
    >
      {(p.name[0] || "?").toUpperCase()}
    </div>
  );
}

export function ProfilePicker({ onLogin, onClose }: { onLogin: (p: Profile) => void; onClose?: () => void }) {
  const profiles = useApp((s) => s.profiles);
  const current = useApp((s) => s.profile);
  const upsert = useApp((s) => s.upsertProfile);
  const toast = useApp((s) => s.toast);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROFILE_COLORS[1]);
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (pinFor ? setPinFor(null) : creating ? setCreating(false) : onClose?.()),
  });

  async function enter(p: Profile, code?: string) {
    if (p.hasPin && code === undefined) {
      setPin("");
      setPinFor(p);
      return;
    }
    try {
      const prof = await api.login(p.id, code);
      playSound("launch");
      onLogin(prof);
    } catch (e) {
      playSound("error");
      toast("error", errMsg(e));
      setPin("");
    }
  }

  async function create() {
    if (!name.trim()) return;
    try {
      const p = await api.createProfile(name.trim(), color, current?.themeId ?? "steam");
      upsert(p);
      setCreating(false);
      setName("");
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  function digit(d: string) {
    const next = (pin + d).slice(0, 8);
    setPin(next);
    if (next.length >= 4 && pinFor) {
      // Se intenta en cada dígito a partir de 4 (PIN de 4 a 8 cifras).
      api.login(pinFor.id, next).then(
        (prof) => {
          playSound("launch");
          onLogin(prof);
        },
        () => next.length === 8 && (playSound("error"), setPin("")),
      );
    }
  }

  return (
    <div ref={ref} className="overlay-enter absolute inset-0 z-40 flex flex-col bg-[radial-gradient(ellipse_at_center,#172036_0%,#07090e_70%)]">
      <div className="h-10 shrink-0" onMouseDown={(e) => e.button === 0 && void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag")} />
      {onClose && (
        <button data-nav onClick={onClose} className="absolute right-6 top-12 grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-white/10 cursor-pointer">
          <X />
        </button>
      )}
      <div className="flex flex-1 flex-col items-center justify-center">
        <h1 className="mb-14 text-3xl font-light tracking-wide text-white/90">¿Quién va a jugar?</h1>
        <div className="flex flex-wrap items-start justify-center gap-10 px-10" data-focus-group>
          {profiles.map((p) => (
            <button
              key={p.id}
              data-nav
              data-autofocus={p.id === current?.id || undefined}
              onClick={() => enter(p)}
              className="group flex w-40 flex-col items-center gap-4 rounded-3xl p-3 outline-none cursor-pointer [&.is-focused]:shadow-none"
            >
              <span className="rounded-full p-1 transition-transform group-hover:scale-105 group-[.is-focused]:scale-110 group-[.is-focused]:ring-4 group-[.is-focused]:ring-white/90">
                <Avatar p={p} size={128} />
              </span>
              <span className="flex items-center gap-1.5 text-lg text-white/80 group-[.is-focused]:text-white">
                {p.hasPin && <Lock size={14} className="opacity-60" />}
                {p.name}
              </span>
            </button>
          ))}
          <button
            data-nav
            onClick={() => setCreating(true)}
            className="group flex w-40 flex-col items-center gap-4 rounded-3xl p-3 cursor-pointer [&.is-focused]:shadow-none"
          >
            <span className="grid h-[136px] w-[136px] place-items-center rounded-full border-2 border-dashed border-white/25 text-white/50 transition group-hover:border-white/60 group-[.is-focused]:scale-110 group-[.is-focused]:border-white">
              <Plus size={40} />
            </span>
            <span className="text-lg text-white/60">Añadir</span>
          </button>
        </div>
      </div>

      <Hints
        className="absolute bottom-8 left-0 right-0 justify-center text-sm"
        items={onClose ? [["accept", "Entrar"], ["back", "Volver"]] : [["accept", "Entrar"]]}
      />

      {creating && (
        <div className="absolute inset-0 grid place-items-center bg-black/60" data-focus-trap>
          <div className="panel-enter glass w-[420px] rounded-3xl p-6">
            <h2 className="mb-4 text-lg font-semibold">Nuevo perfil</h2>
            <TextInput autoFocus data-autofocus placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="mt-4 flex flex-wrap gap-2">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  data-nav
                  onClick={() => setColor(c)}
                  className={cx("h-8 w-8 rounded-full cursor-pointer", c === color && "ring-2 ring-white ring-offset-2 ring-offset-black")}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={create} disabled={!name.trim()}>
                Crear
              </Button>
            </div>
          </div>
        </div>
      )}

      {pinFor && (
        <div className="absolute inset-0 grid place-items-center bg-black/70" data-focus-trap>
          <div className="panel-enter flex flex-col items-center">
            <Avatar p={pinFor} size={88} />
            <div className="mt-4 text-lg">{pinFor.name}</div>
            <div className="my-6 flex gap-3">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span key={i} className={cx("h-3.5 w-3.5 rounded-full", i < pin.length ? "bg-white" : "bg-white/20")} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
                d ? (
                  <button
                    key={i}
                    data-nav
                    data-autofocus={d === "5" || undefined}
                    onClick={() => (d === "⌫" ? setPin(pin.slice(0, -1)) : digit(d))}
                    className="h-16 w-16 rounded-full bg-white/10 text-xl hover:bg-white/20 cursor-pointer"
                  >
                    {d}
                  </button>
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
            <input
              className="absolute opacity-0"
              autoFocus
              value=""
              onChange={() => {}}
              onKeyDown={(e) => {
                if (/^\d$/.test(e.key)) digit(e.key);
                if (e.key === "Backspace") setPin(pin.slice(0, -1));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
