// 유튜브 쇼츠 생태계에서 크리에이터가 실제로 쓰는 카테고리 분류 (pint.kr 벤치마킹).
export const categoryOptions = [
  '전체',
  '정치·시사',
  '경제·주식',
  '예능 짜깁기',
  '잡학상식·정보',
  '게임',
  '애니·짤형',
  '아이돌·팬튜브',
  '연애 이슈',
  '먹방·푸드',
  '뷰티·패션',
  '운동·헬스',
  '동물·펫',
  '키즈',
  'IT·AI·테크',
  '자동차',
  '여행',
  '음악·커버',
  '스포츠',
  '인스타·틱톡 짜깁기',
  'ASMR',
  '브이로그·일상',
  '리뷰·언박싱',
  '공포·미스터리',
  '자기계발',
];

export const templateOptions = ['전체', 'Ranking Hook', '9:16 Full Frame', 'IG Caption Card', 'Before / After', 'Street Interview', 'POV Story', 'Listicle', 'Tutorial Steps', 'Duet/Reaction', 'Product Demo', 'News Explainer', 'Challenge Loop', 'Caption Meme'];

// 대량 자동 수집용 시드 키워드 풀. 카테고리 생태계를 폭넓게 커버해 '한 키워드 편향'을 막는다.
// discover 수집은 이 풀을 순회하며 키워드별 인기 Shorts를 모은 뒤 breakout 점수로 거른다.
export const seedKeywords = [
  '먹방', '레시피', '맛집', '브이로그', '일상', '게임', '롤', '마인크래프트',
  '뷰티', '메이크업', '패션', '코디', '강아지', '고양이', '운동', '다이어트', '홈트',
  '연애', '썸', '정치', '시사', '주식', '코인', '부동산', '아이돌', '직캠', '컴백',
  '예능', '레전드', '하이라이트', '웹툰', '애니', '챌린지', '커버곡', '여행', '캠핑',
  '자동차', '리뷰', '꿀팁', '내돈내산', 'asmr', '축구', '손흥민', '야구', '공포', '괴담',
  '동기부여', '자기계발', '키즈', '육아', '틱톡', '릴스', 'IT', 'AI',
];

// count개 키워드를 회전 오프셋으로 선택 (수집을 반복할 때마다 다른 묶음을 돌게 한다).
export const selectSeedKeywords = (count: number, offset = 0): string[] => {
  const total = seedKeywords.length;
  const take = Math.max(1, Math.min(count, total));
  const start = ((offset % total) + total) % total;
  return Array.from({ length: take }, (_, index) => seedKeywords[(start + index) % total]);
};

// 제목·채널명 키워드로 콘텐츠 카테고리를 추론한다. 위에서부터 첫 매칭을 사용하므로
// 더 구체적인 규칙을 앞에 둔다. 매칭이 없으면 가장 포괄적인 '잡학상식·정보'로 분류.
const categoryRules: { category: string; pattern: RegExp }[] = [
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

export const inferCategory = (title: string, channel = ''): string => {
  const text = `${title} ${channel}`;
  for (const rule of categoryRules) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return '잡학상식·정보';
};
