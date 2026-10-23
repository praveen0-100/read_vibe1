"""Languages ReadVibe can read, narrate and summarise — Indian languages first, Southern languages at the very top.

`detect()` identifies a text's language from its Unicode script (Tamil, Telugu, Malayalam, Kannada, Devanagari …), so a
document in Tamil is read by a Tamil voice without the user choosing anything.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Language:
    code: str
    name: str            # English name
    native: str          # name written in its own script
    region: str          # south | india | world
    script: tuple[tuple[int, int], ...]
    voices: tuple[tuple[str, str, str], ...] = ()  # (voice id, display name, gender): [0] and [1] host the two-voice overview
    sample: str = ""     # one friendly sentence in the language, used to preview a voice
    markers: tuple[str, ...] = field(default=())  # common function words, to tell scripts shared by several languages apart


# Order here IS the priority order shown everywhere in the product.
LANGUAGES: tuple[Language, ...] = (
    Language("ta", "Tamil", "தமிழ்", "south", ((0x0B80, 0x0BFF),),
             (("edge:ta-IN-PallaviNeural", "Pallavi", "Female"), ("edge:ta-IN-ValluvarNeural", "Valluvar", "Male")),
             "வணக்கம்! ரீட்வைப் உங்களுக்காக இந்த நூலை இனிமையாகப் படித்துக் காட்டும்."),
    Language("te", "Telugu", "తెలుగు", "south", ((0x0C00, 0x0C7F),),
             (("edge:te-IN-ShrutiNeural", "Shruti", "Female"), ("edge:te-IN-MohanNeural", "Mohan", "Male")),
             "నమస్కారం! రీడ్‌వైబ్ ఈ పుస్తకాన్ని మీకోసం ఆహ్లాదంగా చదివి వినిపిస్తుంది."),
    Language("ml", "Malayalam", "മലയാളം", "south", ((0x0D00, 0x0D7F),),
             (("edge:ml-IN-SobhanaNeural", "Sobhana", "Female"), ("edge:ml-IN-MidhunNeural", "Midhun", "Male")),
             "നമസ്കാരം! റീഡ്‌വൈബ് ഈ പുസ്തകം നിങ്ങൾക്കായി മനോഹരമായി വായിച്ചുകേൾപ്പിക്കും."),
    Language("kn", "Kannada", "ಕನ್ನಡ", "south", ((0x0C80, 0x0CFF),),
             (("edge:kn-IN-SapnaNeural", "Sapna", "Female"), ("edge:kn-IN-GaganNeural", "Gagan", "Male")),
             "ನಮಸ್ಕಾರ! ರೀಡ್‌ವೈಬ್ ಈ ಪುಸ್ತಕವನ್ನು ನಿಮಗಾಗಿ ಸುಂದರವಾಗಿ ಓದಿ ಹೇಳುತ್ತದೆ."),
    Language("hi", "Hindi", "हिन्दी", "india", ((0x0900, 0x097F),),
             (("edge:hi-IN-SwaraNeural", "Swara", "Female"), ("edge:hi-IN-MadhurNeural", "Madhur", "Male")),
             "नमस्ते! रीडवाइब यह किताब आपके लिए सुंदर ढंग से पढ़कर सुनाएगा।",
             ("है", "और", "में", "का", "को", "से", "नहीं", "यह", "था")),
    Language("mr", "Marathi", "मराठी", "india", ((0x0900, 0x097F),),
             (("edge:mr-IN-AarohiNeural", "Aarohi", "Female"), ("edge:mr-IN-ManoharNeural", "Manohar", "Male")),
             "नमस्कार! रीडवाइब हे पुस्तक तुमच्यासाठी सुंदर पद्धतीने वाचून दाखवेल.",
             ("आहे", "आणि", "होते", "नाही", "हे", "मध्ये", "की", "त्या", "आहेत")),
    Language("bn", "Bengali", "বাংলা", "india", ((0x0980, 0x09FF),),
             (("edge:bn-IN-TanishaaNeural", "Tanishaa", "Female"), ("edge:bn-IN-BashkarNeural", "Bashkar", "Male")),
             "নমস্কার! রিডভাইব আপনার জন্য এই বইটি সুন্দরভাবে পড়ে শোনাবে।"),
    Language("gu", "Gujarati", "ગુજરાતી", "india", ((0x0A80, 0x0AFF),),
             (("edge:gu-IN-DhwaniNeural", "Dhwani", "Female"), ("edge:gu-IN-NiranjanNeural", "Niranjan", "Male")),
             "નમસ્તે! રીડવાઇબ તમારા માટે આ પુસ્તક સુંદર રીતે વાંચી સંભળાવશે."),
    Language("pa", "Punjabi", "ਪੰਜਾਬੀ", "india", ((0x0A00, 0x0A7F),)),   # no neural voice yet: text support only
    Language("or", "Odia", "ଓଡ଼ିଆ", "india", ((0x0B00, 0x0B7F),)),        # no neural voice yet: text support only
    Language("ur", "Urdu", "اردو", "india", ((0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)),
             (("edge:ur-IN-GulNeural", "Gul", "Female"), ("edge:ur-IN-SalmanNeural", "Salman", "Male")),
             "السلام علیکم! ریڈوائب آپ کے لیے یہ کتاب خوبصورتی سے پڑھ کر سنائے گا۔"),
    Language("en", "English", "English", "world", ((0x0041, 0x024F),),
             (("edge:en-IN-NeerjaNeural", "Neerja", "Female"), ("edge:en-IN-PrabhatNeural", "Prabhat", "Male")),
             "Hello! ReadVibe will read this book to you, beautifully."),
)

BY_CODE = {lang.code: lang for lang in LANGUAGES}
SOUTHERN = tuple(lang.code for lang in LANGUAGES if lang.region == "south")


def get(code: str | None) -> Language:
    return BY_CODE.get((code or "en").lower(), BY_CODE["en"])


def _script_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        if cp < 0x0250 and not ch.isalpha():
            continue
        for lang in LANGUAGES:
            if any(lo <= cp <= hi for lo, hi in lang.script):
                counts[lang.code] = counts.get(lang.code, 0) + 1
                break
    return counts


def detect(text: str, sample: int = 6000) -> str:
    """Language code of `text` by script share. Latin script (or too little text) means English."""
    text = (text or "")[:sample]
    counts = _script_counts(text)
    letters = sum(counts.values())
    if not letters:
        return "en"
    code, n = max(counts.items(), key=lambda kv: kv[1])
    if code == "en" or n / letters < 0.2:
        return "en"
    if code in ("hi", "mr"):  # Devanagari is shared: decide by common function words
        words = re.findall(r"[ऀ-ॿ]+", text)
        hi = sum(w in BY_CODE["hi"].markers for w in words)
        mr = sum(w in BY_CODE["mr"].markers for w in words)
        return "mr" if mr > hi else "hi"
    return code


def catalogue() -> list[dict]:
    """What the UI needs to build its language pickers, already in priority order."""
    return [
        {
            "code": lang.code, "name": lang.name, "native": lang.native, "region": lang.region, "sample": lang.sample,
            "voices": [{"id": vid, "name": name, "gender": gender} for vid, name, gender in lang.voices],
            "has_voice": bool(lang.voices),
        }
        for lang in LANGUAGES
    ]
