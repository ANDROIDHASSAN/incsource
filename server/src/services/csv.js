// RFC-4180-ish CSV serialization for candidate export.

const COLUMNS = [
  ['fullName', 'Name'],
  ['headline', 'Headline'],
  ['currentTitle', 'Title'],
  ['currentCompany', 'Company'],
  ['city', 'City'],
  ['state', 'State'],
  ['country', 'Country'],
  ['activeScore', 'Intent Score'],
  ['openToWork', 'Open To Work'],
  ['noticePeriodDays', 'Notice (days)'],
  ['status', 'Pipeline Status'],
  ['starred', 'Shortlisted'],
  ['email', 'Email'],
  ['profileUrl', 'Profile URL'],
  ['skills', 'Skills'],
  ['sources', 'Sources'],
  ['lastContactedAt', 'Last Contacted'],
];

function cell(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.join('; ');
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function candidatesToCsv(candidates) {
  const header = COLUMNS.map(([, label]) => cell(label)).join(',');
  const rows = candidates.map((c) => COLUMNS.map(([key]) => cell(c[key])).join(','));
  return [header, ...rows].join('\r\n');
}
