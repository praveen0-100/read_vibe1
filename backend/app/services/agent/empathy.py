"""Reading the room: a light, local estimate of how the reader is feeling, and how the agent should answer because of it.

This is deliberately modest. It looks at the words of the current message plus a few behavioural cues (very late, a very
long session, asking the same thing twice) and returns a *guess with a confidence*, never a diagnosis. The agent is told to
respond to "it sounds like…", not to announce what it detected. Nothing here calls a model, so it works offline and costs
nothing; the text of the message is never stored.

A message that suggests the reader may be in danger skips the model entirely and gets a fixed, caring reply with real help.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# state → (patterns, weight). Checked case-insensitively; a match preceded by a negation ("not confused") is ignored.
_LEXICON: dict[str, tuple[re.Pattern, float]] = {
    "overwhelmed": (re.compile(r"\b(overwhelm\w*|too much|so much to (?:read|do|learn|cover)|can'?t keep up|drowning|swamped|don'?t know where to start|so behind|falling behind)\b", re.I), 1.3),
    "anxious": (re.compile(r"\b(anxious|anxiety|nervous|worried|worry|scared|afraid|panic\w*|stress\w*|terrified|exam (?:is )?(?:tomorrow|tonight)|deadline|going to fail|will fail)\b", re.I), 1.2),
    "discouraged": (re.compile(r"\b(give up|giving up|hopeless|pointless|i'?m (?:so )?(?:stupid|dumb|bad at)|no motivation|unmotivated|burn(?:ed|t)? out|burnout|worthless|can'?t do this|i suck)\b", re.I), 1.4),
    "frustrated": (re.compile(r"\b(frustrat\w*|annoying|annoyed|useless|ugh+|wtf|fed up|sick of|hate this|not working|doesn'?t work|this is (?:so )?(?:stupid|ridiculous)|again and again|still (?:don'?t|doesn'?t|not))\b", re.I), 1.1),
    "confused": (re.compile(r"\b(confus\w*|don'?t (?:get|understand)|doesn'?t make sense|makes? no sense|i'?m lost|no idea what|unclear|lost me|not sure what (?:this|that|it) means|what do you mean)\b", re.I), 1.0),
    "tired": (re.compile(r"\b(tired|sleepy|exhausted|drained|yawn\w*|can'?t focus|can'?t concentrate|distracted|brain fog|burnt)\b", re.I), 0.9),
    "bored": (re.compile(r"\b(bored|boring|dull|tedious|so slow)\b", re.I), 0.8),
    "excited": (re.compile(r"\b(love (?:this|it)|amazing|awesome|fascinating|so cool|wow+|brilliant|excited|can'?t wait|this is great|fantastic)\b", re.I), 0.9),
    "curious": (re.compile(r"\b(curious|wonder\w*|what if|tell me more|go deeper|dig (?:in|deeper)|fascinat\w*)\b", re.I), 0.6),
    "grateful": (re.compile(r"\b(thanks?|thank you|thx|appreciate it|that helped|much better)\b", re.I), 0.7),
}
_NEGATION = re.compile(r"(?:\bnot\b|\bno\b|\bnever\b|n't|\bwithout\b)\W+(?:\w+\W+){0,2}$", re.I)

# Strict, high-precision phrases only: a false alarm here is a kind message, a miss is far worse.
_SAFETY = re.compile(
    r"\b(kill myself|killing myself|end (?:my|it all|my own) life|suicid\w*|want to die|wanna die|don'?t want to (?:live|be alive|be here anymore)|"
    r"self[- ]?harm\w*|hurt myself|cut myself|better off dead|no reason to live|take my own life)\b", re.I)

SAFETY_REPLY = (
    "I’m really glad you told me, and I’m sorry things feel this heavy right now. You deserve support from a real person "
    "tonight, not just from an app.\n\n"
    "• If you might act on these thoughts or you’re in immediate danger, please call your local emergency number now.\n"
    "• In India, **Tele-MANAS** is free, confidential and open 24×7 on **14416**.\n"
    "• Elsewhere, **findahelpline.com** lists a free helpline for your country.\n"
    "• If you can, tell someone near you — a friend, a family member — that you’re not okay and ask them to stay with you.\n\n"
    "I’m here and I’ll keep listening if you want to keep talking. There’s no reading to do right now."
)


@dataclass
class Affect:
    state: str = "neutral"
    confidence: float = 0.0
    cues: list[str] = field(default_factory=list)
    safety: bool = False

    @property
    def needs_care(self) -> bool:
        return self.state in ("overwhelmed", "anxious", "discouraged", "frustrated") and self.confidence >= 0.4

    def public(self) -> dict:
        return {"state": self.state, "confidence": round(self.confidence, 2), "cues": self.cues}


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"\w{3,}", text.lower()))


def _repeats_earlier(message: str, history: list[dict]) -> bool:
    mine = _tokens(message)
    if len(mine) < 3:
        return False
    for turn in history[-6:]:
        if turn.get("role") != "user":
            continue
        theirs = _tokens(turn.get("content", ""))
        if theirs and len(mine & theirs) / len(mine | theirs) >= 0.6:
            return True
    return False


def detect(message: str, history: list[dict] | None = None, *, local_hour: int | None = None, session_minutes: int = 0) -> Affect:
    history = history or []
    if _SAFETY.search(message):
        return Affect("distress", 1.0, ["safety"], safety=True)

    scores: dict[str, float] = {}
    for state, (pattern, weight) in _LEXICON.items():
        for m in pattern.finditer(message):
            if _NEGATION.search(message[max(0, m.start() - 24): m.start()]):
                continue
            scores[state] = scores.get(state, 0.0) + weight
    cues: list[str] = []

    letters = [c for c in message if c.isalpha()]
    shouting = len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.6
    if shouting or message.count("!") >= 3:
        cues.append("intense punctuation")
        scores["frustrated"] = scores.get("frustrated", 0.0) + (0.5 if "frustrated" in scores else 0.2)
    if message.count("?") >= 3:
        cues.append("repeated question marks")
        scores["confused"] = scores.get("confused", 0.0) + 0.4

    if _repeats_earlier(message, history):
        cues.append("asked something similar before")
        scores["confused"] = scores.get("confused", 0.0) + 0.7
    if local_hour is not None and (local_hour >= 23 or local_hour < 4):
        cues.append("late at night")
        if "tired" in scores:
            scores["tired"] += 0.4
    if session_minutes >= 90:
        cues.append(f"{session_minutes} minutes without a break")
        scores["tired"] = scores.get("tired", 0.0) + 0.5

    if not scores:
        return Affect("neutral", 0.0, cues)
    # on a tie the heavier feeling wins
    state, score = max(scores.items(), key=lambda kv: (kv[1], _LEXICON.get(kv[0], (None, 0))[1]))
    return Affect(state, min(0.95, 0.35 + 0.3 * score), cues)


# How to answer, per state. `directive` goes to the model; `opener` is the local fallback when no model is reachable.
STYLE: dict[str, dict] = {
    "overwhelmed": {
        "directive": "The reader may be overwhelmed. Acknowledge it in one short, genuine sentence, then shrink the problem: give at most three small steps, or just one next action. No long lists, no pep talk.",
        "opener": "That sounds like a lot at once — let’s make it smaller.",
        "suggestions": ["Give me just the first step", "Make a 15-minute plan", "What can I safely skip?"],
    },
    "anxious": {
        "directive": "The reader may be anxious or under pressure. Be calm and steady. Acknowledge the pressure briefly, focus on what is in their control, and give a concrete, time-boxed way forward. Do not add urgency.",
        "opener": "Deadlines make everything feel louder. Let’s focus on what’s in reach right now.",
        "suggestions": ["What matters most to know?", "Quiz me gently", "A quick summary first"],
    },
    "discouraged": {
        "directive": "The reader sounds discouraged. Lead with warmth and respect, never cheerleading. Point to something real they have already done (use the reader profile only if it truly supports it), keep the next step tiny, and keep your answer short.",
        "opener": "It’s okay to feel stuck — that usually means you’re working on something that matters.",
        "suggestions": ["Explain it more simply", "Show me one small win", "Take a short break"],
    },
    "frustrated": {
        "directive": "The reader is frustrated. Do not get defensive or over-apologise. Acknowledge it in a few words, try a different angle than the one that has not worked, and be direct and brief.",
        "opener": "Fair — that’s frustrating. Let me try a different angle.",
        "suggestions": ["Explain it a different way", "Give me an example", "Summarize in 3 points"],
    },
    "confused": {
        "directive": "The reader is confused. Explain with plain words and one concrete example or analogy, build up from what they already know, and end with a quick check of understanding. Never imply they should have understood.",
        "opener": "Let’s unpack that step by step.",
        "suggestions": ["Give me an example", "Explain like I’m new to this", "Quiz me to check"],
    },
    "tired": {
        "directive": "The reader seems tired. Keep your answer short and easy to take in, lean on bullets or one idea at a time, and (once, lightly, only if it fits) mention that a short rest or listening instead of reading is fine.",
        "opener": "You sound tired, so I’ll keep this light.",
        "suggestions": ["Read this to me", "Just the key idea", "Save this for later"],
    },
    "bored": {
        "directive": "The reader seems bored. Make it vivid: lead with the most interesting angle, a surprising connection or a real-world hook, and propose a more active way in (a question, a challenge).",
        "opener": "Let’s find the interesting part.",
        "suggestions": ["Why does this matter?", "Quiz me", "Connect this to real life"],
    },
    "excited": {
        "directive": "The reader is enthusiastic. Match their energy, go a level deeper than usual, and offer a stretch idea or a related thread to follow.",
        "opener": "Love the energy — let’s go deeper.",
        "suggestions": ["Go deeper", "Related ideas to explore", "Challenge me with a hard question"],
    },
    "curious": {
        "directive": "The reader is curious. Satisfy the question fully, then open one interesting adjacent thread.",
        "opener": "",
        "suggestions": ["Go deeper", "Show me a diagram", "What should I read next?"],
    },
    "grateful": {
        "directive": "The reader is thanking you. Reply warmly in a sentence, then offer a natural next step.",
        "opener": "Glad that helped!",
        "suggestions": ["What should I do next?", "Quiz me on this", "Save this to my notes"],
    },
    "neutral": {"directive": "", "opener": "", "suggestions": []},
    "distress": {"directive": "", "opener": "", "suggestions": []},
}


def style_for(affect: Affect) -> dict:
    return STYLE.get(affect.state, STYLE["neutral"])


MOOD_TO_STATE = {"great": "excited", "okay": "neutral", "tired": "tired", "stressed": "anxious", "low": "discouraged"}

CHECKIN_REPLIES = {
    "great": "Great to hear. Want to use that energy on something challenging?",
    "okay": "Steady is good. I’ll keep things simple and let you lead.",
    "tired": "Thanks for telling me. I’ll keep things light today — shorter answers, and listening mode is there if your eyes need a rest.",
    "stressed": "That sounds like a lot. We’ll take it one small piece at a time, and I’ll keep my answers short and calm.",
    "low": "I’m sorry it’s a heavy day. No pressure to be productive — we can read something gentle, or just do five minutes.",
}
