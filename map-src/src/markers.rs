// Compile our single-sprite distance markers. The two textures are references
// to Deadlock's installed material library; the addon contains no texture data.
use super::{Result, external_refs};
use source2_kv3::Document;
use source2_resource::{Block, BlockKind, Resource, Versions};
use std::{fs, path::Path};

pub fn build_range_markers(directory: &Path) -> Result<()> {
    let ring_texture = "materials/particle/generic/generic_rangefinder_psd_93e87dab.vtex";
    let digit_texture = "materials/particle/last_hit/last_hit_msg.vtex";
    let frame = r#"{ _class = "C_OP_RemapCPtoScalar" m_nCPInput = 1 m_nField = 0
        m_nFieldOutput = 9 m_flInputMax = 20.0 m_flOutputMax = 20.0 }"#;
    let ground = r#"m_nOrientationType = "PARTICLE_ORIENTATION_WORLD_Z_ALIGNED" m_bDisableZBuffering = false"#;
    // In the 2048px Hideout guide texture the stroke's centre sits at 1013.5px.
    let ring_scale = format!("{:.6}", 1000.0 * 1024.0 / 1013.5);
    fs::create_dir_all(directory)?;
    for (name, texture, radius, sequence, orientation) in [
        ("ring", ring_texture, ring_scale.as_str(), "", ground),
        ("digit", digit_texture, "1000.0", frame, "m_bDisableZBuffering = true"),
    ] {
        let source = include_str!("../range-marker.kv3")
            .replace("@TEXTURE@", texture)
            .replace("@SIZE@", radius)
            .replace("@FRAME@", sequence)
            .replace("@ORIENTATION@", orientation);
        let data = Document::from_text(&source)?.to_bytes()?;
        let resource = Resource::new()
            .with_versions(Versions::new(12, 1))
            .with_block(Block::new(BlockKind::RERL, external_refs(&[texture.into()])))
            .with_block(Block::new(BlockKind::DATA, data));
        fs::write(directory.join(format!("melee_range_{name}.vpcf_c")), resource.to_bytes()?)?;
    }
    Ok(())
}
