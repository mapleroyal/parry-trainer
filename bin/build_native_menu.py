"""Stage the trainer's authored HUD in its Modlock content addon."""
from pathlib import Path
import argparse
import re
import xml.etree.ElementTree as ET

HUD_SCRIPTS = ("melee-range.js", "difficulty-settings.js", "menu/presets.js", "menu/settings.js",
               "menu/score-view.js", "menu/result-audio.js", "menu/result.js", "menu/profiles.js",
               "menu/controls.js", "menu/session.js")
HUD_STYLES = ("menu/controls.css", "menu/difficulty.css", "menu/score.css", "menu/profiles.css")


def add_controls(root, layout, panel):
    controls = ET.parse(root / "menu/panel.xml").getroot()
    # Native sliders may retain pointer capture when Tab closes mid-drag.
    snippets = layout.find("snippets")
    if snippets is None:
        snippets = ET.Element("snippets")
        layout.insert(0, snippets)
    for name in ("ParryTrainerMelee", "ParryTrainerInterval"):
        inputs = controls.find(f".//*[@id='{name}Inputs']")
        snippet = ET.SubElement(snippets, "snippet", name=name + "InputLayout")
        ET.SubElement(snippet, "Panel", {"class": "PTMeleeInputs", "hittest": "false"}).extend(inputs)
    controls.find(".//*[@id='ParryTrainerPageScore']").append(ET.parse(root / "menu/score-body.xml").getroot())
    panel.append(controls)
    return controls


def recap_layout(root):
    recap = ET.parse(root / "menu/result-summary.xml")
    recap.find(".//*[@id='ParryTrainerSummaryBody']").append(ET.parse(root / "menu/score-body.xml").getroot())
    return recap


def namespaced(source):
    """Only trainer-owned references move. Keep retail resources and Modlock's library paths."""
    for directory in (b"layout", b"styles", b"scripts"):
        prefix = b"{resources}/" + directory + b"/"
        source = source.replace(prefix + b"parry_trainer_", prefix + b"{addon}/parry_trainer_")
    return source


def build_native_menu(root, content):
    root, content = Path(root), Path(content)
    for directory in ("layout", "styles", "scripts"):
        (content / directory).mkdir(parents=True, exist_ok=True)
    layout = ET.Element("root")
    styles = ET.SubElement(layout, "styles")
    for src in ("s2r://panorama/styles/citadel_base_styles.vcss", "file://{resources}/styles/{addon}/trainer.css"):
        ET.SubElement(styles, "include", src=src)
    scripts = ET.SubElement(layout, "scripts")
    for src in ("file://{resources}/scripts/modlock/layout.js", "file://{resources}/scripts/{addon}/trainer.js"):
        ET.SubElement(scripts, "include", src=src)
    # BLoadLayout applies the outer Panel to Modlock's existing layout node.
    # Keep the trainer's ID, global class listener and hittest rules on its own child.
    frame = ET.SubElement(layout, "Panel", {"hittest": "false", "style": "width: 100%; height: 100%;"})
    controls = add_controls(root, layout, frame)
    controls.set("onload", "ParryTrainerWatchMenu(true)")
    ET.SubElement(controls, "Panel", {"id": "ParryTrainerDrainWarning", "hittest": "false", "hittestchildren": "false",
                                      "style": "width: 100%; height: 100%;"})
    backup_parent = controls.find(".//*[@id='ParryTrainerLibraryBackup']/..")
    original = backup_parent.find("*[@id='ParryTrainerLibraryBackup']")
    index = list(backup_parent).index(original)
    backup_parent.remove(original)
    backup_parent.insert(index, ET.parse(root / "native/backup-panel.xml").getroot())
    ET.ElementTree(layout).write(content / "layout/trainer.xml", encoding="utf-8")
    summary = ET.tostring(recap_layout(root).getroot(), encoding="utf-8")
    (content / "layout/parry_trainer_summary.xml").write_bytes(namespaced(summary))
    for name, source in (("parry_trainer_result", "result"), ("parry_trainer_countdown", "countdown"),
                         ("parry_trainer_drain_warning", "drain-warning")):
        (content / f"layout/{name}.xml").write_bytes((root / f"menu/{source}.xml").read_bytes())
    (content / "styles/parry_trainer_score.css").write_bytes((root / "menu/score.css").read_bytes())
    style_files = [root / name for name in HUD_STYLES] + [root / "native/backup.css"]
    (content / "styles/trainer.css").write_bytes(b"\n".join(f.read_bytes() for f in style_files))
    sources = (*HUD_SCRIPTS, "native/retail-hud.js", "native/hud.js")
    js = [(root / src).read_bytes() for src in sources]
    # Panorama loads classic scripts. The backup codec is also an ES module in the host.
    codec = re.sub(rb"^export ", b"", (root / "native/save-codec.js").read_bytes(), flags=re.MULTILINE)
    js.extend((codec, (root / "native/backup-client.js").read_bytes()))
    (content / "scripts/trainer.js").write_bytes(namespaced(b"\n".join(js)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("content", type=Path)
    build_native_menu(Path(__file__).resolve().parents[1], parser.parse_args().content)
