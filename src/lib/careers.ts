export const CAREER_EXPERIENCE_LEVELS = [
  { value: 'entry', label: 'Entry level / willing to learn' },
  { value: 'some', label: 'Some cleaning experience' },
  { value: 'experienced', label: 'Experienced cleaner' },
  { value: 'professional', label: 'Professional / lead experience' },
] as const;

export const CAREER_ROLES = [
  { value: 'residential', label: 'Residential cleaning' },
  { value: 'commercial', label: 'Commercial cleaning' },
  { value: 'church', label: 'Church / institutional cleaning' },
  { value: 'str', label: 'STR / turnover cleaning' },
  { value: 'operations', label: 'Operations / scheduling support' },
  { value: 'any', label: 'Open to the right role' },
] as const;

export const CAREER_BRANCHES = [
  { value: 'pensacola', label: 'Pensacola' },
  { value: 'tampa', label: 'Tampa Bay (future interest only)' },
  { value: 'either', label: 'Either branch' },
] as const;

export const CAREER_TRANSPORT = [
  { value: 'own_vehicle', label: 'I have my own vehicle' },
  { value: 'reliable_transport', label: 'I have reliable transportation' },
  { value: 'needs_assistance', label: 'I may need transportation assistance' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

export const CAREER_STATUSES = ['new', 'reviewing', 'interview', 'offer', 'declined', 'archived'] as const;

export const CAREER_RESUME_MAX_BYTES = 5 * 1024 * 1024;

export function careerValue(values: ReadonlyArray<{ value: string }>, value: string): string {
  return values.some((entry) => entry.value === value) ? value : '';
}

export function careerLabel(values: ReadonlyArray<{ value: string; label: string }>, value: unknown): string {
  return values.find((entry) => entry.value === value)?.label ?? String(value ?? '');
}

export function sanitizeResumeName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
}

export function resumeFormat(bytes: Uint8Array, filename: string): { mime: string; ext: 'pdf' | 'docx' } | null {
  const name = filename.toLowerCase();
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && name.endsWith('.docx')) {
    return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  }
  return null;
}
