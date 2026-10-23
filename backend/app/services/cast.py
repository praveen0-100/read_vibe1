"""Casting for plays and dialogue: which characters are men and which are women, judged from the *document's own words*.

Never from the name. A character gets a gender only from explicit evidence anywhere in the book:
  * a title:        "Miss Forsythe", "Mr. Loman"
  * kinship:        "his son, Biff" / "Linda, his wife" / "her husband Charley" (the kin word names the person's sex);
                    "Linda Loman is Willy’s loyal wife"; "Willy’s wife" (the owner of a wife is a husband)
  * a role noun:    "the woman", "girl", "the waiter"
  * a reflexive of the name itself: "Linda defines herself"
Anyone without clear evidence stays undecided (None) and the client gives them the less-used voice.
"""
from __future__ import annotations

import re

FEMALE_TITLES = r"mrs|miss|ms|madam|madame|lady|queen|princess|duchess|dame"
MALE_TITLES = r"mr|mister|sir|lord|king|prince|duke"
FEMALE_KIN = r"wife|mother|daughter|sister|girlfriend|aunt|niece|mom|mum|grandmother|fiancée|fiancee"
MALE_KIN = r"husband|father|son|brother|boyfriend|uncle|nephew|dad|grandfather|fiancé|fiance"
ADJ = r"(?:[A-Za-z-]+\s+){0,3}?"  # "his loyal but sometimes bewildered wife"
FEMALE_ROLE = {"girl", "girls", "woman", "women", "lady", "waitress", "nurse", "actress", "maid", "mother", "wife", "daughter", "sister"}
MALE_ROLE = {"man", "men", "boy", "boys", "waiter", "father", "husband", "son", "brother", "gentleman", "policeman", "salesman"}


def _count(pattern: str, text: str, flags: int = re.I) -> int:
    return len(re.findall(pattern, text, flags))


def _score(text: str, name: str) -> tuple[int, int]:
    """(male evidence, female evidence) for `name`. Strong cues weigh 3, a reflexive 2."""
    n = re.escape(name)
    nb = rf"(?<![A-Za-z'’-]){n}(?![A-Za-z'’-])"
    male = female = 0

    # titles
    female += 3 * _count(rf"\b(?:{FEMALE_TITLES})\.?\s+(?:[A-Za-z]+\s+)?{nb}", text)
    male += 3 * _count(rf"\b(?:{MALE_TITLES})\.?\s+(?:[A-Za-z]+\s+)?{nb}", text)

    # kinship: the kin noun gives the named person's sex, whoever owns it
    #   "Name, his wife"   "his wife, Name"   "Name is Willy’s (loyal) wife"
    for kin, is_female in ((FEMALE_KIN, True), (MALE_KIN, False)):
        hits = (
            # (?![’']s): the kin word must be the person's own relation, not a possessor ("his father’s secretary")
            _count(rf"{nb}[^.!?\n]{{0,14}}?,\s*(?:his|her|their)\s+{ADJ}(?:{kin})\b(?![’']s)", text)
            + _count(rf"\b(?:his|her|their)\s+{ADJ}(?:{kin})\b(?![’']s),?\s+(?:[A-Za-z]+\s+)?{nb}", text)
            + _count(rf"{nb}[^.!?\n]{{0,40}}?\b(?:is|was|as)\s+[A-Za-z]+[’']s\s+{ADJ}(?:{kin})\b(?![’']s)", text)
        )
        if is_female:
            female += 3 * hits
        else:
            male += 3 * hits

    # the owner of a wife is a husband and vice versa: "Willy’s wife"
    owner = rf"(?<![A-Za-z'’-]){n}(?=[’'])"  # the name boundary must let the apostrophe through
    male += 3 * _count(rf"{owner}[’']s\s+{ADJ}(?:wife|girlfriend)\b", text)
    female += 3 * _count(rf"{owner}[’']s\s+{ADJ}(?:husband|boyfriend)\b", text)

    # role nouns used as the name itself ("the woman:", "girl:")
    last = name.split()[-1]
    if name in FEMALE_ROLE or last in FEMALE_ROLE:
        female += 3
    if name in MALE_ROLE or last in MALE_ROLE:
        male += 3

    # a reflexive that belongs to the name itself — no commas between, so "Linda, Charley and Biff himself" never counts
    female += 2 * _count(rf"{nb}\s+(?:[A-Za-z’' ]{{0,30}}?)\bherself\b", text)
    male += 2 * _count(rf"{nb}\s+(?:[A-Za-z’' ]{{0,30}}?)\bhimself\b", text)
    return male, female


_MODIFIERS = re.compile(r"^(?:young|old|little|big|elder|younger|older)\s+")


def _decide(male: int, female: int) -> str | None:
    if male >= 3 and male > female * 1.5:
        return "male"
    if female >= 3 and female > male * 1.5:
        return "female"
    return None


def hints(text: str, names: list[str]) -> dict[str, str | None]:
    """{name: 'male' | 'female' | None} from the whole text — conservative: ties and thin evidence stay None."""
    out: dict[str, str | None] = {}
    for raw in names[:30]:
        name = " ".join(raw.lower().split())
        if not name or len(name) > 40:
            continue
        # a label that is itself a title ("miss forsythe")
        if re.match(rf"(?:{FEMALE_TITLES})\.?\s+\w", name):
            out[raw] = "female"
            continue
        if re.match(rf"(?:{MALE_TITLES})\.?\s+\w", name):
            out[raw] = "male"
            continue
        male, female = _score(text, _MODIFIERS.sub("", name))  # "young bernard" is judged as "bernard"
        out[raw] = _decide(male, female)
    return out
