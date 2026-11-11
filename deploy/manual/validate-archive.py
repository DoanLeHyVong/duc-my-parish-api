#!/usr/bin/env python3
"""Reject tar members and links that can escape an isolated release directory."""
import posixpath
import sys
import tarfile

with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive:
        name = posixpath.normpath(member.name)
        if member.name.startswith("/") or name == ".." or name.startswith("../"):
            raise SystemExit("Unsafe archive path")
        if member.issym() or member.islnk():
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname) if member.issym() else member.linkname)
            if member.linkname.startswith("/") or target == ".." or target.startswith("../"):
                raise SystemExit("Unsafe archive link")
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise SystemExit("Unsupported archive member")
    archive.extractall(sys.argv[2], filter="data")
