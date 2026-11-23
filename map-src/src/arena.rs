// Source 2 containers for a single empty render node, a collision floor and its NPC mesh.
// The black arena ships only authored resources. Its sky material is resolved by Deadlock.
use super::{HALF, NAME, Result, SKY, external_refs, floor_physics, manifest, map_entities, nav};
use source2_kv3::{Document, Object, Value};
use source2_resource::{BlockKind, Resource};
use source2_vpk::{Entry, Vpk};
use std::{fs, path::Path};

fn data(kv: &str) -> Result<Vec<u8>> {
    let text = format!(
        "<!-- kv3 encoding:text:version{{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d}} format:generic:version{{7412167c-06e9-4698-aff2-e63eb59037e7}} -->\n{kv}"
    );
    Ok(Document::from_text(&text)?.to_bytes()?)
}

fn resource(version: u16, refs: &[String], blocks: &[(&[u8; 4], Vec<u8>)]) -> Result<Vec<u8>> {
    let mut r = Resource::new();
    r.versions.resource = version;
    if !refs.is_empty() {
        r.push_block(BlockKind::RERL, external_refs(refs));
    }
    for (tag, bytes) in blocks {
        r.push_block(BlockKind::new(**tag), bytes.clone());
    }
    Ok(r.to_bytes()?)
}

pub fn build_arena(output: &Path) -> Result<()> {
    let prefix = format!("maps/{NAME}");
    let paths = |names: &[&str]| {
        names
            .iter()
            .map(|s| format!("{prefix}/{s}"))
            .collect::<Vec<_>>()
    };
    let mut map = Vpk::new(2);
    let mut owned = Vec::new();
    let mut add = |suffix: &str, content| {
        let path = format!("{prefix}/{suffix}");
        map.push(Entry::inline(format!("{path}_c"), content));
        owned.push(path);
    };
    add(
        "entities/default_ents.vents",
        resource(1, &[SKY.to_owned()], &[(b"DATA", map_entities()?)])?,
    );
    let ents = paths(&["entities/default_ents.vents"]);
    let mut node = Object::new();
    node.insert("m_nParent", -1);
    node.insert("m_flMinimumDistance", -1.0f32);
    node.insert("m_worldNodePrefix", format!(r"maps\{NAME}\worldnodes\n0"));
    for (key, xyz) in [
        ("m_vMinBounds", [-HALF, -HALF, -256.]),
        ("m_vMaxBounds", [HALF, HALF, 16384.]),
        ("m_vOrigin", [0., 0., 0.]),
    ] {
        node.insert(key, xyz.map(Value::float).to_vec());
    }
    let mut world = Object::new();
    world.insert("m_worldNodes", vec![Value::from(node)]);
    world.insert(
        "m_entityLumps",
        vec![Value::from(ents[0].as_str()).with_flags(source2_kv3::flag::RESOURCE)],
    );
    add(
        "world.vwrld",
        resource(1, &ents, &[(b"DATA", Document::new(world).to_bytes()?)])?,
    );
    add(
        "worldnodes/n0.vwnod",
        resource(
            1,
            &[],
            &[(
                b"DATA",
                data(
                    r#"{ m_sceneObjects = [] m_layerNames = ["world_layer_base"] m_sceneObjectLayerIndices = [] }"#,
                )?,
            )],
        )?,
    );
    let model = data(&format!(
        r#"{{ m_name = "{prefix}/world_physics.vmdl" m_modelInfo = {{ m_nFlags = 8388608 }} m_modelSkeleton = {{ m_boneName = [] }} m_refMeshes = [] }}"#
    ))?;
    add(
        "world_physics.vmdl",
        resource(
            1,
            &[],
            &[
                (b"PHYS", floor_physics()?),
                (
                    b"CTRL",
                    data("{ embedded_physics = { phys_data_block = 0 } }")?,
                ),
                (b"DATA", model),
            ],
        )?,
    );

    // An unoccluded region covering the play volume. Both the sky and the only cell
    // see every cluster, including from the arena recenter boundary.
    let vis = data(
        r#"{
        m_vMinBounds = [-16384.0, -16384.0, -16384.0] m_vMaxBounds = [16384.0, 16384.0, 16384.0]
        m_flGridSize = 32.0 m_nBaseClusterCount = 2 m_nPVSBytesPerCluster = 4
        m_nSkyVisibilityCluster = 0 m_nSunVisibilityCluster = 0
        m_NodeBlock = { m_nOffset = 0 m_nElementCount = 1 } m_RegionBlock = { m_nOffset = 8 m_nElementCount = 1 }
        m_EnclosedClusterListBlock = { m_nOffset = 16 m_nElementCount = 0 }
        m_EnclosedClustersBlock = { m_nOffset = 16 m_nElementCount = 0 }
        m_MasksBlock = { m_nOffset = 16 m_nElementCount = 1 } m_nVisBlocks = { m_nOffset = 24 m_nElementCount = 8 }
    }"#,
    )?;
    let flags = [
        1u32,
        0xffffff01,
        0,
        0,
        u32::MAX,
        u32::MAX,
        u32::MAX,
        u32::MAX,
    ];
    add(
        "world_visibility.vvis",
        resource(
            7,
            &[],
            &[
                (b"DATA", vis),
                (
                    b"VXVS",
                    flags.into_iter().flat_map(u32::to_le_bytes).collect(),
                ),
            ],
        )?,
    );
    for (name, mut refs) in [
        ("world_physics.vrman", paths(&["world_physics.vmdl"])),
        ("worldnodes/n0.vrman", paths(&["worldnodes/n0.vwnod"])),
        (
            "world.vrman",
            paths(&[
                "world.vwrld",
                "world_physics.vrman",
                "world_visibility.vvis",
            ]),
        ),
    ] {
        if name == "world.vrman" {
            refs.push(SKY.to_string());
        }
        add(name, resource(1, &refs, &[(b"DATA", manifest(&refs))])?);
    }
    map.push(Entry::inline(
        format!("{prefix}.vmap_c"),
        resource(1, &owned, &[(b"DATA", vec![])])?,
    ));
    map.push(Entry::inline(format!("{prefix}.nav"), nav::arena_nav()));
    fs::write(output, map.to_bytes()?)?;
    Ok(())
}
