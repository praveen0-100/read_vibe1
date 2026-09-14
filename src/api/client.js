// ─── ReadVibe API Client ─────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  } catch (err) {
    console.warn('[ReadVibe API] Falling back to mock:', err.message);
    return null;
  }
}

// ─── Document APIs ───────────────────────────────────────────────────────────

export const api = {
  health: () => request('/health'),

  documents: {
    list: () => request('/documents'),
    upload: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request('/documents', { method: 'POST', body: fd, headers: {} });
    },
  },

  ai: {
    summarize: (documentId, depth = 'standard') =>
      request('/ai/summarize', { method: 'POST', body: JSON.stringify({ document_id: documentId, depth }) }),

    explain: (text, mode = 'simple') =>
      request('/ai/explain', { method: 'POST', body: JSON.stringify({ text, mode }) }),

    chat: (documentId, question) =>
      request('/ai/chat', { method: 'POST', body: JSON.stringify({ document_id: documentId, question }) }),

    diagram: (text, type = 'flowchart') =>
      request('/ai/diagram', { method: 'POST', body: JSON.stringify({ text, type }) }),

    quiz: (documentId, chapterId) =>
      request('/ai/quiz', { method: 'POST', body: JSON.stringify({ document_id: documentId, chapter_id: chapterId }) }),
  },

  audio: {
    generate: (documentId, tone, settings = {}) =>
      request('/audio/jobs', { method: 'POST', body: JSON.stringify({ document_id: documentId, tone, ...settings }) }),
    status: (jobId) => request(`/audio/jobs/${jobId}`),
  },

  research: {
    discover: (topic, sources = []) =>
      request('/research/discover', { method: 'POST', body: JSON.stringify({ topic, sources }) }),
    draft: (projectId, section) =>
      request('/research/draft', { method: 'POST', body: JSON.stringify({ project_id: projectId, section }) }),
  },
};

// ─── Mock AI Responses (when backend is unavailable) ─────────────────────────

export const MOCK_RESPONSES = {
  summarize: (depth) => ({
    depth,
    summary: {
      mainIdea: 'Good design makes the right action obvious. Designers must create invisible bridges between technology and human expectation.',
      keyPoints: [
        'People build mental models from affordances — visual clues about how objects can be used.',
        'Signifiers communicate what affordances are available to the user.',
        'Design failures happen when the system model diverges from the user\'s mental model.',
        'The seven stages of action describe how humans interact with any product or system.',
        'Error-tolerant design respects that mistakes are human, not a failure of the user.',
      ],
      concepts: ['Affordances', 'Signifiers', 'Mental Models', 'The Gulf of Execution', 'Feedback Loops'],
      takeaways: 'Make the next action clear, preserve context, respect attention, and always design room for recovery from errors.',
      suggestedQuestions: [
        'How does the Gulf of Execution manifest in software design?',
        'Can you apply the Norman door concept to a digital product you use daily?',
        'What is the relationship between affordance and feedback?',
      ],
    },
  }),

  explain: (text, mode) => {
    const explanations = {
      simple: `In simple terms: ${text} means making sure people immediately understand what to do without any instructions.`,
      student: `For a student: This concept refers to how designers communicate possible actions through an object's shape or interface. Think of it as design giving you a "hint" about what to do next.`,
      expert: `From an expert perspective: This phenomenon describes the perceptual-cognitive relationship between artifact properties and user affordance recognition — central to Gibson's ecological psychology and subsequently operationalized in Norman's action theory.`,
    };
    return { explanation: explanations[mode] || explanations.simple, mode };
  },

  chat: (question) => ({
    answer: `Based on the document's content, "${question}" is addressed through the lens of human-centered design. The author argues that the gap between how systems actually work and how users expect them to work is the root cause of most user frustration. This is a prototype response — connect your AI provider to enable real document-grounded answers.`,
    citations: [{ page: 184, label: 'Chapter 6 · The Design Challenge' }],
  }),

  quiz: () => ({
    questions: [
      {
        id: 1,
        type: 'multiple_choice',
        question: 'What is an "affordance" in the context of design?',
        options: ['A design flaw', 'A perceived action possibility', 'A type of user error', 'A physical constraint'],
        correct: 1,
      },
      {
        id: 2,
        type: 'multiple_choice',
        question: 'What does Norman call a door that signals the wrong action?',
        options: ['A bad door', 'A Norman door', 'An error-prone artifact', 'A signifier failure'],
        correct: 1,
      },
      {
        id: 3,
        type: 'short_answer',
        question: 'In your own words, describe the "Gulf of Execution."',
        hint: 'Think about the gap between what a user wants to do and how to do it using the system.',
      },
    ],
  }),

  research: (topic) => ({
    topic,
    sources: [
      { id: 1, title: 'Understanding reading environments and cognitive load in digital contexts', authors: ['Smith, J.', 'Chen, R.'], year: 2024, relevance: 0.94, citations: 142, provider: 'Semantic Scholar', openAccess: true },
      { id: 2, title: 'Ambient sound, focus, and comprehension: A systematic review', authors: ['A. Researcher', 'B. Scholar'], year: 2023, relevance: 0.88, citations: 87, provider: 'Crossref', openAccess: true },
      { id: 3, title: 'AI-mediated tutoring systems and learning outcomes', authors: ['Martinez, L.', 'Kim, Y.'], year: 2024, relevance: 0.82, citations: 65, provider: 'Semantic Scholar', openAccess: false },
    ],
  }),
};
