// Panel del overlay: el de la plataforma del tema (el mismo estilo que los
// avisos). Todo se escala con la pantalla (diseñado a 1920 × 1080).

import { useEffect, useState, type ComponentType } from "react";
import type { NoticeStyle, OverlayLive, OverlayPanel } from "../../api/types";
import { CinemaPanel } from "./cinema";
import { EjGamesPanel } from "./ejgames";
import { usePanel, type Panel } from "./model";
import { MonedaPanel } from "./moneda";
import "./panel.css";
import { PlayStationPanel } from "./playstation";
import { RetroPanel } from "./retro";
import { SteamPanel } from "./steam";
import { SwitchPanel } from "./switch";
import { XboxPanel } from "./xbox";

const VIEWS: Partial<Record<NoticeStyle, ComponentType<{ p: Panel }>>> = {
  steam: SteamPanel,
  xbox: XboxPanel,
  playstation: PlayStationPanel,
  switch: SwitchPanel,
  cinema: CinemaPanel,
  retro: RetroPanel,
  ejgames: EjGamesPanel,
  moneda: MonedaPanel,
};

function useZoom() {
  const calc = () => Math.min(1.6, Math.max(0.72, Math.min(window.innerWidth / 1920, window.innerHeight / 1080)));
  const [zoom, setZoom] = useState(calc);
  useEffect(() => {
    const fn = () => setZoom(calc());
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return zoom;
}

export function PanelView({ data, live }: { data: OverlayPanel; live: OverlayLive }) {
  const p = usePanel(data, live);
  const zoom = useZoom();
  const View = VIEWS[data.look.style] ?? MonedaPanel;
  return (
    <div className="pn-root" data-style={data.look.style} style={{ zoom, width: `${100 / zoom}vw`, height: `${100 / zoom}vh` }}>
      <View p={p} />
    </div>
  );
}
