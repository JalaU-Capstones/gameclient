const BIDI_AND_INVISIBLE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const C0_C1_CONTROLS = /\p{Cc}/gu;

export function sanitizeDisplayName(value: string | null | undefined): string {
  if (value == null) return '';

  return value
    .replace(BIDI_AND_INVISIBLE, '')
    .replace(/\p{White_Space}+/gu, ' ')
    .replace(C0_C1_CONTROLS, '')
    .trim();
}
