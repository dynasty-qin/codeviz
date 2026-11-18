"""通用校验 / 文本工具。

这一层只做参数归一化，不碰任何存储，方便 router 与 service 复用。
"""

from __future__ import annotations


class ValidationError(ValueError):
    """入参不合法。"""


def normalize_title(raw: str | None) -> str:
    """标题去空白，空标题直接失败。"""
    text = (raw or "").strip()
    if not text:
        raise ValidationError("标题不能为空")
    if len(text) > 80:
        raise ValidationError("标题过长")
    return text


def parse_minutes(raw: str | int | None) -> int:
    """把前端传的工时统一成整数分钟。"""
    try:
        value = int(raw or 0)
    except (TypeError, ValueError) as exc:
        raise ValidationError("工时必须是整数") from exc
    if value < 0:
        raise ValidationError("工时不能为负数")
    if value > 24 * 60:
        raise ValidationError("单条工时不能超过 24 小时")
    return value


def truncate(text: str, limit: int = 16) -> str:
    """超长文本截断，保留可读前缀。"""
    clean = (text or "").strip()
    if len(clean) <= limit:
        return clean
    return clean[:limit] + "..."


def summarize_titles(titles: list[str], limit: int = 3) -> str:
    """把若干标题拼成一行摘要，最多取 `limit` 条。"""
    picked: list[str] = []
    for title in titles:
        if not title:
            continue
        picked.append(truncate(title))
        if len(picked) >= limit:
            break
    return " / ".join(picked) if picked else "（暂无任务）"
