"""Verify the upstream model and assemble the redistributable obstacle WASM SDK."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tomllib
import urllib.request
import zipfile


SDK_SHA256 = "3d05b85949f5ae3bce3cef1f0678a3aeb31d9e8f935565bcc09da63bb19dd1d1"
SDK_WASM_SHA256 = "feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d"
USI_LICENSE_URL = "https://raw.githubusercontent.com/nyoki-mtl/rsshogi-usi/b22c4ef43476a58791748ef6826e88a5be532c37/LICENSE"
USI_LICENSE_SHA256 = "c96e53c2a56a2a2e96926bdae61a84799c6b70d403947aba8e81058aaa4ec407"
LICENSE_NAME = re.compile(r"^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE|UNLICENSE)([._-]|$)", re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check(data, expected, label):
    if digest(data) != expected:
        raise ValueError(f"SHA-256 mismatch: {label}")
    return data


def download(url, expected):
    with urllib.request.urlopen(url, timeout=60) as response:
        return check(response.read(), expected, url)


def extract(archive, model, model_digest):
    check(archive.read_bytes(), SDK_SHA256, "official ZIP")
    with zipfile.ZipFile(archive) as sdk:
        wasm = check(sdk.read("wasm-sdk/rsshogi_nnue_mini.wasm"), SDK_WASM_SHA256, "official WASM")
    marker = b"RSNNPKG\x00"
    matches = []
    offset = wasm.find(marker)
    while offset >= 0:
        if offset + 28 <= len(wasm):
            version, flags, manifest_size, payload_size = struct.unpack_from("<HHQQ", wasm, offset + 8)
            end = offset + 28 + manifest_size + payload_size
            if version == 1 and flags == 0 and end <= len(wasm):
                candidate = wasm[offset:end]
                if digest(candidate) == model_digest:
                    matches.append(candidate)
        offset = wasm.find(marker, offset + 1)
    if len(matches) != 1:
        raise ValueError("The official WASM did not contain exactly one verified NNUE model")
    model.write_bytes(matches[0])
    print(f"Verified embedded model: {len(matches[0])} bytes")


def collect_notices(lock, rules, rules_revision):
    lines = [
        "Third-party notices for the obstacle SDK",
        "",
        "===== rsshogi 1.7.2 (modified) =====",
        f"https://github.com/nyoki-mtl/rsshogi/blob/{rules_revision}/crates/rsshogi/LICENSE",
        (rules / "crates/rsshogi/LICENSE").read_text(encoding="utf-8"),
    ]
    entries = tomllib.loads(lock.read_text(encoding="utf-8"))["package"]
    for entry in entries:
        if not entry.get("source", "").startswith("registry+"):
            continue
        name, version = entry["name"], entry["version"]
        url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        data = download(url, entry["checksum"])
        lines.extend([f"===== {name} {version} =====", url])
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            license_members = sorted((
                member for member in archive.getmembers()
                if member.isfile()
                and len(PurePosixPath(member.name).parts) == 2
                and LICENSE_NAME.match(PurePosixPath(member.name).name)
            ), key=lambda member: member.name)
            if license_members:
                for member in license_members:
                    lines.extend([
                        f"--- {member.name} ---",
                        archive.extractfile(member).read().decode("utf-8"),
                    ])
            elif (name, version) == ("rsshogi-usi", "0.2.0"):
                lines.extend([USI_LICENSE_URL, download(USI_LICENSE_URL, USI_LICENSE_SHA256).decode("utf-8")])
            else:
                raise ValueError(f"No license files found for {name} {version}")
    return "\n".join(lines)


def package(build, output, rust, rules_revision, engine_revision, model_digest):
    project = Path(__file__).resolve().parents[1]
    engine = build / "engine"
    lock = engine / "Cargo.lock"
    files = {
        name: engine / "bindings/wasm" / name
        for name in ("mini.js", "worker.js", "package.json")
    }
    files["LICENSE"] = engine / "LICENSE"
    files["rsshogi_nnue_mini.wasm"] = engine / "target/wasm32-unknown-unknown/release/rsshogi_nnue_mini.wasm"
    staging = build / "package"
    staging.mkdir(exist_ok=True)
    for name, source in files.items():
        shutil.copyfile(source, staging / name)
    notices = collect_notices(lock, build / "rules", rules_revision)
    (staging / "THIRD-PARTY-NOTICES.txt").write_text(notices, encoding="utf-8")
    manifest = {
        "package": "rsshogi-nnue-mini-obstacle",
        "upstream_engine": {
            "repository": "https://github.com/nyoki-mtl/rsshogi-nnue-mini",
            "version": "0.4.0",
            "revision": engine_revision,
        },
        "upstream_rules": {
            "repository": "https://github.com/nyoki-mtl/rsshogi",
            "version": "1.7.2",
            "revision": rules_revision,
        },
        "upstream_usi_version": "0.2.0",
        "modifications": [
            "Impassable squares in position, move generation, attacks, and mate search",
            "Obstacle SFEN and legal-move JSON commands, transposition separation, and obstacle terminal scoring",
            "Separate worker that supplies obstacle squares with the root position",
        ],
        "rust_version": rust,
        "target": "wasm32-unknown-unknown",
        "cargo_features": ["c-api", "embedded-rsnn"],
        "threads": 1,
        "official_sdk_zip_sha256": SDK_SHA256,
        "official_wasm_sha256": SDK_WASM_SHA256,
        "embedded_rsnn_sha256": model_digest,
        "cargo_lock_sha256": digest(lock.read_bytes()),
        "patch_repository": "https://github.com/amatouazuwo/shogi-is-luck-engine",
        "source_patches_sha256": {
            name: digest((project / "patches" / name).read_bytes())
            for name in ("obstacle-engine.patch", "obstacle-rules.patch")
        },
        "artifacts_sha256": {path.name: digest(path.read_bytes()) for path in sorted(staging.iterdir())},
    }
    revision_paths = ["patches", "scripts/build-obstacle-sdk.sh", "scripts/package-obstacle-sdk.py"]
    repo = ["git", "-C", str(project)]
    if subprocess.run([*repo, "diff", "--quiet", "HEAD", "--", *revision_paths]).returncode == 0:
        manifest["patch_revision"] = subprocess.check_output([*repo, "rev-parse", "HEAD"], text=True).strip()
    (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    sums = [f"{digest(path.read_bytes())}  {path.name}" for path in sorted(staging.iterdir())]
    (staging / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
    output.mkdir(parents=True, exist_ok=True)
    for path in staging.iterdir():
        shutil.copyfile(path, output / path.name)
    print(f"Assembled verified obstacle SDK in {output}")


if __name__ == "__main__":
    if sys.argv[1] == "extract":
        extract(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    elif sys.argv[1] == "package":
        package(Path(sys.argv[2]), Path(sys.argv[3]), *sys.argv[4:])
    else:
        raise ValueError(f"Unknown command {sys.argv[1]}")
