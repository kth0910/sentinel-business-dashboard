export type ConnectionType = 'mcp_server' | 'ai_connector' | 'link_preview' | 'automation_action';
export interface ConnectionCard { name: string; litpage: boolean; desc: string; action: 'Connect' | 'Request' }
export interface ConnectionCategory { key: string; title: string; cards: ConnectionCard[] }
export interface ConnectionOption { key: string; title: string }

export const CONNECTION_CATEGORIES: ConnectionCategory[] = [
  {
    key: 'featured', title: '추천 연결',
    cards: [
      { name: 'Google Drive', litpage: true, desc: '공유 파일을 둘러보고 문서를 CoolNotion! 페이지로 가져옵니다.', action: 'Connect' },
      { name: 'Slack', litpage: true, desc: '대화를 검색하고 선택한 업데이트를 Slack 채널로 보냅니다.', action: 'Connect' },
      { name: 'GitHub', litpage: true, desc: '워크스페이스의 저장소, 이슈, 풀 리퀘스트를 참조합니다.', action: 'Connect' },
    ],
  },
  {
    key: 'communication', title: '커뮤니케이션',
    cards: [
      { name: 'Gmail', litpage: false, desc: 'Gmail 계정의 메일을 찾고 답장 초안을 작성합니다.', action: 'Connect' },
      { name: 'Microsoft Teams', litpage: false, desc: '대화 맥락이 필요할 때 팀 채팅과 채널을 검색합니다.', action: 'Connect' },
      { name: 'Zoom', litpage: false, desc: '미팅을 조회하고 해당 Zoom 상세 정보를 엽니다.', action: 'Connect' },
    ],
  },
  {
    key: 'projects', title: '프로젝트 및 작업',
    cards: [
      { name: 'Linear', litpage: true, desc: 'CoolNotion!에서 업무를 계획하면서 이슈와 프로젝트를 검색합니다.', action: 'Connect' },
      { name: 'Asana', litpage: false, desc: '워크스페이스 메모와 함께 작업과 프로젝트 업데이트를 확인합니다.', action: 'Connect' },
      { name: 'GitLab', litpage: false, desc: '머지 리퀘스트, 이슈, 프로젝트 활동을 맥락으로 가져옵니다.', action: 'Connect' },
    ],
  },
  {
    key: 'files', title: '파일 및 자동화',
    cards: [
      { name: 'Dropbox', litpage: false, desc: '공유된 Dropbox 폴더의 파일을 검색하고 엽니다.', action: 'Connect' },
      { name: 'Zapier', litpage: false, desc: '사용 중인 서비스의 이벤트로 CoolNotion! 워크플로를 실행합니다.', action: 'Connect' },
      { name: 'Make', litpage: false, desc: 'CoolNotion!로 정보를 가져오거나 내보내는 Make 시나리오를 실행합니다.', action: 'Connect' },
    ],
  },
];

export const CATEGORY_OPTIONS: ConnectionOption[] = CONNECTION_CATEGORIES.map(({ key, title }) => ({ key, title }));
export const TYPE_OPTIONS: ConnectionOption[] = [
  { key: 'mcp_server', title: 'MCP 서버' },
  { key: 'ai_connector', title: 'AI 커넥터' },
  { key: 'link_preview', title: '링크 미리보기' },
  { key: 'automation_action', title: '자동화 작업' },
];
