#!/usr/bin/env python3
"""Check a disposable SQL restore without exposing credentials in output."""
import re
import subprocess
import sys
from pathlib import Path

cnf, database, dump = sys.argv[1:]
if not re.fullmatch(r"ducmy_restore_[a-z0-9_]+", database):
    raise SystemExit("Invalid disposable database name")

def query(sql):
    result = subprocess.run(
        ["mariadb", f"--defaults-extra-file={cnf}", "--batch", "--skip-column-names", "-e", sql],
        capture_output=True, text=True, check=True,
    )
    return [row.split("\t") for row in result.stdout.splitlines()]

def ident(value):
    return "`" + value.replace("`", "``") + "`"

tables = query(
    "SELECT table_name FROM information_schema.tables "
    f"WHERE table_schema='{database}' AND table_type='BASE TABLE' ORDER BY table_name"
)
with Path(dump).open("r", encoding="utf-8", errors="replace") as source:
    expected = sum(1 for line in source if line.startswith("CREATE TABLE "))
if not tables or len(tables) != expected:
    raise SystemExit("Restored table count does not match SQL dump")

total_rows = 0
for (table,) in tables:
    total_rows += int(query(f"SELECT COUNT(*) FROM {ident(database)}.{ident(table)}")[0][0])
if total_rows == 0:
    raise SystemExit("Restored database has no rows")

keys = query(
    "SELECT constraint_name, table_name, column_name, referenced_table_name, "
    "referenced_column_name FROM information_schema.key_column_usage "
    f"WHERE table_schema='{database}' AND referenced_table_name IS NOT NULL "
    "ORDER BY table_name, constraint_name, ordinal_position"
)
groups = {}
for constraint, table, column, parent, parent_column in keys:
    groups.setdefault((constraint, table, parent), []).append((column, parent_column))
for (_, table, parent), columns in groups.items():
    joins = " AND ".join(f"c.{ident(c)} = p.{ident(p)}" for c, p in columns)
    present = " AND ".join(f"c.{ident(c)} IS NOT NULL" for c, _ in columns)
    sql = (f"SELECT COUNT(*) FROM {ident(database)}.{ident(table)} c "
           f"LEFT JOIN {ident(database)}.{ident(parent)} p ON {joins} "
           f"WHERE {present} AND p.{ident(columns[0][1])} IS NULL")
    if int(query(sql)[0][0]) != 0:
        raise SystemExit("Foreign-key orphan found in disposable restore")

print(f"Restore verified: {len(tables)} tables, {total_rows} rows, {len(groups)} foreign keys")
