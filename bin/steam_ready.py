"""Check the Steam library Modlock will open before starting its local host."""
import os
from pathlib import Path
import re


def steam_roots():
    if os.name == "nt":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
                yield Path(winreg.QueryValueEx(key, "SteamPath")[0])
        except OSError:
            pass
        yield Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam"
    else:
        home = Path.home()
        for path in (".local/share/Steam", ".steam/steam", ".var/app/com.valvesoftware.Steam/.local/share/Steam",
                     "snap/steam/common/.local/share/Steam", "Library/Application Support/Steam"):
            yield home / path


def read_steam_file(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def deadlock_dir(roots):
    # Match the library search order used by the pinned Modlock CLI.
    root = next((root for root in roots if (root / "steamapps").is_dir()), None)
    if root is None:
        return None
    folders = read_steam_file(root / "steamapps/libraryfolders.vdf")
    paths = re.findall(r'"path"\s+"((?:[^"\\]|\\.)*)"', folders)
    libraries = [root] + [Path(path.replace("\\\\", "\\")) for path in paths]
    for library in libraries:
        game = library / "steamapps/common/Deadlock"
        if game.is_dir():
            return game
    return None


def check_steam_ready(game):
    if game is None or game.parent.name.lower() != "common":
        return
    manifest = read_steam_file(game.parent.parent / "appmanifest_1422450.acf")
    fields = dict(re.findall(r'"(installdir|StateFlags|buildid|TargetBuildID)"\s+"([^"]*)"', manifest))
    if fields.get("installdir", "").casefold() != game.name.casefold():
        return
    state = fields.get("StateFlags")
    target = fields.get("TargetBuildID")
    build = fields.get("buildid")
    # Steam writes 4 for a fully installed, idle app. That bit can also be
    # set alongside UpdateRequired, while the old game files are still present.
    busy = state and state.isdecimal() and int(state) != 4
    pending_build = build and target not in (None, "0", build)
    if busy or pending_build:
        raise ValueError(
            "Steam hasn't marked Deadlock ready for a new session. Close Deadlock if it's running, "
            "finish any queued Deadlock update in Steam Downloads, then launch the trainer again."
        )
