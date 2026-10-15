// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.4x+ on the NVIDIA proprietary driver + Wayland (Hyprland /
    // other wlroots compositors) fails to allocate DMA-BUF buffers on launch
    // ("Failed to create GBM buffer of size WxH: Invalid argument"), which
    // crashes the webview before Tauri can render anything. Setting this env
    // var before the WebKitGTK library is loaded forces software compositing
    // inside WebKitGTK and unsticks the renderer. Verified against
    // webkit2gtk-4.1 2.52.5 + NVIDIA proprietary `nvidia` driver + Hyprland
    // via uwsm. Cost: a small perf hit during scrolling/animation; acceptable
    // for v1. Revisit when wlroots / NVIDIA Wayland support matures.
    #[cfg(target_os = "linux")]
    unsafe {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    app_lib::run();
}
