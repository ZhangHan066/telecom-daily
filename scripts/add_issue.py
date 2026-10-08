#!/usr/bin/env python3
"""Add or replace one daily issue and refresh issues/index.json (newest first).

Usage:
    python3 scripts/add_issue.py path/to/2026-10-09.json
    python3 scripts/add_issue.py path/to/issue.json --issues-dir issues
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ROOT = Path(__file__).resolve().parents[1]


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
    if paper:
        for key in ("title_en", "authors"):
            if key in item and not isinstance(item[key], str):
                errors.append(f"{path}.{key} must be a string")
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

    cover = issue.get("cover")
    if not isinstance(cover, dict):
        errors.append("cover must be an object with url")
    else:
        check_url(cover.get("url"), "cover.url", errors)
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
    return {
        "date": issue["date"],
        "weekday": issue["weekday"],
        "title": issue["title"],
        "theme": issue["theme"],
        "cover": issue["cover"]["url"],
        "highlights": issue["highlights"],
    }


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


def add_issue(source: Path, issues_dir: Path) -> str:
    issue = read_json(source)
    errors = validate(issue)
    if errors:
        fail("invalid issue:\n- " + "\n- ".join(errors))
    assert isinstance(issue, dict)

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
    return f"{verb} {issue['date']} -> {dest} (index: {len(index['issues'])} issues, newest {newest})"


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
