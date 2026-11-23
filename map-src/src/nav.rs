// Source 2 v35 stores shared polygon geometry and a separate area graph per hull.
use super::HALF;

fn words(output: &mut Vec<u8>, values: &[u32]) {
    output.extend(values.iter().flat_map(|value| value.to_le_bytes()));
}

// Serialize an analyzed v35 navigation mesh directly, including the generation
// parameters for the small, medium and large NPC hulls used by this arena.
pub fn arena_nav() -> Vec<u8> {
    let mut nav = Vec::new();
    words(&mut nav, &[0xfeedface, 35, 0, 1]); // No named places.
    append_floor(&mut nav);
    words(&mut nav, &[0, 0, 13, 1]); // No ladders or bounds, v13 hull parameters.
    fn floats(out: &mut Vec<u8>, v: &[f32]) {
        out.extend(v.iter().flat_map(|n| n.to_le_bytes()));
    }
    floats(&mut nav, &[128., 1.5, 2.]); // Tile and voxel dimensions.
    words(&mut nav, &[8, 20]); // Min and merge region size.
    floats(&mut nav, &[120., 2.]);
    words(&mut nav, &[1200]);
    floats(&mut nav, &[51.]);
    words(&mut nav, &[4]);
    floats(&mut nav, &[81.]);
    nav.extend([0, 0]); // No external hull preset or definitions file.
    words(&mut nav, &[3]);
    for (radius, climb, jump) in [(24., 17.5, 500.), (32., 24., 0.), (220., 40., 0.)] {
        nav.push(1);
        floats(&mut nav, &[radius, 84.]);
        nav.push(0);
        floats(&mut nav, &[35.5]);
        nav.push(0);
        floats(&mut nav, &[17.5, climb]);
        words(&mut nav, &[50]); // Maximum slope in degrees.
        floats(&mut nav, &[2000., 68., jump]);
        words(&mut nav, &[u32::MAX]); // Default border erosion.
    }
    nav.push(0); // Gravity stays vertical.
    nav
}

fn append_floor(nav: &mut Vec<u8>) {
    const SIDE: u32 = 32;
    const CELLS: u32 = SIDE * SIDE;
    const HULLS: u8 = 3;
    let extent = HALF - 128.0; // Keep the outermost paths inside the physics floor.
    let spacing = 2.0 * extent / SIDE as f32;
    words(nav, &[(SIDE + 1).pow(2)]);
    for y in 0..=SIDE {
        for x in 0..=SIDE {
            let point = [
                x as f32 * spacing - extent,
                y as f32 * spacing - extent,
                2.0,
            ];
            nav.extend(point.into_iter().flat_map(f32::to_le_bytes));
        }
    }

    words(nav, &[CELLS]);
    for y in 0..SIDE {
        for x in 0..SIDE {
            let corner = y * (SIDE + 1) + x;
            nav.push(4);
            let corners = [corner, corner + 1, corner + SIDE + 2, corner + SIDE + 1];
            words(nav, &corners);
            words(nav, &[u32::MAX]); // Static world polygon.
        }
    }
    words(nav, &[0, 0, CELLS * u32::from(HULLS)]);
    for hull in 0..HULLS {
        let first_id = u32::from(hull) * CELLS + 1;
        for polygon in 0..CELLS {
            let x = polygon % SIDE;
            let y = polygon / SIDE;
            words(nav, &[first_id + polygon, 0, 0]); // Area ID and 64-bit attribute flags.
            nav.push(hull);
            words(nav, &[polygon, 0]);
            for (edge, (dx, dy)) in [(0, -1), (1, 0), (0, 1), (-1, 0)].into_iter().enumerate() {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if (0..SIDE as i32).contains(&nx) && (0..SIDE as i32).contains(&ny) {
                    let neighbor = first_id + ny as u32 * SIDE + nx as u32;
                    let opposite_edge = (edge as u32 + 2) % 4;
                    words(nav, &[1, neighbor, opposite_edge]);
                } else {
                    words(nav, &[0]);
                }
            }
            nav.push(0); // Hiding spots.
            words(nav, &[0, 0, 0]); // Encounters, ladders above and below.
        }
    }
}
