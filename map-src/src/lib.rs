// Shared resource encoders for the Parry Trainer arena and its range markers.
mod arena;
mod markers;
mod nav;

pub use arena::build_arena;
pub use markers::build_range_markers;

use source2_kv3::{Document, Object, Value};
use std::error::Error;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const NAME: &str = "hl_parry_trainer";
const SKY: &str = "materials/skybox/light_test_dark.vmat";
const HALF: f32 = 8192.0;

// Valve uses the 32-bit-word MurmurHash64B variant for resource path IDs.
fn resource_id(path: &str) -> u64 {
    const M: u32 = 0x5bd1e995;
    fn word(chunk: &[u8]) -> u32 {
        let x = u32::from_le_bytes(chunk.try_into().unwrap()).wrapping_mul(M);
        (x ^ (x >> 24)).wrapping_mul(M)
    }
    let mut input = path.as_bytes();
    let mut hi = 0xedab_cdef ^ input.len() as u32;
    let mut lo = 0u32;
    while input.len() >= 8 {
        hi = hi.wrapping_mul(M) ^ word(&input[..4]);
        lo = lo.wrapping_mul(M) ^ word(&input[4..8]);
        input = &input[8..];
    }
    if input.len() >= 4 {
        hi = hi.wrapping_mul(M) ^ word(&input[..4]);
        input = &input[4..];
    }
    if !input.is_empty() {
        let mut tail = [0; 4];
        tail[..input.len()].copy_from_slice(input);
        lo = (lo ^ u32::from_le_bytes(tail)).wrapping_mul(M);
    }
    hi = (hi ^ (lo >> 18)).wrapping_mul(M);
    lo = (lo ^ (hi >> 22)).wrapping_mul(M);
    hi = (hi ^ (lo >> 17)).wrapping_mul(M);
    lo = (lo ^ (hi >> 19)).wrapping_mul(M);
    (u64::from(hi) << 32) | u64::from(lo)
}

fn external_refs(paths: &[String]) -> Vec<u8> {
    let mut bytes = vec![0; 12 + paths.len() * 16];
    bytes[..4].copy_from_slice(&12u32.to_le_bytes());
    bytes[4..8].copy_from_slice(&(paths.len() as u32).to_le_bytes());
    for (i, path) in paths.iter().enumerate() {
        let pos = 12 + i * 16;
        let relative = (bytes.len() - (pos + 8)) as u64;
        bytes[pos..pos + 8].copy_from_slice(&resource_id(path).to_le_bytes());
        bytes[pos + 8..pos + 16].copy_from_slice(&relative.to_le_bytes());
        bytes.extend_from_slice(path.as_bytes());
        bytes.push(0);
    }
    bytes
}

// Resource manifests have a small binary string-list DATA, not binary KV3.
fn manifest(paths: &[String]) -> Vec<u8> {
    let mut data = Vec::new();
    for n in [8, 1, 8, paths.len() as u32] {
        data.extend(n.to_le_bytes());
    }
    data.resize(16 + 4 * paths.len(), 0);
    for (i, path) in paths.iter().enumerate() {
        let pos = 16 + 4 * i;
        let off = (data.len() - pos) as u32;
        data[pos..pos + 4].copy_from_slice(&off.to_le_bytes());
        data.extend(path.as_bytes());
        data.push(0);
    }
    data
}

fn map_entities() -> Result<Vec<u8>> {
    let src = Document::from_text(include_str!("../entities.kv3"))?;
    let mut entries = Vec::new();
    for (index, definition) in src
        .root
        .get("entities")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let mut keys = definition.as_object().unwrap().clone();
        if keys.get("angles").is_none() {
            keys.insert("angles", "0 0 0");
        }
        keys.insert("scales", "1 1 1");
        keys.insert("hammerUniqueId", (index + 1).to_string());
        let mut row = Object::new();
        let mut entity = Object::new();
        entity.insert("version", 1);
        entity.insert("values", keys);
        entity.insert("attributes", Object::new());
        row.insert("m_connections", Vec::<Value>::new());
        row.insert("m_keyValuesData", Value::blob(vec![]));
        row.insert("keyValues3Data", entity);
        entries.push(Value::from(row));
    }
    let mut root = Object::new();
    root.insert("m_name", "default_ents");
    root.insert("m_hammerUniqueId", "");
    root.insert("m_childLumps", Vec::<Value>::new());
    root.insert("m_entityKeyValues", entries);
    Ok(Document::new(root).to_bytes()?)
}

fn floor_physics() -> Result<Vec<u8>> {
    let mut doc = Document::from_text(include_str!("../floor.kv3"))?;
    let part = &mut doc.root.get_mut("m_parts").unwrap().as_array_mut().unwrap()[0];
    let shape = part.get_mut("m_rnShape").unwrap();
    let mesh_desc = &mut shape.get_mut("m_meshes").unwrap().as_array_mut().unwrap()[0];
    let mesh = mesh_desc
        .get_mut("m_Mesh")
        .unwrap()
        .as_object_mut()
        .unwrap();

    // Two +Z-facing triangles, one BVH leaf, native Rubikon binary layout.
    let vertices: Vec<u8> = [
        [-HALF, -HALF, 0.],
        [HALF, -HALF, 0.],
        [HALF, HALF, 0.],
        [-HALF, HALF, 0.],
    ]
    .into_iter()
    .flatten()
    .flat_map(f32::to_le_bytes)
    .collect();
    let triangles: Vec<u8> = [0u32, 1, 2, 0, 2, 3]
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .collect();
    let mut leaf = Vec::new();
    let pad = 0.03125;
    let min = [-HALF - pad, -HALF - pad, -pad];
    let max = [HALF + pad, HALF + pad, pad];
    leaf.extend(min.into_iter().flat_map(f32::to_le_bytes));
    leaf.extend((0xc0000000u32 | 2).to_le_bytes());
    leaf.extend(max.into_iter().flat_map(f32::to_le_bytes));
    leaf.extend(0u32.to_le_bytes());
    mesh.insert("m_vMin", min.map(Value::from).to_vec());
    mesh.insert("m_vMax", max.map(Value::from).to_vec());
    mesh.insert("m_flSurfaceArea", (2.0 * HALF).powi(2));
    mesh.insert("m_Nodes", Value::blob(leaf));
    mesh.insert("m_Triangles", Value::blob(triangles));
    mesh.insert("m_Vertices", Value::blob(vertices));
    Ok(doc.to_bytes()?)
}
