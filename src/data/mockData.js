// ─── ReadVibe Mock Data Store ────────────────────────────────────────────────

export const DOCUMENTS = [
  {
    id: 1,
    title: 'The Design of Everyday Things',
    author: 'Don Norman',
    type: 'BOOK',
    format: 'PDF',
    progress: 68,
    chapter: 'Chapter 6 · The Design Challenge',
    currentPage: 184,
    totalPages: 270,
    color: 'coral',
    time: '18 min left',
    tag: 'Design',
    lastOpened: '2 hours ago',
    offline: true,
    audioGenerated: true,
    coverSymbol: '◒',
    description: 'A groundbreaking work on the design of everyday objects, exploring why some products satisfy customers while others frustrate them.',
    chapters: [
      { id: 1, title: 'The Psychopathology of Everyday Things', page: 1, duration: '34 min' },
      { id: 2, title: 'The Psychology of Everyday Actions', page: 47, duration: '41 min' },
      { id: 3, title: 'Knowledge in the Head and in the World', page: 89, duration: '38 min' },
      { id: 4, title: 'Knowing What to Do', page: 126, duration: '29 min' },
      { id: 5, title: 'To Err Is Human', page: 162, duration: '32 min' },
      { id: 6, title: 'The Design Challenge', page: 184, duration: '44 min' },
      { id: 7, title: 'User-Centered Design', page: 234, duration: '27 min' },
    ],
    highlights: [
      { id: 1, text: 'make things understandable', category: 'Important', page: 184, time: '2m ago' },
      { id: 2, text: 'affordances', category: 'Definition', page: 185, time: '1m ago' },
      { id: 3, text: 'The design of a product should make its operation self-evident.', category: 'Exam', page: 186, time: '5m ago' },
    ],
  },
  {
    id: 2,
    title: 'Deep Work',
    author: 'Cal Newport',
    type: 'BOOK',
    format: 'EPUB',
    progress: 42,
    chapter: 'Chapter 3 · Quit Social Media',
    currentPage: 134,
    totalPages: 320,
    color: 'blue',
    time: '42 min left',
    tag: 'Productivity',
    lastOpened: '1 day ago',
    offline: true,
    audioGenerated: false,
    coverSymbol: '◐',
    description: 'Rules for focused success in a distracted world. Newport argues that the ability to perform deep work is becoming increasingly valuable.',
    chapters: [
      { id: 1, title: 'Deep Work Is Valuable', page: 1, duration: '28 min' },
      { id: 2, title: 'Deep Work Is Rare', page: 68, duration: '33 min' },
      { id: 3, title: 'Quit Social Media', page: 134, duration: '41 min' },
      { id: 4, title: 'Drain the Shallows', page: 201, duration: '37 min' },
    ],
    highlights: [],
  },
  {
    id: 3,
    title: 'Human–Computer Interaction',
    author: 'Research Paper',
    type: 'PAPER',
    format: 'PDF',
    progress: 12,
    chapter: 'Abstract · Introduction',
    currentPage: 4,
    totalPages: 34,
    color: 'lavender',
    time: '1 hr left',
    tag: 'Research',
    lastOpened: '3 days ago',
    offline: false,
    audioGenerated: false,
    coverSymbol: '⌁',
    description: 'A comprehensive survey of human-computer interaction paradigms and the evolving role of AI in mediating the user experience.',
    chapters: [
      { id: 1, title: 'Abstract', page: 1, duration: '3 min' },
      { id: 2, title: 'Introduction', page: 2, duration: '8 min' },
      { id: 3, title: 'Related Work', page: 8, duration: '12 min' },
      { id: 4, title: 'Methodology', page: 16, duration: '10 min' },
      { id: 5, title: 'Results', page: 22, duration: '9 min' },
      { id: 6, title: 'Discussion', page: 28, duration: '7 min' },
    ],
    highlights: [],
  },
  {
    id: 4,
    title: 'The Creative Act',
    author: 'Rick Rubin',
    type: 'BOOK',
    format: 'PDF',
    progress: 86,
    chapter: 'Chapter 9 · The Vessel',
    currentPage: 242,
    totalPages: 282,
    color: 'amber',
    time: '9 min left',
    tag: 'Creativity',
    lastOpened: '4 hours ago',
    offline: true,
    audioGenerated: true,
    coverSymbol: '◑',
    description: 'A timeless and generous primer on the creative process and what it means to be an artist in the broadest sense.',
    chapters: [
      { id: 1, title: 'The Source', page: 1, duration: '15 min' },
      { id: 2, title: 'Awareness', page: 22, duration: '18 min' },
      { id: 3, title: 'The Vessel & The Filter', page: 242, duration: '22 min' },
    ],
    highlights: [],
  },
];

export const AUDIOBOOKS = [
  { id: 1, docId: 1, title: 'The Design of Everyday Things', tone: 'Regular', duration: '6h 22m', progress: 45, status: 'ready' },
  { id: 2, docId: 4, title: 'The Creative Act', tone: 'Humor', duration: '4h 11m', progress: 0, status: 'ready' },
];

export const RESEARCH_PROJECTS = [
  {
    id: 1,
    title: 'AI in Education: A Literature Review',
    topic: 'Artificial intelligence applications in modern education systems',
    sources: 7,
    progress: 72,
    lastUpdated: '2h ago',
    status: 'drafting',
    sections: {
      abstract: { content: 'This review examines the integration of artificial intelligence in contemporary educational frameworks...', status: 'draft' },
      introduction: { content: 'Artificial intelligence has emerged as a transformative force across numerous domains...', status: 'draft' },
      literatureReview: { content: 'Previous studies have demonstrated the potential of AI-powered tutoring systems...', status: 'draft' },
      methodology: { content: '', status: 'empty' },
      results: { content: '', status: 'empty' },
      conclusion: { content: '', status: 'empty' },
    }
  },
  {
    id: 2,
    title: 'Ambient Sound & Focus',
    topic: 'Effects of ambient soundscapes on reading comprehension and cognitive performance',
    sources: 3,
    progress: 28,
    lastUpdated: '1 day ago',
    status: 'exploring',
    sections: {
      abstract: { content: '', status: 'empty' },
      introduction: { content: 'Research on environmental factors affecting cognitive performance...', status: 'draft' },
      literatureReview: { content: '', status: 'empty' },
      methodology: { content: '', status: 'empty' },
      results: { content: '', status: 'empty' },
      conclusion: { content: '', status: 'empty' },
    }
  },
];

export const NOTES = [
  {
    id: 1,
    docId: 1,
    docTitle: 'The Design of Everyday Things',
    category: 'Important',
    title: 'Make things understandable',
    content: '"The challenge of design is to make things understandable. The designer must create a bridge between the user and the technology."',
    page: 184,
    chapter: 'Chapter 4',
    type: 'highlight',
    createdAt: 'Today, 2:15 PM',
    aiExplanation: null,
  },
  {
    id: 2,
    docId: 1,
    docTitle: 'The Design of Everyday Things',
    category: 'Definition',
    title: 'Affordances',
    content: 'The perceived and actual properties of an object that determine how it can be used.',
    page: 185,
    chapter: 'Chapter 4',
    type: 'highlight',
    createdAt: 'Today, 2:18 PM',
    aiExplanation: 'An affordance is a relationship between an object and its user — a door handle affords pulling, a button affords pressing. Gibson coined the term; Norman popularized it in design.',
  },
  {
    id: 3,
    docId: 2,
    docTitle: 'Deep Work',
    category: 'AI Insight',
    title: 'A useful connection',
    content: 'Deep work requires reducing ambiguity. Good design does the same: it makes the next action obvious.',
    page: null,
    chapter: null,
    type: 'ai_insight',
    createdAt: 'Today, 3:00 PM',
    aiExplanation: null,
  },
  {
    id: 4,
    docId: 1,
    docTitle: 'The Design of Everyday Things',
    category: 'Question',
    title: 'How do signifiers differ from affordances?',
    content: 'Norman distinguishes between affordances (what an object can do) and signifiers (what communicates those affordances). Are these always aligned?',
    page: 190,
    chapter: 'Chapter 4',
    type: 'note',
    createdAt: 'Yesterday',
    aiExplanation: null,
  },
];

export const READING_CONTENT = `
The challenge of design is to make things understandable. The designer must create a bridge between the user and the technology, a bridge that feels natural, almost invisible. Good design is not about adding more features; it is about making the right actions obvious.

When we encounter a new object, we form a mental model of how it works. We look for clues in its shape, its controls, and its relationship to the things around it. These clues are called affordances—the perceived and actual properties of an object that determine how it can be used.

"The design of a product should make its operation self-evident."

The best products teach us how to use them without requiring a manual. They respect our attention and make room for mistakes. A good reader, much like a good designer, notices the small details: the rhythm, the pause, the moment when something clicks.

Consider the humble door. When a door has a flat panel, we push. When it has a handle, we pull. But what happens when the designer puts a handle on a push door? We pull, fail, feel foolish, and blame ourselves. Yet it is not our fault. The design failed us.

Norman calls this the "Norman door" — a door whose design communicates the wrong action. This failure of signification creates frustration, wasted effort, and a subtle erosion of trust in ourselves and the world around us.

Design is not neutral. Every choice the designer makes — the shape of a button, the placement of a label, the color of a warning — communicates meaning. The question is whether that meaning aligns with the user's expectations.

The seven stages of action describe the cycle a person goes through when interacting with the world: forming a goal, planning an action sequence, executing the action, perceiving the result, interpreting that result, evaluating it against the goal, and either continuing or revising. Design failures tend to occur at the gap between what the system does and what the person expects.
`;

export const VIBE_PRESETS = [
  { id: 'chill', name: 'Chill', emoji: '🌿', gradient: 'linear-gradient(135deg, #2d4a3e, #1a2f28)', textColor: '#b8d4c5' },
  { id: 'study', name: 'Study', emoji: '📚', gradient: 'linear-gradient(135deg, #2a2f4a, #151827)', textColor: '#b4bde8' },
  { id: 'rainy', name: 'Rainy', emoji: '🌧', gradient: 'linear-gradient(135deg, #2a3544, #151c22)', textColor: '#a8bfd4' },
  { id: 'cinematic', name: 'Cinematic', emoji: '🎬', gradient: 'linear-gradient(135deg, #3d2a1e, #1e1510)', textColor: '#d4b89a' },
  { id: 'midnight', name: 'Midnight', emoji: '🌙', gradient: 'linear-gradient(135deg, #1a1530, #0d0b18)', textColor: '#c4b4e8' },
  { id: 'dreamy', name: 'Dreamy', emoji: '✨', gradient: 'linear-gradient(135deg, #3a2a4a, #1e1530)', textColor: '#daaee8' },
  { id: 'energetic', name: 'Energetic', emoji: '⚡', gradient: 'linear-gradient(135deg, #4a2a1a, #2a150d)', textColor: '#e8bb88' },
  { id: 'lofi', name: 'Lo-Fi Focus', emoji: '🎵', gradient: 'linear-gradient(135deg, #2a3040, #141820)', textColor: '#b0c0d8' },
];

export const ZEN_PRESETS = [
  { id: 'rainy_library', name: 'Rainy Library', emoji: '🌧', sound: 'rain', gradient: 'radial-gradient(circle at 60% 20%, #1a2030, #0d1218 60%, #0a0e12)' },
  { id: 'deep_forest', name: 'Deep Forest', emoji: '🌲', sound: 'forest', gradient: 'radial-gradient(circle at 40% 30%, #0d2218, #081510 60%, #050e09)' },
  { id: 'night_study', name: 'Night Study', emoji: '🌙', sound: 'binaural', gradient: 'radial-gradient(circle at 50% 10%, #151020, #0a0810 60%, #060408)' },
  { id: 'minimal_white', name: 'Minimal White', emoji: '◻', sound: 'none', gradient: 'linear-gradient(135deg, #f8f6f2, #efe9e0)' },
  { id: 'ocean_focus', name: 'Ocean Focus', emoji: '🌊', sound: 'ocean', gradient: 'radial-gradient(circle at 70% 40%, #0a1e30, #050e18 60%, #030810)' },
  { id: 'coffeehouse', name: 'Quiet Coffeehouse', emoji: '☕', sound: 'cafe', gradient: 'radial-gradient(circle at 30% 60%, #2a1a10, #160d08 60%, #0e0805)' },
];

export const MOCK_REFERENCES = [
  { id: 1, title: 'Understanding reading environments and cognitive load in digital contexts', authors: ['Smith, J.', 'Chen, R.', 'Patel, S.'], year: 2024, relevance: 0.94, citations: 142, provider: 'Semantic Scholar', openAccess: true, included: true },
  { id: 2, title: 'Ambient sound, focus, and comprehension: A systematic review', authors: ['A. Researcher', 'B. Scholar'], year: 2023, relevance: 0.88, citations: 87, provider: 'Crossref', openAccess: true, included: true },
  { id: 3, title: 'AI-mediated tutoring systems and learning outcomes', authors: ['Martinez, L.', 'Kim, Y.'], year: 2024, relevance: 0.82, citations: 65, provider: 'Semantic Scholar', openAccess: false, included: false },
  { id: 4, title: 'Personalized reading experiences: An adaptive systems perspective', authors: ['Thompson, C.'], year: 2022, relevance: 0.79, citations: 211, provider: 'Crossref', openAccess: true, included: true },
  { id: 5, title: 'Text-to-speech synthesis and auditory learning outcomes', authors: ['Brown, K.', 'Davis, M.'], year: 2023, relevance: 0.74, citations: 39, provider: 'Semantic Scholar', openAccess: true, included: false },
];

export const AI_SUGGESTIONS = [
  { id: 1, text: 'Continue from page 184', action: 'read', icon: '📖' },
  { id: 2, text: 'Generate a 2-minute summary', action: 'summarize', icon: '✨' },
  { id: 3, text: 'Listen to Chapter 6', action: 'audio', icon: '🎧' },
  { id: 4, text: 'Create a mind map from your 7 highlights', action: 'mindmap', icon: '🗺️' },
  { id: 5, text: 'Quiz me on The Design Challenge', action: 'quiz', icon: '🧠' },
];

export const READING_STATS = {
  weeklyMinutes: [38, 52, 44, 74, 62, 88, 48],
  streak: 4,
  totalBooksRead: 12,
  totalAudioHours: 24,
  focusSessions: 31,
  currentWeekTotal: 406,
};
