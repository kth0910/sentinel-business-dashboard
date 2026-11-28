import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // jsdom has no matchMedia; the UI store reads it when it loads
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as any;
});

vi.mock('../api.ts', async () => {
  const actual = await vi.importActual<typeof import('../api.ts')>('../api.ts');
  return { ...actual, api: vi.fn() };
});

import { api, ApiError } from '../api.ts';
import { transactions, Tx } from './transactions.ts';
import { useUI } from './ui.ts';

function commitOne() {
  const tx = new Tx('s1', 'test');
  tx.ops.push({ pointer: { table: 'block', id: 'b1', spaceId: 's1' }, path: [], command: 'set', args: { id: 'b1' } } as any);
  transactions.commit(tx);
}

beforeEach(() => {
  useUI.setState({ toasts: [] });
  vi.mocked(api).mockReset();
});

describe('rejected saves', () => {
  it('403 shows a Korean permission toast', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(403, 'PermissionError', 'forbidden'));
    commitOne();
    await transactions.flush();
    expect(useUI.getState().toasts.map((t) => t.message)).toEqual(['이 페이지를 편집할 권한이 없습니다.']);
  });

  it('413 shows the server message, or a fallback when it is empty', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(413, 'ValidationError', '한 번에 저장할 수 있는 양을 넘었습니다.'));
    commitOne();
    await transactions.flush();
    vi.mocked(api).mockRejectedValue(new ApiError(400, 'ValidationError', ''));
    commitOne();
    await transactions.flush();
    expect(useUI.getState().toasts.map((t) => t.message)).toEqual(['한 번에 저장할 수 있는 양을 넘었습니다.', '변경 내용을 저장하지 못했습니다.']);
  });
});
