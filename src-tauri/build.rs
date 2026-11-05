fn main() {
    tauri_build::build();
    // Tauri embeds its manifest in application binaries only. Rust's library-test harness
    // otherwise imports TaskDialogIndirect from Common Controls v5 and fails before main.
    // Keep this resource opt-in for `test:desktop`, never part of normal application builds.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var_os("CARGO_FEATURE_NATIVE_TESTS").is_some()
    {
        println!("cargo:rerun-if-changed=tests/desktop-tests.manifest");
        let manifest = std::env::current_dir()
            .unwrap()
            .join("tests/desktop-tests.manifest");
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("desktop-tests.rc");
        std::fs::write(
            &resource,
            format!(
                "1 24 \"{}\"\n",
                manifest.display().to_string().replace('\\', "/")
            ),
        )
        .unwrap();
        embed_resource::compile_for_everything(resource, embed_resource::NONE)
            .manifest_required()
            .expect("Could not embed the Windows desktop-test manifest");
    }
}
