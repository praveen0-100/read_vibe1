// ─── ReadVibe App State Context ───────────────────────────────────────────────
import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { DOCUMENTS, NOTES, RESEARCH_PROJECTS, AUDIOBOOKS } from '../data/mockData';

const AppCtx = createContext(null);

const initialState = {
  // Theme & UI
  theme: 'dark',
  sidebar: 'expanded', // 'expanded' | 'collapsed'
  toast: null,

  // Navigation
  page: 'home', // 'home' | 'library' | 'reader' | 'audio' | 'research' | 'notes' | 'settings'
  subPage: null,

  // Reader
  activeDoc: DOCUMENTS[0],
  readerMode: 'Reader', // 'Reader' | 'Zen' | 'Vibe'
  readingSettings: {
    font: 'Playfair Display',
    fontSize: 17,
    lineHeight: 1.8,
    margins: 'comfortable',
    theme: 'sepia',
  },

  // Zen Mode
  zenPreset: 'rainy_library',
  zenSound: 'rain',
  zenVolume: 60,
  zenFocusTimer: null,

  // Vibe Mode
  vibePreset: 'chill',
  vibeVolume: 50,
  vibeTextContrast: 80,

  // AI Panel
  aiOpen: false,
  aiTab: 'tools', // 'tools' | 'chat'
  aiLoading: false,
  aiResult: null,
  chatHistory: [],

  // Library
  libraryTab: 'all',
  librarySearch: '',
  librarySort: 'recent',

  // Audio
  audioJob: null,
  audioTone: 'Regular',
  audioPlaying: false,
  audioProgress: 0,
  audioSpeed: 1.0,

  // Research
  activeProject: null,
  researchStep: 'home', // 'home' | 'discover' | 'sources' | 'draft' | 'citations'

  // Data
  documents: DOCUMENTS,
  notes: NOTES,
  researchProjects: RESEARCH_PROJECTS,
  audiobooks: AUDIOBOOKS,

  // Upload
  uploadOpen: false,
  uploadProgress: null,

  // Quiz
  quizActive: false,
  quizQuestions: [],
  quizAnswers: {},

  // Search
  searchOpen: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'TOGGLE_SIDEBAR': return { ...state, sidebar: state.sidebar === 'expanded' ? 'collapsed' : 'expanded' };
    case 'SET_PAGE': return { ...state, page: action.payload, subPage: null };
    case 'SET_SUB_PAGE': return { ...state, subPage: action.payload };
    case 'OPEN_DOC': return { ...state, activeDoc: action.payload, page: 'reader' };
    case 'SET_READER_MODE': return { ...state, readerMode: action.payload };
    case 'SET_READING_SETTINGS': return { ...state, readingSettings: { ...state.readingSettings, ...action.payload } };
    case 'SET_ZEN_PRESET': return { ...state, zenPreset: action.payload.id, zenSound: action.payload.sound };
    case 'SET_ZEN_VOLUME': return { ...state, zenVolume: action.payload };
    case 'SET_VIBE_PRESET': return { ...state, vibePreset: action.payload };
    case 'SET_VIBE_VOLUME': return { ...state, vibeVolume: action.payload };
    case 'SET_AI_OPEN': return { ...state, aiOpen: action.payload };
    case 'SET_AI_TAB': return { ...state, aiTab: action.payload };
    case 'SET_AI_LOADING': return { ...state, aiLoading: action.payload };
    case 'SET_AI_RESULT': return { ...state, aiResult: action.payload, aiLoading: false };
    case 'ADD_CHAT_MSG': return { ...state, chatHistory: [...state.chatHistory, action.payload] };
    case 'CLEAR_CHAT': return { ...state, chatHistory: [] };
    case 'SET_LIBRARY_TAB': return { ...state, libraryTab: action.payload };
    case 'SET_LIBRARY_SEARCH': return { ...state, librarySearch: action.payload };
    case 'SET_AUDIO_TONE': return { ...state, audioTone: action.payload };
    case 'SET_AUDIO_JOB': return { ...state, audioJob: action.payload };
    case 'SET_AUDIO_PLAYING': return { ...state, audioPlaying: action.payload };
    case 'SET_AUDIO_SPEED': return { ...state, audioSpeed: action.payload };
    case 'SET_AUDIO_PROGRESS': return { ...state, audioProgress: action.payload };
    case 'SET_ACTIVE_PROJECT': return { ...state, activeProject: action.payload };
    case 'SET_RESEARCH_STEP': return { ...state, researchStep: action.payload };
    case 'SET_UPLOAD_OPEN': return { ...state, uploadOpen: action.payload };
    case 'SET_SEARCH_OPEN': return { ...state, searchOpen: action.payload };
    case 'SET_QUIZ': return { ...state, quizActive: true, quizQuestions: action.payload, quizAnswers: {} };
    case 'SET_QUIZ_ANSWER': return { ...state, quizAnswers: { ...state.quizAnswers, [action.payload.id]: action.payload.answer } };
    case 'CLOSE_QUIZ': return { ...state, quizActive: false };
    case 'ADD_NOTE': return { ...state, notes: [action.payload, ...state.notes] };
    case 'ADD_DOCUMENT': return { ...state, documents: [action.payload, ...state.documents] };
    case 'SHOW_TOAST': return { ...state, toast: action.payload };
    case 'CLEAR_TOAST': return { ...state, toast: null };
    case 'UPDATE_DOC_PROGRESS': return {
      ...state,
      documents: state.documents.map(d => d.id === action.payload.id ? { ...d, progress: action.payload.progress } : d),
    };
    default: return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const notify = useCallback((msg, type = 'success') => {
    dispatch({ type: 'SHOW_TOAST', payload: { msg, type } });
    setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 2800);
  }, []);

  const openDoc = useCallback((doc) => {
    dispatch({ type: 'OPEN_DOC', payload: doc });
  }, []);

  const setPage = useCallback((page) => {
    dispatch({ type: 'SET_PAGE', payload: page });
  }, []);

  return (
    <AppCtx.Provider value={{ state, dispatch, notify, openDoc, setPage }}>
      {children}
    </AppCtx.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
