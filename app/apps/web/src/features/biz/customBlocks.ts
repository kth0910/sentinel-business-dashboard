// 사용자 정의 업무 블록(화면 쪽): 블록 메뉴 '업무 블록으로 저장', '/' 업무 묶음 목록, 넣기, 이름 변경·삭제.
// 목록은 워크스페이스별로 잠깐 기억해 두고('/' 메뉴는 동기적으로 그려야 함), 메뉴를 열 때마다 뒤에서 새로 받아 온다.
import { api } from '../../lib/api.ts';
import { deleteBlocksIn, getBlock, run } from '../../lib/blocks.ts';
import { useSession } from '../../lib/store/session.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useUI } from '../../lib/store/ui.ts';
import { askName } from './nameDialog.tsx';

export interface CustomBlock { id: string; name: string; createdTime: number }

let cache: { spaceId: string; list: CustomBlock[]; at: number } | null = null;
const STALE_MS = 15_000;

const spaceId = () => useSession.getState().spaceId;
const toast = (m: string) => useUI.getState().toast(m);

export async function refreshCustomBlocks(): Promise<CustomBlock[]> {
  const sid = spaceId();
  if (!sid) return [];
  const { blocks } = await api<{ blocks: CustomBlock[] }>('bizCustomBlocks', { spaceId: sid });
  cache = { spaceId: sid, list: blocks, at: Date.now() };
  return blocks;
}

/** '/' 메뉴용: 기억해 둔 목록을 바로 주고, 오래됐으면 뒤에서 새로 받아 온다. */
export function cachedCustomBlocks(): CustomBlock[] {
  const sid = spaceId();
  if (!sid) return [];
  if (!cache || cache.spaceId !== sid || Date.now() - cache.at > STALE_MS) void refreshCustomBlocks().catch(() => {});
  return cache?.spaceId === sid ? cache.list : [];
}

function firstText(ids: string[]): string {
  for (const id of ids) {
    const t = (getBlock(id)?.properties?.title ?? []).map((s: any) => s[0]).join('').trim();
    if (t) return t.slice(0, 30);
  }
  return '';
}

export async function saveAsCustomBlock(ids: string[]) {
  const sid = spaceId();
  if (!sid || !ids.length) return;
  const name = await askName('업무 블록으로 저장', firstText(ids));
  if (!name) return;
  try {
    await transactions.flush();
    await api('bizSaveCustomBlock', { spaceId: sid, name, blockIds: ids });
    await refreshCustomBlocks();
    toast(`'${name}' 블록을 저장했습니다. '/' 메뉴 업무 묶음에서 넣을 수 있습니다`);
  } catch (e: any) {
    toast(e?.message ?? '저장하지 못했습니다');
  }
}

/** '/'를 친 줄 바로 뒤에 넣고, 그 줄이 비어 있으면 지운다. */
export async function insertCustomBlock(id: string, blockId: string, empty: boolean) {
  try {
    await transactions.flush();
    await api('bizInsertCustomBlock', { id, afterBlockId: blockId });
    if (empty && getBlock(blockId)) run('bizCustomInsert', (tx) => deleteBlocksIn(tx, [blockId]));
  } catch (e: any) {
    toast(e?.message ?? '블록을 넣지 못했습니다');
  }
}

export async function renameCustomBlock(c: CustomBlock) {
  const name = await askName('업무 블록 이름 변경', c.name, '변경');
  if (!name || name === c.name) return;
  try {
    await api('bizRenameCustomBlock', { id: c.id, name });
    await refreshCustomBlocks();
  } catch (e: any) {
    toast(e?.message ?? '이름을 바꾸지 못했습니다');
  }
}

export async function deleteCustomBlock(c: CustomBlock) {
  if (!confirm(`'${c.name}' 업무 블록을 목록에서 지울까요? 이미 페이지에 넣은 블록은 그대로 남습니다.`)) return;
  try {
    await api('bizDeleteCustomBlock', { id: c.id });
    await refreshCustomBlocks();
    toast(`'${c.name}' 블록을 지웠습니다`);
  } catch (e: any) {
    toast(e?.message ?? '지우지 못했습니다');
  }
}

// 워크스페이스에 들어오거나 바뀌면 미리 받아 둔다('/' 메뉴를 처음 열 때도 목록이 보이게)
let lastSpace: string | null = null;
useSession.subscribe((st) => {
  if (st.spaceId && st.spaceId !== lastSpace) {
    lastSpace = st.spaceId;
    void refreshCustomBlocks().catch(() => {});
  }
});
if (useSession.getState().spaceId) {
  lastSpace = useSession.getState().spaceId;
  void refreshCustomBlocks().catch(() => {});
}
