'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, BarChart3, Check, ChevronDown, Download, Filter,
  Folder, LayoutDashboard, Library, MoreHorizontal, Play, Search,
  Sparkles, Star, TimerReset, X, ArrowLeft, ShieldCheck, SlidersHorizontal, AlertTriangle, FileVideo, ScanLine, Waves, Fingerprint,
} from 'lucide-react';
import { categoryOptions, templateOptions } from '../lib/catalog';
import {
  commentsScore, computeBaseline, durationSeconds, formatCompact, measuredVelocity, pct, scorecardCurve,
  scoreWindows, shareScore, uploadedHours, velocityNumber, vidiqMetrics,
  type ScoreWindow,
} from '../lib/metrics';
import type { AppState, ChannelSummary, DownloadClip, FolderItem, MatchReport, VideoItem } from '../lib/types';

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Trend Rankings', href: '/rankings', icon: BarChart3 },
  { label: 'Saved Library', href: '/saved', icon: Library },
  { label: 'Folders', href: '/folders', icon: Folder },
  { label: 'Download Queue', href: '/downloads', icon: Download },
  { label: 'Match Guard', href: '/match', icon: ShieldCheck },
];

const intentPresets = [
  { title: '바로 따라 만들 템플릿', desc: '재현 쉬운 구조 + 30초 내 클립', template: 'Tutorial Steps', category: '전체' },
  { title: '광고/커머스 후킹', desc: '상품 데모, 전후비교, 구매 전환형', template: 'Product Demo', category: '전체' },
  { title: '조회수 급상승 레퍼런스', desc: '카테고리 무관 전체 실시간 인기', template: '전체', category: '전체' },
  { title: '자막/밈 포맷 수집', desc: '캡션 카드, 밈, 반응형 포맷', template: 'Caption Meme', category: '전체' },
];
const filterGroups = {
  uploaded: ['전체 기간', '실시간', '업로드 24h', '업로드 3일', '14일', '30일', '60일', '90일', '180일', '1년 이상'],
  views: ['전체 조회수', '조회수 10만+', '조회수 50만+', '조회수 100만+'],
  duration: ['전체 길이', '숏츠 길이 30s↓', '숏츠 길이 60s↓'],
  language: ['전체 언어', '한국어', '영어'],
  subscribers: ['전체 규모', '소형 1만↓', '중형 10만↓', '대형 제외 100만↓'],
  sort: ['급상승순', '조회수순', '저장률순', '최신순', '댓글수순', '공유순', '급가속순'],
};
type DiscoveryFilters = { [K in keyof typeof filterGroups]: (typeof filterGroups)[K][number] };
const defaultFilters: DiscoveryFilters = { uploaded: '전체 기간', views: '전체 조회수', duration: '전체 길이', language: '한국어', subscribers: '전체 규모', sort: '급상승순' };
const filterLabelMap: Record<keyof DiscoveryFilters, string> = { uploaded: '업로드', views: '조회수', duration: '길이', language: '언어', subscribers: '채널규모', sort: '정렬' };
const filterSummary = (filters: DiscoveryFilters) => Object.values(filters).join(' · ');
const uploadWindowHours = (window: DiscoveryFilters['uploaded']) => window === '실시간' ? 1 : window === '업로드 24h' ? 24 : window === '업로드 3일' ? 72 : window === '14일' ? 336 : window === '30일' ? 720 : window === '60일' ? 1440 : window === '90일' ? 2160 : window === '180일' ? 4320 : window === '1년 이상' ? Infinity : Infinity;
// 채널규모 필터의 구독자 상한값. '전체 규모'면 null(제한 없음).
const subscriberBound = (scale: DiscoveryFilters['subscribers']): number | null => scale === '소형 1만↓' ? 10000 : scale === '중형 10만↓' ? 100000 : scale === '대형 제외 100만↓' ? 1000000 : null;
type PageKind = 'dashboard' | 'rankings' | 'saved' | 'folders' | 'downloads' | 'match';
type ActionName = 'sync' | 'save' | 'folder' | 'download' | 'match' | 'ingest' | 'youtube' | null;

const videoQueryParams = (category: string, template: string, filters: DiscoveryFilters, query: string) => {
  const params = new URLSearchParams();
  if (category !== '전체') params.set('category', category);
  if (template !== '전체') params.set('template', template);
  if (query.trim()) params.set('q', query.trim());
  params.set('uploaded', filters.uploaded);
  params.set('views', filters.views);
  params.set('duration', filters.duration);
  params.set('language', filters.language);
  if (filters.subscribers === '소형 1만↓') params.set('maxSubscribers', '1만');
  else if (filters.subscribers === '중형 10만↓') params.set('maxSubscribers', '10만');
  else if (filters.subscribers === '대형 제외 100만↓') params.set('maxSubscribers', '100만');
  params.set('sort', filters.sort);
  return params;
};

const valueFromParams = <T extends readonly string[]>(params: URLSearchParams, key: string, options: T, fallback: T[number]) => {
  const value = params.get(key);
  return options.includes(value ?? '') ? value as T[number] : fallback;
};

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
};

const requestState = (url: string, init?: RequestInit): Promise<AppState> => requestJson<AppState>(url, init);

const formatSyncTime = (value: string | null) => {
  if (!value) return '동기화 전';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
};

export function PrototypeApp({ page = 'dashboard', videoId }: { page?: PageKind; videoId?: string }) {
  const pathname = usePathname();
  const initialQueryApplied = useRef(false);
  const [query, setQuery] = useState('');
  const [activeTemplate, setActiveTemplate] = useState('전체');
  const [activeCategory, setActiveCategory] = useState('전체');
  const [filters, setFilters] = useState<DiscoveryFilters>(defaultFilters);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [selectedId, setSelectedId] = useState(videoId ?? '');
  const [folderModal, setFolderModal] = useState(false);
  const [downloadModal, setDownloadModal] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [clipStart, setClipStart] = useState(3);
  const [clipEnd, setClipEnd] = useState(31);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('API 상태를 불러오는 중');
  const [pendingAction, setPendingAction] = useState<ActionName>(null);
  const [serverVideos, setServerVideos] = useState<VideoItem[] | null>(null);
  const [serverQueryUrl, setServerQueryUrl] = useState('/api/videos');
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (initialQueryApplied.current || typeof window === 'undefined') return;
    initialQueryApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get('q') ?? '');
    setActiveCategory(valueFromParams(params, 'category', categoryOptions, '전체'));
    setActiveTemplate(valueFromParams(params, 'template', templateOptions, '전체'));
    setFilters({
      uploaded: valueFromParams(params, 'uploaded', filterGroups.uploaded, defaultFilters.uploaded),
      views: valueFromParams(params, 'views', filterGroups.views, defaultFilters.views),
      duration: valueFromParams(params, 'duration', filterGroups.duration, defaultFilters.duration),
      language: valueFromParams(params, 'language', filterGroups.language, defaultFilters.language),
      subscribers: valueFromParams(params, 'subscribers', filterGroups.subscribers, defaultFilters.subscribers),
      sort: valueFromParams(params, 'sort', filterGroups.sort, defaultFilters.sort),
    });
  }, []);

  const applyState = (nextState: AppState, preferredId?: string) => {
    setAppState(nextState);
    setSelectedId((current) => {
      const nextId = preferredId ?? current ?? videoId ?? '';
      if (nextState.videos.some((video) => video.id === nextId)) return nextId;
      if (videoId && nextState.videos.some((video) => video.id === videoId)) return videoId;
      return nextState.videos[0]?.id ?? '';
    });
  };

  const loadState = async () => {
    setLoading(true);
    setApiError(null);
    try {
      const nextState = await requestState('/api/state');
      applyState(nextState, videoId);
      setActionMessage(`마지막 동기화: ${formatSyncTime(nextState.lastSyncedAt)}`);
    } catch (error) {
      setApiError(`GET /api/state 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setActionMessage('API 연결 필요');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  useEffect(() => {
    if (videoId) setSelectedId(videoId);
  }, [videoId]);

  const postState = async (action: Exclude<ActionName, null>, url: string, body?: unknown, optimistic?: (prev: AppState) => AppState, successMessage = '변경 사항이 저장되었습니다.', method = 'POST') => {
    if (!appState) return false;
    const previous = appState;
    setPendingAction(action);
    setApiError(null);
    if (optimistic) setAppState(optimistic(previous));
    try {
      const nextState = await requestState(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      applyState(nextState, selectedId);
      setActionMessage(successMessage);
      return true;
    } catch (error) {
      setAppState(previous);
      setApiError(`${method} ${url} 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setActionMessage('변경 사항을 저장하지 못했습니다.');
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const videoState = appState?.videos ?? [];
  const templates = appState?.templates ?? [];
  const folders = appState?.folders ?? [];
  const downloads = appState?.downloads ?? [];
  const matchReports = appState?.matchReports ?? [];
  const selected = videoState.find((video) => video.id === selectedId) ?? videoState[0];

  const discoveryQuery = useMemo(() => videoQueryParams(activeCategory, activeTemplate, filters, query).toString(), [activeCategory, activeTemplate, filters, query]);

  useEffect(() => {
    if (!appState) return;
    const url = `/api/videos${discoveryQuery ? `?${discoveryQuery}` : ''}`;
    setServerQueryUrl(url);

    const controller = new AbortController();
    // 빠른 연속 필터 변경 시 200ms 디바운스 후 1회만 요청. 직전 in-flight 요청은 abort.
    const timer = setTimeout(() => {
      setServerVideos(null);
      setDiscoveryLoading(true);
      setDiscoveryError(null);

      fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.json() as Promise<{ videos: VideoItem[] }>;
        })
        .then((body) => {
          setServerVideos(body.videos);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setDiscoveryError(error instanceof Error ? error.message : '알 수 없는 오류');
        })
        .finally(() => {
          if (!controller.signal.aborted) setDiscoveryLoading(false);
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [appState, discoveryQuery]);

  useEffect(() => {
    if (!initialQueryApplied.current || typeof window === 'undefined') return;
    const supportsDiscoveryQuery = pathname === '/' || pathname === '/rankings';
    if (!supportsDiscoveryQuery) return;
    window.history.replaceState(null, '', `${pathname}${discoveryQuery ? `?${discoveryQuery}` : ''}`);
  }, [discoveryQuery, pathname]);

  const clientFilteredVideos = useMemo(() => videoState
    .filter((video) => activeCategory === '전체' || video.category === activeCategory)
    .filter((video) => activeTemplate === '전체' || video.template === activeTemplate)
    .filter((video) => filters.uploaded === '전체 기간' || (filters.uploaded === '1년 이상' ? uploadedHours(video.uploaded) >= 8760 : uploadedHours(video.uploaded) <= uploadWindowHours(filters.uploaded)))
    .filter((video) => filters.views === '전체 조회수' || video.viewCount >= Number(filters.views.match(/(\d+)/)?.[1] ?? 0) * 10000)
    .filter((video) => filters.duration === '전체 길이' || durationSeconds(video.duration) <= Number(filters.duration.match(/(\d+)/)?.[1] ?? 60))
    .filter((video) => filters.language === '전체 언어' || (video.language ?? '한국어') === filters.language)
    .filter((video) => subscriberBound(filters.subscribers) === null || video.subscriberCount == null || video.subscriberCount <= subscriberBound(filters.subscribers)!)
    .filter((video) => `${video.title} ${video.channel} ${video.template} ${video.category}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => filters.sort === '조회수순' ? b.viewCount - a.viewCount : filters.sort === '최신순' ? a.rank - b.rank : filters.sort === '저장률순' ? pct(b.saveRate) - pct(a.saveRate) : filters.sort === '댓글수순' ? commentsScore(b) - commentsScore(a) : filters.sort === '공유순' ? shareScore(b) - shareScore(a) : filters.sort === '급가속순' ? measuredVelocity(b).perHour - measuredVelocity(a).perHour : a.rank - b.rank),
  [activeCategory, activeTemplate, filters, query, videoState]);
  const filteredVideos = serverVideos ?? clientFilteredVideos;
  const activeFilter = `${filterSummary(filters)} · ${serverVideos ? 'server results' : 'local fallback'}`;
  const savedCount = videoState.filter((video) => video.saved).length;
  const folderStats = folders.map((folder) => ({ ...folder, count: videoState.filter((video) => video.folder === folder.name).length }));
  const resetDiscovery = () => { setActiveCategory('전체'); setActiveTemplate('전체'); setQuery(''); setFilters(defaultFilters); };
  const applyPreset = (preset: typeof intentPresets[number]) => { setActiveCategory(preset.category); setActiveTemplate(preset.template); setFilters(defaultFilters); };
  const toggleSaved = (id: string) => postState('save', '/api/saved', { videoId: id }, (prev) => ({ ...prev, videos: prev.videos.map((video) => video.id === id ? { ...video, saved: !video.saved } : video) }), '저장 상태가 반영되었습니다.');
  const assignFolder = (folder: string) => {
    if (!selected) return;
    void postState('folder', '/api/folders', { videoId: selected.id, folder }, (prev) => ({ ...prev, videos: prev.videos.map((video) => video.id === selected.id ? { ...video, saved: true, folder } : video) }), `${folder} 폴더에 저장했습니다.`);
    setFolderModal(false);
  };
  const addDownload = () => {
    if (!selected) return;
    if (clipEnd <= clipStart) {
      setApiError('다운로드 구간은 종료 시간이 시작 시간보다 커야 합니다.');
      setActionMessage('다운로드 구간을 다시 선택하세요.');
      return;
    }
    void postState('download', '/api/downloads', { videoId: selected.id, startSec: clipStart, endSec: clipEnd, policyAccepted: true }, undefined, '정책 확인 후 다운로드 큐에 추가했습니다.');
    setDownloadModal(false);
  };
  const runSync = () => postState('sync', '/api/sync', undefined, undefined, '라이브 인덱스를 갱신했습니다.');
  const createMatchReport = (payload?: { remakeNotes?: string; remakeTitle?: string; remakeUrl?: string }) => postState('match', '/api/match-reports', selected ? { sourceVideoId: selected.id, sourceTitle: selected.title, sourceUrl: selected.sourceUrl, ...payload } : payload, undefined, 'Match Guard 리포트를 생성했습니다.');
  const ingestReference = (payload: { category?: string; language?: string; sourceUrl?: string; template?: string; title?: string }) => postState('ingest', '/api/ingest', payload, undefined, '새 레퍼런스를 인덱스에 추가했습니다.');
  const importYoutubeKeyword = (payload: { category?: string; language?: string; query?: string; template?: string }) => postState('youtube', '/api/youtube/search', { ...payload, maxResults: 10, order: 'viewCount', regionCode: payload.language === '영어' ? 'US' : 'KR' }, undefined, 'YouTube Data API 검색 결과를 인덱스에 추가했습니다.');
  const updateDownload = (clipId: string, status: DownloadClip['status']) => postState('download', '/api/downloads', { clipId, status }, undefined, status === 'ready' ? '다운로드 클립을 ready로 표시했습니다.' : status === 'failed' ? '다운로드 클립을 failed로 표시했습니다.' : '다운로드 클립을 queued로 되돌렸습니다.', 'PATCH');
  const processDownload = (clipId: string) => postState('download', '/api/downloads/process', { clipId }, undefined, '로컬 다운로드 파이프라인을 실행했습니다.');

  if (loading) return <main className="shell appStateOnly"><section className="statePanel"><Activity size={18} /><h1>Shorts IQ 데이터를 불러오는 중입니다.</h1><p>GET /api/state 응답을 기다리고 있습니다.</p></section></main>;
  if (!appState) return <main className="shell appStateOnly"><section className="statePanel error"><AlertTriangle size={18} /><h1>API 상태를 불러오지 못했습니다.</h1><p>{apiError ?? 'AppState가 비어 있습니다.'}</p><button className="primary" onClick={loadState}><Activity size={14} /> 다시 불러오기</button></section></main>;
  if (!selected) return <main className="shell appStateOnly"><section className="statePanel error"><AlertTriangle size={18} /><h1>선택 가능한 영상이 없습니다.</h1><p>API state는 응답했지만 영상 목록이 비어 있습니다. Live sync 후 다시 확인하세요.</p><button className="primary" onClick={loadState}><Activity size={14} /> 다시 불러오기</button></section></main>;

  return (
    <main className="shell">
      <Sidebar pathname={pathname} videoCount={videoState.length} lastSyncedAt={appState.lastSyncedAt} />
      <section className="workspace">
        <Topbar query={query} setQuery={setQuery} advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} onSync={runSync} syncing={pendingAction === 'sync'} actionMessage={actionMessage} apiError={apiError} />
        {pathname !== '/' && <BackButton fallback="/" label="이전 페이지" />}
        {advancedOpen && <DiscoveryPanel activeCategory={activeCategory} activeTemplate={activeTemplate} applyPreset={applyPreset} setActiveCategory={setActiveCategory} setActiveTemplate={setActiveTemplate} />}
        {page === 'dashboard' && <DashboardPage selected={selected} peers={videoState} filteredVideos={filteredVideos} activeCategory={activeCategory} activeTemplate={activeTemplate} activeFilter={activeFilter} serverQueryUrl={serverQueryUrl} discoveryLoading={discoveryLoading} discoveryError={discoveryError} filters={filters} setFilters={setFilters} savedCount={savedCount} downloads={downloads} templates={templates} totalVideos={videoState.length} folderStats={folderStats} resetDiscovery={resetDiscovery} setActiveTemplate={setActiveTemplate} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setFolderModal={setFolderModal} setDownloadModal={setDownloadModal} clipStart={clipStart} clipEnd={clipEnd} setClipStart={setClipStart} setClipEnd={setClipEnd} assignFolder={assignFolder} pendingAction={pendingAction} onIngest={ingestReference} ingesting={pendingAction === 'ingest'} onYoutubeImport={importYoutubeKeyword} youtubeImporting={pendingAction === 'youtube'} />}
        {page === 'rankings' && <RankingsPage videos={filteredVideos} activeCategory={activeCategory} activeTemplate={activeTemplate} activeFilter={activeFilter} serverQueryUrl={serverQueryUrl} discoveryLoading={discoveryLoading} discoveryError={discoveryError} filters={filters} setFilters={setFilters} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setDownloadModal={setDownloadModal} setFolderModal={setFolderModal} pendingAction={pendingAction} />}
        {page === 'saved' && <SavedPage videos={videoState.filter((v) => v.saved)} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setDownloadModal={setDownloadModal} setFolderModal={setFolderModal} />}
        {page === 'folders' && <FoldersPage folderStats={folderStats} videos={videoState} downloads={downloads} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setDownloadModal={setDownloadModal} setFolderModal={setFolderModal} />}
        {page === 'match' && <MatchGuardPage selected={selected} report={matchReports[0]} onCreateReport={createMatchReport} creating={pendingAction === 'match'} />}
        {page === 'downloads' && <DownloadsPage downloads={downloads} videos={videoState} selected={selected} folderStats={folderStats} clipStart={clipStart} clipEnd={clipEnd} setClipStart={setClipStart} setClipEnd={setClipEnd} setSelectedId={setSelectedId} setDownloadModal={setDownloadModal} assignFolder={assignFolder} updateDownload={updateDownload} processDownload={processDownload} processing={pendingAction === 'download'} />}
      </section>
      {folderModal && <FolderModal selected={selected} folders={folders} onClose={() => setFolderModal(false)} onAssign={assignFolder} />}
      {downloadModal && <DownloadModal selected={selected} clipStart={clipStart} clipEnd={clipEnd} setClipStart={setClipStart} setClipEnd={setClipEnd} onClose={() => setDownloadModal(false)} onAdd={addDownload} />}
    </main>
  );
}

function Sidebar({ pathname, videoCount, lastSyncedAt }: { pathname: string; videoCount: number; lastSyncedAt: string | null }) {
  return <aside className="sidebar">
    <Link className="brand brandLink" href="/"><div className="brandMark"><Sparkles size={15} /></div><div><strong>Shorts IQ</strong><span>Template Intelligence</span></div></Link>
    <nav className="navGroup" aria-label="Primary">
      {navItems.map((item) => <Link className={`navItem ${pathname === item.href ? 'active' : ''}`} key={item.label} href={item.href}><item.icon size={15} /><span>{item.label}</span></Link>)}
    </nav>
    <section className="sidebarCard"><div className="miniLabel">LIVE INDEX</div><div className="pulseRow"><span className="pulse" /> {videoCount.toLocaleString()} videos tracked</div><div className="sidebarMeta">{formatSyncTime(lastSyncedAt)}</div><div className="tinyChart">{Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: `${18 + ((i * 13) % 42)}px` }} />)}</div></section>
  </aside>;
}

function BackButton({ fallback = '/', label = '이전 페이지' }: { fallback?: string; label?: string }) {
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(fallback);
  };
  return <button className="backLink backButton" type="button" onClick={goBack}><ArrowLeft size={14} /> {label}</button>;
}
function Topbar({ query, setQuery, advancedOpen, setAdvancedOpen, onSync, syncing, actionMessage, apiError }: { query: string; setQuery: (v: string) => void; advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void; onSync: () => void; syncing: boolean; actionMessage: string; apiError: string | null }) {
  return <header className="topbar"><div className="searchBox"><Search size={16} /><input aria-label="영상 검색" placeholder="영상, 채널, 템플릿, 키워드 검색..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘K</kbd></div><button className={`ghost ${advancedOpen ? 'selected' : ''}`} onClick={() => setAdvancedOpen(!advancedOpen)}><Filter size={14} /> Find videos</button><button className="primary" onClick={onSync} disabled={syncing}><Activity size={14} /> {syncing ? 'Syncing' : 'Live sync'}</button><div className={`topbarStatus ${apiError ? 'error' : ''}`} aria-live="polite" {...(apiError ? { role: 'alert' } : {})}>{apiError ? 'API 오류' : actionMessage}</div></header>;
}
function DiscoveryPanel({ activeCategory, activeTemplate, applyPreset, setActiveCategory, setActiveTemplate }: { activeCategory: string; activeTemplate: string; applyPreset: (p: typeof intentPresets[number]) => void; setActiveCategory: (v: string) => void; setActiveTemplate: (v: string) => void }) {
  return <section className="advancedPanel discoveryPanel" aria-label="Advanced filter panel"><div className="discoveryIntro"><span className="miniLabel">DISCOVERY BUILDER</span><strong>무엇을 찾고 싶은지 먼저 고르면, 카테고리와 템플릿을 좁혀줍니다.</strong><p>기본 랭킹은 항상 전체 영상 기준 실시간 인기입니다. 아래 조건은 “찾기/분석”용 필터입니다.</p></div><div className="intentGrid">{intentPresets.map((preset) => <button key={preset.title} onClick={() => applyPreset(preset)}><b>{preset.title}</b><span>{preset.desc}</span></button>)}</div><div className="taxonomyBlock"><span>카테고리</span><div>{categoryOptions.map((cat) => <button className={activeCategory === cat ? 'activeChip' : ''} key={cat} onClick={() => setActiveCategory(cat)}>{cat}</button>)}</div></div><div className="taxonomyBlock"><span>템플릿</span><div>{templateOptions.map((tpl) => <button className={activeTemplate === tpl ? 'activeChip' : ''} key={tpl} onClick={() => setActiveTemplate(tpl)}>{tpl}</button>)}</div></div></section>;
}
function Hero({ eyebrow, title, desc, stats }: { eyebrow: string; title: string; desc: string; stats?: [string, string][] }) {
  return <div className="dashboardHeader"><div><div className="eyebrow"><span /> {eyebrow}</div><h1>{title}</h1><p>{desc}</p></div><div className="headerStats">{(stats ?? [['+31.4%', 'avg velocity'], ['4.2M', 'live views']]).map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div></div>;
}
function DashboardPage(props: any) {
  return <><Hero eyebrow="REAL-TIME SHORTS RADAR" title="전체 숏츠에서 지금 뜨는 영상과 템플릿을 먼저 보여줍니다." desc="카테고리 안에 갇힌 랭킹이 아니라, 전체 실시간 인기 영상 → 템플릿 신호 → 저장/다운로드 후보로 이어지는 리서치 흐름." /><section className="kpiGrid" aria-label="Realtime metrics"><article className="kpi"><span>수집 영상</span><strong>{props.totalVideos.toLocaleString()}</strong><em>from API state</em></article><article className="kpi"><span>감지 템플릿</span><strong>{props.templates.length}</strong><em>{templateOptions.length - 1} taxonomy types</em></article><article className="kpi"><span>북마크</span><strong>{props.savedCount}</strong><em>{props.folderStats.length} folders</em></article><article className="kpi"><span>다운로드 큐</span><strong>{props.downloads.length}</strong><em>{props.downloads.filter((clip: DownloadClip) => clip.status === 'ready').length} clips ready</em></article></section><DashboardIngest activeCategory={props.activeCategory} activeTemplate={props.activeTemplate} onIngest={props.onIngest} ingesting={props.ingesting} onYoutubeImport={props.onYoutubeImport} youtubeImporting={props.youtubeImporting} /><FilterRail filters={props.filters} setFilters={props.setFilters} /><section className="contentGrid"><RankingPanel {...props} /><DetailPanel {...props} /></section></>;
}
function DashboardIngest({ activeCategory, activeTemplate, onIngest, ingesting, onYoutubeImport, youtubeImporting }: { activeCategory: string; activeTemplate: string; onIngest: (payload: { category?: string; language?: string; sourceUrl?: string; template?: string; title?: string }) => Promise<boolean>; ingesting: boolean; onYoutubeImport: (payload: { category?: string; language?: string; query?: string; template?: string }) => Promise<boolean>; youtubeImporting: boolean }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [title, setTitle] = useState('');
  const [youtubeQuery, setYoutubeQuery] = useState('');
  const [language, setLanguage] = useState<VideoItem['language']>('한국어');
  const submitIngest = async () => {
    const saved = await onIngest({
      sourceUrl: sourceUrl.trim() || undefined,
      title: title.trim() || undefined,
      category: activeCategory === '전체' ? '수동 수집' : activeCategory,
      template: activeTemplate === '전체' ? '9:16 Full Frame' : activeTemplate,
      language,
    });
    if (saved) { setSourceUrl(''); setTitle(''); }
  };
  const submitYoutubeImport = async () => {
    const saved = await onYoutubeImport({
      query: youtubeQuery.trim(),
      category: activeCategory === '전체' ? 'YouTube 수집' : activeCategory,
      template: activeTemplate === '전체' ? undefined : activeTemplate,
      language,
    });
    if (saved) setYoutubeQuery('');
  };
  return <section className="ingestRail" aria-label="데이터 수집">
    <div className="ingestRailHead"><span className="miniLabel">데이터 수집</span><p>키워드로 Shorts 후보를 모으거나 레퍼런스 URL을 직접 인덱스에 추가합니다.</p></div>
    <div className="ingestRailGrid">
      <div className="ingestBox"><span className="miniLabel">YOUTUBE DATA API</span><input aria-label="YouTube keyword" placeholder="키워드로 Shorts 후보 수집" value={youtubeQuery} onChange={(event) => setYoutubeQuery(event.target.value)} /><button className="primary wide" onClick={() => { void submitYoutubeImport(); }} disabled={youtubeImporting || !youtubeQuery.trim()}><Search size={14} /> {youtubeImporting ? 'API 수집 중' : '키워드 수집'}</button></div>
      <div className="ingestBox"><span className="miniLabel">ADD REFERENCE</span><input aria-label="YouTube Shorts URL" placeholder="YouTube Shorts URL 또는 레퍼런스 URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /><input aria-label="Manual title" placeholder="수동 제목 fallback" value={title} onChange={(event) => setTitle(event.target.value)} /><div className="segmentedMini">{(['한국어', '영어', '기타'] as const).map((item) => <button key={item} className={language === item ? 'activeChip' : ''} onClick={() => setLanguage(item)}>{item}</button>)}</div><button className="primary wide" onClick={() => { void submitIngest(); }} disabled={ingesting || (!sourceUrl.trim() && !title.trim())}><Search size={14} /> {ingesting ? '수집 중' : '레퍼런스 추가'}</button></div>
    </div>
  </section>;
}
function FilterRail({ filters, setFilters }: { filters: DiscoveryFilters; setFilters: (v: DiscoveryFilters) => void }) {
  const [openKey, setOpenKey] = useState<keyof DiscoveryFilters | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openKey) return;
    const closeOnOutside = (event: PointerEvent) => { if (railRef.current && !railRef.current.contains(event.target as Node)) setOpenKey(null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenKey(null); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [openKey]);
  const updateFilter = (key: keyof DiscoveryFilters, option: string) => { setFilters({ ...filters, [key]: option } as DiscoveryFilters); setOpenKey(null); };
  return <section ref={railRef} className="filterRail dropdownRail" aria-label="Filters">
    {(Object.keys(filterGroups) as (keyof DiscoveryFilters)[]).map((key) => <div className={`filterDropdown ${openKey === key ? 'open' : ''}`} key={key}>
      <button className="filterTrigger" type="button" aria-haspopup="listbox" aria-expanded={openKey === key} onClick={() => setOpenKey(openKey === key ? null : key)}>
        <span>{filterLabelMap[key]}</span><b>{filters[key]}</b><ChevronDown size={13} />
      </button>
      {openKey === key && <div className="filterMenu" role="listbox" aria-label={filterLabelMap[key]}>
        {filterGroups[key].map((option) => <button key={option} role="option" aria-selected={filters[key] === option} className={filters[key] === option ? 'selectedOption' : ''} onClick={() => updateFilter(key, option)}>{option}</button>)}
      </div>}
    </div>)}
    <button className="ghost small" onClick={() => { setFilters(defaultFilters); setOpenKey(null); }}><SlidersHorizontal size={13} /> 초기화</button>
  </section>;
}
function RankingPanel({ filteredVideos, activeCategory = '전체', activeTemplate = '전체', activeFilter = '전체 실시간 인기', serverQueryUrl, discoveryLoading, discoveryError, setSelectedId, toggleSaved, setDownloadModal, setFolderModal }: any) { return <div className="rankPanel"><div className="panelHead"><div><span className="miniLabel">GLOBAL LIVE RANKING</span><h2>전체 실시간 인기 영상</h2><p className="panelSub">현재 조건: {activeCategory} · {activeTemplate} · {activeFilter}</p><p className={`serverQuery ${discoveryError ? 'error' : ''}`}>{discoveryError ? `API fallback: ${discoveryError}` : `${discoveryLoading ? 'syncing' : 'server'} ${serverQueryUrl}`}</p></div><div className="panelActions"><button className="ghost small">Reset</button><button className="ghost small">Export CSV</button></div></div><div className="tableHeader"><span>Rank</span><span>Video</span><span>Template</span><span>Views</span><span>Velocity</span><span>Action</span></div><VideoRows videos={filteredVideos} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setDownloadModal={setDownloadModal} setFolderModal={setFolderModal} /></div>; }
function VideoRows({ videos: rows, setSelectedId, toggleSaved, setDownloadModal, setFolderModal }: { videos: VideoItem[]; setSelectedId: (id: string) => void; toggleSaved: (id: string) => void; setDownloadModal: (v: boolean) => void; setFolderModal: (v: boolean) => void }) { return <div className="videoRows">{rows.map((video) => <article className="videoRow" key={video.id} onClick={() => setSelectedId(video.id)}><div className="rank"><b>{video.rank}</b><em>▲ {Math.max(2, 14 - video.rank)}</em></div><div className="videoInfo"><VideoThumb video={video} /><div><h3>{video.title}</h3><p>{video.channel} · {video.uploaded} · {video.category}</p></div></div><span className="pill">{video.template}</span><strong className="mono">{video.views}</strong>{(() => { const mv = measuredVelocity(video); return <span className="velocity">+{formatCompact(mv.perHour)}/h{!mv.measured && <em className="miniLabel"> 추정</em>}</span>; })()}<div className="rowActions"><button aria-label="북마크" className={video.saved ? 'icon saved' : 'icon'} onClick={(event) => { event.stopPropagation(); toggleSaved(video.id); }}><Star size={13} /></button><button aria-label="구간 다운로드" className="icon" onClick={(event) => { event.stopPropagation(); setSelectedId(video.id); setDownloadModal(true); }}><Download size={13} /></button><button aria-label="폴더 선택" className="icon" onClick={(event) => { event.stopPropagation(); setSelectedId(video.id); setFolderModal(true); }}><MoreHorizontal size={13} /></button></div></article>)}{rows.length === 0 && <div className="emptyState">조건이 너무 좁습니다. 전체 랭킹 보기로 되돌려보세요.</div>}</div>; }
function ScorecardCurve({ selected }: { selected: VideoItem }) {
  const [window, setWindow] = useState<ScoreWindow>('All');
  const curve = scorecardCurve(selected, window);
  return <div className="scorecardChart">
    <div className="scoreTabs">{scoreWindows.map((item) => <button key={item} className={window === item ? 'active' : ''} onClick={() => setWindow(item)}>{item}</button>)}</div>
    <svg viewBox="0 0 300 160" preserveAspectRatio="none" aria-label="vidIQ scorecard cumulative views curve">
      {[36, 66, 96, 126].map((y) => <line key={y} x1="14" x2="266" y1={y} y2={y} />)}
      <path className="scoreFill" d={curve.fill} />
      <path className="scoreLine" d={curve.path} />
    </svg>
    <div className="scoreAxis y"><span>{formatCompact(curve.yMax)}</span><span>{formatCompact(curve.yMax * .75)}</span><span>{formatCompact(curve.yMax * .5)}</span><span>{formatCompact(curve.yMax * .25)}</span><span>0</span></div>
    <div className="scoreAxis x">{curve.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
  </div>;
}
function VidiqInsightPanel({ selected, peers = [], compact = false }: { selected: VideoItem; peers?: VideoItem[]; compact?: boolean }) {
  const metrics = vidiqMetrics(selected, computeBaseline(peers, selected));
  return <div className={`vidiqPanel ${compact ? 'compact' : ''}`}>
    <div className="vidiqCardTop"><div><span className="miniLabel">vidIQ SCORECARD</span><h3>Views</h3><strong>{formatCompact(selected.viewCount)}</strong></div><div className="iqBadge">IQ</div></div>
    <ScorecardCurve selected={selected} />
    <div className="vidiqMetricRows"><div><span>Uploaded</span><b>{selected.uploaded}</b></div><div><span>Views per hour</span><b>{formatCompact(metrics.vph)}</b></div><div><span>Engagement</span><b>{metrics.engagement}% <em className="miniLabel">{metrics.measured.engagement ? '측정' : '추정'}</em></b></div></div>
    <div className="vidiqScoreRow"><strong>{metrics.score}</strong><div><b>{metrics.grade}</b><span>overall score · outlier {metrics.measured.outlier === false ? '표본 부족' : `${metrics.outlier}x`}</span></div></div>
    <div className="vidiqMetricGrid">
      <span><b>{formatCompact(metrics.velocity)}</b><em>velocity · {metrics.measured.velocity ? '측정' : '추정'}</em></span>
      <span><b>{formatCompact(metrics.comments)}</b><em>comments est.</em></span>
      <span><b>{formatCompact(metrics.shares)}</b><em>shares est.</em></span>
      <span><b>{selected.saveRate}</b><em>save rate{selected.metricsProxy ? ' · 추정' : ''}</em></span>
    </div>
    <p className="insightCopy">초반 급상승 후 완만히 plateau 되는 vidIQ식 누적 조회 커브를 기준으로 VPH, outlier, engagement를 함께 판정합니다. ‘측정’은 실측 샘플, ‘추정’은 proxy 기반입니다.</p>
  </div>;
}
function DetailPanel({ selected, peers = [], folderStats, clipStart, clipEnd, setClipStart, setClipEnd, setDownloadModal, assignFolder }: any) { return <aside className="detailPanel"><div className="selectedPreview"><div className="phoneFrame"><VideoPreview video={selected} /></div><div><span className="miniLabel">SELECTED VIDEO</span><h2>{selected.title}</h2><p>{selected.template} · {selected.category} · {selected.uploaded}</p></div></div><VidiqInsightPanel selected={selected} peers={peers} /><div className="clipBox"><div className="boxHead"><Download size={14} /> 구간 선택 다운로드</div><div className="timeline"><span style={{ left: `${clipStart * 2}%` }} /><span style={{ left: `${clipEnd * 2}%` }} /><div style={{ left: `${clipStart * 2}%`, right: `${100 - clipEnd * 2}%` }} /></div><div className="timeInputs"><button onClick={() => setClipStart(3)}>00:{String(clipStart).padStart(2, '0')}</button><button onClick={() => setClipEnd(31)}>00:{String(clipEnd).padStart(2, '0')}</button><button onClick={() => setDownloadModal(true)}>{clipEnd - clipStart}s clip</button></div></div><div className="folderBox"><div className="boxHead"><Archive size={14} /> Raindrop-style folders</div>{folderStats.map((folder: any) => <button className={`folderItem ${selected.folder === folder.name ? 'currentFolder' : ''}`} key={folder.name} onClick={() => assignFolder(folder.name)}><i style={{ background: folder.color }} /><span>{folder.name}</span><em>{folder.count}</em></button>)}</div></aside>; }
function RankingsPage(props: any) {
  const [tab, setTab] = useState<'videos' | 'channels'>('videos');
  return <><Hero eyebrow="TREND RANKINGS" title="실시간 인기 영상과 채널을 한 화면에서." desc="전체 영상 기준 실시간 인기 랭킹과, 그 영상을 만든 채널 단위 성장 랭킹을 탭으로 나눠 봅니다." stats={[[String(props.videos.length), 'visible videos'], ['+78.1K/h', 'top velocity']]} />
    <section className="rankTabs" aria-label="랭킹 탭">
      <button className={tab === 'videos' ? 'active' : ''} onClick={() => setTab('videos')}>인기 영상</button>
      <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>인기 채널</button>
    </section>
    {tab === 'videos'
      ? <><FilterRail filters={props.filters} setFilters={props.setFilters} /><section className="widePanel"><RankingPanel filteredVideos={props.videos} {...props} /></section></>
      : <ChannelsTab onPickVideo={(id) => { props.setSelectedId(id); setTab('videos'); }} />}
  </>;
}
const channelSortOptions = [
  { key: '조회수합계순', label: '조회수 합계' },
  { key: '급성장순', label: '급성장' },
  { key: '구독자순', label: '구독자순' },
] as const;
function ChannelsTab({ onPickVideo }: { onPickVideo: (id: string) => void }) {
  const [sort, setSort] = useState<typeof channelSortOptions[number]['key']>('조회수합계순');
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/channels?sort=${encodeURIComponent(sort)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json() as Promise<{ channels: ChannelSummary[]; total: number }>;
      })
      .then((body) => { if (!cancelled) setChannels(body.channels); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '알 수 없는 오류'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sort]);
  return <section className="widePanel"><div className="rankPanel">
    <div className="panelHead"><div><span className="miniLabel">CHANNEL LIVE RANKING</span><h2>실시간 인기 채널</h2><p className="panelSub">전체 영상에서 집계한 채널 단위 성장 랭킹입니다.</p><p className={`serverQuery ${error ? 'error' : ''}`}>{error ? `API fallback: ${error}` : `${loading ? 'syncing' : 'server'} /api/channels?sort=${sort}`}</p></div>
      <div className="channelSortRow">{channelSortOptions.map((option) => <button key={option.key} className={`ghost small ${sort === option.key ? 'selected' : ''}`} onClick={() => setSort(option.key)}>{option.label}</button>)}</div>
    </div>
    <div className="tableHeader channelHeader"><span>Rank</span><span>Channel</span><span>Subs</span><span>Views</span><span>Growth</span><span>Velocity</span></div>
    <div className="videoRows">
      {(channels ?? []).map((channel, index) => <article className="videoRow channelRow" key={channel.channelId ?? channel.channel}>
        <div className="rank"><b>{index + 1}</b></div>
        {channel.topVideoId
          ? <button type="button" className="videoInfo videoInfoButton" onClick={() => onPickVideo(channel.topVideoId!)}><ChannelThumb channel={channel} /><div><h3>{channel.channel}</h3><p>{channel.videoCount} videos · {channel.topCategory} · 대표 {channel.topVideoTitle ?? '—'}</p></div></button>
          : <div className="videoInfo"><ChannelThumb channel={channel} /><div><h3>{channel.channel}</h3><p>{channel.videoCount} videos · {channel.topCategory}</p></div></div>}
        <strong className="mono">{channel.subscriberCount == null ? '—' : formatCompact(channel.subscriberCount)}</strong>
        <strong className="mono">{formatCompact(channel.totalViews)}</strong>
        <span className="velocity">{channel.growthRatio.toFixed(1)}x</span>
        <span className="velocity">{channel.topVelocity}</span>
      </article>)}
      {!loading && (channels ?? []).length === 0 && <div className="emptyState">집계된 채널이 없습니다. Live sync 후 다시 확인하세요.</div>}
      {loading && channels === null && <div className="emptyState">채널 랭킹을 불러오는 중입니다.</div>}
    </div>
  </div></section>;
}
function ChannelThumb({ channel }: { channel: ChannelSummary }) {
  return <div className={`thumb ${channel.thumbnailUrl ? 'hasImage' : ''}`} style={{ background: channel.gradient }} aria-label={`${channel.channel} thumbnail`}>{channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Play size={16} />}<span>{channel.topCategory}</span></div>;
}
const youtubeIdFromUrl = (sourceUrl?: string) => {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (!url.hostname.includes('youtube.com')) return null;
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/').filter(Boolean)[1] ?? null;
    return url.searchParams.get('v');
  } catch {
    return null;
  }
};
const previewLabel = (video: VideoItem) => video.sourceKind === 'youtube-api' ? 'YouTube API' : video.sourceKind === 'youtube-oembed' ? 'oEmbed' : video.sourceKind === 'manual' ? 'Manual' : 'Seed';
function VideoThumb({ video }: { video: VideoItem }) {
  const [hover, setHover] = useState(false);
  const youtubeId = youtubeIdFromUrl(video.sourceUrl);
  return <div className={`thumb ${video.thumbnailUrl ? 'hasImage' : ''}`} style={{ background: video.gradient }} aria-label={`${video.title} thumbnail`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Play size={16} />}{hover && youtubeId && <iframe className="thumbPreview" title={`${video.title} preview`} src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${youtubeId}&playsinline=1`} frameBorder={0} allow="autoplay" />}<span>{previewLabel(video)}</span></div>;
}
function VideoPreview({ video, size = 'compact' }: { video: VideoItem; size?: 'compact' | 'large' }) {
  const [hover, setHover] = useState(false);
  const youtubeId = youtubeIdFromUrl(video.sourceUrl);
  const href = youtubeId ? `https://www.youtube.com/shorts/${youtubeId}` : video.sourceUrl;
  const body = <div className={`videoPreviewMedia ${video.thumbnailUrl ? 'hasImage' : ''}`} style={{ background: video.gradient }}>{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Play size={size === 'large' ? 34 : 22} />}{hover && youtubeId && <iframe className="previewVideo" title={`${video.title} preview`} src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${youtubeId}&playsinline=1`} frameBorder={0} allow="autoplay" />}<div className="previewScrim" /><div className="previewPlay"><Play size={size === 'large' ? 18 : 14} /></div><div className="previewMeta"><span>{previewLabel(video)}</span><b>{video.duration}</b></div></div>;
  const handlers = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  return href ? <a className={`videoPreviewFrame ${size}`} href={href} target="_blank" rel="noreferrer" aria-label={`${video.title} preview`} {...handlers}>{body}</a> : <div className={`videoPreviewFrame ${size}`} {...handlers}>{body}</div>;
}
function SavedPage(props: any) { return <><Hero eyebrow="SAVED LIBRARY" title="저장한 영상과 템플릿을 작업 보드처럼 관리합니다." desc="Raindrop처럼 저장하되, 숏츠 제작 관점의 폴더·태그·다운로드 후보로 이어집니다." stats={[[String(props.videos.length), 'saved now'], ['4', 'folders']]} /><section className="widePanel"><RankingPanel filteredVideos={props.videos} activeCategory="저장됨" activeTemplate="전체" activeFilter="Saved" {...props} /></section></>; }
function FoldersPage({ folderStats, videos: rows, downloads, setSelectedId, toggleSaved, setDownloadModal, setFolderModal }: { folderStats: FolderItem[]; videos: VideoItem[]; downloads: DownloadClip[]; setSelectedId: (id: string) => void; toggleSaved: (id: string) => void; setDownloadModal: (v: boolean) => void; setFolderModal: (v: boolean) => void }) {
  const [activeFolder, setActiveFolder] = useState(folderStats.find((folder) => (folder.count ?? 0) > 0)?.name ?? folderStats[0]?.name ?? '');
  useEffect(() => {
    if (folderStats.some((folder) => folder.name === activeFolder)) return;
    setActiveFolder(folderStats.find((folder) => (folder.count ?? 0) > 0)?.name ?? folderStats[0]?.name ?? '');
  }, [activeFolder, folderStats]);

  const selectedFolder = folderStats.find((folder) => folder.name === activeFolder) ?? folderStats[0];
  const folderVideos = selectedFolder ? rows.filter((video) => video.folder === selectedFolder.name) : [];
  const folderDownloadCount = downloads.filter((clip) => folderVideos.some((video) => video.id === clip.videoId)).length;
  const templateCounts = Array.from(folderVideos.reduce((map, video) => map.set(video.template, (map.get(video.template) ?? 0) + 1), new Map<string, number>()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const totalItems = folderStats.reduce((sum, folder) => sum + (folder.count ?? 0), 0);
  const topVelocity = [...folderVideos].sort((a, b) => velocityNumber(b) - velocityNumber(a))[0]?.velocity ?? '+0.0K/h';

  return <><Hero eyebrow="FOLDERS" title="레퍼런스를 목적별 컬렉션으로 정리합니다." desc="각 폴더는 영상 저장소가 아니라 제작 목적에 맞춘 리서치 묶음입니다." stats={[[String(folderStats.length), 'folders'], [String(totalItems), 'items']]} />
    <section className="folderGridLarge" aria-label="Folder collections">{folderStats.map((folder) => {
      const previews = rows.filter((video) => video.folder === folder.name).slice(0, 3);
      return <button type="button" className={`folderCardLarge folderCardButton ${folder.name === activeFolder ? 'selectedFolderCard' : ''}`} key={folder.name} onClick={() => setActiveFolder(folder.name)} aria-pressed={folder.name === activeFolder}><i style={{ background: folder.color }} /><h2>{folder.name}</h2><p>{folder.desc}</p><strong>{folder.count ?? 0} items</strong><div className="folderPreviewStack">{previews.length ? previews.map((v) => <span key={v.id} style={{ background: v.gradient }} />) : <em>empty</em>}</div></button>;
    })}</section>
    <section className="folderWorkspace">
      <aside className="folderSummaryPanel">
        <span className="miniLabel">ACTIVE COLLECTION</span>
        <h2>{selectedFolder?.name ?? '폴더 없음'}</h2>
        <p>{selectedFolder?.desc ?? '저장한 레퍼런스가 없습니다.'}</p>
        <div className="folderMetrics">
          <div><b>{folderVideos.length}</b><span>references</span></div>
          <div><b>{folderDownloadCount}</b><span>clips</span></div>
          <div><b>{topVelocity}</b><span>top velocity</span></div>
        </div>
        <div className="folderTemplateList">{templateCounts.length ? templateCounts.map(([name, count]) => <button type="button" key={name}><span>{name}</span><em>{count}</em></button>) : <div className="emptyState compact">이 폴더에는 아직 템플릿 신호가 없습니다.</div>}</div>
      </aside>
      <div className="rankPanel folderCollectionPanel"><div className="panelHead"><div><span className="miniLabel">FOLDER REFERENCES</span><h2>{selectedFolder?.name ?? '컬렉션'} 영상</h2><p className="panelSub">폴더 안에서 바로 영상 상세, 다운로드, 폴더 재분류로 이어집니다.</p><p className="serverQuery">server /api/folders?folder={encodeURIComponent(selectedFolder?.name ?? '')}</p></div></div><div className="tableHeader"><span>Rank</span><span>Video</span><span>Template</span><span>Views</span><span>Velocity</span><span>Action</span></div><VideoRows videos={folderVideos} setSelectedId={setSelectedId} toggleSaved={toggleSaved} setDownloadModal={setDownloadModal} setFolderModal={setFolderModal} /></div>
    </section>
  </>;
}

function MatchGuardPage({ selected, report, onCreateReport, creating }: { selected: VideoItem; report?: MatchReport; onCreateReport: (payload?: { remakeNotes?: string; remakeTitle?: string; remakeUrl?: string }) => void; creating: boolean }) {
  const [remakeTitle, setRemakeTitle] = useState(report?.remakeTitle || `${selected.title} 리메이크 초안`);
  const [remakeUrl, setRemakeUrl] = useState(report?.remakeUrl || '');
  const [remakeNotes, setRemakeNotes] = useState('새 촬영, 다른 음원, 훅과 CTA 순서 변경');
  useEffect(() => {
    if (!report) setRemakeTitle(`${selected.title} 리메이크 초안`);
  }, [selected.id, selected.title, report]);
  const signalIcon = (label: string) => label.includes('사운드') ? Waves : label.includes('픽셀') || label.includes('프레임') ? ScanLine : label.includes('구조') ? Fingerprint : FileVideo;
  const signals = report?.signals ?? [
    { label: '텍스트/키워드', score: '대기', note: '리포트를 생성하면 제목·자막 키워드 비교 결과가 표시됩니다.' },
    { label: '사운드 핑거프린트', score: '대기', note: 'BGM·효과음·음성 톤 비교를 기다리는 중입니다.' },
    { label: '픽셀/프레임', score: '대기', note: '프레임 유사도 분석을 기다리는 중입니다.' },
    { label: '구조/전개', score: '대기', note: '훅→증거→CTA 구조 비교를 기다리는 중입니다.' },
  ];
  const policyChecks = report?.policyChecks ?? [
    { name: 'Reused content', status: '검토' as const, desc: '아직 리포트가 없습니다. 강력 검수 리포트를 생성하세요.' },
    { name: 'Misleading metadata', status: '검토' as const, desc: '제목/태그/썸네일 일치 여부를 API 리포트에서 확인합니다.' },
    { name: 'Copyright / Content ID', status: '검토' as const, desc: '원본 음원·화면·로고 재사용 여부를 API 리포트에서 확인합니다.' },
  ];
  const submitReport = () => onCreateReport({
    remakeNotes: remakeNotes.trim() || undefined,
    remakeTitle: remakeTitle.trim() || undefined,
    remakeUrl: remakeUrl.trim() || undefined,
  });
  return <><Hero eyebrow="VIDEO MATCH GUARD" title="원본 vs 재각색 영상의 일치율과 유튜브 위반 리스크를 함께 봅니다." desc="낮은 일치율만 보지 않고, 키워드·사운드·픽셀값 치환으로 0%처럼 보이는 케이스도 구조/정책 기준으로 재검수합니다." stats={[[report?.matchScore ?? 'Pending', 'match score'], [report?.risk ?? 'Not run', 'policy scrutiny']]} />
    <section className="matchGrid">
      <article className="matchUploadPanel"><div className="panelHead slim"><div><span className="miniLabel">SOURCE INPUT</span><h2>원본 영상</h2></div><button className="ghost small">선택됨</button></div><div className="matchDropzone"><FileVideo size={24} /><strong>{report?.sourceTitle ?? selected.title}</strong><span>{selected.sourceUrl ?? '현재 선택한 영상의 메타데이터를 기준값으로 사용'}</span></div><div className="fingerprintBars"><i style={{width:'86%'}}/><i style={{width:'72%'}}/><i style={{width:'64%'}}/><i style={{width:'91%'}}/></div></article>
      <article className="matchUploadPanel remake"><div className="panelHead slim"><div><span className="miniLabel">REMAKE INPUT</span><h2>재각색·리메이크 영상</h2></div><button className="ghost small">API draft</button></div><div className="matchDropzone"><Play size={24} /><strong>{report?.remakeTitle ?? remakeTitle}</strong><span>{(report?.remakeUrl ?? remakeUrl) || '입력값으로 POST /api/match-reports 리포트를 생성합니다.'}</span></div><div className="matchInputStack"><input aria-label="Remake title" value={remakeTitle} onChange={(event) => setRemakeTitle(event.target.value)} placeholder="리메이크 제목 또는 초안명" /><input aria-label="Remake URL" value={remakeUrl} onChange={(event) => setRemakeUrl(event.target.value)} placeholder="리메이크 URL 또는 초안 링크" /><textarea aria-label="Remake notes" value={remakeNotes} onChange={(event) => setRemakeNotes(event.target.value)} placeholder="음원, 화면, 구조 변경 메모" /></div><div className="fingerprintBars alt"><i style={{width:'14%'}}/><i style={{width:'9%'}}/><i style={{width:'22%'}}/><i style={{width:'48%'}}/></div></article>
      <article className="matchScorePanel"><span className="miniLabel">LOWER IS BETTER</span><div className="scoreDial"><strong>{report?.matchScore ?? '--'}</strong><span>일치율</span></div><p>{report ? `${formatSyncTime(report.createdAt)} 생성된 최신 검수 리포트입니다. 정책 리스크: ${report.risk}.` : '아직 생성된 Match Guard 리포트가 없습니다. 선택한 영상을 기준으로 리메이크 입력값을 검수하세요.'}</p><button className="primary wide" onClick={submitReport} disabled={creating || !remakeTitle.trim()}><ShieldCheck size={14}/> {creating ? '리포트 생성 중' : '강력 검수 리포트 생성'}</button></article>
    </section>
    <section className="signalGrid">{signals.map((signal) => { const Icon = signalIcon(signal.label); return <article key={signal.label}><Icon size={15}/><span>{signal.label}</span><strong>{signal.score}</strong><p>{signal.note}</p></article>; })}</section>
    <section className="policyPanel"><div className="panelHead"><div><span className="miniLabel">YOUTUBE GUIDELINE REVIEW</span><h2>유튜브 가이드라인 위반 기준 강력 검수</h2><p className="panelSub">일치율이 낮아도 재사용 콘텐츠·오해 유발 메타데이터·저작권·반복 생산 리스크를 별도로 판정합니다.</p></div><AlertTriangle size={18}/></div><div className="policyRows">{policyChecks.map(({ name, status, desc }) => <div key={name} className={status === '통과' ? 'pass' : status === '주의' ? 'warn' : 'review'}><b>{name}</b><span>{status}</span><p>{desc}</p></div>)}</div></section>
  </>;
}

function DownloadsPage({ downloads, videos, selected, folderStats, clipStart, clipEnd, setClipStart, setClipEnd, setSelectedId, setDownloadModal, assignFolder, updateDownload, processDownload, processing }: { downloads: DownloadClip[]; videos: VideoItem[]; selected: VideoItem; folderStats: FolderItem[]; clipStart: number; clipEnd: number; setClipStart: (value: number) => void; setClipEnd: (value: number) => void; setSelectedId: (id: string) => void; setDownloadModal: (value: boolean) => void; assignFolder: (folder: string) => void; updateDownload: (clipId: string, status: DownloadClip['status']) => void; processDownload: (clipId: string) => void; processing: boolean }) {
  const avgClip = downloads.length ? Math.round(downloads.reduce((sum, clip) => sum + Math.max(0, clip.endSec - clip.startSec), 0) / downloads.length) : 0;
  const videoById = new Map(videos.map((video) => [video.id, video]));
  return <><Hero eyebrow="DOWNLOAD QUEUE" title="필요한 구간만 잘라서 다운로드 큐로 넘깁니다." desc="영상 전체가 아니라 훅, 전환, CTA 구간을 선택해 레퍼런스 클립으로 저장하는 흐름입니다." stats={[[String(downloads.length), 'clips'], [`${avgClip}s`, 'avg clip']]} /><section className="downloadQueueGrid"><div className="queueList">{downloads.map((clip, i) => { const video = videoById.get(clip.videoId); return <article className={`queueItem ${clip.status}`} key={clip.id}><button className="queueMain" onClick={() => setSelectedId(clip.videoId)}><span>#{i + 1}</span>{video && <VideoThumb video={video} />}<h3>{clip.title}</h3><p>00:{String(clip.startSec).padStart(2, '0')}-00:{String(clip.endSec).padStart(2, '0')} · {clip.format.toUpperCase()} · {clip.aspectRatio} · {clip.status}</p><em>{clip.error ?? clip.outputPath ?? clip.policyNote}</em></button><div className="queueActions"><button className="ghost small nowrap" onClick={() => { setSelectedId(clip.videoId); setDownloadModal(true); }}>구간 조정</button><button className={`ghost small nowrap processAction ${clip.status === 'ready' ? 'activeStatus' : clip.status === 'failed' ? 'warning' : ''}`} aria-pressed={clip.status === 'ready'} disabled={processing || clip.status === 'processing' || clip.status === 'ready'} onClick={() => processDownload(clip.id)}>{clip.status === 'processing' ? 'Processing' : clip.status === 'failed' ? 'Retry' : clip.status === 'ready' ? 'Ready' : 'Process'}</button></div></article>; })}{downloads.length === 0 && <div className="emptyState">다운로드 큐가 비어 있습니다. 영상에서 구간 다운로드를 추가하세요.</div>}</div><DetailPanel selected={selected} folderStats={folderStats} clipStart={clipStart} clipEnd={clipEnd} setClipStart={setClipStart} setClipEnd={setClipEnd} setDownloadModal={setDownloadModal} assignFolder={assignFolder} /></section></>;
}
// 모달 접근성: 마운트 시 첫 focusable로 focus 이동, Tab/Shift+Tab을 ref 내부에서 순환,
// Escape로 닫기, 언마운트 시 직전 활성 요소로 focus 복원.
function useModalA11y(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = ref.current;
    const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(container?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement);

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !container?.contains(active)) { event.preventDefault(); last.focus(); }
      } else if (active === last || !container?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, onClose]);
}

function FolderModal({ selected, folders, onClose, onAssign }: { selected: VideoItem; folders: FolderItem[]; onClose: () => void; onAssign: (folder: string) => void }) {
  const cardRef = useRef<HTMLElement | null>(null);
  useModalA11y(cardRef, onClose);
  return <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="폴더 선택" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={cardRef} className="modalCard compactModal"><div className="modalHead"><div><span className="miniLabel">SAVE TO FOLDER</span><h2>{selected.title}</h2></div><button className="icon" onClick={onClose}><X size={14} /></button></div><div className="modalList">{folders.map((folder) => <button key={folder.name} onClick={() => onAssign(folder.name)}><i style={{ background: folder.color }} /><span>{folder.name}</span>{selected.folder === folder.name && <Check size={14} />}</button>)}</div></section></div>;
}
function DownloadModal({ selected, clipStart, clipEnd, setClipStart, setClipEnd, onClose, onAdd }: { selected: VideoItem; clipStart: number; clipEnd: number; setClipStart: (value: number) => void; setClipEnd: (value: number) => void; onClose: () => void; onAdd: () => void }) {
  const clipLength = clipEnd - clipStart;
  const rangeInvalid = clipLength <= 0;
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  useModalA11y(cardRef, onClose);
  return <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="구간 선택 다운로드" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={cardRef} className="modalCard downloadModal"><div className="modalHead"><div><span className="miniLabel">CLIP DOWNLOAD</span><h2>{selected.title}</h2></div><button className="icon" onClick={onClose}><X size={14} /></button></div><div className="downloadWorkspace"><div className="largePhone"><VideoPreview video={selected} size="large" /></div><div className="downloadControls"><div className={`downloadMetric ${rangeInvalid ? 'invalid' : ''}`}><TimerReset size={15} /><span>{Math.max(0, clipLength)}s selected</span><strong>00:{String(clipStart).padStart(2, '0')}–00:{String(clipEnd).padStart(2, '0')}</strong></div><div className="rangePair"><label>Start<input type="range" min="0" max="40" value={clipStart} onChange={(event) => setClipStart(Number(event.target.value))} aria-invalid={rangeInvalid} /></label><label>End<input type="range" min="10" max="50" value={clipEnd} onChange={(event) => setClipEnd(Number(event.target.value))} aria-invalid={rangeInvalid} /></label></div>{rangeInvalid && <p className="clipRangeError">종료 시간은 시작 시간보다 커야 합니다. 큐 추가는 유효한 구간에서만 가능합니다.</p>}<label className="policyConfirm"><input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span><b>정책 확인</b> 원본 재배포가 아니라 내부 레퍼런스 구간 큐로만 등록하며, 게시 전 저작권·플랫폼 정책을 별도 검토합니다.</span></label><div className="presetGrid">{[15, 30, 45].map((seconds) => <button key={seconds} onClick={() => { setClipStart(3); setClipEnd(3 + seconds); }}>{seconds}s preset</button>)}</div><button className="primary wide" onClick={() => { if (!rangeInvalid && policyAccepted) onAdd(); }} disabled={rangeInvalid || !policyAccepted}><Download size={14} /> 다운로드 큐에 추가</button></div></div></section></div>;
}
