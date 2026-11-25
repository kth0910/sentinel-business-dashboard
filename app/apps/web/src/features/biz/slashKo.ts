// '/' 메뉴 한국어 표시(업무관리 시연판). 메뉴 항목은 slashItems.ts에서 영어 이름으로 만들어지고,
// 묶음 이름(section)은 코드에서 비교에 쓰이므로 그대로 두고 화면에 보일 때만 바꾼다.
const LABELS: Record<string, string> = {
  'Text': '텍스트', 'Heading 1': '제목 1', 'Heading 2': '제목 2', 'Heading 3': '제목 3', 'Heading 4': '제목 4',
  'Bulleted list': '글머리 기호 목록', 'Numbered list': '번호 매기기 목록', 'Task list': '할 일 목록', 'Toggle list': '토글 목록',
  'Page': '페이지', 'Callout': '콜아웃', 'Quote': '인용', 'Table': '표', 'Divider': '구분선', 'Page link': '페이지 링크',
  'Image': '이미지', 'Video': '동영상', 'Audio': '오디오', 'Code': '코드', 'File': '파일', 'Web bookmark': '웹 북마크',
  'Table view': '표 보기', 'List view': '리스트 보기', 'Calendar view': '캘린더 보기', 'Timeline view': '타임라인 보기',
  'Column bar chart': '세로 막대 차트', 'Row bar chart': '가로 막대 차트', 'Line chart': '꺾은선 차트', 'Donut chart': '도넛 차트', 'Number chart': '숫자 차트',
  'Database - Inline': '데이터베이스 - 인라인', 'Database full page': '데이터베이스 - 전체 페이지', 'Linked data source view': '데이터 소스 연결 보기',
  'Contents list': '목차', 'Block equation': '수학 공식 블록', 'Button': '버튼', 'Breadcrumb': '이동 경로', 'Tabs': '탭', 'Mirrored block': '동기화 블록',
  'Toggle heading 1': '토글 제목 1', 'Toggle heading 2': '토글 제목 2', 'Toggle heading 3': '토글 제목 3', 'Toggle heading 4': '토글 제목 4',
  '2 columns': '2단', '3 columns': '3단', '4 columns': '4단', '5 columns': '5단',
  'Mention someone': '사람 멘션', 'Mention pages and data sources': '페이지·데이터 소스 멘션', 'Date or reminder': '날짜 또는 리마인더',
  'Emoji': '이모지', 'Inline equation': '인라인 수학 공식', 'Embed': '임베드',
  'Plain text and Markdown': '일반 텍스트와 Markdown', 'Page in': '다른 페이지 안의 페이지', 'Synced block': '동기화 블록',
  'Copy block link': '블록 링크 복사', 'Duplicate': '복제', 'Move to': '옮기기', 'Delete': '삭제', 'Start presenting here': '여기서 발표 시작',
  'Default text': '기본 글자색', 'Gray text': '회색 글자', 'Brown text': '갈색 글자', 'Orange text': '주황색 글자', 'Yellow text': '노란색 글자',
  'Green text': '초록색 글자', 'Blue text': '파란색 글자', 'Purple text': '보라색 글자', 'Pink text': '분홍색 글자', 'Red text': '빨간색 글자',
  'Default background': '기본 배경', 'Gray background': '회색 배경', 'Brown background': '갈색 배경', 'Orange background': '주황색 배경',
  'Yellow background': '노란색 배경', 'Green background': '초록색 배경', 'Blue background': '파란색 배경', 'Purple background': '보라색 배경',
  'Pink background': '분홍색 배경', 'Red background': '빨간색 배경',
  // 외부 서비스·파일 형식 이름은 영어 그대로(사용자 결정). 일반 단어가 섞인 것만 바꾼다.
  'Code - Mermaid': '코드 - Mermaid', 'Tweet': '트윗', 'Jira preview (Data center)': 'Jira 미리보기(Data Center)',
};

const SECTIONS: Record<string, string> = {
  'Suggested': '추천', 'Basic blocks': '기본 블록', 'Media': '미디어', 'Database': '데이터베이스', 'Advanced blocks': '고급 블록',
  'Inline': '인라인', 'Embeds': '임베드', 'Synced Databases': '동기화 데이터베이스', 'Import': '가져오기', 'Turn into': '변환',
  'Actions': '작업', 'Text color': '글자색', 'Background color': '배경색',
};

const BADGES: Record<string, string> = { 'New': '새 기능', 'Beta': '베타' };

/** '/' 메뉴 맨 위에 두는 업무 묶음 이름(slash.block.tsx의 section과 같아야 한다). */
export const BIZ_SECTION = '업무';

export const slashLabelKo = (s: string) => LABELS[s] ?? s;
export const slashSectionKo = (s: string) => SECTIONS[s] ?? s;
export const slashBadgeKo = (s: string | undefined) => (s ? BADGES[s] ?? s : s);
