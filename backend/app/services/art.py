"""Generated slide imagery.

There is no image model behind this: each picture is drawn procedurally (soft light fields plus an orbit, network, wave
or crystal motif) from a seed derived from the slide's topic, so the same topic always gets the same picture and every
deck gets its own look. The same image bytes feed the web slideshow and the exported .pptx.
"""
from __future__ import annotations

import hashlib
import io
import math
import random
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter

# bg0/bg1: slide background gradient · a1-a3: accents · text/muted: ink · panel: card fill
THEMES: dict[str, dict[str, str]] = {
    "aurora": {"name": "Aurora", "bg0": "#06121f", "bg1": "#0d2a3a", "a1": "#2de2c4", "a2": "#7c5cff", "a3": "#5ab8ff", "text": "#eaf6ff", "muted": "#8fb2c7", "panel": "#0f2433"},
    "nebula": {"name": "Nebula", "bg0": "#0c0818", "bg1": "#241046", "a1": "#ff5fd2", "a2": "#8b6bff", "a3": "#ffb86b", "text": "#f6efff", "muted": "#b7a6d6", "panel": "#1a1032"},
    "solar": {"name": "Solar", "bg0": "#150a06", "bg1": "#3a1a0c", "a1": "#ffb347", "a2": "#ff6b4a", "a3": "#ffe08a", "text": "#fff4e8", "muted": "#d1a98c", "panel": "#26120a"},
    "frost": {"name": "Frost", "bg0": "#f4f8fc", "bg1": "#dbe8f5", "a1": "#1769e0", "a2": "#7b4dff", "a3": "#00a6a6", "text": "#0e1b2c", "muted": "#51647a", "panel": "#ffffff"},
}
STYLES = ("orbit", "network", "wave", "crystal")


def theme_of(name: str | None) -> dict[str, str]:
    return THEMES.get(name or "", THEMES["aurora"])


def _rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def pick_style(seed: str) -> str:
    return STYLES[int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(STYLES)]


def _background(w: int, h: int, th: dict[str, str]) -> Image.Image:
    # a diagonal gradient built from a tiny gradient strip, scaled up
    small = Image.new("RGB", (64, 64))
    px = small.load()
    c0, c1 = _rgb(th["bg0"]), _rgb(th["bg1"])
    for y in range(64):
        for x in range(64):
            px[x, y] = _mix(c0, c1, (x + y) / 126)
    return small.resize((w, h), Image.BILINEAR)


def _glow_field(img: Image.Image, rng: random.Random, th: dict[str, str]) -> Image.Image:
    w, h = img.size
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for key in ("a1", "a2", "a3", "a1"):
        r = rng.uniform(0.16, 0.34) * w
        cx, cy = rng.uniform(0.05, 0.95) * w, rng.uniform(0.05, 0.95) * h
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=_rgb(th[key]))
    layer = layer.filter(ImageFilter.GaussianBlur(w * 0.11))
    light = th["bg0"].lower() > "#888888"
    # dark themes add light; light themes get a gentle tint instead
    return ImageChops.screen(img, layer.point(lambda v: int(v * (0.30 if light else 0.55))))


def _paint(draw: ImageDraw.ImageDraw, rng: random.Random, style: str, w: int, h: int, cols: list[tuple[int, int, int]]) -> None:
    def col(a: int, k: int | None = None) -> tuple[int, int, int, int]:
        c = cols[rng.randrange(len(cols)) if k is None else k % len(cols)]
        return (*c, a)

    cx, cy = w * rng.uniform(0.42, 0.62), h * rng.uniform(0.40, 0.60)
    if style == "orbit":
        for i in range(7):
            r = (0.10 + 0.075 * i) * w
            ry = r * rng.uniform(0.38, 0.62)
            tilt = rng.uniform(-0.5, 0.5)
            pts = [(cx + r * math.cos(t) * math.cos(tilt) - ry * math.sin(t) * math.sin(tilt),
                    cy + r * math.cos(t) * math.sin(tilt) + ry * math.sin(t) * math.cos(tilt)) for t in [k * math.pi / 90 for k in range(181)]]
            draw.line(pts, fill=col(120 - i * 9, i), width=2)
            a = rng.uniform(0, math.tau)
            px = cx + r * math.cos(a) * math.cos(tilt) - ry * math.sin(a) * math.sin(tilt)
            py = cy + r * math.cos(a) * math.sin(tilt) + ry * math.sin(a) * math.cos(tilt)
            s = rng.uniform(5, 14)
            draw.ellipse([px - s, py - s, px + s, py + s], fill=col(235, i))
        draw.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=col(255, 0))
    elif style == "network":
        pts = [(rng.uniform(0.05, 0.95) * w, rng.uniform(0.08, 0.92) * h) for _ in range(34)]
        for i, p in enumerate(pts):
            near = sorted(pts, key=lambda q: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2)[1:4]
            for q in near:
                draw.line([p, q], fill=col(90, i), width=2)
        for i, (x, y) in enumerate(pts):
            s = rng.choice((4, 5, 7, 10))
            draw.ellipse([x - s, y - s, x + s, y + s], fill=col(230, i))
    elif style == "wave":
        for i in range(16):
            amp, freq, ph = rng.uniform(0.04, 0.16) * h, rng.uniform(1.0, 2.8), rng.uniform(0, math.tau)
            base = (0.18 + 0.045 * i) * h
            pts = [(x, base + amp * math.sin(x / w * math.tau * freq + ph)) for x in range(0, w + 8, 8)]
            draw.line(pts, fill=col(60 + (i * 11) % 120, i), width=rng.choice((2, 3, 5)))
    else:  # crystal
        for i in range(22):
            x, y = rng.uniform(0, w), rng.uniform(0, h)
            r = rng.uniform(0.05, 0.2) * w
            n = rng.choice((3, 4, 5, 6))
            rot = rng.uniform(0, math.tau)
            poly = [(x + r * math.cos(rot + k * math.tau / n), y + r * math.sin(rot + k * math.tau / n)) for k in range(n)]
            draw.polygon(poly, fill=col(rng.randint(22, 70), i), outline=col(150, i))


@lru_cache(maxsize=96)
def render(seed: str, theme: str = "aurora", style: str = "", w: int = 960, h: int = 540) -> bytes:
    """JPEG bytes of the picture for `seed`. Deterministic: same arguments, same picture."""
    th = theme_of(theme)
    style = style if style in STYLES else pick_style(seed)
    rng = random.Random(int(hashlib.sha256(f"{seed}|{style}".encode()).hexdigest()[:16], 16))
    base = _glow_field(_background(w, h, th), rng, th).convert("RGBA")
    cols = [_rgb(th["a1"]), _rgb(th["a2"]), _rgb(th["a3"])]

    art = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    _paint(ImageDraw.Draw(art), rng, style, w, h, cols)
    halo = art.filter(ImageFilter.GaussianBlur(7))  # bloom: a blurred copy under the crisp drawing
    out = Image.alpha_composite(Image.alpha_composite(base, halo), art)

    buf = io.BytesIO()
    out.convert("RGB").save(buf, "JPEG", quality=86, optimize=True, progressive=True)
    return buf.getvalue()
