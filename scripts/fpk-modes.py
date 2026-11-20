"""Set Unix file modes on a local unsigned FPK built with Windows fnpack."""

from hashlib import md5
import io
import os
from pathlib import Path
import re
import sys
import tarfile


def write_archive(original, output, *, package=False):
    with tarfile.open(fileobj=original, mode="r:gz") as source:
        items = source.getmembers()
        if any(not (item.isfile() or item.isdir()) for item in items):
            raise ValueError("Unexpected archive entry type")
        names = {item.name for item in items}
        if package and ("manifest" not in names or "cmd/main" not in names
                        or "app.tgz" not in names):
            raise ValueError("Unexpected FPK layout")
        if package and {name.split("/", 1)[0] for name in names} - {
            "app.tgz", "cmd", "config", "ICON.PNG", "ICON_256.PNG", "manifest"
        }:
            raise ValueError("Only the unsigned local package layout is supported")

        replacements = {}
        if package:
            original_payload = source.extractfile("app.tgz").read()
            manifest = source.extractfile("manifest").read()
            checksum = re.search(rb"(?m)^checksum[ \t]*=[ \t]*([a-f0-9]{32})[ \t]*\r?$", manifest)
            if not checksum or checksum[1] != md5(original_payload).hexdigest().encode("ascii"):
                raise ValueError("Unexpected fnpack payload checksum")
            payload = io.BytesIO()
            write_archive(io.BytesIO(original_payload), payload)
            replacements["app.tgz"] = payload.getvalue()
            replacements["manifest"] = (
                manifest[:checksum.start(1)]
                + md5(replacements["app.tgz"]).hexdigest().encode("ascii")
                + manifest[checksum.end(1):]
            )

        with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT) as target:
            for item in items:
                executable = package and item.name.startswith("cmd/")
                item.mode = 0o755 if item.isdir() or executable else 0o644
                if item.name in replacements:
                    data = replacements[item.name]
                    item.size = len(data)
                    target.addfile(item, io.BytesIO(data))
                else:
                    target.addfile(item, source.extractfile(item) if item.isfile() else None)


archive = Path(sys.argv[1])
temporary = archive.with_suffix(".linux.fpk")
with archive.open("rb") as original, temporary.open("xb") as output:
    write_archive(original, output, package=True)
os.replace(temporary, archive)
