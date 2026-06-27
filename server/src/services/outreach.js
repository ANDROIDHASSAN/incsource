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
];

export function renderTemplate(tpl, candidate, ctx = {}) {
  const first = (candidate.fullName || '').split(' ')[0] || 'there';
  const skills = (candidate.skills || []).slice(0, 3).join(', ');
  const vars = {
    firstName: first,
    name: candidate.fullName || 'there',
    role: ctx.role || candidate.currentTitle || 'this role',
    company: ctx.company || 'our team',
    recruiter: ctx.recruiter || 'The InCruiter team',
    skillLine: skills ? ` with ${skills}` : '',
  };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}
