#!/usr/bin/env python3
"""Add or replace one daily issue and refresh issues/index.json (newest first).

Usage:
    python3 scripts/add_issue.py path/to/2026-10-09.json
    python3 scripts/add_issue.py path/to/issue.json --issues-dir issues

A remote cover.url is downloaded into covers/YYYY-MM-DD.jpg and rewritten to
that site-relative path. Wikimedia Commons file URLs are resolved through the
Commons API (1920px thumb) so a wrong hash path still works when the filename
is right. The script exits non-zero if the download is not a valid image.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "telecom-daily/1.0 (https://github.com/ZhangHan066/telecom-daily; cover mirror)"
COVER_MAX_BYTES = 600 * 1024
COVER_MIN_WIDTH = 1600
COVER_MAX_WIDTH = 1920
COVER_DOWNLOAD_MAX_BYTES = 40 * 1024 * 1024
COMMONS_API = "https://commons.wikimedia.org/w/api.php"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def valid_iso_date(value: object) -> bool:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def require_str(obj: dict, key: str, path: str, errors: list[str]) -> None:
    if key not in obj:
        errors.append(f"{path}.{key} is required")
        return
    if not isinstance(obj[key], str) or not obj[key].strip():
        errors.append(f"{path}.{key} must be a non-empty string")


def check_url(value: object, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path} must be a non-empty string")
        return
    if not value.startswith(("http://", "https://")):
        errors.append(f"{path} must start with http:// or https://")


def local_cover_url(issue_date: object) -> str | None:
    if not isinstance(issue_date, str):
        return None
    return f"covers/{issue_date}.jpg"


def check_cover_url(value: object, issue_date: object, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append("cover.url must be a non-empty string")
        return
    url = value.strip()
    if url.startswith(("http://", "https://")):
        return
    expected = local_cover_url(issue_date)
    if expected and url == expected:
        return
    errors.append(
        "cover.url must be an http(s) image URL or covers/YYYY-MM-DD.jpg matching the issue date"
    )


def check_links(links: object, path: str, errors: list[str]) -> None:
    if not isinstance(links, list):
        errors.append(f"{path} must be an array")
        return
    for i, link in enumerate(links):
        where = f"{path}[{i}]"
        if not isinstance(link, dict):
            errors.append(f"{where} must be an object")
            continue
        require_str(link, "label", where, errors)
        check_url(link.get("url"), f"{where}.url", errors)


def optional_str(obj: dict, key: str, path: str, errors: list[str]) -> None:
    if key in obj and not isinstance(obj[key], str):
        errors.append(f"{path}.{key} must be a string")


def check_item(item: object, path: str, errors: list[str], *, paper: bool) -> None:
    if not isinstance(item, dict):
        errors.append(f"{path} must be an object")
        return
    require_str(item, "title", path, errors)
    # Item date is a display label ("10/5", "至 10/10"). Do not parse it.
    if "date" not in item:
        errors.append(f"{path}.date is required (free-text label, not a parsed date)")
    elif not isinstance(item["date"], str) or not item["date"].strip():
        errors.append(f"{path}.date must be a non-empty string label")
    require_str(item, "summary", path, errors)
    # Optional long text. Paragraphs are separated by a blank line; do not parse it.
    if "detail" in item and not isinstance(item["detail"], str):
        errors.append(f"{path}.detail must be a string")
    for key in ("summary_en", "detail_en"):
        optional_str(item, key, path, errors)
    if paper:
        for key in ("title_en", "authors"):
            optional_str(item, key, path, errors)
    else:
        optional_str(item, "title_en", path, errors)
    if "links" in item:
        check_links(item["links"], f"{path}.links", errors)


def validate(issue: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(issue, dict):
        return ["issue JSON must be an object"]

    if "date" not in issue:
        errors.append("date is required")
    elif not valid_iso_date(issue["date"]):
        errors.append("date must be a real calendar date in YYYY-MM-DD form")

    for key in ("weekday", "title", "theme"):
        require_str(issue, key, "issue", errors)
    for key in ("weekday_en", "theme_en"):
        optional_str(issue, key, "issue", errors)

    cover = issue.get("cover")
    if not isinstance(cover, dict):
        errors.append("cover must be an object with url")
    else:
        check_cover_url(cover.get("url"), issue.get("date"), errors)
        for key in ("credit", "source"):
            if key in cover and not isinstance(cover[key], str):
                errors.append(f"cover.{key} must be a string")
        if isinstance(cover.get("source"), str) and cover["source"].strip():
            check_url(cover["source"], "cover.source", errors)

    highlights = issue.get("highlights")
    if not isinstance(highlights, list):
        errors.append("highlights must be an array")
    else:
        for i, item in enumerate(highlights):
            where = f"highlights[{i}]"
            if not isinstance(item, dict):
                errors.append(f"{where} must be an object")
                continue
            require_str(item, "label", where, errors)
            require_str(item, "text", where, errors)

    research = issue.get("research")
    if not isinstance(research, list):
        errors.append("research must be an array")
    else:
        for i, item in enumerate(research):
            check_item(item, f"research[{i}]", errors, paper=True)

    industry = issue.get("industry")
    if not isinstance(industry, list):
        errors.append("industry must be an array")
    else:
        for i, group in enumerate(industry):
            where = f"industry[{i}]"
            if not isinstance(group, dict):
                errors.append(f"{where} must be an object")
                continue
            require_str(group, "section", where, errors)
            optional_str(group, "section_en", where, errors)
            if "emoji" in group and not isinstance(group["emoji"], str):
                errors.append(f"{where}.emoji must be a string")
            items = group.get("items")
            if not isinstance(items, list):
                errors.append(f"{where}.items must be an array")
            else:
                for j, item in enumerate(items):
                    check_item(item, f"{where}.items[{j}]", errors, paper=False)

    if "notion_url" in issue and issue["notion_url"] not in (None, ""):
        check_url(issue["notion_url"], "notion_url", errors)

    return errors


def index_entry(issue: dict) -> dict:
    entry = {
        "date": issue["date"],
        "weekday": issue["weekday"],
        "title": issue["title"],
        "theme": issue["theme"],
        "cover": issue["cover"]["url"],
        "highlights": issue["highlights"],
    }
    for key in ("weekday_en", "theme_en"):
        value = issue.get(key)
        if isinstance(value, str) and value.strip():
            entry[key] = value
    return entry


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        fail(f"file not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"{path} is not valid JSON: {exc}")
    raise AssertionError("unreachable")


def write_json(path: Path, data: object) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def load_index(path: Path) -> dict:
    if not path.exists():
        return {"issues": []}
    data = read_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("issues"), list):
        fail("issues/index.json must be an object with an issues array")
    for i, entry in enumerate(data["issues"]):
        if not isinstance(entry, dict) or not isinstance(entry.get("date"), str):
            fail(f"issues/index.json issues[{i}] must be an object with a date string")
    return data


class DownloadError(Exception):
    pass


def http_request(url: str, *, accept: str) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > COVER_DOWNLOAD_MAX_BYTES:
                    raise DownloadError(
                        f"response exceeds {COVER_DOWNLOAD_MAX_BYTES} bytes: {url}"
                    )
                chunks.append(chunk)
            content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            return b"".join(chunks), content_type
    except urllib.error.HTTPError as exc:
        raise DownloadError(f"HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise DownloadError(f"{exc.reason} for {url}") from exc


def commons_file_title(url: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    host = parsed.netloc.lower()
    if not host.endswith("wikimedia.org"):
        return None
    query = urllib.parse.parse_qs(parsed.query)
    for candidate in query.get("title", []):
        if candidate.lower().startswith("file:"):
            name = urllib.parse.unquote(candidate)
            return "File:" + name.split(":", 1)[1].replace("_", " ").strip()
    path = urllib.parse.unquote(parsed.path)
    file_page = re.search(r"/wiki/(?:File:|Special:FilePath/)(.+)$", path, re.IGNORECASE)
    if file_page and host.endswith("commons.wikimedia.org"):
        return "File:" + file_page.group(1).replace("_", " ").strip()
    marker = "/wikipedia/commons/"
    index = path.lower().find(marker)
    if index < 0:
        return None
    parts = [part for part in path[index + len(marker):].split("/") if part]
    if parts and parts[0].lower() == "thumb":
        parts = parts[1:]
    if (
        len(parts) >= 3
        and re.fullmatch(r"[0-9a-fA-F]", parts[0])
        and re.fullmatch(r"[0-9a-fA-F]{2}", parts[1])
    ):
        return "File:" + parts[2].replace("_", " ").strip()
    return None


def resolve_commons_thumb(title: str) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|mime",
            "iiurlwidth": "1920",
            "format": "json",
        }
    )
    body, content_type = http_request(f"{COMMONS_API}?{query}", accept="application/json")
    if content_type and "json" not in content_type:
        raise DownloadError(f"Commons API returned {content_type or 'an unknown type'} for {title}")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DownloadError(f"Commons API returned invalid JSON for {title}") from exc
    if payload.get("error"):
        info = payload["error"].get("info") if isinstance(payload["error"], dict) else None
        raise DownloadError(info or f"Commons API error for {title}")
    pages = payload.get("query", {}).get("pages", {})
    if not isinstance(pages, dict) or not pages:
        raise DownloadError(f"Commons API returned no page for {title}")
    for page in pages.values():
        if not isinstance(page, dict):
            continue
        if "missing" in page or int(page.get("pageid") or 0) < 0:
            raise DownloadError(f"Commons has no file {title}")
        info = (page.get("imageinfo") or [None])[0]
        if not isinstance(info, dict):
            raise DownloadError(f"Commons returned no image info for {title}")
        thumb = info.get("thumburl") or info.get("url")
        if not isinstance(thumb, str) or not thumb.startswith(("http://", "https://")):
            raise DownloadError(f"Commons returned no image URL for {title}")
        return thumb
    raise DownloadError(f"Commons API returned no page for {title}")


def http_get_image(url: str) -> bytes:
    data, content_type = http_request(url, accept="image/jpeg,image/*;q=0.8")
    if not data:
        raise DownloadError(f"empty response for {url}")
    if content_type and not content_type.startswith("image/") and content_type != "application/octet-stream":
        raise DownloadError(f"not an image ({content_type}) for {url}")
    sniff = data.lstrip()[:15].lower()
    if sniff.startswith(b"<!doctype") or sniff.startswith(b"<html") or sniff.startswith(b"<?xml"):
        raise DownloadError(f"not an image (HTML) for {url}")
    return data


def fetch_remote_cover(cover: dict) -> bytes:
    url = str(cover.get("url") or "").strip()
    source = cover.get("source")
    title = commons_file_title(url)
    if title is None and isinstance(source, str):
        title = commons_file_title(source)
    if title:
        try:
            resolved = resolve_commons_thumb(title)
        except DownloadError as exc:
            fail(f"cover: {exc}")
        try:
            return http_get_image(resolved)
        except DownloadError as exc:
            if resolved.split("?", 1)[0] == url.split("?", 1)[0]:
                fail(f"cover download failed: {exc}")
            try:
                return http_get_image(url)
            except DownloadError as direct_exc:
                fail(f"cover download failed: {exc}; {direct_exc}")
    try:
        return http_get_image(url)
    except DownloadError as exc:
        fail(f"cover download failed: {exc}")
    raise AssertionError("unreachable")


def flatten_rgb(image):
    from PIL import Image

    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def assert_jpeg(data: bytes, label: str) -> tuple[int, int]:
    from PIL import Image, UnidentifiedImageError

    if not data.startswith(b"\xff\xd8\xff"):
        fail(f"{label} is not a JPEG image")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            width, height = image.size
            if image.format != "JPEG":
                fail(f"{label} is not a JPEG image")
    except UnidentifiedImageError as exc:
        fail(f"{label} is not a valid image: {exc}")
    if width < COVER_MIN_WIDTH:
        fail(f"{label} is {width}px wide; need at least {COVER_MIN_WIDTH}px")
    if len(data) >= COVER_MAX_BYTES:
        fail(f"{label} is {len(data)} bytes; need under {COVER_MAX_BYTES} bytes")
    return width, height


def render_cover_jpeg(data: bytes, label: str) -> bytes:
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError:
        fail("Pillow is required to store cover images. Install it with: pip install pillow")

    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            width, height = image.size
            orientation = image.getexif().get(274) if image.getexif() else None
            if width < COVER_MIN_WIDTH:
                fail(f"{label} is {width}px wide; need at least {COVER_MIN_WIDTH}px")
            # Keep a qualifying JPEG unchanged so a later run does not recompress it.
            if (
                image.format == "JPEG"
                and image.mode == "RGB"
                and orientation in (None, 1)
                and COVER_MIN_WIDTH <= width <= COVER_MAX_WIDTH
                and len(data) < COVER_MAX_BYTES
                and data.startswith(b"\xff\xd8\xff")
            ):
                return data
            image = ImageOps.exif_transpose(image)
            rgb = flatten_rgb(image)
            if rgb.width > COVER_MAX_WIDTH:
                resized_height = max(1, round(rgb.height * COVER_MAX_WIDTH / rgb.width))
                rgb = rgb.resize((COVER_MAX_WIDTH, resized_height), Image.Resampling.LANCZOS)
    except SystemExit:
        raise
    except UnidentifiedImageError as exc:
        fail(f"{label} is not a valid image: {exc}")
    except Exception as exc:
        fail(f"{label} is not a valid image: {exc}")

    if rgb.width < COVER_MIN_WIDTH:
        fail(f"{label} is {rgb.width}px wide; need at least {COVER_MIN_WIDTH}px")

    last_size = 0
    for quality in range(90, 44, -5):
        buffer = io.BytesIO()
        rgb.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
        blob = buffer.getvalue()
        last_size = len(blob)
        if last_size < COVER_MAX_BYTES:
            assert_jpeg(blob, label)
            return blob
    fail(f"{label} could not be compressed under 600KB (last {last_size} bytes)")
    raise AssertionError("unreachable")


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def materialize_cover(issue: dict, issues_dir: Path) -> str:
    issue_date = issue["date"]
    expected = local_cover_url(issue_date)
    assert expected is not None
    cover = issue["cover"]
    url = cover["url"].strip()
    dest = issues_dir.parent / "covers" / f"{issue_date}.jpg"
    if url == expected:
        if not dest.is_file():
            fail(f"cover.url is {expected} but file is missing: {dest}")
        jpeg = render_cover_jpeg(dest.read_bytes(), expected)
    else:
        jpeg = render_cover_jpeg(fetch_remote_cover(cover), url)
    width, height = assert_jpeg(jpeg, expected)
    write_bytes(dest, jpeg)
    cover["url"] = expected
    return f"{expected} ({width}x{height}, {len(jpeg)} bytes)"


def add_issue(source: Path, issues_dir: Path) -> str:
    issue = read_json(source)
    errors = validate(issue)
    if errors:
        fail("invalid issue:\n- " + "\n- ".join(errors))
    assert isinstance(issue, dict)

    cover_note = materialize_cover(issue, issues_dir)
    issues_dir.mkdir(parents=True, exist_ok=True)
    dest = issues_dir / f"{issue['date']}.json"
    index_path = issues_dir / "index.json"
    index = load_index(index_path)
    replaced = any(entry["date"] == issue["date"] for entry in index["issues"])
    index["issues"] = [entry for entry in index["issues"] if entry["date"] != issue["date"]]
    index["issues"].append(index_entry(issue))
    index["issues"].sort(key=lambda entry: entry["date"], reverse=True)

    write_json(dest, issue)
    write_json(index_path, index)
    verb = "updated" if replaced else "added"
    newest = index["issues"][0]["date"]
    return (
        f"{verb} {issue['date']} -> {dest} "
        f"(cover: {cover_note}; index: {len(index['issues'])} issues, newest {newest})"
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("issue_json", type=Path, help="Path to the new issue JSON")
    parser.add_argument(
        "--issues-dir",
        type=Path,
        default=ROOT / "issues",
        help="Directory that contains index.json (default: <repo>/issues)",
    )
    args = parser.parse_args(argv)
    message = add_issue(args.issue_json, args.issues_dir.resolve())
    print(message)


if __name__ == "__main__":
    main()
