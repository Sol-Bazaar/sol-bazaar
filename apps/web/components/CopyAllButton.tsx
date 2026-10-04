'use client';

import { useState } from 'react';

export function CopyAllButton({ codes }: { codes: string[] }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setDone(true);
      setTimeout(() => setDone(false), 2200);
    } catch {
      /* clipboard unavailable — codes remain selectable on the page */
    }
  };

  return (
    <button type="button" onClick={copy} className="btn btn-primary" disabled={!codes.length}>
      {done ? (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="m5 13 4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        'Copy all codes'
      )}
    </button>
  );
}