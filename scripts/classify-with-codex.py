# Codex CLI(ChatGPT 로그인 인증, gpt-5.5)로 .data 영상을 25개 카테고리로 재분류한다.
# API 과금 없이 구독 인증 사용. 배치 단위로 codex exec를 호출해 JSON 결과를 파싱.
import json, subprocess, re, shutil, sys

DATA = '.data/shorts-iq.json'
CATS = [
    '정치·시사','경제·주식','예능 짜깁기','잡학상식·정보','게임','애니·짤형','아이돌·팬튜브',
    '연애 이슈','먹방·푸드','뷰티·패션','운동·헬스','동물·펫','키즈','IT·AI·테크','자동차','여행',
    '음악·커버','스포츠','인스타·틱톡 짜깁기','ASMR','브이로그·일상','리뷰·언박싱','공포·미스터리','자기계발',
]
BATCH = 40

shutil.copyfile(DATA, DATA + '.pre-codex.bak')
data = json.load(open(DATA, encoding='utf-8'))
videos = data['videos']
updated = 0

for i in range(0, len(videos), BATCH):
    batch = videos[i:i+BATCH]
    items = [{'id': v['id'], 'title': v['title'][:90], 'channel': v.get('channel', '')[:30]} for v in batch]
    prompt = (
        'Output ONLY a compact JSON array, no prose, no markdown, no code fences. '
        'Classify each Korean YouTube Shorts video into exactly ONE category from this exact list: '
        + json.dumps(CATS, ensure_ascii=False)
        + '. Use title language/hashtags/channel as cues; never output a category outside the list; '
        'if ambiguous pick the closest. Videos: '
        + json.dumps(items, ensure_ascii=False)
        + '. Output: [{"id":"...","category":"..."}, ...]'
    )
    try:
        r = subprocess.run(
            ['codex', 'exec', '--skip-git-repo-check', '-c', 'model_reasoning_effort="low"', '-'],
            input=prompt, capture_output=True, text=True, cwd='/tmp', timeout=300,
        )
        matches = re.findall(r'\[\s*\{"id".*?\}\s*\]', r.stdout, re.S)
        if matches:
            res = json.loads(matches[-1])
            cmap = {x['id']: x['category'] for x in res if x.get('category') in CATS}
            for v in batch:
                if v['id'] in cmap and v['category'] != cmap[v['id']]:
                    v['category'] = cmap[v['id']]
                    updated += 1
            print(f'batch {i//BATCH+1}/{(len(videos)+BATCH-1)//BATCH}: {len(cmap)}/{len(batch)} classified', flush=True)
        else:
            print(f'batch {i//BATCH+1}: NO JSON in output', flush=True)
    except Exception as e:
        print(f'batch {i//BATCH+1}: ERROR {e}', flush=True)

json.dump(data, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
dist = {}
for v in videos:
    dist[v['category']] = dist.get(v['category'], 0) + 1
print(f'\nupdated {updated}/{len(videos)} videos')
print('distribution:', json.dumps(dist, ensure_ascii=False))
