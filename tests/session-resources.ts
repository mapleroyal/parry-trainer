// Start a second drill with the previous session's spent resources, then use them during its countdown.
import { addBot, log, onFrame, readField, serverCommand, writeField, type Player } from 'modlock'
import { beginTraining, setFastStamina, setFreeParry, stopTraining, testSubject } from '../gameplay'
import { captureHeroLoadout, heroLoadoutKey } from '../hero-loadout'
import { session } from '../session'

export default function registerSessionResourceProbe(): void {
  let trainee: Player | undefined, stage = 'spawn', start = -1
  let baseHealth = 0, fullClip = 0, fullCharges = 0, build = ''
  const primary = 'CCitadel_Ability_PrimaryWeapon'
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
  onFrame(({ timeSeconds: now }) => {
    if (stage === 'done') return
    if (start < 0) start = now
    try {
      check(now - start < 20, 'timed out')
      if (!trainee) {
        trainee = addBot({ name: 'Session resource tester', hero: 'hero_wraith', team: 2 })
        if (trainee) testSubject(trainee, undefined, false)
        return
      }
      const player = trainee, pawn = player.pawn()
      if (!pawn?.hero || pawn.health <= 0) return
      const owned = player.abilities(), cards = owned.find(a => a.slot === 0)
      const boots = owned.find(a => a.name === 'upgrade_fleetfoot_boots')
      const gun = owned.find(a => a.slot === 21)?.entity
      if (!gun || !cards) return
      const clip = readField(gun, primary, 'm_iClip', 'int32')
      if (typeof clip !== 'number' || clip <= 0) return
      const maximum = pawn.effectiveMaxHealth ?? pawn.maxHealth
      function spendResources() {
        check(writeField(pawn!.entity, 'CBaseEntity', 'm_iHealth', 'int32', Math.floor(maximum / 2)) &&
          writeField(gun!, primary, 'm_iClip', 'int32', 4) && player.setStamina(0), 'could not deplete resources')
        check(player.setAbility({ ability: cards!.name, charges: 0, rechargeEnd: now + 60, cooldownEnd: now + 60 }) &&
          player.setAbility({ ability: boots!.name, cooldownEnd: now + 60 }), 'could not put skills and equipment on cooldown')
      }
      function verifyRefresh() {
        const kit = captureHeroLoadout(player, true, true)
        check(kit && heroLoadoutKey(kit) === build, 'refresh changed the equipped build or progression')
        check(pawn!.health === maximum && pawn!.stamina === pawn!.maxStamina, 'health or stamina below the equipped maximum')
        check(clip === fullClip && cards!.charges === fullCharges && cards!.cooldownEnd === 0 &&
          cards!.rechargeEnd === 0 && boots!.cooldownEnd === 0, 'ammo, charges or cooldowns below full readiness')
      }

      if (stage === 'spawn') {
        baseHealth = maximum
        setFastStamina(false)
        setFreeParry(false)
        check(player.trainAbility(0) && player.buyItem('upgrade_health') && player.buyItem('upgrade_fleetfoot_boots'), 'prepare build')
        stage = 'setup'
      } else if (stage === 'setup' && maximum > baseHealth && boots) {
        check(beginTraining({ mode: 'none' }), 'first Begin')
        stage = 'first session'
      } else if (stage === 'first session' && session.phase === 'running') {
        fullClip = clip
        fullCharges = cards.charges
        const kit = captureHeroLoadout(player, true, true)
        check(fullClip > 4 && fullCharges > 0 && kit?.abilities?.slots.some(s => s.state === 0), 'reference build')
        build = heroLoadoutKey(kit!)
        spendResources()
        stopTraining()
        stage = 'finished'
      } else if (stage === 'finished' && clip === 4 && cards.cooldownEnd > now && boots!.cooldownEnd > now) {
        check(pawn.health < maximum && pawn.stamina! < pawn.maxStamina! && cards.charges === 0, 'previous session resources must be spent')
        check(beginTraining({ mode: 'none' }), 'second Begin')
        stage = 'restart'
      } else if (stage === 'restart') {
        check(session.phase === 'countdown', 'expected countdown')
        verifyRefresh()
        stage = 'countdown'
      } else if (stage === 'countdown' && session.remaining(now) <= 1) {
        spendResources()
        stage = 'first scored frame'
      } else if (stage === 'first scored frame' && session.phase === 'running') {
        verifyRefresh()
        log('PARRY TRAINER PROBE PASS session-resources full effective health, ammo, stamina, card charges and item/skill cooldowns on restart and first scored frame; build preserved')
        stage = 'done'
        serverCommand('quit')
      }
    } catch (error) {
      log('PARRY TRAINER PROBE FAIL session-resources', stage, String(error))
      stage = 'done'
      serverCommand('quit')
    }
  })
}
