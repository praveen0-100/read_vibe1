"""Stage directions and other bracketed notes are *performed*, never spoken.

A play, screenplay or annotated text carries things like `[directly to biff]`, `[turning on him, in an outburst]` or
`[1, 2]` — instructions and references for the reader, not words for the narrator. This module removes them from
anything that will be spoken. (The client keeps them visible in the transcript, dimmed, and turns their meaning into
delivery — see `tts.PRESETS`.)
"""
from __future__ import annotations

import re

_BRACKETED = re.compile(r"\[[^\]]*\]")
_UNCLOSED_TAIL = re.compile(r"\[[^\]]*$")
_STRAY_HEAD = re.compile(r"^[^\[]*\]")


def strip_for_speech(text: str) -> str:
    """`text` without any [bracketed] content (including a bracket left open or closed across a split), whitespace tidied."""
    if not text:
        return ""
    t = _BRACKETED.sub(" ", text)
    t = _UNCLOSED_TAIL.sub(" ", t)
    t = _STRAY_HEAD.sub(" ", t) if "]" in t else t
    return " ".join(t.split())
