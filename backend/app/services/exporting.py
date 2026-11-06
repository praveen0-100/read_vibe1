"""Helpers for exports."""
from __future__ import annotations


def csv_cell(value: str) -> str:
    """Neutralise spreadsheet formula injection: a cell that starts with = + - @ (or a tab/CR) would be executed as a formula
    when the CSV is opened in Excel/Sheets, and highlights are text the user (or a document) controls."""
    if value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def marks_label(marks: dict | None) -> str:
    parts = [f"{color} {style}" for style, color in (marks or {}).items() if color]
    return ", ".join(parts)
