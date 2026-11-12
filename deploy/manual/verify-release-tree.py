"""Verify an extracted release still matches the approved tarball."""
import os
import sys
import tarfile
from pathlib import Path


archive_path, target_path = sys.argv[1:]
target = Path(target_path)
expected = set()
with tarfile.open(archive_path, "r:gz") as archive:
    for member in archive:
        relative = Path(member.name)
        expected.add(relative.as_posix().rstrip("/"))
        actual = target / relative
        if member.isfile():
            if not actual.is_file() or actual.is_symlink() or actual.stat().st_size != member.size:
                raise SystemExit("Extracted release differs from archive")
            source = archive.extractfile(member)
            if source is None:
                raise SystemExit("Unreadable archive member")
            with source, actual.open("rb") as deployed:
                while chunk := source.read(1024 * 1024):
                    if deployed.read(len(chunk)) != chunk:
                        raise SystemExit("Extracted release differs from archive")
        elif member.issym():
            if not actual.is_symlink() or os.readlink(actual) != member.linkname:
                raise SystemExit("Extracted release link differs from archive")
        elif member.islnk():
            linked = target / member.linkname
            if not actual.is_file() or actual.is_symlink() or not linked.is_file() or not os.path.samefile(actual, linked):
                raise SystemExit("Extracted release hardlink differs from archive")
        elif member.isdir():
            if not actual.is_dir() or actual.is_symlink():
                raise SystemExit("Extracted release directory differs from archive")
        else:
            raise SystemExit("Unsupported release member")

for path in target.rglob("*"):
    relative = path.relative_to(target).as_posix()
    if relative not in expected and relative != ".source-archive.sha256":
        raise SystemExit("Unexpected file in extracted release")
