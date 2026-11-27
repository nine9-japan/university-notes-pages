#!/usr/bin/env python3
"""Send Discord webhook notifications when new notes are added to notes.json."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

DEFAULT_SITE_BASE_URL = "https://nine9-japan.github.io/university-notes-pages"
ALLOWED_WEBHOOK_HOSTS = {
    "discord.com",
    "discordapp.com",
    "ptb.discord.com",
    "canary.discord.com",
}
WEBHOOK_PATH_RE = re.compile(r"^/api(?:/v\d+)?/webhooks/\d+/[A-Za-z0-9_-]+$")
EMBED_COLOR = 0x4285C5
USER_AGENT = "DiscordBot (https://nine9-japan.github.io/university-notes-pages, 1.0)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse HTTP redirects so webhook credentials cannot be redirected."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        raise RuntimeError("Redirect refused for Discord webhook.")


def validate_webhook_url(raw: str) -> str:
    """Validate and normalize a Discord webhook URL without leaking it on error."""
    stripped = raw.strip()
    try:
        parsed = urllib.parse.urlsplit(stripped)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Invalid Discord webhook URL format.") from exc

    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_WEBHOOK_HOSTS
        or port is not None
        or parsed.username is not None
        or parsed.password is not None
        or not WEBHOOK_PATH_RE.match(parsed.path)
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid Discord webhook URL format.")

    return f"https://{parsed.hostname}{parsed.path}?wait=true"


def note_id(note: dict[str, Any]) -> str:
    """Return the canonical note identifier used by the Pages catalog."""
    return str(note.get("id") or note.get("driveFileId") or "").strip()


def build_payload(note: dict[str, Any], site_base_url: str = DEFAULT_SITE_BASE_URL) -> dict[str, Any]:
    """Build a Discord webhook embed payload matching the original Sites format."""
    nid = note_id(note)
    title = (str(note.get("title") or "").strip() or "無題")[:256]
    subject = (str(note.get("subject") or "").strip() or "未分類")[:1024]
    session = str(note.get("classSession") or "").strip()
    class_date = str(note.get("classDate") or "").strip()
    session_date = (" · ".join(part for part in (session, class_date) if part) or "未設定")[:1024]
    base = site_base_url.rstrip("/")
    url = f"{base}/notes/{urllib.parse.quote(nid, safe='')}"
    return {
        "username": "大学ノート庫",
        "allowed_mentions": {"parse": []},
        "flags": 4096,
        "embeds": [
            {
                "title": title,
                "url": url,
                "description": "新しい講義ノートを公開しました。",
                "color": EMBED_COLOR,
                "fields": [
                    {"name": "科目", "value": subject},
                    {"name": "授業回・日付", "value": session_date},
                ],
                "footer": {"text": "大学ノート庫"},
            }
        ],
    }


def find_new_notes(prev_notes: list[Any], curr_notes: list[Any]) -> list[dict[str, Any]]:
    """Return newly added notes oldest-first (since notes.json prepends newest entries)."""
    prev_ids = {
        note_id(item)
        for item in prev_notes
        if isinstance(item, dict) and note_id(item)
    }
    seen: set[str] = set()
    added: list[dict[str, Any]] = []
    for item in curr_notes:
        if not isinstance(item, dict):
            continue
        nid = note_id(item)
        if not nid or nid in prev_ids or nid in seen:
            continue
        seen.add(nid)
        added.append(item)
    return list(reversed(added))


def load_notes_file(path: str) -> list[dict[str, Any]]:
    """Load and validate a JSON array of note objects from disk."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array in {path}.")
    return data


def load_notes_from_git(
    ref: str,
    notes_path: str = "notes.json",
    cwd: str | None = None,
) -> list[dict[str, Any]] | None:
    """Load notes.json from a previous git revision, or None if unavailable."""
    if not ref or set(ref) == {"0"}:
        return None
    git_path = notes_path.lstrip("./") if not os.path.isabs(notes_path) else notes_path
    proc = subprocess.run(
        ["git", "show", f"{ref}:{git_path}"],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        return None
    data = json.loads(proc.stdout)
    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array at {ref}:{git_path}.")
    return data


def _parse_retry_after(headers: Any, body: str, fallback: float) -> float:
    """Extract Discord retry-after duration clamped to [1.0, 30.0] seconds."""
    delay: float | None = None
    if headers is not None:
        raw_header = headers.get("Retry-After") or headers.get("retry-after")
        if raw_header is not None:
            try:
                delay = float(raw_header)
            except (TypeError, ValueError):
                delay = None
    if delay is None and body:
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = None
        if isinstance(parsed, dict) and parsed.get("retry_after") is not None:
            try:
                delay = float(parsed["retry_after"])
            except (TypeError, ValueError):
                delay = None
    if delay is None:
        delay = fallback
    return max(1.0, min(30.0, delay))


def send_webhook(
    webhook_url: str,
    payload: dict[str, Any],
    *,
    max_attempts: int = 3,
    timeout: float = 15.0,
    opener: urllib.request.OpenerDirector | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> int:
    """POST JSON payload to Discord webhook with bounded retries and no URL leakage."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    active_opener = opener if opener is not None else urllib.request.build_opener(NoRedirect())

    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(
            webhook_url,
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        try:
            with active_opener.open(request, timeout=timeout) as response:
                response.read()
                return int(getattr(response, "status", 200))
        except urllib.error.HTTPError as err:
            err_body = ""
            try:
                if err.fp is not None:
                    err_body = err.fp.read().decode("utf-8", "replace")
            except OSError:
                err_body = ""

            if err.code == 429:
                if attempt < max_attempts:
                    delay = _parse_retry_after(err.headers, err_body, float(2 ** (attempt - 1)))
                    sleep_fn(delay)
                    continue
                raise RuntimeError(
                    f"Discord webhook rate limited (HTTP 429) after {max_attempts} attempts."
                ) from None
            if err.code >= 500:
                if attempt < max_attempts:
                    sleep_fn(float(2 ** (attempt - 1)))
                    continue
                raise RuntimeError(
                    f"Discord webhook failed with HTTP {err.code} after {max_attempts} attempts."
                ) from None
            raise RuntimeError(f"Discord webhook failed with HTTP {err.code}.") from None
        except RuntimeError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            reason = getattr(err, "reason", None)
            if isinstance(reason, RuntimeError):
                raise reason from None
            if attempt < max_attempts:
                sleep_fn(float(2 ** (attempt - 1)))
                continue
            raise RuntimeError(
                f"Discord webhook request failed after {max_attempts} attempts ({type(err).__name__})."
            ) from None

    raise RuntimeError("Discord webhook failed unexpectedly.")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments with GitHub Actions environment variable defaults."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--event",
        default=os.environ.get("GITHUB_EVENT_NAME", "push"),
        help="Trigger event name (push or workflow_dispatch).",
    )
    parser.add_argument(
        "--before",
        default=os.environ.get("BEFORE_SHA", ""),
        help="Base commit SHA before push.",
    )
    parser.add_argument(
        "--notes-file",
        default="notes.json",
        help="Path to current notes.json.",
    )
    parser.add_argument(
        "--note-id",
        default=os.environ.get("INPUT_NOTE_ID", ""),
        help="Specific note id (or driveFileId) for workflow_dispatch.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.environ.get("INPUT_DRY_RUN", "").strip().lower() == "true",
        help="Print notification payloads without sending to Discord.",
    )
    parser.add_argument(
        "--site-base-url",
        default=os.environ.get("SITE_BASE_URL", DEFAULT_SITE_BASE_URL),
        help="Base URL of the GitHub Pages site.",
    )
    return parser.parse_args(argv)


def _select_dispatch_targets(curr_notes: list[dict[str, Any]], target_id: str) -> list[dict[str, Any]]:
    if not curr_notes:
        raise ValueError("notes.json is empty; no note available to notify.")
    if target_id:
        for item in curr_notes:
            if not isinstance(item, dict):
                continue
            if note_id(item) == target_id or str(item.get("driveFileId") or "").strip() == target_id:
                return [item]
        raise ValueError(f"Note ID not found in notes.json: {target_id}")
    return [curr_notes[0]]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    target_id = args.note_id.strip()

    try:
        curr_notes = load_notes_file(args.notes_file)
        if args.event == "workflow_dispatch":
            targets = _select_dispatch_targets(curr_notes, target_id)
        else:
            if not args.before or set(args.before) == {"0"}:
                print("No previous commit SHA; skipping bulk Discord notification.")
                return 0
            prev_notes = load_notes_from_git(args.before, args.notes_file)
            if prev_notes is None:
                print("notes.json did not exist at base commit; skipping bulk Discord notification.")
                return 0
            targets = find_new_notes(prev_notes, curr_notes)
            if not targets:
                print("No newly added notes detected in notes.json.")
                return 0

        payloads = [build_payload(note, args.site_base_url) for note in targets]
        if args.dry_run:
            for payload in payloads:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        raw_webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
        if not raw_webhook:
            print(
                "::error::DISCORD_WEBHOOK_URL secret is not configured. "
                "Add it in repository Settings -> Secrets and variables -> Actions.",
                file=sys.stderr,
            )
            return 1

        webhook_url = validate_webhook_url(raw_webhook)
        for idx, (note, payload) in enumerate(zip(targets, payloads)):
            send_webhook(webhook_url, payload)
            print(
                f"Sent Discord notification for {note_id(note)}: "
                f"{note.get('subject', '')} / {note.get('title', '')}"
            )
            if idx + 1 < len(targets):
                time.sleep(1.0)
        return 0
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
