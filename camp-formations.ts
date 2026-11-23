// Midtown's info_neutral_trooper_spawn markers, grouped by their named camp and tier.
// Offsets are relative to each camp center, projected onto the practice floor.
type Member = [unit: string, x: number, y: number]
type Camp = { tether: number, members: Member[] }
export const formations: Camp[][] = [
  [
    { tether: 135, members: [ // dock_authority_camp
      ['neutral_drain_creature_weak', 0, -128],
      ['neutral_drain_creature_weak', 128, 0],
      ['neutral_drain_creature_weak', -128, 0],
    ] },
    { tether: 300, members: [ // nw_utility_south_neutrals
      ['neutral_specimen_weak', -91, -128],
      ['neutral_specimen_weak', 96, 160],
      ['neutral_specimen_weak', 96, -128],
    ] },
    { tether: 300, members: [ // se_utility_neutrals
      ['neutral_specimen_weak', -76, 113],
      ['neutral_specimen_weak', -56, -116],
      ['neutral_specimen_weak', 136, 11],
    ] },
  ],
  [
    { tether: 300, members: [ // chinatown_fish_neutrals
      ['neutral_lantern_normal', 128, -128],
      ['neutral_lantern_normal', -128, -128],
      ['neutral_lantern_normal', 0, 128],
    ] },
    { tether: 300, members: [ // construction_camp
      ['neutral_drain_creature_normal', -9, 264],
      ['neutral_drain_creature_weak', -137, -149],
      ['neutral_drain_creature_weak', 183, 56],
      ['neutral_drain_creature_weak', 135, -232],
      ['neutral_drain_creature_weak', 169, 232],
    ] },
    { tether: 220, members: [ // dept_store_camp
      ['neutral_specimen_weak', 128, -80],
      ['neutral_specimen_normal', -176, 88],
      ['neutral_specimen_weak', -176, -64],
      ['neutral_specimen_weak', 128, 88],
    ] },
    { tether: 400, members: [ // hq_01_camp
      ['neutral_library_normal', 96, -128],
      ['neutral_library_normal', -160, 0],
      ['neutral_library_normal', 96, 128],
      ['neutral_library_weak', -192, 256],
      ['neutral_library_weak', 0, -320],
    ] },
    { tether: 175, members: [ // hq_roof_camp
      ['neutral_underground_normal', -147, -83],
      ['neutral_underground_normal', 0, 128],
      ['neutral_underground_normal', 147, -83],
    ] },
    { tether: 500, members: [ // nursery_downstairs_camp
      ['neutral_plant_normal', 0, -160],
      ['neutral_plant_normal', 160, 0],
      ['neutral_plant_normal', -128, 96],
      ['neutral_plant_weak', -352, -320],
      ['neutral_plant_weak', 320, 224],
    ] },
    { tether: 220, members: [ // oracle_camp
      ['neutral_specimen_normal', 144, -72],
      ['neutral_specimen_weak', -160, -56],
      ['neutral_specimen_weak', 144, 112],
      ['neutral_specimen_weak', -160, 112],
    ] },
    { tether: 400, members: [ // park_chapel_camp
      ['neutral_library_normal', 8, -184],
      ['neutral_library_weak', -120, 136],
      ['neutral_library_weak', -144, -120],
      ['neutral_library_weak', 144, -112],
      ['neutral_library_weak', 144, 144],
    ] },
    { tether: 300, members: [ // park_library_roof_camp
      ['neutral_underground_normal', 192, 192],
      ['neutral_underground_normal', 0, -192],
      ['neutral_underground_normal', -192, 192],
    ] },
    { tether: 300, members: [ // park_mansion_roof_camp
      ['neutral_underground_normal', 100, -144],
      ['neutral_underground_normal', 128, 164],
      ['neutral_underground_normal', -152, 4],
    ] },
    { tether: 600, members: [ // plaza_rink_02_camp
      ['neutral_drain_creature_normal', -160, 0],
      ['neutral_drain_creature_normal', 128, 112],
      ['neutral_drain_creature_normal', 128, -128],
    ] },
    { tether: 550, members: [ // slums_alley_camp
      ['neutral_barrel_02_normal', 0, -160],
      ['neutral_barrel_02_normal', 128, 0],
      ['neutral_barrel_02_normal', 0, 160],
    ] },
    { tether: 620, members: [ // slums_bodega_down_camp
      ['neutral_underground_weak', 288, -8],
      ['neutral_underground_weak', 128, 104],
      ['neutral_underground_weak', 0, -152],
      ['neutral_underground_weak', -96, 104],
      ['neutral_underground_normal', -200, 8],
      ['neutral_underground_normal', 224, -568],
    ] },
    { tether: 220, members: [ // slums_garage_down_camp
      ['neutral_drain_creature_normal', 0, 112],
      ['neutral_drain_creature_weak', -122, 0],
      ['neutral_drain_creature_weak', 146, 0],
    ] },
    { tether: 400, members: [ // slums_roof_camp
      ['neutral_underground_normal', 0, -160],
      ['neutral_underground_normal', -104, 104],
      ['neutral_underground_normal', 104, 104],
    ] },
    { tether: 350, members: [ // slums_storage_camp
      ['neutral_mushroom_normal', -112, 80],
      ['neutral_mushroom_normal', 128, 96],
      ['neutral_mushroom_normal', 144, -96],
    ] },
    { tether: 540, members: [ // theater_down_camp
      ['neutral_underground_normal', 256, 0],
      ['neutral_underground_normal', -256, 0],
      ['neutral_underground_weak', -192, -128],
      ['neutral_underground_weak', 0, 128],
      ['neutral_underground_weak', 0, -128],
      ['neutral_underground_weak', 192, 128],
    ] },
    { tether: 540, members: [ // theater_stage_02_camp
      ['neutral_theater_normal', 3, 158],
      ['neutral_theater_normal', 136, -83],
      ['neutral_theater_normal', -128, -69],
    ] },
    { tether: 600, members: [ // theater_upstairs_01_camp
      ['neutral_theater_normal', 27, -198],
      ['neutral_theater_normal', 128, 96],
      ['neutral_theater_normal', -96, 128],
    ] },
    { tether: 290, members: [ // theater_upstairs_02_camp
      ['neutral_theater_weak', 128, 96],
      ['neutral_theater_normal', -32, -160],
      ['neutral_theater_weak', -160, 64],
    ] },
  ],
  [
    { tether: 550, members: [ // basketball_camp
      ['neutral_underground_normal', 84, -144],
      ['neutral_underground_normal', -176, 0],
      ['neutral_underground_strong', 84, 128],
    ] },
    { tether: 600, members: [ // chinatown_alley_camp
      ['neutral_drain_creature_normal', 96, 128],
      ['neutral_drain_creature_normal', -128, 0],
      ['neutral_drain_creature_strong', 96, -144],
    ] },
    { tether: 300, members: [ // chinatown_bell_02_camp
      ['neutral_lantern_strong', 128, -96],
      ['neutral_lantern_normal', -128, -96],
      ['neutral_lantern_normal', 0, 160],
    ] },
    { tether: 650, members: [ // chinatown_street_camp
      ['neutral_lantern_strong', 128, 128],
      ['neutral_lantern_strong', -128, -128],
      ['neutral_lantern_strong', 128, -128],
    ] },
    { tether: 300, members: [ // dock_camp
      ['neutral_barrel_01_strong', -96, -256],
      ['neutral_barrel_01_strong', 192, 0],
      ['neutral_barrel_01_strong', -96, 256],
    ] },
    { tether: -1, members: [ // park_gate_camp
      ['neutral_plant_strong', 64, 160],
      ['neutral_plant_strong', 64, -160],
      ['neutral_plant_strong', -128, 0],
    ] },
    { tether: 200, members: [ // plaza_corner_camp
      ['neutral_drain_creature_strong', -136, -80],
      ['neutral_drain_creature_strong', 136, -80],
      ['neutral_drain_creature_strong', 0, 152],
    ] },
    { tether: 600, members: [ // plaza_rink_01_camp
      ['neutral_drain_creature_normal', -128, 128],
      ['neutral_drain_creature_strong', 160, 0],
      ['neutral_drain_creature_normal', -128, -128],
    ] },
    { tether: 600, members: [ // plaza_rink_03_camp
      ['neutral_drain_creature_weak', 128, -64],
      ['neutral_drain_creature_normal', 0, 120],
      ['neutral_drain_creature_strong', -128, -64],
    ] },
    { tether: 540, members: [ // slums_warehouse_camp
      ['neutral_mushroom_strong', 0, -192],
      ['neutral_mushroom_strong', 192, 96],
      ['neutral_mushroom_strong', -192, 0],
    ] },
    { tether: 550, members: [ // theater_lobby_camp
      ['neutral_theater_strong', 117, -134],
      ['neutral_theater_strong', 54, 135],
      ['neutral_theater_strong', -149, -28],
    ] },
    { tether: 450, members: [ // theater_stage_01_camp
      ['neutral_theater_normal', 0, 160],
      ['neutral_theater_strong', -160, -103],
      ['neutral_theater_normal', 143, -65],
    ] },
  ],
]
