"use client";
import { useState } from "react";

// Kopierer en ferdig formulert oppgave (f.eks. til Claude Code eller en utvikler)
export function CopyButton({ text, label = "Kopier som oppgave" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn line sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt("Kopier teksten:", text); } }}>
      {done ? "Kopiert ✓" : label}
    </button>
  );
}
