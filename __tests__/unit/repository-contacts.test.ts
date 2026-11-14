import { describe, it, expect } from 'vitest';
import { liftRepositoryContacts } from '@/lib/gedcom/repository-contacts';
import { contactHref } from '@/lib/utils/contact-links';

describe('liftRepositoryContacts (ADR 0049)', () => {
  it('lifts the first of each tag and leaves the rest in order', () => {
    const out = liftRepositoryContacts(['1 WWW https://a.example', '1 CHAN', '2 DATE 1 JAN 2000', '1 WWW https://b.example', '1 EMAIL x@@y.example']);
    expect(out).toEqual({
      Website: 'https://a.example', Phone: null, Email: 'x@y.example',
      rest: ['1 CHAN', '2 DATE 1 JAN 2000', '1 WWW https://b.example'],
    });
  });

  it('keeps a first line that is blank or has lines under it, and every later one of that tag', () => {
    const lines = ['1 PHON', '1 PHON 555', '1 EMAIL a@b.example', '2 _TYPE work', '1 EMAIL c@d.example'];
    expect(liftRepositoryContacts(lines)).toEqual({ Website: null, Phone: null, Email: null, rest: lines });
  });

  it('on a merge, keeps a different existing value raw and drops the same one', () => {
    const lines = ['1 PHON 555', '1 EMAIL a@b.example', '1 WWW https://a.example'];
    expect(liftRepositoryContacts(lines, { Phone: '999', Email: 'a@b.example' }))
      .toEqual({ Website: 'https://a.example', Phone: null, Email: null, rest: ['1 PHON 555'] });
  });

  it('ignores deeper lines with the same tags', () => {
    const lines = ['1 _ADDR', '2 PHON 555'];
    expect(liftRepositoryContacts(lines)).toMatchObject({ Phone: null, rest: lines });
  });
});

describe('contactHref', () => {
  it('links only http(s) websites', () => {
    expect(contactHref('Website', ' https://a.example ')).toBe('https://a.example');
    expect(contactHref('Website', 'javascript:alert(1)')).toBeNull();
    expect(contactHref('Website', 'www.a.example')).toBeNull();
  });

  it('links an email address and a phone number', () => {
    expect(contactHref('Email', 'desk@archive.example')).toBe('mailto:desk@archive.example');
    expect(contactHref('Email', 'not an email')).toBeNull();
    expect(contactHref('Email', 'a@b?subject=x')).toBeNull();
    expect(contactHref('Email', 'a@x.example,b@y.example')).toBeNull();
    expect(contactHref('Phone', '+33 (1) 00-00')).toBe('tel:+3310000');
    expect(contactHref('Phone', 'ask at desk')).toBeNull();
    expect(contactHref('Phone', null)).toBeNull();
  });
});
