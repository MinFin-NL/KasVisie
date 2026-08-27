#!/usr/bin/env python3
"""Haalt het NLDD Design System op en zet het klaar in vendor/nldd/.

Deze applicatie heeft geen Node-toolchain: de frontend is platte HTML/JS die de
browser zelf laadt, en het design system komt als kant-en-klare bundel
(`dist/nldd.min.js` + `dist/css` + `dist/fonts`) uit het npm-pakket. Dit script
haalt dat pakket met de Python-standaardbibliotheek op, zodat het zowel in de
Dockerfile als lokaal werkt zonder npm.

De opgehaalde map is *niet* gecommit (zie .gitignore); dit script is de enige
bron. Upgraden: pas VERSION aan, draai het script met --print-hash, en zet de
nieuwe waarde in SHA512.

    python scripts/fetch_nldd.py            # naar vendor/nldd/
    python scripts/fetch_nldd.py --dest DIR # naar een andere map (Docker)
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

PACKAGE = "@nldd/design-system"
VERSION = "0.8.83"

# sha512 van de tarball, base64 zoals npm hem in `dist.integrity` publiceert.
# Vervangt de lockfile: zonder deze controle vertrouwt de build blind op het
# register. Zet op None om een nieuwe versie te laten uitrekenen (--print-hash).
SHA512 = "sha512-f7AqpPbMGG8BDh194maf5qEYD5JJzMSZ9plLONr9hxfKG3eInmSTHdu2jlvWGmWmTVkV8J6yPaxZVB2COs328w=="

REGISTRY = "https://registry.npmjs.org"

# Alleen wat de browser nodig heeft; de rest van het pakket (bronnen, types,
# custom-elements.json, voorbeelden) blijft buiten het image.
WANTED = ("dist/nldd.min.js", "dist/css/", "dist/fonts/")


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 (vaste https-url)
        return resp.read()


def _integrity(raw: bytes) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(raw).digest()).decode()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dest", default=None, help="doelmap (standaard: vendor/nldd)")
    ap.add_argument("--version", default=VERSION, help=f"pakketversie (standaard {VERSION})")
    ap.add_argument(
        "--print-hash",
        action="store_true",
        help="druk de integrity-waarde af in plaats van hem te controleren",
    )
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    dest = Path(args.dest) if args.dest else repo_root / "vendor" / "nldd"

    meta = json.loads(_fetch(f"{REGISTRY}/{PACKAGE}/{args.version}"))
    tarball_url = meta["dist"]["tarball"]
    print(f"→ {PACKAGE}@{args.version}", file=sys.stderr)

    raw = _fetch(tarball_url)
    got = _integrity(raw)

    # Het register vertelt zelf welke hash bij deze versie hoort; die controle
    # vangt een kapotte download. SHA512 hierboven vangt daarnaast een gewijzigd
    # register, en is dus het equivalent van de lockfile.
    expected = meta["dist"].get("integrity")
    if expected and got != expected:
        print(f"integrity uit register wijkt af: {got} != {expected}", file=sys.stderr)
        return 1
    if args.print_hash:
        print(got)
        return 0
    if SHA512 and got != SHA512:
        print(
            f"tarball komt niet overeen met de vastgelegde hash:\n  {got}\n  {SHA512}",
            file=sys.stderr,
        )
        return 1
    if not SHA512:
        print("let op: SHA512 staat op None, tarball niet vastgepind", file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "package.tgz"
        tar_path.write_bytes(raw)
        with tarfile.open(tar_path) as tar:
            members = [
                m
                for m in tar.getmembers()
                if m.isfile()
                and m.name.startswith("package/")
                and any(m.name[len("package/") :].startswith(w) for w in WANTED)
            ]
            if not members:
                print("tarball bevat geen dist/nldd.min.js — verkeerd pakket?", file=sys.stderr)
                return 1
            tar.extractall(Path(tmp) / "out", members=members, filter="data")

        src = Path(tmp) / "out" / "package" / "dist"
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dest)

    # Herkomst zichtbaar houden: de map staat niet in git, dus dit is het enige
    # spoor van welke versie er in een image zit.
    (dest / "VERSION").write_text(f"{PACKAGE}@{args.version}\n{got}\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    print(f"✓ {dest} ({total / 1_000_000:.1f} MB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
