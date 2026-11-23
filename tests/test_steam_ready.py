import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from steam_ready import check_steam_ready, deadlock_dir


class SteamReadyTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.library = self.root / "Game Library"
        self.game = self.library / "steamapps/common/Deadlock"
        self.game.mkdir(parents=True)
        (self.root / "steamapps").mkdir()
        escaped_path = str(self.library).replace("\\", "\\\\")
        (self.root / "steamapps/libraryfolders.vdf").write_text(f'"path" "{escaped_path}"')

    def manifest(self, state, target="123"):
        (self.library / "steamapps/appmanifest_1422450.acf").write_text(
            f'"installdir" "Deadlock"\n"StateFlags" "{state}"\n"buildid" "123"\n"TargetBuildID" "{target}"'
        )

    def test_ready_in_secondary_library(self):
        self.assertEqual(self.game, deadlock_dir([self.root]))
        for target in ("0", "123"):
            self.manifest("4", target)
            check_steam_ready(self.game)

    def test_update_queued_or_applying(self):
        for state, target in (("6", "123"), ("4", "124"), ("4194308", "124")):
            with self.subTest(state=state, target=target):
                self.manifest(state, target)
                with self.assertRaisesRegex(ValueError, "Steam Downloads"):
                    check_steam_ready(self.game)

    def test_private_install_is_independent(self):
        self.manifest("6")
        check_steam_ready(self.root / "private/Deadlock")
        check_steam_ready(self.game.with_name("PrivateClone"))
        check_steam_ready(None)

    def test_missing_manifest_leaves_discovery_to_modlock(self):
        check_steam_ready(self.game)


if __name__ == "__main__":
    unittest.main()
