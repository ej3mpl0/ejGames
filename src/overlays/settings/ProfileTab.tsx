import { useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, KeyRound, LogOut, PenLine, Trash2, UserRound } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import { openProfile, refreshPage } from "../../host/profile";
import { Button, Cycle, Section, Slider, TextInput, Toggle, cx } from "../../components/ui";
import { PROFILE_COLORS } from "../../lib/format";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import { Avatar } from "../ProfilePicker";

export function ProfileTab() {
  const profile = useApp((s) => s.profile)!;
  const profiles = useApp((s) => s.profiles);
  const upsert = useApp((s) => s.upsertProfile);
  const toast = useApp((s) => s.toast);
  const open = useApp((s) => s.open);
  const [name, setName] = useState(profile.name);
  const [pin, setPin] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const volTimer = useRef(0);

  async function patch(p: Parameters<typeof api.updateProfile>[1]) {
    try {
      upsert(await api.updateProfile(profile.id, p));
      refreshPage();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <div>
      <Section title="Tu perfil">
        <div className="flex items-center gap-5 p-3">
          <Avatar p={profile} size={84} />
          <div className="flex-1">
            <TextInput value={name} maxLength={32} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== profile.name && patch({ name: name.trim() })} />
            <div className="mt-3 flex flex-wrap gap-2">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  data-nav
                  onClick={() => patch({ color: c })}
                  className={cx("h-7 w-7 rounded-full cursor-pointer", c === profile.color && "ring-2 ring-white ring-offset-2 ring-offset-[var(--h-surface)]")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              icon={<ImagePlus size={14} />}
              onClick={async () => {
                const path = await openDialog({ multiple: false, filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
                if (typeof path === "string") upsert(await api.setAvatar(profile.id, path));
                refreshPage();
              }}
            >
              Cambiar avatar
            </Button>
            {profile.avatar && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  upsert(await api.setAvatar(profile.id, null));
                  refreshPage();
                }}
              >
                Quitar avatar
              </Button>
            )}
          </div>
        </div>
        <p className="px-3 text-xs text-muted">
          Tu perfil al estilo Steam (resumen, marco, fondo, vitrinas, nivel e insignias) se guarda en este PC, como tus horas y tus logros.
        </p>
        <div className="flex flex-wrap gap-2 p-3">
          <Button size="sm" icon={<UserRound size={14} />} onClick={() => openProfile("profile")}>
            Ver mi perfil
          </Button>
          <Button size="sm" variant="ghost" icon={<PenLine size={14} />} onClick={() => openProfile("profile-editor")}>
            Editar perfil
          </Button>
        </div>
      </Section>

      <Section title="Al jugar">
        <Cycle
          label="Cuando lanzo un juego"
          value={profile.launchBehavior}
          options={[
            { value: "saver", label: "Modo ahorro (cerrar interfaz)" },
            { value: "minimize", label: "Minimizar ejGames" },
            { value: "none", label: "No hacer nada" },
          ]}
          onChange={(v) => patch({ launchBehavior: v })}
        />
        <p className="px-3 pb-2 text-xs text-muted">
          El modo ahorro cierra la interfaz mientras juegas y deja solo el núcleo en la bandeja (unos pocos MB): sigue contando horas y mostrando
          Discord. Al salir del juego, ejGames vuelve solo.
        </p>
        <Toggle label="Mostrar en Discord a qué estoy jugando" checked={profile.discordEnabled} onChange={(v) => patch({ discordEnabled: v })} />
        <Toggle
          label="Ocultar el nombre del juego en Discord"
          hint="Se verá «Jugando a Un juego»."
          checked={profile.discordHideNames}
          onChange={(v) => patch({ discordHideNames: v })}
        />
        <Slider
          label="Volumen de los sonidos de la interfaz"
          min={0}
          max={1}
          step={0.05}
          value={profile.soundsVolume}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => {
            upsert({ ...profile, soundsVolume: v });
            clearTimeout(volTimer.current);
            volTimer.current = window.setTimeout(() => void api.updateProfile(profile.id, { soundsVolume: v }), 400);
          }}
        />
      </Section>

      <Section title={t("Modo juego")}>
        <p className="px-3 pb-1 text-xs text-muted">{t("Es de este perfil: cada perfil elige si quiere el modo juego.")}</p>
        <Toggle
          label={t("Plan de energía de alto rendimiento")}
          hint={t("Mientras juegas, Windows usa el plan de alto rendimiento; al cerrar el juego vuelve el que tenías.")}
          checked={profile.gameModePower}
          onChange={(v) => patch({ gameModePower: v })}
        />
        <Toggle
          label={t("Silenciar las notificaciones de Windows")}
          hint={t("Sin avisos que te tapen la partida. Al cerrar el juego se activan otra vez.")}
          checked={profile.gameModeDnd}
          onChange={(v) => patch({ gameModeDnd: v })}
        />
      </Section>

      <Section title="Privacidad">
        <div className="flex items-center gap-3 px-3 py-2">
          <KeyRound size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-sm">{profile.hasPin ? "Este perfil tiene PIN" : "Protege este perfil con un PIN (4 a 8 cifras)"}</span>
          <div className="w-36 shrink-0">
            <TextInput
              inputMode="numeric"
              maxLength={8}
              placeholder="Nuevo PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button size="sm" disabled={pin.length < 4} onClick={() => patch({ pin }).then(() => setPin(""))}>
            Guardar
          </Button>
          {profile.hasPin && (
            <Button size="sm" variant="ghost" onClick={() => patch({ pin: "" })}>
              Quitar
            </Button>
          )}
        </div>
      </Section>

      <Section title="Perfiles">
        <div className="flex flex-wrap gap-2 p-2">
          <Button icon={<LogOut size={15} />} onClick={() => open("profiles")}>
            Cambiar de perfil
          </Button>
          {profiles.length > 1 &&
            (confirmDel ? (
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                onClick={async () => {
                  try {
                    await api.deleteProfile(profile.id);
                    location.reload();
                  } catch (e) {
                    toast("error", errMsg(e));
                  }
                }}
              >
                Borrar «{profile.name}» y sus horas
              </Button>
            ) : (
              <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirmDel(true)}>
                Borrar este perfil
              </Button>
            ))}
        </div>
      </Section>
    </div>
  );
}
