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



# ─── Example scenes ──────────────────────────────────────────────────────────
# A picture for an *example* on a slide: a pictogram chosen from the example's own words, standing on a glowing platform with
# orbiting sparks. Still procedural (no image model), but it shows the thing the example is about rather than abstract shapes.
SCENE_WORDS: dict[str, tuple[str, ...]] = {
    "bulb": ("idea", "ideas", "think", "thinking", "innovation", "invent", "creative", "insight", "solve", "solution", "brain", "mind", "learn"),
    "book": ("book", "read", "reading", "story", "lesson", "school", "student", "education", "teach", "document", "write", "writing", "library", "novel"),
    "chart": ("data", "number", "numbers", "growth", "market", "economy", "sales", "percent", "rate", "price", "profit", "statistics", "trend", "money"),
    "gear": ("system", "process", "machine", "engineering", "software", "code", "technology", "automation", "tool", "algorithm", "computer", "network", "design"),
    "shield": ("security", "secure", "safe", "safety", "protect", "privacy", "policy", "law", "rule", "risk", "cyber", "password", "attack", "defence", "defense"),
    "people": ("team", "people", "community", "social", "society", "customer", "user", "users", "family", "friends", "group", "human", "public", "citizen"),
    "house": ("home", "house", "building", "city", "architecture", "room", "village", "street", "shop", "hotel", "office"),
    "rocket": ("launch", "future", "progress", "goal", "success", "space", "start", "startup", "speed", "mission", "begin", "journey"),
    "tree": ("nature", "environment", "plant", "tree", "forest", "garden", "animal", "biology", "life", "climate", "farm", "food", "water"),
    "globe": ("world", "global", "country", "travel", "international", "language", "culture", "map", "trade", "earth", "history", "war"),
}
SCENES = tuple(SCENE_WORDS)


def pick_scene(seed: str) -> str:
    words = [w.strip(".,;:!?()\"'").lower() for w in seed.split()]
    scores = {k: sum(w in vocab or w.rstrip("s") in vocab for w in words) for k, vocab in SCENE_WORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else SCENES[int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(SCENES)]


def _pictogram(d: ImageDraw.ImageDraw, kind: str, cx: float, cy: float, u: float, c1, c2, c3, ink, ground) -> None:
    """Draw `kind` centred on (cx, cy), roughly ±u in each direction."""
    def a(c, al=255):
        return (*c, al)

    lw = max(3, int(.05 * u))
    if kind == "bulb":
        d.ellipse([cx - .55 * u, cy - .85 * u, cx + .55 * u, cy + .25 * u], fill=a(c3))
        d.rounded_rectangle([cx - .24 * u, cy + .18 * u, cx + .24 * u, cy + .62 * u], radius=int(.06 * u), fill=a(ink, 235))
        for k in range(9):
            ang = math.radians(200 + k * 17.5)
            d.line([cx + .72 * u * math.cos(ang), cy - .3 * u + .72 * u * math.sin(ang),
                    cx + .98 * u * math.cos(ang), cy - .3 * u + .98 * u * math.sin(ang)], fill=a(c1), width=lw)
        d.arc([cx - .28 * u, cy - .55 * u, cx + .28 * u, cy + .05 * u], 200, 340, fill=a(ground, 200), width=max(2, int(.04 * u)))
    elif kind == "book":
        d.polygon([(cx - 1.05 * u, cy - .55 * u), (cx, cy - .35 * u), (cx, cy + .7 * u), (cx - 1.05 * u, cy + .5 * u)], fill=a(c2))
        d.polygon([(cx + 1.05 * u, cy - .55 * u), (cx, cy - .35 * u), (cx, cy + .7 * u), (cx + 1.05 * u, cy + .5 * u)], fill=a(c1))
        for i in range(4):
            y = cy - .12 * u + i * .17 * u
            d.line([cx - .85 * u, y - .08 * u, cx - .15 * u, y + .04 * u], fill=a(ink, 170), width=max(2, int(.03 * u)))
            d.line([cx + .15 * u, y + .04 * u, cx + .85 * u, y - .08 * u], fill=a(ink, 170), width=max(2, int(.03 * u)))
        d.line([cx, cy - .35 * u, cx, cy + .7 * u], fill=a(ink, 220), width=max(2, int(.04 * u)))
    elif kind == "chart":
        base = cy + .75 * u
        heights = (.45, .8, .6, 1.2)
        for i, hgt in enumerate(heights):
            x = cx - .95 * u + i * .5 * u
            d.rounded_rectangle([x, base - hgt * u, x + .34 * u, base], radius=int(.05 * u), fill=a((c1, c2, c3, c1)[i]))
        pts = [(cx - .78 * u + i * .5 * u, base - hgt * u - .25 * u) for i, hgt in enumerate(heights)]
        d.line(pts, fill=a(ink, 240), width=lw)
        for x, y in pts:
            d.ellipse([x - .07 * u, y - .07 * u, x + .07 * u, y + .07 * u], fill=a(ink))
        d.line([cx - 1.1 * u, base, cx + 1.1 * u, base], fill=a(ink, 200), width=max(2, int(.03 * u)))
    elif kind == "gear":
        teeth, pts = 10, []
        for k in range(teeth * 2):
            r = .95 * u if k % 2 == 0 else .72 * u
            for off in (-0.12, 0.12):
                ang = (k + off) * math.pi / teeth
                pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        d.polygon(pts, fill=a(c2))
        d.ellipse([cx - .5 * u, cy - .5 * u, cx + .5 * u, cy + .5 * u], fill=a(c1))
        d.ellipse([cx - .22 * u, cy - .22 * u, cx + .22 * u, cy + .22 * u], fill=a(ground))
    elif kind == "shield":
        d.polygon([(cx - .75 * u, cy - .85 * u), (cx + .75 * u, cy - .85 * u), (cx + .75 * u, cy + .1 * u), (cx, cy + 1.0 * u), (cx - .75 * u, cy + .1 * u)], fill=a(c2))
        d.polygon([(cx - .55 * u, cy - .65 * u), (cx + .55 * u, cy - .65 * u), (cx + .55 * u, cy + .05 * u), (cx, cy + .75 * u), (cx - .55 * u, cy + .05 * u)], fill=a(c1, 200))
        d.line([(cx - .3 * u, cy - .02 * u), (cx - .06 * u, cy + .24 * u), (cx + .34 * u, cy - .34 * u)], fill=a(ink), width=max(4, int(.1 * u)), joint="curve")
    elif kind == "people":
        for dx, sc, col in ((-.72, .8, c2), (.72, .8, c3), (0, 1.0, c1)):
            x, y = cx + dx * u, cy + (0 if dx == 0 else .12 * u)
            d.ellipse([x - .24 * u * sc, y - .62 * u * sc, x + .24 * u * sc, y - .14 * u * sc], fill=a(col))
            d.rounded_rectangle([x - .36 * u * sc, y - .06 * u * sc, x + .36 * u * sc, y + .78 * u * sc], radius=int(.2 * u), fill=a(col))
    elif kind == "house":
        d.polygon([(cx - 1.0 * u, cy - .1 * u), (cx, cy - .95 * u), (cx + 1.0 * u, cy - .1 * u)], fill=a(c1))
        d.rectangle([cx - .75 * u, cy - .1 * u, cx + .75 * u, cy + .8 * u], fill=a(c2))
        d.rounded_rectangle([cx - .2 * u, cy + .2 * u, cx + .2 * u, cy + .8 * u], radius=int(.05 * u), fill=a(ground))
        d.rectangle([cx + .35 * u, cy + .05 * u, cx + .62 * u, cy + .32 * u], fill=a(c3))
        d.rectangle([cx - .62 * u, cy + .05 * u, cx - .35 * u, cy + .32 * u], fill=a(c3))
    elif kind == "rocket":
        d.polygon([(cx - .42 * u, cy + .3 * u), (cx - .85 * u, cy + .85 * u), (cx - .25 * u, cy + .55 * u)], fill=a(c2))
        d.polygon([(cx + .42 * u, cy + .3 * u), (cx + .85 * u, cy + .85 * u), (cx + .25 * u, cy + .55 * u)], fill=a(c2))
        d.polygon([(cx - .2 * u, cy + .62 * u), (cx + .2 * u, cy + .62 * u), (cx, cy + 1.15 * u)], fill=a(c3))
        d.ellipse([cx - .42 * u, cy - 1.0 * u, cx + .42 * u, cy + .7 * u], fill=a(ink, 245))
        d.polygon([(cx - .38 * u, cy - .45 * u), (cx, cy - 1.15 * u), (cx + .38 * u, cy - .45 * u)], fill=a(c1))
        d.ellipse([cx - .17 * u, cy - .25 * u, cx + .17 * u, cy + .09 * u], fill=a(c2))
    elif kind == "tree":
        d.rounded_rectangle([cx - .12 * u, cy + .1 * u, cx + .12 * u, cy + .85 * u], radius=int(.04 * u), fill=a(c3, 200))
        for dx, dy, r, col in ((-.4, -.1, .5, c2), (.4, -.1, .5, c2), (0, -.45, .62, c1), (0, .0, .55, c1)):
            d.ellipse([cx + (dx - r) * u, cy + (dy - r) * u, cx + (dx + r) * u, cy + (dy + r) * u], fill=a(col, 235))
    else:  # globe
        d.ellipse([cx - .92 * u, cy - .92 * u, cx + .92 * u, cy + .92 * u], fill=a(c2, 230), outline=a(ink, 230), width=max(2, int(.04 * u)))
        for k in (.25, .6):
            d.ellipse([cx - k * .92 * u * 1.4, cy - .92 * u, cx + k * .92 * u * 1.4, cy + .92 * u], outline=a(ink, 150), width=max(2, int(.025 * u)))
        for yy in (-.45, 0, .45):
            hw = math.sqrt(max(0, .92 ** 2 - yy ** 2)) * u
            d.line([cx - hw, cy + yy * u, cx + hw, cy + yy * u], fill=a(ink, 150), width=max(2, int(.025 * u)))
        d.ellipse([cx - .45 * u, cy - .5 * u, cx - .05 * u, cy - .15 * u], fill=a(c1, 220))
        d.ellipse([cx + .1 * u, cy + .05 * u, cx + .5 * u, cy + .45 * u], fill=a(c1, 220))


def _scene(w: int, h: int, th: dict[str, str], seed: str, rng: random.Random) -> Image.Image:
    kind = pick_scene(seed)
    c1, c2, c3 = _rgb(th["a1"]), _rgb(th["a2"]), _rgb(th["a3"])
    ink, ground = _rgb(th["text"]), _rgb(th["bg0"])
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, u = w * 0.5, h * 0.47, min(w, h) * 0.27
    for i in range(6):  # platform glow: stacked translucent discs
        r = u * (2.1 - i * .22)
        d.ellipse([cx - r, cy - r * .92, cx + r, cy + r * .92], fill=(*(c2 if i % 2 else c1), 22 + i * 9))
    d.ellipse([cx - u * 1.55, cy + u * .95, cx + u * 1.55, cy + u * 1.3], fill=(*ground, 120))  # ground shadow
    for i in range(2):  # orbit rings
        d.ellipse([cx - u * (1.9 + i * .35), cy - u * (.75 + i * .2), cx + u * (1.9 + i * .35), cy + u * (.75 + i * .2)], outline=(*c3, 70 - i * 25), width=2)
    for _ in range(16):  # sparks
        ang, r = rng.uniform(0, math.tau), rng.uniform(1.25, 2.2) * u
        x, y, sz = cx + r * math.cos(ang), cy + r * .75 * math.sin(ang), rng.uniform(3, 9)
        d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=(*rng.choice((c1, c2, c3)), rng.randint(120, 230)))
    _pictogram(d, kind, cx, cy, u, c1, c2, c3, ink, ground)
    return layer


@lru_cache(maxsize=96)
def render(seed: str, theme: str = "aurora", style: str = "", w: int = 960, h: int = 540) -> bytes:
    """JPEG bytes of the picture for `seed`. Deterministic: same arguments, same picture."""
    th = theme_of(theme)
    style = style if style in STYLES or style == "scene" else pick_style(seed)
    rng = random.Random(int(hashlib.sha256(f"{seed}|{style}".encode()).hexdigest()[:16], 16))
    base = _glow_field(_background(w, h, th), rng, th).convert("RGBA")
    cols = [_rgb(th["a1"]), _rgb(th["a2"]), _rgb(th["a3"])]

    if style == "scene":
        art = _scene(w, h, th, seed, rng)
    else:
        art = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        _paint(ImageDraw.Draw(art), rng, style, w, h, cols)
    halo = art.filter(ImageFilter.GaussianBlur(7))  # bloom: a blurred copy under the crisp drawing
    out = Image.alpha_composite(Image.alpha_composite(base, halo), art)

    buf = io.BytesIO()
    out.convert("RGB").save(buf, "JPEG", quality=86, optimize=True, progressive=True)
    return buf.getvalue()
