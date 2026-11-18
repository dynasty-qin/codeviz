"""Overlay loading, validation and image handling.

Two overlay types are supported (CONTRACT.md section 2)::

    {"id","title","type":"layers","layers":[{"title","columns","items":[{"title","desc"}]}]}
    {"id","title","type":"image","image":"assets/foo.png"}

Image paths are relative to the project root.  In ``site`` mode the renderer
copies them into ``<out>/assets`` and rewrites the path; in ``single-file`` mode
they are inlined as data URIs.
"""

from __future__ import annotations

import base64
import copy
import mimetypes
import shutil
from pathlib import Path
from typing import Any, Iterable

from .model import warn

VALID_TYPES = ("layers", "image")

_MIME_FALLBACK = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
}


def load_overlays(config: dict) -> list[dict]:
    """Return validated overlays from ``config["overlays"]``.

    Invalid entries are skipped with a warning instead of aborting the build.
    """

    raw = config.get("overlays")
    if not isinstance(raw, list):
        return []

    overlays: list[dict] = []
    seen: set[str] = set()
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        overlay = _normalize(item, position)
        if overlay is None:
            continue
        base_id = overlay["id"]
        suffix = 2
        while overlay["id"] in seen:
            overlay["id"] = f"{base_id}-{suffix}"
            suffix += 1
        seen.add(overlay["id"])
        overlays.append(overlay)
    return overlays


def _normalize(item: dict, position: int) -> dict | None:
    overlay_id = item.get("id")
    if not isinstance(overlay_id, str) or not overlay_id.strip():
        overlay_id = f"overlay-{position + 1}"
    overlay_id = overlay_id.strip()

    title = item.get("title")
    if not isinstance(title, str) or not title.strip():
        title = overlay_id
    title = title.strip()

    overlay_type = item.get("type")
    if not isinstance(overlay_type, str) or not overlay_type.strip():
        if isinstance(item.get("layers"), list):
            overlay_type = "layers"
        elif isinstance(item.get("image"), str):
            overlay_type = "image"
        else:
            overlay_type = ""
    overlay_type = overlay_type.strip().lower()

    if overlay_type not in VALID_TYPES:
        warn(f"覆盖层 {overlay_id} 的 type={overlay_type!r} 不受支持，已跳过（仅支持 layers / image）")
        return None

    overlay: dict = {"id": overlay_id, "title": title, "type": overlay_type}
    for key in ("subtitle", "desc"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            overlay[key] = value.strip()

    if overlay_type == "layers":
        layers = _normalize_layers(item.get("layers"))
        if not layers:
            warn(f"覆盖层 {overlay_id} 没有有效 layers，已跳过")
            return None
        overlay["layers"] = layers
    else:
        image = item.get("image")
        if not isinstance(image, str) or not image.strip():
            warn(f"覆盖层 {overlay_id} 缺少 image 路径，已跳过")
            return None
        overlay["image"] = image.strip().replace("\\", "/")
    return overlay


def _normalize_layers(raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        return []
    layers: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        columns = item.get("columns")
        if isinstance(columns, bool) or not isinstance(columns, int) or columns < 1:
            columns = 0

        items: list[dict] = []
        raw_items = item.get("items")
        if isinstance(raw_items, list):
            for raw_item in raw_items:
                if not isinstance(raw_item, dict):
                    continue
                item_title = raw_item.get("title")
                if not isinstance(item_title, str) or not item_title.strip():
                    continue
                entry = {"title": item_title.strip()}
                desc = raw_item.get("desc")
                if isinstance(desc, str) and desc.strip():
                    entry["desc"] = desc.strip()
                for key in ("tag", "color"):
                    value = raw_item.get(key)
                    if isinstance(value, str) and value.strip():
                        entry[key] = value.strip()
                items.append(entry)

        layer = {"title": title.strip(), "items": items}
        layer["columns"] = columns if columns else max(1, min(len(items) or 1, 6))
        subtitle = item.get("subtitle")
        if isinstance(subtitle, str) and subtitle.strip():
            layer["subtitle"] = subtitle.strip()
        layers.append(layer)
    return layers


# ---------------------------------------------------------------------------
# site mode: copy images next to the static site
# ---------------------------------------------------------------------------


def copy_overlay_images(
    overlays: list[dict],
    project_path: str | Path,
    out_dir: str | Path,
) -> None:
    """Copy ``type=image`` overlays into ``<out>/assets`` (in place).

    Missing files cause the overlay to be dropped with a warning, so the
    generated site never links to a file that was not copied.
    """

    project = Path(project_path).expanduser().resolve()
    assets = Path(out_dir) / "assets"
    used: dict[str, Path] = {}
    kept: list[dict] = []

    for overlay in overlays:
        if not isinstance(overlay, dict) or overlay.get("type") != "image":
            kept.append(overlay)
            continue

        image = overlay.get("image")
        if not isinstance(image, str) or not image:
            continue
        relative = _clean_relative(image)
        source = (project / relative).resolve()
        if not source.is_file():
            warn(f"覆盖层 {overlay.get('id')} 的图片不存在: {image}（已跳过该覆盖层）")
            continue

        name = source.name
        if name in used and used[name] != source:
            stem = _safe_name(str(overlay.get("id") or "overlay"))
            name = f"{stem}-{name}"
        used[name] = source

        assets.mkdir(parents=True, exist_ok=True)
        destination = assets / name
        try:
            shutil.copyfile(source, destination)
        except OSError as exc:
            warn(f"覆盖层 {overlay.get('id')} 的图片复制失败: {exc}（已跳过该覆盖层）")
            continue

        overlay = dict(overlay)
        overlay["image"] = f"assets/{name}"
        kept.append(overlay)

    overlays[:] = kept


# ---------------------------------------------------------------------------
# single-file mode: inline images as data URIs
# ---------------------------------------------------------------------------


def inline_overlay_images(overlays: Iterable[dict], project_path: str | Path) -> list[dict]:
    """Return a copy of ``overlays`` with ``image`` values as data URIs."""

    project = Path(project_path).expanduser().resolve()
    result: list[dict] = []
    for overlay in overlays:
        if not isinstance(overlay, dict):
            continue
        if overlay.get("type") != "image":
            result.append(copy.deepcopy(overlay))
            continue

        image = overlay.get("image")
        if not isinstance(image, str) or not image:
            continue
        relative = _clean_relative(image)
        # ``assets/foo.png`` may already be a copied path (site then single-file
        # into the same directory); fall back to the bare file name.
        candidates = [project / relative, project / Path(relative).name]
        source = next((candidate for candidate in candidates if candidate.is_file()), None)
        if source is None:
            warn(f"覆盖层 {overlay.get('id')} 的图片不存在: {image}（已跳过该覆盖层）")
            continue

        try:
            payload = base64.b64encode(source.read_bytes()).decode("ascii")
        except OSError as exc:
            warn(f"覆盖层 {overlay.get('id')} 的图片读取失败: {exc}（已跳过该覆盖层）")
            continue

        mime = mimetypes.guess_type(source.name)[0] or _MIME_FALLBACK.get(source.suffix.lower())
        if not mime:
            mime = "application/octet-stream"

        clone = copy.deepcopy(overlay)
        clone["image"] = f"data:{mime};base64,{payload}"
        result.append(clone)
    return result


def _clean_relative(path: str) -> str:
    text = path.replace("\\", "/").strip()
    while text.startswith("./"):
        text = text[2:]
    return text.lstrip("/")


def _safe_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "-_" else "-" for char in value)
    return cleaned.strip("-") or "overlay"
