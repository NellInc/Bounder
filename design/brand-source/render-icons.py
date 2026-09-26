#!/usr/bin/env python3
"""Regenerate favicon.ico and assets/apple-touch-icon.png from assets/bounder-mark.svg.

Run from the repository root with rsvg-convert (librsvg) on PATH:

    python3 design/brand-source/render-icons.py

favicon.ico holds 16, 32 and 48 px PNG renders of the mark in one ICO container.
The touch icon is a full-bleed 180 px square, because iOS applies its own corner mask.
"""
import pathlib
import shutil
import struct
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MARK = ROOT / "assets" / "bounder-mark.svg"
INK = "#11130f"


def render(svg: bytes, size: int, target: pathlib.Path, background: str | None = None) -> bytes:
    command = [shutil.which("rsvg-convert") or "rsvg-convert", "-w", str(size), "-h", str(size)]
    if background:
        command += ["-b", background]
    subprocess.run(command + ["-o", str(target)], input=svg, check=True)
    return target.read_bytes()


def pack_ico(pngs: list[bytes]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    entries, body = b"", b""
    for data in pngs:
        assert data[:8] == b"\x89PNG\r\n\x1a\n"
        width, height = struct.unpack(">II", data[16:24])
        entries += struct.pack("<BBBBHHII", width % 256, height % 256, 0, 0, 1, 32, len(data), offset + len(body))
        body += data
    return header + entries + body


def main() -> None:
    svg = MARK.read_bytes()
    with tempfile.TemporaryDirectory() as scratch:
        scratch_path = pathlib.Path(scratch)
        pngs = [render(svg, size, scratch_path / f"mark-{size}.png") for size in (16, 32, 48)]
        (ROOT / "favicon.ico").write_bytes(pack_ico(pngs))
        square = svg.replace(b' rx="22"', b"", 1)
        touch = render(square, 180, scratch_path / "touch.png", background=INK)
        (ROOT / "assets" / "apple-touch-icon.png").write_bytes(touch)


if __name__ == "__main__":
    main()
