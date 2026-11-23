// A neutral's camp controller supplies its aggro, tether and native attack AI.
// The private arena contains only the single camp requested by the trainee.
import { createEntity, entityPosition, findEntities, ground, moveEntity, Npc, readField,
  removeEntity, serverCommand, vector, type Vector } from 'modlock'
import { formations } from './camp-formations'

export class NeutralCamp {
  private readonly markers: number[] = []
  private readonly seen = new Set<number>()
  private count = 0
  readonly deadline: number

  private constructor(now: number) { this.deadline = now + 2 }

  static spawn(center: Vector, level: number, now: number): NeutralCamp | undefined {
    const layouts = formations[level - 1]
    if (!layouts?.length) return
    const floor = ground(center, { above: 128, below: 32768 })
    if (!floor) return
    const camp = new NeutralCamp(now)
    const name = 'parry_trainer_training_camp'
    const { members, tether } = layouts[Math.floor(Math.random() * layouts.length)]
    const controller = createEntity({
      designerName: 'info_neutral_trooper_camp', team: 0,
      subclass: ['neutral_camp_weak', 'neutral_camp_medium', 'neutral_camp_strong'][level - 1],
      position: floor, keyValues: [{ key: 'targetname', value: { text: name } },
        { key: 'TetherRadiusOverride', value: { number: tether } }],
    })
    if (!controller) return
    camp.markers.push(controller)
    const angle = Math.random() * 2 * Math.PI, cos = Math.cos(angle), sin = Math.sin(angle)
    for (const [unit, x, y] of members) {
      const marker = createEntity({
        designerName: 'info_neutral_trooper_spawn', subclass: '', team: 4,
        position: { x: floor.x + x*cos - y*sin, y: floor.y + x*sin + y*cos, z: floor.z + 4 },
        keyValues: [{ key: 'CampName', value: { text: name } },
          { key: 'ENeutralTrooperType', value: { integer: -1 } },
          { key: 'NeutralSubclass', value: { text: unit } }],
      })
      if (!marker) { camp.remove(); return }
      camp.markers.push(marker)
    }
    camp.count = members.length
    // Regular timed respawns stay disabled. This command spawns the placed camp next tick.
    serverCommand('citadel_spawn_all_neutrals')
    return camp
  }

  get pending(): boolean { return this.seen.size < this.count }

  newMembers(killed?: number): Npc[] {
    if (!this.pending) return []
    const added: Npc[] = []
    for (const id of findEntities('npc_trooper_neutral')) {
      if (this.seen.has(id) || (id !== killed && readField(id, 'CBaseEntity', 'm_lifeState', 'uint8') !== 0)) continue
      this.seen.add(id)
      added.push(new Npc(id))
    }
    return added
  }

  get center(): Vector | undefined { return entityPosition(this.markers[0])?.position }

  move(offset: Vector): void {
    for (const marker of this.markers) {
      const p = entityPosition(marker)?.position
      if (p) moveEntity(marker, vector.add(p, offset))
    }
  }

  remove(): void {
    for (const id of this.markers) removeEntity(id)
    this.markers.length = 0
  }
}
