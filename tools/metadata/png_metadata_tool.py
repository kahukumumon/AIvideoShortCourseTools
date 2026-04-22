from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TEXT_CHUNK_TYPES = {b"tEXt", b"zTXt", b"iTXt"}
TARGET_VERSION = "Version: f2.0.1v1.10.1-previous-669-gdfdcbab6"
RAW_NEEDLES = [
    b"parameters",
    b"Negative prompt",
    b"Steps:",
    b"Sampler:",
    b"CFG scale",
    b"Seed:",
    b"Model:",
    b"Model hash",
    b"Version:",
    b"UserComment",
    b"Exif",
    b"XML",
    b"xmp",
    b"prompt",
]


def read_u32be(data: bytes, offset: int) -> int:
    return struct.unpack(">I", data[offset : offset + 4])[0]


def write_u32be(value: int) -> bytes:
    return struct.pack(">I", value)


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def make_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    return write_u32be(len(payload)) + chunk_type + payload + write_u32be(crc32(chunk_type + payload))


def decode_latin1(data: bytes) -> str:
    return data.decode("latin-1", "replace")


def decode_utf8(data: bytes) -> str:
    return data.decode("utf-8", "replace")


def parse_png_chunks(data: bytes) -> tuple[list[dict], int]:
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")

    chunks = []
    offset = len(PNG_SIGNATURE)
    while offset + 12 <= len(data):
        length = read_u32be(data, offset)
        chunk_type = data[offset + 4 : offset + 8]
        payload_start = offset + 8
        payload_end = payload_start + length
        end = offset + 12 + length
        if end > len(data):
            raise ValueError(f"broken chunk at offset={offset}, type={chunk_type!r}, length={length}")

        stored_crc = read_u32be(data, payload_end)
        calculated_crc = crc32(chunk_type + data[payload_start:payload_end])
        ancillary = bool(chunk_type[0] & 32)
        chunks.append(
            {
                "type": decode_latin1(chunk_type),
                "type_bytes": chunk_type,
                "offset": offset,
                "payload_offset": payload_start,
                "payload_end": payload_end,
                "end": end,
                "length": length,
                "ancillary": ancillary,
                "critical": not ancillary,
                "crc_ok": stored_crc == calculated_crc,
                "payload": data[payload_start:payload_end],
            }
        )
        offset = end
        if chunk_type == b"IEND":
            break

    if not any(chunk["type_bytes"] == b"IEND" for chunk in chunks):
        raise ValueError("IEND chunk not found")

    return chunks, len(data) - offset


def parse_text_chunk(chunk: dict) -> dict | None:
    chunk_type = chunk["type_bytes"]
    payload = chunk["payload"]
    try:
        if chunk_type == b"tEXt":
            key, value = payload.split(b"\x00", 1)
            return {"key": decode_latin1(key), "value": decode_latin1(value), "compressed": False}

        if chunk_type == b"zTXt":
            key, rest = payload.split(b"\x00", 1)
            method = rest[0]
            if method != 0:
                return {"key": decode_latin1(key), "value": f"[unsupported zTXt method {method}]", "compressed": True}
            return {"key": decode_latin1(key), "value": decode_latin1(zlib.decompress(rest[1:])), "compressed": True}

        if chunk_type == b"iTXt":
            key_end = payload.index(0)
            key = decode_latin1(payload[:key_end])
            compression_flag = payload[key_end + 1]
            compression_method = payload[key_end + 2]
            language_end = payload.index(0, key_end + 3)
            translated_key_end = payload.index(0, language_end + 1)
            text = payload[translated_key_end + 1 :]
            if compression_flag == 1:
                if compression_method != 0:
                    return {
                        "key": key,
                        "value": f"[unsupported iTXt method {compression_method}]",
                        "compressed": True,
                    }
                text = zlib.decompress(text)
            return {"key": key, "value": decode_utf8(text), "compressed": compression_flag == 1}
    except Exception as exc:
        return {"key": None, "value": f"[parse error: {exc}]", "compressed": False}

    return None


def find_raw_hits(data: bytes, chunks: list[dict]) -> list[dict]:
    hits = []
    for needle in RAW_NEEDLES:
        start = 0
        while True:
            offset = data.find(needle, start)
            if offset < 0:
                break
            owner = next((chunk for chunk in chunks if chunk["offset"] <= offset < chunk["end"]), None)
            snippet_start = max(0, offset - 80)
            snippet_end = min(len(data), offset + 240)
            hits.append(
                {
                    "needle": decode_latin1(needle),
                    "offset": offset,
                    "owner": owner["type"] if owner else "outside_png_chunks",
                    "snippet": decode_latin1(data[snippet_start:snippet_end]).replace("\x00", "\\0"),
                }
            )
            start = offset + len(needle)
    return hits


def inspect_png(path: pathlib.Path) -> dict:
    data = path.read_bytes()
    chunks, bytes_after_iend = parse_png_chunks(data)
    text_entries = []
    for chunk in chunks:
        parsed_text = parse_text_chunk(chunk)
        if parsed_text:
            value = parsed_text["value"] or ""
            text_entries.append(
                {
                    "chunk_type": chunk["type"],
                    "chunk_offset": chunk["offset"],
                    "chunk_end": chunk["end"],
                    "chunk_length": chunk["length"],
                    "key": parsed_text["key"],
                    "compressed": parsed_text["compressed"],
                    "contains_target_version": TARGET_VERSION in value,
                    "value": value,
                }
            )

    deletions = [
        {
            "type": chunk["type"],
            "offset": chunk["offset"],
            "end": chunk["end"],
            "length_on_disk": chunk["end"] - chunk["offset"],
            "reason": "ancillary PNG chunk; removable metadata/non-pixel data",
        }
        for chunk in chunks
        if chunk["ancillary"]
    ]

    return {
        "file": str(path),
        "size": len(data),
        "bytes_after_iend": bytes_after_iend,
        "chunks": [
            {
                "type": chunk["type"],
                "offset": chunk["offset"],
                "end": chunk["end"],
                "length": chunk["length"],
                "critical": chunk["critical"],
                "ancillary": chunk["ancillary"],
                "crc_ok": chunk["crc_ok"],
            }
            for chunk in chunks
        ],
        "text_metadata": text_entries,
        "raw_hits": find_raw_hits(data, chunks),
        "delete_ranges": deletions,
        "contains_target_version": any(entry["contains_target_version"] for entry in text_entries),
    }


def strip_png_metadata(input_path: pathlib.Path, output_path: pathlib.Path) -> None:
    data = input_path.read_bytes()
    chunks, _ = parse_png_chunks(data)
    kept = [PNG_SIGNATURE]
    for chunk in chunks:
        if chunk["critical"]:
            kept.append(make_chunk(chunk["type_bytes"], chunk["payload"]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"".join(kept))


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect and strip PNG metadata chunks.")
    parser.add_argument("paths", nargs="+", type=pathlib.Path)
    parser.add_argument("--strip-dir", type=pathlib.Path, help="Write stripped PNG files to this directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of human-readable text.")
    args = parser.parse_args()

    reports = []
    for path in args.paths:
        report = inspect_png(path)
        reports.append(report)
        if args.strip_dir:
            output_path = args.strip_dir / f"{path.stem}-stripped.png"
            strip_png_metadata(path, output_path)
            report["stripped_output"] = str(output_path)

    if args.json:
        json.dump(reports, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0

    for report in reports:
        print("=" * 100)
        print(f"FILE {report['file']} size={report['size']} target_version={report['contains_target_version']}")
        print(f"BYTES_AFTER_IEND {report['bytes_after_iend']}")
        print("CHUNKS")
        for chunk in report["chunks"]:
            print(
                f"  {chunk['type']:<4} offset={chunk['offset']:<8} end={chunk['end']:<8} "
                f"len={chunk['length']:<8} critical={chunk['critical']} crc_ok={chunk['crc_ok']}"
            )
        print("TEXT_METADATA")
        if not report["text_metadata"]:
            print("  none")
        for entry in report["text_metadata"]:
            print(
                f"  {entry['chunk_type']} offset={entry['chunk_offset']} end={entry['chunk_end']} "
                f"key={entry['key']!r} target_version={entry['contains_target_version']}"
            )
            print(entry["value"])
        print("DELETE_RANGES")
        if not report["delete_ranges"]:
            print("  none")
        for item in report["delete_ranges"]:
            print(f"  {item['type']} offset={item['offset']} end={item['end']} bytes={item['length_on_disk']}")
        print("RAW_HITS")
        if not report["raw_hits"]:
            print("  none")
        for hit in report["raw_hits"]:
            print(f"  {hit['needle']} offset={hit['offset']} owner={hit['owner']}")
        if "stripped_output" in report:
            print(f"STRIPPED_OUTPUT {report['stripped_output']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
