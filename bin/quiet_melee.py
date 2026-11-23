"""Prepare opponent-only heavy-melee visuals for the native server manifest."""
import json
import shutil


def stage_quiet_melee(native, project):
    # Use the same reserved names in the script that equips a bot and in the
    # manifest that silences its weapon. Each variant retains its native sounds.
    source = native / "quiet-melee.json"
    shutil.copyfile(source, project / "native" / source.name)
    variants = json.loads(source.read_text())
    melee = "CAbilityHoldMelee_VData"
    attacks = melee + ".m_mapAttacks[EMeleeHold_AttackType.EAttackType_"
    # This is an explicitly empty particle on all reserved retail definitions.
    empty = attacks + "Heavy]/AttackData_t.m_MeleeActivateParticle"
    particles = {melee + ".m_HoldBeginEffect": empty}
    for move in ("Heavy", "HeavyAir", "Slide"):
        for field in ("m_MeleeActivateParticle", "m_MeleeSwingParticle", "m_MeleeAttackParticle"):
            path = attacks + move + "]/AttackData_t." + field
            if path != empty:
                particles[path] = empty
    for variant in variants:
        del variant["weapons"]  # Only the script needs the list of heroes' weapon records.
        variant["copyFields"] = particles
    return variants
