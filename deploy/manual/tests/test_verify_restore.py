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
    def run_verifier(self, tables, orphan_count=0, empty_dump=False, rows=1, source_count=None):
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "backup.sql"
            dump.write_text(
                "-- SQL dump of empty database\n-- appglv-source-tables=0\n" if empty_dump else "CREATE TABLE `parent` (id int);\nCREATE TABLE `child` (id int);\n-- appglv-source-tables=2\n",
                encoding="utf-8",
            )
            if source_count is not None:
                content = dump.read_text(encoding="utf-8")
                content = content.replace("-- appglv-source-tables=0", f"-- appglv-source-tables={source_count}") if empty_dump else content.replace("-- appglv-source-tables=2", f"-- appglv-source-tables={source_count}")
                dump.write_text(content, encoding="utf-8")

            def fake_run(command, **_kwargs):
                sql = command[-1]
                if "FROM information_schema.tables" in sql:
                    output = "\n".join(tables) + ("\n" if tables else "")
                elif "FROM information_schema.key_column_usage" in sql:
                    output = "" if empty_dump else "fk_child_parent\tchild\tparent_id\tparent\tid\n"
                elif "LEFT JOIN" in sql:
                    output = f"{orphan_count}\n"
                elif "COUNT(*)" in sql:
                    output = f"{rows}\n"
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

    def test_accepts_real_empty_dump_restored_as_zero_tables(self):
        self.run_verifier([], empty_dump=True)

    def test_rejects_missing_table_from_nonempty_dump(self):
        with self.assertRaisesRegex(SystemExit, "table count"):
            self.run_verifier([], empty_dump=False)

    def test_rejects_unexpected_table_in_empty_dump(self):
        with self.assertRaisesRegex(SystemExit, "table count"):
            self.run_verifier(["parent"], empty_dump=True)

    def test_rejects_zero_table_dump_claiming_nonempty_source(self):
        with self.assertRaisesRegex(SystemExit, "source inventory"):
            self.run_verifier([], empty_dump=True, source_count=1)

    def test_nonempty_schema_still_requires_rows(self):
        with self.assertRaisesRegex(SystemExit, "no rows"):
            self.run_verifier(["parent", "child"], rows=0)

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
