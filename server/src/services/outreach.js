// Outreach message templates with simple {{placeholder}} rendering.
// Recruiters pick a template; the client opens the user's mail client (mailto)
// or copies the message, then logs the outreach back to the candidate.

export const TEMPLATES = [
  {
    id: 'intro',
    name: 'Warm intro',
    subject: 'Opportunity for {{role}} — {{company}} is hiring',
    body:
      'Hi {{firstName}},\n\n' +
      'I came across your profile and was really impressed by your background' +
      '{{skillLine}}. We have an opening that looks like a strong match for what you do.\n\n' +
      'Would you be open to a quick 15-minute chat this week to explore it?\n\n' +
      'Best,\n{{recruiter}}',
  },
  {
    id: 'opentowork',
    name: 'Open-to-work nudge',
    subject: 'Saw you’re open to work — let’s talk, {{firstName}}',
    body:
      'Hi {{firstName}},\n\n' +
      'Noticed you’re open to new opportunities. We’re hiring for a {{role}} role and your experience' +
      '{{skillLine}} stood out.\n\n' +
      'Happy to share details — when works for a short call?\n\n' +
      'Cheers,\n{{recruiter}}',
  },
  {
    id: 'followup',
    name: 'Follow-up',
    subject: 'Following up — {{role}} opportunity',
    body:
      'Hi {{firstName}},\n\n' +
      'Just floating this back to the top of your inbox. Would love to tell you more about the {{role}} role ' +
      'whenever you have a few minutes.\n\n' +
      'Best,\n{{recruiter}}',
  },
  {
    id: 'resume',
    name: 'Resume request',
    subject: '{{role}} role — share your resume, {{firstName}}?',
    body:
      'Hi {{firstName}},\n\n' +
      'I came across your profile{{experienceLine}} and think you could be a strong fit for a {{role}} role we’re hiring for.\n\n' +
      'What we’re looking for:\n{{requirements}}\n\n' +
      'If this sounds interesting, could you share your latest resume here? It takes a few seconds:\n{{resumeLink}}\n\n' +
      'Looking forward to it,\n{{recruiter}}',
  },
];

// Human phrase for a candidate's experience, used in personalized outreach.
// "6 years of experience", "around 2 years", or '' when unknown.
export function experiencePhrase(candidate = {}) {
  const y = candidate.experienceYears;
  if (y == null || Number.isNaN(Number(y))) return '';
  const n = Number(y);
  if (n <= 0) return '';
  return `${n} year${n === 1 ? '' : 's'} of experience`;
}

export function renderTemplate(tpl, candidate, ctx = {}) {
  const first = (candidate.fullName || '').split(' ')[0] || 'there';
  const skills = (candidate.skills || []).slice(0, 3).join(', ');
  const exp = experiencePhrase(candidate);
  const vars = {
    firstName: first,
    name: candidate.fullName || 'there',
    role: ctx.role || candidate.currentTitle || 'this role',
    company: ctx.company || 'our team',
    recruiter: ctx.recruiter || 'The InCruiter team',
    skillLine: skills ? ` with ${skills}` : '',
    // Their experience — both a bare value ({{experience}} → "6 years of experience")
    // and a sentence-fragment form ({{experienceLine}} → " — I see you have 6 years…")
    // so templates can drop it in naturally.
    experience: exp,
    experienceLine: exp ? ` — I see you have ${exp}` : '',
    // Our requirements / JD, as typed by the recruiter for this campaign.
    requirements: ctx.requirements ? String(ctx.requirements).trim() : 'a strong match for your background',
    // Per-candidate public resume-upload link (set by the email route when the
    // recruiter asks to collect resumes). Empty string when not requested.
    resumeLink: ctx.resumeLink || '',
  };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}
