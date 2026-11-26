export const CAREER_EXPERIENCE_LEVELS = [
  { value: 'entry', label: 'Entry level / willing to learn' },
  { value: 'some', label: 'Some cleaning experience' },
  { value: 'experienced', label: 'Experienced cleaner' },
  { value: 'professional', label: 'Professional / lead experience' },
] as const;

export const CAREER_ROLES = [
  { value: 'residential', label: 'Residential Cleaning Specialist' },
  { value: 'commercial', label: 'Commercial Cleaning Specialist' },
  { value: 'str', label: 'Vacation Rental Cleaning Specialist' },
  { value: 'lead', label: 'Lead Cleaner' },
  { value: 'management', label: 'Future Management Opportunities' },
  { value: 'church', label: 'Church / institutional cleaning' },
  { value: 'operations', label: 'Operations / scheduling support' },
  { value: 'any', label: 'Open to the right role' },
] as const;

export const CAREER_BRANCHES = [
  { value: 'pensacola', label: 'Pensacola (active recruiting market)' },
  { value: 'tampa', label: 'Tampa Bay (future interest only)' },
  { value: 'either', label: 'Either branch' },
] as const;

export const CAREER_TRANSPORT = [
  { value: 'own_vehicle', label: 'I have my own vehicle' },
  { value: 'reliable_transport', label: 'I have reliable transportation' },
  { value: 'needs_assistance', label: 'I may need transportation assistance' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

export const CAREER_EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'either', label: 'Either' },
] as const;

export const CAREER_AVAILABILITY = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'weekend', label: 'Weekend' },
] as const;

export const CAREER_DAYS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
] as const;

export const CAREER_PIPELINE_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'interview_requested', label: 'Interview Requested' },
  { value: 'interview_scheduled', label: 'Interview Scheduled' },
  { value: 'interview_completed', label: 'Interview Completed' },
  { value: 'selected', label: 'Selected' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'hired', label: 'Hired' },
  { value: 'not_selected', label: 'Not Selected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'archived', label: 'Archived' },
] as const;

export const CAREER_LEGACY_STATUSES = ['new', 'reviewing', 'interview', 'offer', 'declined', 'archived'] as const;

export type CareerPipelineStatus = (typeof CAREER_PIPELINE_STATUSES)[number]['value'];

export const CAREER_OPPORTUNITIES = [
  {
    code: 'residential',
    title: 'Residential Cleaning Specialist',
    description: 'Care for homes, recurring customers and detailed deep cleans.',
    branch: 'Pensacola',
  },
  {
    code: 'commercial',
    title: 'Commercial Cleaning Specialist',
    description: 'Serve offices, facilities and scheduled commercial accounts.',
    branch: 'Pensacola',
  },
  {
    code: 'str',
    title: 'Vacation Rental Cleaning Specialist',
    description: 'Prepare short-term rental turnovers with reliable timing.',
    branch: 'Pensacola',
  },
  {
    code: 'lead',
    title: 'Lead Cleaner',
    description: 'Guide a crew, protect quality and communicate with customers.',
    branch: 'Pensacola',
  },
  {
    code: 'management',
    title: 'Future Management Opportunities',
    description: 'Grow into operations and team leadership as the company expands.',
    branch: 'Pensacola',
  },
] as const;

export const CAREER_BENEFITS = [
  ['Competitive compensation', 'Approved role-based rates with clear assignment expectations.'],
  ['Structured professional training', 'Learn our cleaning standards, safety practices and customer care.'],
  ['Opportunities for advancement', 'Lead and specialist pathways as the company grows.'],
  ['Clear responsibilities', 'Defined scopes, checklists and operating procedures.'],
  ['Organized scheduling', 'Assignments are coordinated through our employee scheduling systems.'],
  ['Supportive team environment', 'Respectful communication and practical on-the-job support.'],
  ['Room to grow', 'Join an expanding local company and take on more responsibility over time.'],
] as const;

export const CAREER_DEFAULT_PAY = {
  regular: 1800,
  lead: 2200,
  solo: 2500,
} as const;

export const CAREER_RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const CAREER_APPLICATION_RETENTION_MONTHS = 24;

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
