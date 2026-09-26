// Sin consola en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ejgames_lib::run()
}
