//! Build script: gzip the Japanese corpus JSON files into `OUT_DIR` so the
//! binary embeds compressed data (shrink from ~21 MB raw JSON to a few MB)
//! and decompresses at startup.
//!
//! Data lives in `packages/japanese/data/` (the `@manobu/japanese` package is
//! now a data generator — its fetch scripts write these files; the Rust crate
//! is the only consumer of the lookup engine). Every file gets `cargo:rerun-if-changed`
//! so a corpus regen triggers a rebuild.

use std::{env, fs, io::Write, path::PathBuf};

fn main() {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // crates/jlpt-mcp → repo root → packages/japanese/data
    let data_dir = crate_dir.join("../../packages/japanese/data");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));

    let files = [
        // vocabulary
        "n1.json",
        "n2.json",
        "n3.json",
        "n4.json",
        "n5.json",
        // grammar + conjugations
        "grammar/n1.json",
        "grammar/n2.json",
        "grammar/n3.json",
        "grammar/n4.json",
        "grammar/n5.json",
        "grammar/conjugations.json",
        // kanji + pitch-accent
        "kanji.json",
        "pitch-accent.json",
        // TASK-23.4: Tatoeba/Tanaka sentence pairs (doc-2 §5.2). 147,705 pairs,
        // ~42 MB raw → ~9.5 MB gzipped. doc-2 §6 prescribed a lazy app-data
        // load, but the sidecar must run fully offline from a single binary
        // (Tauri externalBin has no resource dir guarantee) — measured gzip is
        // 9.5 MB, which keeps the binary inside the sidecar size budget while
        // still shipping the corpus offline.
        "sentences/sentences.jsonl",
        // TASK-23.5.1: KanjiVG stroke-order SVGs (doc-2 §5.3). 6,417 kanji
        // (the corpus subset covered by the pinned KanjiVG release), ~21 MB
        // raw → ~4.2 MB gzipped. One JSONL — one {c, s} object per line.
        "kanjivg/kanjivg.jsonl",
    ];

    for rel in files {
        let src = data_dir.join(rel);
        println!("cargo:rerun-if-changed={}", src.display());
        let raw =
            fs::read(&src).unwrap_or_else(|e| panic!("missing corpus file {}: {e}", src.display()));

        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        encoder.write_all(&raw).expect("gzip write failed");
        let compressed = encoder.finish().expect("gzip finish failed");

        // Flatten the grammar/ prefix so OUT_DIR stays flat: grammar-n5.json.gz
        let flat_name = rel.replace('/', "-");
        let dest = out_dir.join(format!("{flat_name}.gz"));
        fs::write(&dest, compressed)
            .unwrap_or_else(|e| panic!("failed writing {}: {e}", dest.display()));
    }
}
