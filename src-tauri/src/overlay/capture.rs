//! Capturas de pantalla durante la partida (F12 o el botón del panel).
//!
//! Se copia la imagen del monitor del juego con la duplicación de escritorio de
//! DirectX (vale en ventana, sin bordes y en la pantalla completa "optimizada";
//! si falla, con GDI) y se recorta al área de la ventana del juego. La ventana
//! del overlay se aparta de la captura mientras tanto, así que no salen ni el
//! panel ni los avisos.
//!
//! Se guardan en Imágenes\ejGames\<juego>\ (o la carpeta de Ajustes) en PNG,
//! con una miniatura JPEG en `.thumbs` para las galerías.

use super::{next_id, Look, Notice};
use crate::state::AppState;
use rusqlite::params;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: i64,
    pub game_id: i64,
    pub url: String,
    pub thumb: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub taken_at: i64,
}

/// Imagen en BGRA, fila a fila.
struct Frame {
    width: u32,
    height: u32,
    bgra: Vec<u8>,
}

/// Una captura a la vez (F12 mantenida, dos atajos seguidos…).
static BUSY: AtomicBool = AtomicBool::new(false);

const THUMB_W: u32 = 480;

pub fn url(id: i64) -> String {
    format!("{}/s/{id}", crate::db::models::MEDIA_ORIGIN)
}

pub fn thumb_url(id: i64) -> String {
    format!("{}/s/{id}/t", crate::db::models::MEDIA_ORIGIN)
}

/// Carpeta de las capturas (sin el juego).
pub fn root(st: &AppState) -> PathBuf {
    let custom = st.settings.get().screenshot_dir;
    if !custom.trim().is_empty() {
        return PathBuf::from(custom.trim());
    }
    dirs::picture_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Pictures")))
        .unwrap_or_else(|| st.paths.root.clone())
        .join("ejGames")
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Capture> {
    let id: i64 = r.get(0)?;
    Ok(Capture {
        id,
        game_id: r.get(1)?,
        url: url(id),
        thumb: thumb_url(id),
        path: r.get(2)?,
        width: r.get(3)?,
        height: r.get(4)?,
        taken_at: r.get(5)?,
    })
}

/// Las últimas capturas de un juego (las que siguen en disco).
pub fn list(st: &AppState, game_id: i64, limit: usize) -> Vec<Capture> {
    let rows: Vec<Capture> = st
        .db
        .with(|c| {
            let mut q = c.prepare_cached(
                "SELECT id, game_id, path, width, height, taken_at FROM screenshots WHERE game_id = ?1 ORDER BY taken_at DESC, id DESC LIMIT 200",
            )?;
            let rows = q.query_map([game_id], row)?.filter_map(Result::ok).collect();
            Ok(rows)
        })
        .unwrap_or_default();
    rows.into_iter().filter(|c| Path::new(&c.path).is_file()).take(limit).collect()
}

/// Archivo de una captura (o su miniatura) para ejg-media.
pub fn file(st: &AppState, id: i64, thumb: bool) -> Option<PathBuf> {
    let (path, t): (String, String) = st
        .db
        .with(|c| c.query_row("SELECT path, thumb FROM screenshots WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))))
        .ok()?;
    let p = PathBuf::from(if thumb && Path::new(&t).is_file() { t } else { path });
    p.is_file().then_some(p)
}

/// Carpeta de las capturas de un juego (se crea si no existe).
pub fn game_folder(st: &AppState, title: &str) -> PathBuf {
    root(st).join(crate::downloads::sanitize(title))
}

/// Hace una captura del juego en marcha, en otro hilo. Avisa con el overlay.
pub fn take(st: &Arc<AppState>, delay_ms: u64) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    let _ = std::thread::Builder::new().name("ejg-capture".into()).spawn(move || {
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
        let r = shoot(&st);
        BUSY.store(false, Ordering::SeqCst);
        match r {
            Ok(c) => {
                tracing::info!("captura: {} ({}×{})", c.path, c.width, c.height);
                super::refresh_captures(&st);
            }
            Err(e) => {
                tracing::warn!("captura: {e:#}");
                super::notify(
                    &st,
                    Notice {
                        id: next_id(&st),
                        kind: "info".into(),
                        game_id: None,
                        game: None,
                        title: crate::i18n::t("No se pudo hacer la captura").into(),
                        body: Some(format!("{e}")),
                        icon: None,
                        rarity: None,
                        at: crate::util::now(),
                        score: None,
                        progress: None,
                        look: Look::default(),
                    },
                );
            }
        }
    });
}

#[cfg(windows)]
fn shoot(st: &Arc<AppState>) -> anyhow::Result<Capture> {
    let (game_id, title) = {
        let g = st.overlay.inner.lock();
        let live = g.live.as_ref().ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No hay ningún juego en marcha.")))?;
        (live.game_id, live.title.clone())
    };
    let hwnd = super::game_window(st).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No se encuentra la ventana del juego.")))?;
    let area = win::client_area(hwnd).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("La ventana del juego está minimizada.")))?;

    // Que el overlay (panel y avisos) no salga en la imagen.
    let overlay = st.overlay.hwnd.load(Ordering::Relaxed);
    let hidden = overlay != 0 && win::exclude_from_capture(overlay, true);
    if hidden {
        std::thread::sleep(std::time::Duration::from_millis(60));
    }
    let frame = win::duplicate(hwnd, area).or_else(|e| {
        tracing::info!("captura: duplicación de escritorio no disponible ({e:#}); se usa GDI");
        win::gdi(area)
    });
    if hidden {
        win::exclude_from_capture(overlay, false);
    }
    let frame = frame?;

    let folder = game_folder(st, &title);
    std::fs::create_dir_all(&folder)?;
    let thumbs = folder.join(".thumbs");
    if !thumbs.exists() {
        std::fs::create_dir_all(&thumbs)?;
        win::hide(&thumbs);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S").to_string();
    let base = crate::downloads::sanitize(&title);
    let mut name = format!("{base} {stamp}");
    let mut n = 2;
    while folder.join(format!("{name}.png")).exists() {
        name = format!("{base} {stamp} ({n})");
        n += 1;
    }
    let path = folder.join(format!("{name}.png"));
    let thumb = thumbs.join(format!("{name}.jpg"));

    let rgb = to_rgb(&frame);
    // Primero la miniatura (rápida): el aviso sale enseguida.
    save_thumb(&rgb, &thumb)?;
    let taken_at = crate::util::now();
    let id = st.db.with(|c| {
        c.execute(
            "INSERT INTO screenshots (game_id, path, thumb, width, height, taken_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![game_id, path.to_string_lossy(), thumb.to_string_lossy(), frame.width, frame.height, taken_at],
        )?;
        Ok(c.last_insert_rowid())
    })?;
    save_png(&rgb, &path)?;
    #[cfg(windows)]
    if st.settings.get().overlay_sound {
        super::win::play_shutter();
    }
    super::notify(
        st,
        Notice {
            id: next_id(st),
            kind: "screenshot".into(),
            game_id: Some(game_id),
            game: Some(title),
            title: "Captura guardada".into(),
            body: Some(folder.to_string_lossy().into_owned()),
            icon: Some(thumb_url(id)),
            rarity: None,
            at: taken_at,
            score: None,
            progress: None,
            look: Look::default(),
        },
    );
    Ok(Capture {
        id,
        game_id,
        url: url(id),
        thumb: thumb_url(id),
        path: path.to_string_lossy().into_owned(),
        width: frame.width,
        height: frame.height,
        taken_at,
    })
}

#[cfg(not(windows))]
fn shoot(_st: &Arc<AppState>) -> anyhow::Result<Capture> {
    anyhow::bail!("Solo en Windows")
}

fn to_rgb(f: &Frame) -> image::RgbImage {
    let mut out = Vec::with_capacity((f.width * f.height * 3) as usize);
    for px in f.bgra.chunks_exact(4) {
        out.extend_from_slice(&[px[2], px[1], px[0]]);
    }
    image::RgbImage::from_raw(f.width, f.height, out).expect("tamaño de la captura")
}

fn save_png(img: &image::RgbImage, path: &Path) -> anyhow::Result<()> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    let tmp = crate::util::temp_path(path);
    {
        let f = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        PngEncoder::new_with_quality(f, CompressionType::Fast, FilterType::Adaptive).write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgb8,
        )?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn save_thumb(img: &image::RgbImage, path: &Path) -> anyhow::Result<()> {
    let w = THUMB_W.min(img.width()).max(1);
    let h = ((img.height() as f64 * w as f64 / img.width().max(1) as f64).round() as u32).max(1);
    let small = image::imageops::thumbnail(img, w, h);
    let f = std::io::BufWriter::new(std::fs::File::create(path)?);
    image::codecs::jpeg::JpegEncoder::new_with_quality(f, 82).encode_image(&small)?;
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::Frame;
    use windows::core::Interface;
    use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_UNSPECIFIED, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIResource, DXGI_OUTDUPL_FRAME_INFO};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, MonitorFromWindow,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};

    /// (x, y, ancho, alto) en px físicos de pantalla.
    pub type Area = (i32, i32, i32, i32);

    fn h(v: isize) -> HWND {
        HWND(v as *mut _)
    }

    /// Área de cliente de la ventana (sin bordes ni barra de título).
    pub fn client_area(hwnd: isize) -> Option<Area> {
        unsafe {
            let mut r = RECT::default();
            GetClientRect(h(hwnd), &mut r).ok()?;
            let mut p = POINT::default();
            if !ClientToScreen(h(hwnd), &mut p).as_bool() {
                return None;
            }
            let (w, hh) = (r.right - r.left, r.bottom - r.top);
            (w > 0 && hh > 0).then_some((p.x, p.y, w, hh))
        }
    }

    /// Aparta (o vuelve a poner) la ventana en las capturas. true si se pudo.
    pub fn exclude_from_capture(hwnd: isize, exclude: bool) -> bool {
        unsafe { SetWindowDisplayAffinity(h(hwnd), if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }).is_ok() }
    }

    pub fn hide(dir: &std::path::Path) {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let _ = SetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_HIDDEN);
        }
    }

    fn intersect(a: Area, b: RECT) -> Option<Area> {
        let x0 = a.0.max(b.left);
        let y0 = a.1.max(b.top);
        let x1 = (a.0 + a.2).min(b.right);
        let y1 = (a.1 + a.3).min(b.bottom);
        (x1 > x0 && y1 > y0).then_some((x0, y0, x1 - x0, y1 - y0))
    }

    /// Duplicación de escritorio del monitor de la ventana, recortada a `area`.
    pub fn duplicate(hwnd: isize, area: Area) -> anyhow::Result<Frame> {
        unsafe {
            let monitor = MonitorFromWindow(h(hwnd), MONITOR_DEFAULTTONEAREST);
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut i = 0;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                i += 1;
                let mut j = 0;
                while let Ok(output) = adapter.EnumOutputs(j) {
                    j += 1;
                    let desc = output.GetDesc()?;
                    if desc.Monitor != monitor {
                        continue;
                    }
                    if desc.Rotation != DXGI_MODE_ROTATION_IDENTITY && desc.Rotation != DXGI_MODE_ROTATION_UNSPECIFIED {
                        anyhow::bail!("monitor girado");
                    }
                    let crop = intersect(area, desc.DesktopCoordinates).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("la ventana está fuera del monitor")))?;
                    let mut device: Option<ID3D11Device> = None;
                    let mut ctx: Option<ID3D11DeviceContext> = None;
                    D3D11CreateDevice(
                        &adapter,
                        D3D_DRIVER_TYPE_UNKNOWN,
                        HMODULE::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        Some(&[D3D_FEATURE_LEVEL_11_0]),
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        Some(&mut ctx),
                    )?;
                    let (device, ctx) = (device.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("sin dispositivo")))?, ctx.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("sin contexto")))?);
                    let dup = output.cast::<IDXGIOutput1>()?.DuplicateOutput(&device)?;
                    // El primer fotograma trae la imagen actual del escritorio; si
                    // solo trae el cursor (sin imagen), se espera al siguiente.
                    let mut tex: Option<ID3D11Texture2D> = None;
                    for attempt in 0..4 {
                        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                        let mut res: Option<IDXGIResource> = None;
                        if dup.AcquireNextFrame(250, &mut info, &mut res).is_err() {
                            continue;
                        }
                        if info.LastPresentTime == 0 && attempt < 3 {
                            let _ = dup.ReleaseFrame();
                            continue;
                        }
                        let Some(res) = res else {
                            let _ = dup.ReleaseFrame();
                            continue;
                        };
                        let src: ID3D11Texture2D = res.cast()?;
                        let mut d = D3D11_TEXTURE2D_DESC::default();
                        src.GetDesc(&mut d);
                        let staging_desc = D3D11_TEXTURE2D_DESC {
                            MipLevels: 1,
                            ArraySize: 1,
                            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                            Usage: D3D11_USAGE_STAGING,
                            BindFlags: 0,
                            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                            MiscFlags: 0,
                            ..d
                        };
                        if d.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
                            let _ = dup.ReleaseFrame();
                            anyhow::bail!("formato de escritorio {:?} (HDR)", d.Format);
                        }
                        let mut staging: Option<ID3D11Texture2D> = None;
                        device.CreateTexture2D(&staging_desc, None, Some(&mut staging))?;
                        let staging = staging.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("sin textura")))?;
                        ctx.CopyResource(&staging, &src);
                        let _ = dup.ReleaseFrame();
                        tex = Some(staging);
                        break;
                    }
                    let tex = tex.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("el escritorio no dio ninguna imagen")))?;
                    let mut map = D3D11_MAPPED_SUBRESOURCE::default();
                    ctx.Map(&tex, 0, D3D11_MAP_READ, 0, Some(&mut map))?;
                    let (ox, oy) = (crop.0 - desc.DesktopCoordinates.left, crop.1 - desc.DesktopCoordinates.top);
                    let (w, hh) = (crop.2 as usize, crop.3 as usize);
                    let mut bgra = Vec::with_capacity(w * hh * 4);
                    let base = map.pData as *const u8;
                    for y in 0..hh {
                        let row = base.add((oy as usize + y) * map.RowPitch as usize + ox as usize * 4);
                        bgra.extend_from_slice(std::slice::from_raw_parts(row, w * 4));
                    }
                    ctx.Unmap(&tex, 0);
                    return Ok(Frame { width: w as u32, height: hh as u32, bgra });
                }
            }
            anyhow::bail!("{}", crate::i18n::t("no se encontró el monitor del juego"))
        }
    }

    /// Copia de la pantalla con GDI (no ve la pantalla completa exclusiva).
    pub fn gdi(area: Area) -> anyhow::Result<Frame> {
        let (x, y, w, hh) = area;
        unsafe {
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, hh);
            let old = SelectObject(mem, bmp.into());
            let copied = BitBlt(mem, 0, 0, w, hh, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -hh,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (w * hh * 4) as usize];
            let lines = GetDIBits(mem, bmp, 0, hh as u32, Some(bgra.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            copied?;
            if lines == 0 {
                anyhow::bail!("{}", crate::i18n::t("GDI no devolvió la imagen"));
            }
            Ok(Frame { width: w as u32, height: hh as u32, bgra })
        }
    }
}
