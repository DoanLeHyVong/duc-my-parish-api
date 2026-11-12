"""Exercise the production restore verifier with deterministic MariaDB responses."""
import contextlib
import io
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


VERIFIER = Path(__file__).resolve().parents[1] / "verify-restore.py"
TREE_VERIFIER = Path(__file__).resolve().parents[1] / "verify-release-tree.py"


class RestoreVerifierTest(unittest.TestCase):
    def run_verifier(self, tables, orphan_count=0):
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "backup.sql"
            dump.write_text("CREATE TABLE `parent` (id int);\nCREATE TABLE `child` (id int);\n", encoding="utf-8")

            def fake_run(command, **_kwargs):
                sql = command[-1]
                if "FROM information_schema.tables" in sql:
                    output = "\n".join(tables) + "\n"
                elif "FROM information_schema.key_column_usage" in sql:
                    output = "fk_child_parent\tchild\tparent_id\tparent\tid\n"
                elif "LEFT JOIN" in sql:
                    output = f"{orphan_count}\n"
                elif "COUNT(*)" in sql:
                    output = "1\n"
                else:
                    raise AssertionError(sql)
                return subprocess.CompletedProcess(command, 0, output, "")

            with patch.object(sys, "argv", [str(VERIFIER), "test.cnf", "ducmy_restore_test", str(dump)]), patch(
                "subprocess.run", side_effect=fake_run
            ), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(VERIFIER), run_name="__main__")

    def test_rejects_missing_table(self):
        with self.assertRaisesRegex(SystemExit, "table count"):
            self.run_verifier(["parent"])

    def test_rejects_foreign_key_orphan(self):
        with self.assertRaisesRegex(SystemExit, "orphan"):
            self.run_verifier(["parent", "child"], orphan_count=1)

    def test_accepts_complete_restore(self):
        self.run_verifier(["parent", "child"])

    def test_release_tree_rejects_mutated_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "extracted"
            (target / "dist").mkdir(parents=True)
            file = target / "dist" / "server.js"
            file.write_text("original", encoding="utf-8")
            archive = root / "release.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                bundle.add(target / "dist", arcname="dist")
            with patch.object(sys, "argv", [str(TREE_VERIFIER), str(archive), str(target)]):
                runpy.run_path(str(TREE_VERIFIER), run_name="__main__")
                file.write_text("modified", encoding="utf-8")
                with self.assertRaisesRegex(SystemExit, "differs"):
                    runpy.run_path(str(TREE_VERIFIER), run_name="__main__")


if __name__ == "__main__":
    unittest.main()
