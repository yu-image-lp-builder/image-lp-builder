/**
 * Button clipboard
 *
 * A single-slot clipboard for CTA templates, persisted in localStorage
 * so the user can copy a button in one section's editor and paste it
 * into another section (or even after a page reload).
 */

import type { Cta } from './content';

const KEY = 'image-lp-builder:button-clipboard';

export interface ButtonClipboardEntry {
  template: Omit<Cta, 'id'>;
  copiedAt: number;
}

export function setButtonClipboard(template: Omit<Cta, 'id'>): void {
  if (typeof window === 'undefined') return;
  const entry: ButtonClipboardEntry = {
    template,
    copiedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entry));
    // Notify same-tab listeners — `storage` event fires only across
    // tabs, so we dispatch a custom event for our own page.
    window.dispatchEvent(new CustomEvent('button-clipboard:change'));
  } catch {
    // localStorage unavailable (e.g. private browsing); silently ignore
  }
}

export function getButtonClipboard(): ButtonClipboardEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ButtonClipboardEntry;
    if (!parsed || typeof parsed !== 'object' || !parsed.template) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearButtonClipboard(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('button-clipboard:change'));
  } catch {
    // ignore
  }
}
