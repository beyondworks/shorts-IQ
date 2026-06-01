// 일회성: .data/shorts-iq.json의 기존 영상 카테고리를 새 분류 체계로 재매핑한다.
// seed 영상은 id 매핑, 그 외(youtube/manual)는 inferCategory 규칙(catalog.ts와 동기화)으로 재분류.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const categoryOptions = [
  '전체', '정치·시사', '경제·주식', '예능 짜깁기', '잡학상식·정보', '게임', '애니·짤형',
  '아이돌·팬튜브', '연애 이슈', '먹방·푸드', '뷰티·패션', '운동·헬스', '동물·펫', '키즈',
  'IT·AI·테크', '자동차', '여행', '음악·커버', '스포츠', '인스타·틱톡 짜깁기', 'ASMR',
  '브이로그·일상', '리뷰·언박싱', '공포·미스터리', '자기계발',
];

const categoryRules = [
  { category: 'ASMR', pattern: /asmr|이팅사운드|이팅 사운드/i },
  { category: '정치·시사', pattern: /정치|대통령|국회|선거|시사|논란|속보|여당|야당|정부/ },
  { category: '경제·주식', pattern: /주식|증시|코인|비트코인|부동산|재테크|경제|환율|투자|금리|연봉|월급/ },
  { category: '게임', pattern: /게임|롤|lol|마크|마인크래프트|배그|발로란트|피파|게이밍|플레이|롤토체스|메이플/i },
  { category: '애니·짤형', pattern: /애니|만화|웹툰|성우|애니메이션|짤방|밈|드립/ },
  { category: '아이돌·팬튜브', pattern: /아이돌|직캠|컴백|무대|뮤직뱅크|kpop|아이브|뉴진스|데뷔|팬튜브|입덕|최애/i },
  { category: '연애 이슈', pattern: /연애|썸|이별|소개팅|커플|환승|결혼|데이트|짝사랑|고백/ },
  { category: '먹방·푸드', pattern: /먹방|레시피|맛집|요리|푸드|편의점|디저트|쿠킹|먹어본|존맛|음식/ },
  { category: '뷰티·패션', pattern: /메이크업|뷰티|화장|올리브영|패션|코디|스타일링|네일|헤어|쿠션|립/ },
  { category: '운동·헬스', pattern: /운동|헬스|다이어트|홈트|러닝|요가|근육|스쿼트|피트니스|바디프로필/ },
  { category: '동물·펫', pattern: /강아지|고양이|반려|냥이|댕댕|멍멍|펫|햄스터|앵무/ },
  { category: '키즈', pattern: /키즈|육아|어린이|장난감|키즈카페|아기|초등/ },
  { category: 'IT·AI·테크', pattern: /\bai\b|gpt|코딩|프로그래밍|테크|아이폰|갤럭시|프롬프트|챗봇|노코드|자동화|앱개발/i },
  { category: '자동차', pattern: /자동차|차량|드라이브|전기차|테슬라|시승|\bcar\b/i },
  { category: '여행', pattern: /여행|travel|관광|호텔|캠핑|백패킹|국내여행|해외여행/i },
  { category: '음악·커버', pattern: /커버곡|버스킹|악기|기타연주|피아노|보컬|cover|노래방/i },
  { category: '스포츠', pattern: /축구|야구|농구|월드컵|손흥민|골프|경기|올림픽|배구/ },
  { category: '인스타·틱톡 짜깁기', pattern: /틱톡|인스타|릴스|tiktok|reels|숏박스/i },
  { category: '리뷰·언박싱', pattern: /리뷰|언박싱|내돈내산|비교|추천템|review|꿀템|가성비/i },
  { category: '공포·미스터리', pattern: /공포|괴담|미스터리|무서운|귀신|호러|썰|실화/ },
  { category: '자기계발', pattern: /동기부여|자기계발|성공|습관|마인드셋|명언|루틴|생산성/ },
  { category: '예능 짜깁기', pattern: /예능|짜깁기|레전드|하이라이트|방송클립|짤편집|클립/ },
  { category: '브이로그·일상', pattern: /브이로그|vlog|일상|데일리/i },
];

const inferCategory = (title, channel = '') => {
  const text = `${title} ${channel}`;
  for (const rule of categoryRules) if (rule.pattern.test(text)) return rule.category;
  return '잡학상식·정보';
};

const seedMap = {
  'vid-001': '먹방·푸드', 'vid-002': '잡학상식·정보', 'vid-003': '아이돌·팬튜브',
  'vid-004': '브이로그·일상', 'vid-005': 'IT·AI·테크', 'vid-006': '뷰티·패션',
  'vid-007': '리뷰·언박싱', 'vid-008': '잡학상식·정보', 'vid-009': '운동·헬스', 'vid-010': '경제·주식',
};

const path = process.env.SHORTS_IQ_DATA_PATH || '.data/shorts-iq.json';
copyFileSync(path, `${path}.pre-category.bak`);
const data = JSON.parse(readFileSync(path, 'utf8'));
let migrated = 0;
for (const video of data.videos) {
  const before = video.category;
  if (seedMap[video.id]) video.category = seedMap[video.id];
  else if (!categoryOptions.includes(video.category)) video.category = inferCategory(video.title, video.channel);
  if (video.category !== before) migrated += 1;
}
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`migrated ${migrated}/${data.videos.length} videos. backup: ${path}.pre-category.bak`);
const dist = {};
for (const v of data.videos) dist[v.category] = (dist[v.category] ?? 0) + 1;
console.log('category distribution:', dist);
