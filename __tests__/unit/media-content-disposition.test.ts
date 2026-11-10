import { describe, it, expect } from 'vitest';
import { mediaContentDisposition } from '@/lib/media/content-disposition';

describe('mediaContentDisposition', () => {
  it('names the file after its title with the stored extension', () => {
    expect(mediaContentDisposition({ Title: 'Birth register, 1889', FilePath: '12_1700_ab12cd34.pdf' }, false))
      .toBe(`inline; filename="birth-register-1889.pdf"; filename*=UTF-8''birth-register-1889.pdf`);
  });

  it('asks for an attachment when downloading', () => {
    expect(mediaContentDisposition({ Title: 'Deed', FilePath: 'x.pdf' }, true)).toMatch(/^attachment; filename="deed\.pdf"/);
  });

  it('keeps a non-Latin title in filename* and a plain ASCII fallback', () => {
    const header = mediaContentDisposition({ Title: 'Бабушка Анна', FilePath: 'x.jpg' }, false);
    expect(header).toContain('filename="media.jpg"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('бабушка-анна.jpg')}`);
  });

  it('never lets a quote, semicolon or line break into the header', () => {
    const header = mediaContentDisposition({ Title: 'a"; b\r\nX-Evil: 1', FilePath: 'x".pdf' }, false);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
  });
});
