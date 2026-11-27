import { describe, expect, it, beforeEach, vi } from 'vitest';
import ko from './i18n.ko-KR.json';

// 소스 전체를 문자열로 읽는다(테스트 파일 제외). node 타입 없이 vite 로더만 쓴다.
const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('한국어 고정', () => {
  beforeEach(() => vi.resetModules());

  it('locale stays Korean even if en-US was stored', async () => {
    localStorage.setItem('nc:locale', 'en-US');
    const i18n = await import('./i18n.ts');
    expect(i18n.getLocale()).toBe('ko-KR');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('exports no language switching', async () => {
    const i18n: Record<string, unknown> = await import('./i18n.ts');
    expect(i18n.LOCALES).toBeUndefined();
    expect(i18n.setLocale).toBeUndefined();
  });

  it('every t() key has a Korean translation', () => {
    const keys = new Set(Object.values(sources).flatMap((text) => [...text.matchAll(/\bt\(\s*'(lp\.[^']+)'/g)].map((m) => m[1])));
    expect(keys.size).toBeGreaterThan(1000);
    const missing = [...keys].filter((k) => !(k in (ko as Record<string, string>)));
    expect(missing).toEqual([]);
  });
});
