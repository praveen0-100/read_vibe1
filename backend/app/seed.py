"""Demo account and original sample content so a fresh install is immediately explorable."""
from __future__ import annotations

import logging
import random
import threading
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Audiobook, Highlight, Note, ReadingSession, ResearchProject, User, utcnow
from .security import hash_password
from .services import ingest, narration

log = logging.getLogger("readvibe.seed")

DEMO_EMAIL = "demo@readvibe.app"
DEMO_PASSWORD = "readvibe123"

FOCUSED_READING = """# The Quiet Mind

Reading well begins before the first sentence. It begins with a decision to give one thing your whole attention. In a world built to interrupt us, attention has become the scarcest resource we own, and reading is one of the few activities that asks for all of it at once.

Attention is not a fixed quantity. It behaves more like a muscle than a tank: it tires with overuse, recovers with rest, and grows stronger with deliberate practice. A reader who sits down for twenty undisturbed minutes trains the same capacity that later lets them work through a difficult chapter without reaching for a phone.

Consider the difference between skimming and reading. Skimming is a search for landmarks; reading is a walk through the landscape. Both are useful, but only reading builds the mental model that lets us remember, question and apply what we found.

The first step, therefore, is to remove friction. Choose a place, silence notifications, and decide in advance how long the session will last. A clear boundary turns an intention into a plan.

# Building a Mental Model

When we read, we are not storing sentences. We are building a mental model — a simplified internal picture of how the ideas in a text relate to one another. A mental model is what lets us predict, explain and connect new information to what we already know.

Good writers help us build that model. They give signposts: headings, summaries, examples and transitions that tell us where we are and where we are going. Good readers look for those signposts actively. They ask what the main claim is, what evidence supports it, and how each paragraph moves the argument forward.

For example, a reader studying a chapter on memory might sketch three boxes — encoding, storage and retrieval — and place each new idea inside one of them. The sketch is crude, but it turns a stream of sentences into a structure that can be reviewed later.

Retrieval practice strengthens the model further. Closing the book and explaining a concept in your own words reveals immediately what you understood and what you only recognised. Recognition feels like knowledge, but only retrieval proves it.

# The Reading Cycle

Effective study follows a cycle with five stages: previewing the text, reading actively, pausing to summarise, testing yourself, and reviewing after a delay. Each stage has a distinct purpose, and skipping one weakens the others.

First, previewing gives the mind a scaffold. Scanning headings, the introduction and the conclusion takes only a few minutes, yet it tells you what questions the text will answer. Then, active reading means reading with a question in mind and marking the passages that answer it. Next, pausing to summarise forces you to compress what you read into a few sentences of your own. After that, testing yourself — with flashcards or a short quiz — converts recognition into recall. Finally, reviewing after a delay of a day or a week fights the forgetting curve and moves knowledge into long-term memory.

The cycle repeats with every chapter. Over time it becomes automatic, and the reader spends less effort managing the process and more effort thinking about the ideas themselves.

# Environment and Focus

The space around us shapes the attention we bring to a page. Light, sound and posture all influence how long we can concentrate. Research on ambient sound suggests that moderate, steady background noise — rain, distant conversation, the hum of a café — can support focus for some readers, while sudden or lyrical sounds tend to pull attention away.

The key is predictability. The brain filters out sounds it can predict, and it notices sounds it cannot. This is why a steady rainfall is calming while a single notification chime is disruptive.

Rituals help as well. Brewing tea, opening the same playlist, or setting a timer signals to the mind that a focused session is beginning. Short, timed sessions followed by deliberate breaks — the Pomodoro technique is one example — keep attention fresh and make long books feel manageable.

In short, a reader cannot control every distraction, but they can design an environment where focus is the easiest path to take.
"""

DESIGN_THINKING = """# Why Design Matters

Every object we use carries a message about how it should be used. A handle invites us to pull; a flat plate invites us to push; a raised button invites us to press. Designers call these cues signifiers, and when they are clear we barely notice them. When they are wrong, we blame ourselves for mistakes that were really failures of design.

Good design is not decoration. It is the practice of making the right action obvious and the wrong action difficult. It respects the limits of human attention and memory, and it leaves room for the errors that all people inevitably make.

# Affordances and Signifiers

An affordance is a relationship between an object and a person: it describes what actions are possible. A chair affords sitting; a thin sheet of glass affords seeing through it, and unfortunately it also affords walking into it. Affordances exist whether or not anyone perceives them.

A signifier is any mark or sound that communicates where the action should take place. A sign that says "push", the shape of a handle, or the highlight on a button are all signifiers. Designers must make affordances discoverable, and signifiers are the tool they use to do it.

Problems arise when the two disagree. A door with a pull handle that must be pushed sends a false signal. People pull, fail, and feel foolish — yet the failure belongs to the designer, not the user.

# Feedback and Mapping

Feedback tells people what happened after they acted. A button that clicks, a light that turns on, or a progress bar that moves all confirm that the system heard us. Without feedback, people repeat actions, press buttons harder, or give up entirely.

Mapping is the relationship between controls and their effects. A good mapping uses spatial layout so that the control's position matches the result: the stove knob on the left controls the burner on the left. Poor mapping forces people to memorise arbitrary rules, which increases errors.

Constraints complete the picture. Physical, cultural and logical constraints limit the possible actions so that the correct one is the most natural choice. A plug that fits only one way is a constraint that prevents a whole class of mistakes.

# Designing for Error

People make two broad kinds of errors. Slips occur when we intend the right action but perform the wrong one, such as pressing the key next to the one we meant. Mistakes occur when the goal or plan itself is wrong, often because our mental model of the system is inaccurate.

Designers should assume errors will happen and plan for recovery. Undo commands, confirmation for destructive actions, and clear error messages turn failures into learning moments rather than disasters. The goal is not to eliminate human error but to make it cheap.

Therefore, the best products are forgiving. They explain what went wrong in plain language, offer a way back, and never make the user feel stupid for a problem the design created.
"""

AMBIENT_PAPER = """Abstract

This paper reviews how ambient sound influences reading comprehension and sustained attention. We synthesise findings on steady background noise, music with and without lyrics, and nature soundscapes. Evidence suggests that moderate, predictable sound can support focus for some readers, whereas speech-like or lyrical audio reliably impairs comprehension of complex text. We discuss implications for the design of digital reading environments.

Introduction

Digital reading increasingly happens in noisy, shared spaces and on devices that also deliver entertainment. Many readers deliberately add sound — rain recordings, lo-fi playlists or white noise — to create a sense of privacy and focus. Yet the cognitive effects of these choices are not well understood by the people making them.

The central question of this review is whether ambient sound helps or hinders reading, and under which conditions. We focus on comprehension of expository text, because it places the heaviest demand on working memory.

Methodology

We conducted a narrative literature review of studies published over the last two decades on background sound and reading. Studies were included if they measured reading comprehension or sustained attention under at least two sound conditions. We coded each study for the sound type, its intensity, the reading task and the outcome measure, and compared findings across these dimensions.

Results

Three consistent patterns emerged. First, intelligible speech is the most disruptive sound condition, because it competes for the same verbal processing resources that reading requires. Second, music with lyrics produces smaller but reliable decrements, especially for difficult passages. Third, steady non-verbal sound such as rain or broadband noise has little negative effect and, for readers who report high distractibility, may modestly improve sustained attention.

Individual differences matter. Readers with lower working-memory capacity were more affected by all sound conditions, which suggests that a single "best" soundscape does not exist.

Discussion

These findings support reading tools that offer controllable, non-verbal ambient soundscapes rather than lyrical music by default. Personal control is important: readers should be able to adjust volume, mute sound instantly and choose among several predictable textures. Interfaces should also avoid notification sounds during focus sessions, since unpredictable sounds capture attention involuntarily.

Conclusion

Ambient sound is neither universally helpful nor universally harmful. Predictable, non-verbal sound at moderate volume is a reasonable default for focused reading, while speech and lyrics should be avoided for demanding text. Future work should examine long-term effects and adaptive systems that adjust sound to the reader's state.
"""


_seed_lock = threading.Lock()  # startup seeding and /auth/demo must not both create the account


def seed_demo(db: Session) -> None:
    with _seed_lock:
        _seed_demo(db)


def _seed_demo(db: Session) -> None:
    if db.scalar(select(User).where(User.email == DEMO_EMAIL)):
        return
    log.info("Seeding demo account %s", DEMO_EMAIL)
    user = User(email=DEMO_EMAIL, name="Praveen", password_hash=hash_password(DEMO_PASSWORD), preferences={})
    db.add(user)
    db.commit()

    reading = ingest.create_from_text(db, user.id, "The Art of Focused Reading", "ReadVibe Editorial", FOCUSED_READING, "BOOK", ["Learning", "Focus"])
    design = ingest.create_from_text(db, user.id, "Everyday Design Principles", "ReadVibe Editorial", DESIGN_THINKING, "BOOK", ["Design", "UX"])
    paper = ingest.create_from_text(db, user.id, "Ambient Sound and Reading Comprehension: A Review", "ReadVibe Research", AMBIENT_PAPER, "PAPER", ["Research", "Cognition"])
    reading.color, design.color, paper.color = "coral", "blue", "lavender"

    now = utcnow()
    reading.progress, reading.current_chapter, reading.last_opened_at, reading.offline = 58.0, 2, now - timedelta(hours=2), True
    design.progress, design.current_chapter, design.last_opened_at, design.favorite = 31.0, 1, now - timedelta(days=1), True
    paper.progress, paper.current_chapter, paper.last_opened_at = 12.0, 0, now - timedelta(days=3)

    db.add_all([
        Highlight(owner_id=user.id, document_id=reading.id, chapter_index=1, category="Definition",
                  text="a simplified internal picture of how the ideas in a text relate to one another"),
        Highlight(owner_id=user.id, document_id=reading.id, chapter_index=1, category="Important",
                  text="Recognition feels like knowledge, but only retrieval proves it."),
        Highlight(owner_id=user.id, document_id=reading.id, chapter_index=2, category="Exam",
                  text="previewing the text, reading actively, pausing to summarise, testing yourself, and reviewing after a delay"),
        Highlight(owner_id=user.id, document_id=design.id, chapter_index=1, category="Definition",
                  text="An affordance is a relationship between an object and a person"),
    ])
    db.add_all([
        Note(owner_id=user.id, document_id=reading.id, chapter_index=1, title="Retrieval beats re-reading",
             content="Close the book and explain the idea out loud before moving on. Use the quiz tool at the end of each chapter.",
             quote="Recognition feels like knowledge, but only retrieval proves it.", category="Important", note_type="note"),
        Note(owner_id=user.id, document_id=design.id, chapter_index=1, title="Affordance vs. signifier?",
             content="Affordance = what is possible. Signifier = what tells you where/how to act. Are they always aligned? (No — the push/pull door.)",
             category="Question", note_type="note"),
        Note(owner_id=user.id, document_id=None, title="Connection between the two books",
             content="Focused reading and good design share one idea: reduce friction so the right action is the obvious one.",
             category="AI Insight", note_type="ai_insight", pinned=True),
    ])

    # Two weeks of reading history for the stats dashboard
    rng = random.Random(7)
    docs = [reading, design, paper]
    for day in range(14):
        if day in (5, 9):
            continue
        start = (now - timedelta(days=day)).replace(hour=rng.choice([8, 13, 20, 21]), minute=rng.randint(0, 59))
        db.add(ReadingSession(owner_id=user.id, document_id=rng.choice(docs).id, kind="reading",
                              mode=rng.choice(["Reader", "Reader", "Zen", "Vibe"]), seconds=rng.randint(12, 55) * 60, started_at=start))
        if day % 3 == 0:
            db.add(ReadingSession(owner_id=user.id, document_id=reading.id, kind="focus", mode="Zen", seconds=25 * 60, started_at=start))
        if day % 4 == 1:
            db.add(ReadingSession(owner_id=user.id, document_id=design.id, kind="listening", mode="Audio", seconds=rng.randint(15, 40) * 60, started_at=start))

    chapters = [(c.position, c.title, c.content) for c in reading.chapters]
    script, seconds = narration.build_script(chapters, "Regular")
    db.add(Audiobook(owner_id=user.id, document_id=reading.id, title=reading.title, tone="Regular", status="ready",
                     script=script, rate=1.0, pitch=1.0, duration_seconds=seconds, position_chapter=1))

    db.add(ResearchProject(
        owner_id=user.id, title="Ambient Sound & Focus", status="exploring",
        topic="Effects of ambient soundscapes on reading comprehension and sustained attention",
        source_document_ids=[paper.id], sections={},
    ))
    db.commit()
