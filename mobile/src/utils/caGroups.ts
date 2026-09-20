export type CaGroup = 'Group I' | 'Group II';

export const caGroupDetails: Record<CaGroup, { short: string; papers: string[]; color: string; soft: string }> = {
  'Group I': {
    short: 'G1',
    papers: ['Advanced Accounting', 'Corporate & Other Laws', 'Taxation'],
    color: '#3157D5',
    soft: '#EAF0FF',
  },
  'Group II': {
    short: 'G2',
    papers: ['Cost & Management Accounting', 'Auditing & Ethics', 'FM & SM'],
    color: '#7758D6',
    soft: '#F0ECFF',
  },
};

export const allCaGroups: CaGroup[] = ['Group I', 'Group II'];

export const subjectGroup = (subject?: string): CaGroup | 'General' => {
  const value = String(subject || '').trim().toLowerCase();
  if (!value) return 'General';

  // Group II is checked first because "Cost and Management Accounting" also
  // contains the word "accounting".
  if (
    /cost|costing|audit|auditing|financial management|strategic management/.test(value) ||
    /^(fm|sm)(\b|\s|&)/.test(value) ||
    value === 'fm' || value === 'sm'
  ) return 'Group II';

  if (/account|law|tax|gst|direct tax|corporate/.test(value)) return 'Group I';
  return 'General';
};

export const groupsForStudent = (group?: string): CaGroup[] => {
  const value = String(group || '').toLowerCase();
  if (/both|group\s*(i|1)\s*(&|and|\+)\s*(ii|2)/.test(value)) return allCaGroups;
  const hasOne = /group\s*(i|1)\b/.test(value);
  const hasTwo = /group\s*(ii|2)\b/.test(value);
  if (hasOne && !hasTwo) return ['Group I'];
  if (hasTwo && !hasOne) return ['Group II'];
  return allCaGroups;
};
