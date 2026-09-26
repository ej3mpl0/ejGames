//! Durante la partida: botón Guía/PS (o Back+Start mantenidos 1 s) abre el
//! overlay (o el launcher). Con el panel del overlay abierto, la cruceta, el
//! stick y A/B/X/Y lo manejan. Hilo XInput ligero que solo existe mientras hay
//! un juego abierto.

use crate::overlay::PadEvent;
use gilrs::{Axis, Button, Gilrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn nav_of(b: Button) -> Option<&'static str> {
    Some(match b {
        Button::DPadUp => "up",
        Button::DPadDown => "down",
        Button::DPadLeft => "left",
        Button::DPadRight => "right",
        Button::South => "accept",
        Button::East => "back",
        Button::West => "x",
        Button::North => "y",
        Button::LeftTrigger => "lb",
        Button::RightTrigger => "rb",
        Button::Start => "menu",
        _ => return None,
    })
}

/// `guide`: reaccionar al botón Guía (en juegos de Steam lo usa Steam).
pub fn spawn(stop: Arc<AtomicBool>, guide: bool, on_event: impl Fn(PadEvent) + Send + 'static) {
    let _ = std::thread::Builder::new().name("ejg-pad-home".into()).spawn(move || {
        let Ok(mut gilrs) = Gilrs::new() else { return };
        let mut combo_since: Option<Instant> = None;
        let mut last_fire = Instant::now() - Duration::from_secs(10);
        // Stick: dirección actual y próximo disparo por repetición.
        let mut stick: Option<(&'static str, Instant)> = None;
        while !stop.load(Ordering::Relaxed) {
            let mut fire = false;
            while let Some(ev) = gilrs.next_event() {
                if let gilrs::EventType::ButtonPressed(b, _) = ev.event {
                    if b == Button::Mode {
                        fire |= guide;
                    } else if let Some(a) = nav_of(b) {
                        on_event(PadEvent::Nav(a));
                    }
                }
            }
            let combo = gilrs
                .gamepads()
                .any(|(_, g)| g.is_pressed(Button::Select) && g.is_pressed(Button::Start));
            match (combo, combo_since) {
                (true, None) => combo_since = Some(Instant::now()),
                (true, Some(t)) if t.elapsed() > Duration::from_millis(1000) => {
                    fire = true;
                    combo_since = None;
                }
                (false, _) => combo_since = None,
                _ => {}
            }
            if fire && last_fire.elapsed() > Duration::from_millis(700) {
                last_fire = Instant::now();
                on_event(PadEvent::Home);
            }

            // Stick izquierdo como cruceta (con repetición al mantener).
            let (x, y) = gilrs
                .gamepads()
                .map(|(_, g)| (g.value(Axis::LeftStickX), g.value(Axis::LeftStickY)))
                .fold((0f32, 0f32), |a, v| if v.0.abs() + v.1.abs() > a.0.abs() + a.1.abs() { v } else { a });
            let dir = if y > 0.6 {
                Some("up")
            } else if y < -0.6 {
                Some("down")
            } else if x < -0.6 {
                Some("left")
            } else if x > 0.6 {
                Some("right")
            } else {
                None
            };
            match (dir, stick) {
                (Some(d), Some((prev, next))) if d == prev => {
                    if Instant::now() >= next {
                        on_event(PadEvent::Nav(d));
                        stick = Some((d, Instant::now() + Duration::from_millis(140)));
                    }
                }
                (Some(d), _) => {
                    on_event(PadEvent::Nav(d));
                    stick = Some((d, Instant::now() + Duration::from_millis(400)));
                }
                (None, _) => stick = None,
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
}
