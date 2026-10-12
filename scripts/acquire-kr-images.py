"""Fetch only Korean event/home banners, with explicit download/output budgets.

Install UnityPy==1.25.4 into .cache/terra-media/python, then run with --apply.
Compressed bundles stay in memory; only extracted PNGs and provenance are saved.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".cache/terra-media/python"))
CDN = "https://ark-kr-static-online-1300509597.yo-star.com/assetbundle/official/Android"
DOWNLOAD_BUDGET = 64 * 1024 * 1024
OUTPUT_BUDGET = 512 * 1024 * 1024
PREFIXES = ("spritepack/ui_home_act_banner_", "arts/ui/stage/[uc]homeentry", "spritepack/ui_zone_home_theme_")


def decompress_arknights(data, expected_size):
    """Normalize Arknights' LZ4 tokens and big-endian match offsets.

    Format reference: MooncellWiki/UnityPy commit 781badde6d636f101279fef76f461bb8dd0e1ffc.
    This adapter is scoped to this downloader; installed UnityPy remains unchanged.
    """
    import lz4.block
    block = bytearray(data)
    cursor = 0
    produced = 0

    def length(base):
        nonlocal cursor
        value = base
        if base == 15:
            while True:
                extra = block[cursor]
                cursor += 1
                value += extra
                if extra != 255:
                    break
        return value

    while cursor < len(block):
        token = block[cursor]
        block[cursor] = ((token & 15) << 4) | (token >> 4)
        cursor += 1
        literals = length(token & 15)
        cursor += literals
        produced += literals
        if cursor >= len(block):
            break
        if cursor + 2 > len(block):
            raise ValueError("Truncated Arknights LZ4 offset")
        block[cursor], block[cursor + 1] = block[cursor + 1], block[cursor]
        cursor += 2
        produced += length(token >> 4) + 4
        if produced > expected_size:
            raise ValueError("Arknights LZ4 output exceeded declared size")
    result = lz4.block.decompress(bytes(block), uncompressed_size=expected_size)
    if len(result) != expected_size:
        raise ValueError("Arknights LZ4 size mismatch")
    return result


def fetch(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "TerraArchive/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError("Response exceeded the storage budget")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    version_bytes = fetch(CDN + "/version", 8192)
    version = json.loads(version_bytes)
    version_id = version["resVersion"]
    listing_bytes = fetch(f"{CDN}/assets/{version_id}/hot_update_list.json", 16 * 1024 * 1024)
    listing = json.loads(listing_bytes)
    selected = [item for item in listing["abInfos"] if item["name"].startswith(PREFIXES)]
    size = sum(item["totalSize"] for item in selected)
    print(json.dumps({"version": version, "packs": len(selected), "downloadBytes": size}), flush=True)
    if not args.apply:
        return
    if size > DOWNLOAD_BUDGET or shutil.disk_usage(ROOT).free < OUTPUT_BUDGET + 2 * 1024**3:
        raise RuntimeError("Insufficient disk space or download budget exceeded")
    import UnityPy
    from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
    DECOMPRESSION_MAP[4] = decompress_arknights
    DECOMPRESSION_MAP[5] = decompress_arknights
    destination = ROOT / "data/raw/arknights-assets2/kr-localized"
    destination.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "data/raw/manifests/kr-localized-images.json"
    previous = json.loads(report_path.read_text("utf-8")) if report_path.exists() else {}
    if previous.get("resourceVersion") == version_id and previous.get("complete"):
        if all((ROOT / image["path"]).is_file() and hashlib.sha256((ROOT / image["path"]).read_bytes()).hexdigest() == image["sha256"] for image in previous["images"]):
            print("Existing version verified; no download needed", flush=True)
            return
    report = {"retrievedAt": datetime.now(timezone.utc).isoformat(), "source": CDN,
              "resourceVersion": version_id, "clientVersion": version["clientVersion"],
              "scope": list(PREFIXES), "downloadBudget": DOWNLOAD_BUDGET, "outputBudget": OUTPUT_BUDGET,
              "unityPyVersion": UnityPy.__version__, "metadataSha256": hashlib.sha256(listing_bytes).hexdigest(),
              "complete": False, "packs": [], "images": [], "outputBytes": 0}
    (destination / "hot_update_list.json").write_bytes(listing_bytes)
    total_output = 0
    seen_content = {}
    for number, pack in enumerate(selected, 1):
        name = pack["name"]
        safe_name = re.sub(r"[^A-Za-z0-9_.#\[\]-]", "_", name.rsplit(".", 1)[0])
        encoded = name.rsplit(".", 1)[0].replace("/", "_").replace("#", "__") + ".dat"
        payload = fetch(f"{CDN}/assets/{version_id}/{encoded}", pack["totalSize"] + 65536)
        chunks = []
        if zipfile.is_zipfile(io.BytesIO(payload)):
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for item in archive.infolist():
                    if item.is_dir():
                        continue
                    if item.file_size > 128 * 1024 * 1024 or ".." in PurePosixPath(item.filename).parts:
                        raise RuntimeError("Unexpected bundle entry")
                    chunks.append(archive.read(item))
        else:
            chunks = [payload]
        md5_valid = any(hashlib.md5(chunk).hexdigest() == pack["md5"] for chunk in [payload, *chunks])
        if not md5_valid:
            raise RuntimeError(f"Bundle MD5 mismatch: {name}")
        pack_record = {"name": name, "md5": pack["md5"], "downloadBytes": len(payload), "md5Verified": True, "images": 0}
        for chunk in chunks:
            environment = UnityPy.load(chunk)
            objects = [obj for obj in environment.objects if obj.type.name in ("Sprite", "Texture2D")]
            # Prefer individual sprites; keep texture sheets only in bundles without sprites.
            if any(obj.type.name == "Sprite" for obj in objects):
                objects = [obj for obj in objects if obj.type.name == "Sprite"]
            for obj in objects:
                data = obj.parse_as_object()
                image = data.image
                if image.width < 32 or image.height < 16:
                    continue
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                png = buffer.getvalue()
                sha = hashlib.sha256(png).hexdigest()
                asset_name = str(data.m_Name)
                file_name = re.sub(r"[^A-Za-z0-9가-힣_.#@+-]", "_", asset_name)[:140] + f"_{obj.path_id}.png"
                target = destination / safe_name / file_name
                if sha not in seen_content:
                    if total_output + len(png) > OUTPUT_BUDGET:
                        raise RuntimeError("Extracted images exceeded output budget")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(png)
                    seen_content[sha] = target
                    total_output += len(png)
                else:
                    target = seen_content[sha]
                report["images"].append({"name": asset_name, "pack": name, "path": target.relative_to(ROOT).as_posix(), "sha256": sha,
                                         "bytes": len(png), "width": image.width, "height": image.height, "type": obj.type.name})
                pack_record["images"] += 1
        report["packs"].append(pack_record)
        report["outputBytes"] = total_output
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
        print(json.dumps({"pack": number, "of": len(selected), "images": len(report["images"]), "outputBytes": total_output}), flush=True)
    report["complete"] = True
    report["downloadBytes"] = sum(pack["downloadBytes"] for pack in report["packs"])
    report["uniqueFiles"] = len(seen_content)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({"complete": True, "images": len(report["images"]), "uniqueFiles": len(seen_content), "bytes": total_output}), flush=True)


if __name__ == "__main__":
    main()
