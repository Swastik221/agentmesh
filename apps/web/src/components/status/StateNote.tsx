import { AlertTriangle, Inbox } from 'lucide-react';

export type StateNoteTone = 'empty' | 'error' | 'loading';

export interface StateNoteProps {
  tone: StateNoteTone;
  text: string;
}

/** Small consistent empty / error / loading states for real data views. */
export function StateNote({ tone, text }: StateNoteProps) {
  return (
    <div className={`state-note state-note--${tone}`} role="status">
      {tone === 'error' ? <AlertTriangle size={14} /> : tone === 'empty' ? <Inbox size={14} /> : null}
      {text}
    </div>
  );
}