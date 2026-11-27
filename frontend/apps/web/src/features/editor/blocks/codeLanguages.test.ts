import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, languageLabel } from './codeLanguages.ts';

describe('코드 언어 표시 이름', () => {
  it('shows CoolNotion! Formula while the stored value stays Litpage Formula', () => {
    expect(languageLabel('Litpage Formula')).toBe('CoolNotion! Formula');
    expect(CODE_LANGUAGES).toContain('Litpage Formula');
    expect(CODE_LANGUAGES).not.toContain('CoolNotion! Formula');
  });

  it('leaves every other language name as is', () => {
    for (const l of CODE_LANGUAGES.filter((x) => x !== 'Litpage Formula')) expect(languageLabel(l)).toBe(l);
  });

  it('no visible language label contains Litpage', () => {
    expect(CODE_LANGUAGES.map(languageLabel).filter((l) => /litpage/i.test(l))).toEqual([]);
  });
});
