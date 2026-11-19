"""数据契约校验：引用完整性与分组颜色（CONTRACT 第 2 / 6 节）。"""

from __future__ import annotations

import copy

from codeviz.model import MAX_REFERENCE_ERRORS, validate_data


def test_valid_data_passes(minimal_data: dict) -> None:
    assert validate_data(minimal_data) == []
    assert validate_data(copy.deepcopy(minimal_data)) == []


def test_dangling_call_target_is_reported(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["calls"][0]["target"] = "function:missing"

    errors = validate_data(data)

    assert any("calls[0].target" in error and "missing" in error for error in errors)


def test_dangling_call_source_is_reported(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["calls"][0]["source"] = "function:missing"

    errors = validate_data(data)

    assert any("calls[0].source" in error for error in errors)


def test_dangling_entry_id_is_reported(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["entries"][0]["id"] = "function:missing"

    errors = validate_data(data)

    assert any("entries[0].id" in error and "missing" in error for error in errors)


def test_bad_group_color_is_reported(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["groups"]["router"]["color"] = "red"

    errors = validate_data(data)

    assert any("color" in error and "router" in error for error in errors)


def test_short_group_color_is_accepted(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["groups"]["router"]["color"] = "#abc"

    assert validate_data(data) == []


def test_reference_errors_are_capped_per_kind(minimal_data: dict) -> None:
    data = copy.deepcopy(minimal_data)
    data["calls"] = [
        {"source": "function:missing", "target": "function:missing"} for _ in range(20)
    ]

    errors = validate_data(data)
    dangling = [error for error in errors if "指向不存在的符号" in error]

    assert len(dangling) == MAX_REFERENCE_ERRORS * 2
    assert len(errors) <= 51
