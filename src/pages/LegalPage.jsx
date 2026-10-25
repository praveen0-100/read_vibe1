// ─── Privacy policy & terms of service (public, no sign-in needed) ────────────
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const CONTACT = 'praveen824815@gmail.com';
const UPDATED = '23 October 2026';

const PRIVACY = [
  ['Who we are', <>ReadVibe (“we”, “the app”) is an AI-assisted reading, audiobook and research app available at readvibecodex.vercel.app. Questions about this policy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</>],
  ['What we collect', <>
    <ul>
      <li><strong>Account details</strong> — your name and email address, and a password hash if you register with a password (we never store the password itself).</li>
      <li><strong>Google sign-in</strong> — if you choose “Continue with Google” we receive your Google account’s name, email address, profile picture and a unique Google account ID. We use Google sign-in only to identify you; we do not access your Gmail, Drive, contacts or any other Google data.</li>
      <li><strong>Your content</strong> — documents you upload or paste, plus your highlights, notes, bookmarks, reading progress, audiobooks, research projects and app preferences.</li>
      <li><strong>Basic technical data</strong> — standard server logs (IP address, request time, request path) used for security and troubleshooting.</li>
    </ul></>],
  ['How we use it', 'To run the app: sign you in, store and show your library, generate summaries, translations and narration you ask for, and keep the service secure. We do not sell your data, show ads, or use your documents to train AI models.'],
  ['Services that process your content', <>
    When you use a feature, the relevant text may be sent to a processor that performs it:
    <ul>
      <li><strong>Read-aloud / audiobooks</strong> — text is sent to a text-to-speech service (Microsoft neural voices, or OpenAI speech if enabled) to produce audio.</li>
      <li><strong>Translation and Audio Overview</strong> — sentences may be sent to the MyMemory or Google Translate services, and, for AI answers, summaries and translation, to free public AI services (Pollinations, LLM7) or to an AI provider the server operator configures.</li>
      <li><strong>Hosting</strong> — the app is served by Vercel and its API runs on Render.</li>
    </ul>
    Each processor handles data under its own terms and privacy policy.</>],
  ['Cookies and local storage', 'We use your browser’s local storage to keep you signed in and remember preferences (theme, reading settings). We do not use advertising or tracking cookies. Google’s sign-in button may set its own cookies when you use it.'],
  ['Retention, export and deletion', 'We keep your data until you delete it. In Settings you can download everything we store about you and permanently delete your account, which removes your profile, documents, notes and uploaded files from our servers. Backups and logs may persist briefly after deletion.'],
  ['Security', 'Traffic is encrypted with HTTPS, passwords are hashed, and access is limited by signed session tokens. No system is perfectly secure, so please use a strong, unique password.'],
  ['Children', 'ReadVibe is not directed at children under 13, and we do not knowingly collect their data.'],
  ['Changes', 'If we change this policy we will update the date above. Continued use after a change means you accept it.'],
  ['Contact', <>Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> for any privacy request.</>],
];

const TERMS = [
  ['Acceptance', 'By creating an account or using ReadVibe you agree to these terms. If you do not agree, please do not use the app.'],
  ['Your account', 'You are responsible for your account and for keeping your password secure. Provide accurate information and tell us if you suspect unauthorised access.'],
  ['Your content', 'You keep ownership of everything you upload. You give us permission only to store and process it to provide the features you use. Upload only material you have the right to use — do not upload content that infringes copyright or others’ rights, or that is unlawful.'],
  ['Acceptable use', 'Do not misuse the service: no attempts to break or overload it, access other users’ data, send malware, or use it to harass others or break the law. We may suspend accounts that do.'],
  ['AI and generated content', 'Summaries, translations, narration and other generated output may contain mistakes. Check anything important against the original source; do not rely on it for legal, medical or financial decisions.'],
  ['Availability', 'ReadVibe is provided free and “as is”. It may be slow, interrupted or change at any time, and data may be lost — please keep your own copies of important documents.'],
  ['Liability', 'To the extent permitted by law, we are not liable for indirect or consequential loss, or loss of data, arising from your use of the app.'],
  ['Ending your use', 'You can delete your account at any time in Settings. We may suspend or remove access if these terms are broken.'],
  ['Changes', 'We may update these terms; the date above shows the latest version. Continued use means you accept the changes.'],
  ['Contact', <>Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</>],
];

export default function LegalPage({ kind }) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? PRIVACY : TERMS;
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';
  useEffect(() => { document.title = `${title} — ReadVibe`; }, [title]);
  return (
    <div className="legal-page">
      <article className="legal-card">
        <Link to="/login" className="legal-back"><ArrowLeft size={14} /> Back to ReadVibe</Link>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            {typeof body === 'string' ? <p>{body}</p> : <div>{body}</div>}
          </section>
        ))}
        <p className="legal-other">{isPrivacy ? <Link to="/terms">Terms of Service</Link> : <Link to="/privacy">Privacy Policy</Link>}</p>
      </article>
    </div>
  );
}
