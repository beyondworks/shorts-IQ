import type { AppState, FolderItem, TemplatePattern, VideoItem } from './types';

export const seedTemplates: TemplatePattern[] = [
  { name: 'Ranking Hook', type: '랭킹/리스트형', views: '42.8M', delta: '+22.4%', count: 214, tone: 'cyan', why: '숫자·순위·비교 후킹이 가장 빠르게 확산', bestFor: '정보형, 교육형, 큐레이션' },
  { name: '9:16 Full Frame', type: '몰입형 풀프레임', views: '38.4M', delta: '+18.2%', count: 148, tone: 'violet', why: '작업 과정·현장감·스크린 기록형에 강함', bestFor: 'AI 제작, 튜토리얼, 과정 공개' },
  { name: 'Product Demo', type: '제품/커머스 데모', views: '31.2M', delta: '+16.9%', count: 132, tone: 'green', why: '문제→시연→결과 전환이 구매 의도와 연결', bestFor: '커머스, 뷰티, 푸드, 앱' },
  { name: 'Caption Meme', type: '자막/밈 포맷', views: '27.6M', delta: '+14.1%', count: 187, tone: 'blue', why: '짧은 문장·공감 포인트로 저장률이 높음', bestFor: '엔터, 라이프스타일, SNS 밈' },
  { name: 'Before / After', type: '전후 비교형', views: '24.1M', delta: '+12.4%', count: 103, tone: 'green', why: '변화가 한눈에 보여 retention이 안정적', bestFor: '디자인, 운동, 뷰티, 생산성' },
  { name: 'Street Interview', type: '거리 인터뷰형', views: '21.8M', delta: '+11.0%', count: 96, tone: 'cyan', why: '현장성 + 질문형 훅으로 스크롤 정지 유도', bestFor: '패션, 엔터, 교육, 리서치' },
];

export const seedVideos: VideoItem[] = [
  { id: 'vid-001', rank: 1, title: '편의점 신상 조합이 터진 이유', channel: 'Snack Radar', template: 'Product Demo', category: '먹방·푸드', uploaded: '34m ago', views: '2.42M', viewCount: 2420000, velocity: '+78.1K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#f59e0b,#171717 56%,#050505)', hook: '제품 클로즈업 + 가격/반응 즉시 제시', retention: '74%', saveRate: '8.1%', duration: '00:42', sourceUrl: 'https://www.youtube.com/shorts/seed-001' },
  { id: 'vid-002', rank: 2, title: '3초 안에 끝나는 노트 정리법', channel: 'Creator Lab KR', template: 'Ranking Hook', category: '잡학상식·정보', uploaded: '2h ago', views: '1.84M', viewCount: 1840000, velocity: '+42.8K/h', saved: true, folder: '랭킹형 후킹', gradient: 'linear-gradient(160deg,#7170ff,#111827 58%,#050505)', hook: '숫자형 약속 + 즉시 결과 화면', retention: '69%', saveRate: '11.4%', duration: '00:31', sourceUrl: 'https://www.youtube.com/shorts/seed-002' },
  { id: 'vid-003', rank: 3, title: '아이돌 직캠에서 다시 뜬 전환 컷', channel: 'Stage Loop', template: 'Challenge Loop', category: '아이돌·팬튜브', uploaded: '3h ago', views: '1.31M', viewCount: 1310000, velocity: '+36.4K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#ec4899,#111827 58%,#050505)', hook: '음악 비트와 반복 루프가 저장/공유를 유도', retention: '81%', saveRate: '5.9%', duration: '00:18', sourceUrl: 'https://www.youtube.com/shorts/seed-003' },
  { id: 'vid-004', rank: 4, title: '출근 전 15분 루틴이 바꾼 것', channel: 'Daily Edit', template: 'IG Caption Card', category: '브이로그·일상', uploaded: '5h ago', views: '982K', viewCount: 982000, velocity: '+31.2K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#06b6d4,#111827 54%,#050505)', hook: '감정 변화 전후 + 짧은 캡션 카드', retention: '63%', saveRate: '9.7%', duration: '00:36', sourceUrl: 'https://www.youtube.com/shorts/seed-004' },
  { id: 'vid-005', rank: 5, title: 'AI로 1분 광고 만드는 실제 과정', channel: 'Prompt Studio', template: '9:16 Full Frame', category: 'IT·AI·테크', uploaded: '8h ago', views: '741K', viewCount: 741000, velocity: '+19.7K/h', saved: true, folder: '다운로드 후보', gradient: 'linear-gradient(160deg,#10b981,#111827 60%,#050505)', hook: '작업 화면 풀프레임 + 결과물 컷', retention: '71%', saveRate: '13.2%', duration: '00:58', sourceUrl: 'https://www.youtube.com/shorts/seed-005' },
  { id: 'vid-006', rank: 6, title: '올리브영 세일템 5개만 비교', channel: 'Beauty Desk', template: 'Listicle', category: '뷰티·패션', uploaded: '9h ago', views: '702K', viewCount: 702000, velocity: '+17.8K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#fb7185,#121212 55%,#050505)', hook: '가격·효과·사용컷을 5단 리스트로 압축', retention: '61%', saveRate: '7.8%', duration: '00:45', sourceUrl: 'https://www.youtube.com/shorts/seed-006' },
  { id: 'vid-007', rank: 7, title: '잘 팔리는 상세페이지 첫 화면 비교', channel: 'Commerce Cuts', template: 'Before / After', category: '리뷰·언박싱', uploaded: '1d ago', views: '613K', viewCount: 613000, velocity: '+11.5K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#f59e0b,#151515 55%,#050505)', hook: 'Before/After 분할 + 한 줄 진단', retention: '66%', saveRate: '12.5%', duration: '00:39', sourceUrl: 'https://www.youtube.com/shorts/seed-007' },
  { id: 'vid-008', rank: 8, title: '요즘 뜨는 자막 후킹 패턴 7개', channel: 'Shorts Pattern', template: 'Caption Meme', category: '잡학상식·정보', uploaded: '1d ago', views: '588K', viewCount: 588000, velocity: '+9.8K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#8b5cf6,#101010 55%,#050505)', hook: '리스트형 약속 + 빠른 예시 전환', retention: '68%', saveRate: '15.1%', duration: '00:49', sourceUrl: 'https://www.youtube.com/shorts/seed-008' },
  { id: 'vid-009', rank: 9, title: '러닝 초보가 무릎 아플 때 바꾸는 것', channel: 'Fit Minute', template: 'Tutorial Steps', category: '운동·헬스', uploaded: '1d ago', views: '431K', viewCount: 431000, velocity: '+7.2K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#22c55e,#111827 56%,#050505)', hook: '잘못된 동작→수정 동작 3단계', retention: '73%', saveRate: '10.9%', duration: '00:52', sourceUrl: 'https://www.youtube.com/shorts/seed-009' },
  { id: 'vid-010', rank: 10, title: '오늘 환율 뉴스 30초 요약', channel: 'Money Snap', template: 'News Explainer', category: '경제·주식', uploaded: '1d ago', views: '389K', viewCount: 389000, velocity: '+6.1K/h', saved: false, folder: '', gradient: 'linear-gradient(160deg,#38bdf8,#111827 56%,#050505)', hook: '뉴스 원인→영향→체크포인트 구조', retention: '58%', saveRate: '6.4%', duration: '00:30', sourceUrl: 'https://www.youtube.com/shorts/seed-010' },
];

export const seedFolders: FolderItem[] = [
  { name: '랭킹형 후킹', color: '#7170ff', desc: '숫자·순위·비교 구조' },
  { name: '커머스 레퍼런스', color: '#10b981', desc: '제품 데모와 구매 전환' },
  { name: '다운로드 후보', color: '#06b6d4', desc: '구간 다운로드할 원본' },
  { name: '자막/캡션 실험', color: '#f59e0b', desc: '자막·밈·카피 패턴' },
];

export const createSeedState = (): AppState => ({
  videos: seedVideos.map((video) => ({
    ...video,
    publishedAt: video.publishedAt ?? nullTimestampFromUploaded(video.uploaded),
    lastSampledAt: nullTimestampFromUploaded('0m ago'),
    viewsHistory: [{ at: nullTimestampFromUploaded('0m ago'), views: video.viewCount }],
  })),
  templates: seedTemplates,
  folders: seedFolders,
  downloads: [
    {
      id: 'clip-vid-005',
      videoId: 'vid-005',
      title: 'AI로 1분 광고 만드는 실제 과정',
      startSec: 3,
      endSec: 31,
      status: 'queued',
      format: 'mp4',
      aspectRatio: '9:16',
      createdAt: nullTimestampFromUploaded('0m ago'),
      policyNote: '로컬 큐에만 등록됩니다. 원본 재배포 전 권리와 플랫폼 정책을 확인하세요.',
    },
  ],
  matchReports: [],
  lastSyncedAt: null,
});

const nullTimestampFromUploaded = (uploaded: string) => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const amount = Number(uploaded.match(/(\d+)/)?.[1] ?? 0);
  const hours = uploaded.includes('m') ? amount / 60 : uploaded.includes('h') ? amount : uploaded.includes('d') ? amount * 24 : 0;
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
};
