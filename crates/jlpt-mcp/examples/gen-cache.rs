use std::time::Instant;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = "../../apps/desktop/src-tauri/resources/vaporetto/model/bccwj-suw+unidic_pos+kana.model.zst";
    let file = std::fs::File::open(path)?;
    let reader = zstd::Decoder::new(file)?;
    let t0 = Instant::now();
    let model = vaporetto::Model::read(reader)?;
    let predictor = vaporetto::Predictor::new(model, true)?;
    let blob = predictor.serialize_to_vec()?;
    let compressed = zstd::bulk::compress(&blob[..], 3)?;
    let out = format!("{path}.predictor.bin.zst");
    std::fs::write(&out, &compressed)?;
    eprintln!(
        "wrote {out} ({} bytes, {:.1} MB compressed from {:.1} MB) in {:?}",
        compressed.len(),
        compressed.len() as f64 / 1048576.0,
        blob.len() as f64 / 1048576.0,
        t0.elapsed()
    );
    Ok(())
}
