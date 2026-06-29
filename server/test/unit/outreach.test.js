import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, renderTemplate } from '../../src/services/outreach.js';

describe('renderTemplate', () => {
  const candidate = { fullName: 'Asha Rao', skills: ['React', 'Node.js', 'MongoDB'], currentTitle: 'React Developer' };

  it('substitutes all known placeholders', () => {
    const { subject, body } = renderTemplate(TEMPLATES[0], candidate, { role: 'Senior React Developer', recruiter: 'Sam' });
    assert.match(subject, /Senior React Developer/);
    assert.match(body, /Hi Asha,/);
    assert.match(body, /with React, Node\.js, MongoDB/);
    assert.match(body, /Sam/);
  });

  it('never leaves an unresolved {{placeholder}} behind', () => {
    const { subject, body } = renderTemplate(TEMPLATES[1], candidate, {});
    assert.doesNotMatch(subject + body, /\{\{|\}\}/);
  });

  it('degrades gracefully when fields are missing', () => {
    const { subject, body } = renderTemplate(TEMPLATES[2], {}, {});
    assert.match(body, /Hi there,/);
    assert.doesNotMatch(subject + body, /\{\{/);
  });

  it('ships the documented built-in templates', () => {
    assert.deepEqual(TEMPLATES.map((t) => t.id), ['intro', 'opentowork', 'followup', 'resume']);
  });

  it('personalizes the resume-request template with experience, requirements and link', () => {
    const tpl = TEMPLATES.find((t) => t.id === 'resume');
    const out = renderTemplate(tpl, { fullName: 'Asha Rao', currentTitle: 'React Developer', experienceYears: 6 }, {
      role: 'Senior React Developer', requirements: '5+ yrs React, Node', resumeLink: 'https://app.test/r/ABC',
    });
    assert.match(out.subject, /Asha/);
    assert.match(out.body, /6 years of experience/);
    assert.match(out.body, /5\+ yrs React, Node/);
    assert.match(out.body, /https:\/\/app\.test\/r\/ABC/);
    assert.doesNotMatch(out.subject + out.body, /\{\{/);
  });
});
