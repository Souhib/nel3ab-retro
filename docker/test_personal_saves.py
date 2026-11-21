"""The real Docker launcher mounts just the selected account, at the linked path."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class PersonalMount(unittest.TestCase):
    def test_launcher_preserves_paths_with_spaces_and_rejects_escaping_mounts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            user = root / "room"
            user.mkdir()
            account = root / "account data"
            account.mkdir()
            target = user / "saves/game/joueur-fixture"
            target.mkdir(parents=True)
            commands = root / "commands"
            commands.mkdir()
            docker = commands / "docker"
            docker.write_text(
                "#!/usr/bin/python3\nimport os,sys,json\n"
                "if sys.argv[1] == 'run':\n"
                " open(os.environ['PERSONAL_ARGS_LOG'],'w').write(json.dumps(sys.argv[1:]))\n"
            )
            docker.chmod(0o755)
            record = root / "arguments.json"
            env = {
                **os.environ,
                "PATH": f"{commands}:/usr/bin:/bin",
                "PERSONAL_ARGS_LOG": str(record),
            }
            marker = user / "personal-save-mount"
            launcher = Path(__file__).with_name("dolphin-in-docker.sh")

            def launch():
                # The executable is the repository launcher; Docker is a fixture
                # that records arguments and never starts a real container.
                return subprocess.run(  # noqa: S603
                    [
                        str(launcher),
                        "--user",
                        str(user),
                        "--exec",
                        str(root / "game.iso"),
                    ],
                    env=env,
                    capture_output=True,
                    check=False,
                )

            marker.write_text(f"{account}\n{target}\n")
            result = launch()
            self.assertEqual(result.returncode, 0, result.stderr)
            args = json.loads(record.read_text())
            self.assertIn(f"{account}:{target}", args)
            self.assertIn(f"{user}:{user}", args)
            record.unlink()
            for bad in (
                f"{account}\n{root}/outside\n",
                f"{account}\n{target}/../joueur-other\n",
                f"{account}\n{target}\nextra\n",
            ):
                marker.write_text(bad)
                result = launch()
                self.assertEqual(result.returncode, 64, result.stderr)
                self.assertFalse(record.exists())
            marker.unlink()
            self.assertEqual(launch().returncode, 0)
            self.assertNotIn(f"{account}:{target}", json.loads(record.read_text()))
