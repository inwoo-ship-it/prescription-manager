// ═══════════════════════════════════════════════════════
// 처방전 관리 시스템 — app.js
// ═══════════════════════════════════════════════════════

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwiNuRBcMxV9J2d0M320ljuYnG0JyZyteAPOE9Ti2rfqXUn6tuyoXRX3SMPR547KNk4/exec';
const CACHE_KEY  = 'rx_data_cache';

// ── 상태 ──────────────────────────────────────────────
let allData    = [];
let allGroups  = [];
let editingId  = null;
let filterStatusVal = '';   // 기본: 미처리+처리중 강조
let filterTypeVal   = '';
let filterUrgentOnly = false;  // 마감 임박 필터
let activeSections  = new Set(['미처리','처리중']);  // 기본 펼침

const TODAY = new Date().toISOString().split('T')[0];

// ── 유형별 처리여부 옵션 ─────────────────────────────
const STATUS_OPTIONS = {
  '처방전 요청': ['미처리','처리중','공유완료'],
  '박스 찾기':   ['미처리','처리중','공유완료'],
  '박스 회수':   ['미처리','처리중','공유완료'],
  '우선 스캔':   ['미처리','처리중','스캔완료'],
  '재스캔':      ['미처리','처리중','스캔완료'],
};
function getStatusOpts(type) { return STATUS_OPTIONS[type] || ['미처리','처리중','공유완료']; }

// ── 유형 메타 ─────────────────────────────────────────
const TYPE_META = {
  '처방전 요청': { stripe:'stripe-blue',   badge:'b-blue',   icon:'📋', showRx: true  },
  '우선 스캔':   { stripe:'stripe-red',    badge:'b-red',    icon:'🔴', showRx: false },
  '재스캔':      { stripe:'stripe-purple', badge:'b-purple', icon:'🔁', showRx: false },
  '박스 찾기':   { stripe:'stripe-amber',  badge:'b-amber',  icon:'🟡', showRx: false },
  '박스 회수':   { stripe:'stripe-purple', badge:'b-purple', icon:'🟣', showRx: false },
};
function getMeta(type) { return TYPE_META[type] || TYPE_META['처방전 요청']; }

// ── 섹션 설정 ─────────────────────────────────────────
const SECTIONS = [
  { key:'미처리',  label:'미처리',  cls:'red',   icon:'●' },
  { key:'처리중',  label:'처리중',  cls:'amber', icon:'◑' },
  { key:'스캔완료',label:'스캔완료',cls:'green', icon:'✓' },
  { key:'공유완료',label:'공유완료',cls:'blue',  icon:'✓' },
];
const TYPE_ORDER = ['처방전 요청','우선 스캔','재스캔','박스 찾기','박스 회수'];

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('f-created').value = TODAY;
  document.getElementById('q').addEventListener('input', onSearch);

  // 1) 캐시 즉시 렌더
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const { data, groups } = JSON.parse(cached);
      allData = data; allGroups = groups;
      hideLoading();
      render();
      setSyncStatus('loading', '백그라운드 동기화 중…');
    } catch(e) {}
  }

  // 2) 서버에서 최신 데이터 가져오기
  fetchData();
});

// ════════════════════════════════════════════════════════
// API
// ════════════════════════════════════════════════════════
async function fetchData(silent = false) {
  if (!silent) setSyncStatus('loading', '동기화 중…');
  try {
    const res  = await fetch(SCRIPT_URL);
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    allData   = json.data   || [];
    allGroups = json.groups || [];

    // 캐시 저장
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: allData, groups: allGroups }));

    hideLoading();
    render();

    const now = new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    setSyncStatus('ok', `${now} 동기화`);
  } catch(e) {
    setSyncStatus('err', '연결 오류');
    if (!allData.length) {
      document.getElementById('initial-loading').innerHTML = `
        <div class="empty-state">
          <div class="ico">⚠️</div>
          <p>데이터를 불러올 수 없습니다.<br><small>${e.message}</small></p>
        </div>`;
    }
    toast('데이터 로드 실패: ' + e.message, 'err');
  }
}

async function refresh() {
  setSyncStatus('loading','동기화 중…');
  await fetchData(true);
}

async function apiPost(body) {
  try {
    await fetch(SCRIPT_URL, { method:'POST', body:JSON.stringify(body), redirect:'follow' });
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

function setSyncStatus(state, text) {
  const dot  = document.getElementById('sync-dot');
  const txt  = document.getElementById('sync-text');
  dot.className = 'sync-dot ' + state;
  txt.textContent = text;
}

function hideLoading() {
  document.getElementById('initial-loading').classList.add('hidden');
  document.getElementById('board').classList.remove('hidden');
}

// ════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════
function updateStats() {
  document.getElementById('st-total').textContent = allData.length;
  ['미처리','처리중','스캔완료','공유완료'].forEach(s => {
    const el = document.getElementById('st-'+s);
    if (el) el.textContent = allData.filter(r => r.status === s).length;
  });
  // 마감 임박: 미처리 중 3일 이내
  const urgentCount = allGroups.filter(g =>
    (g.status === '미처리' || !g.status) && isUrgentDeadline(g.deadline)
  ).length;
  const urgentEl = document.getElementById('st-임박');
  if (urgentEl) urgentEl.textContent = urgentCount;
  // 0건이면 흐리게
  const urgentStat = document.getElementById('sf-임박');
  if (urgentStat) urgentStat.style.opacity = urgentCount > 0 ? '1' : '0.4';
}

// ════════════════════════════════════════════════════════
// FILTER
// ════════════════════════════════════════════════════════
function filterStatus(s) {
  filterStatusVal = s;
  // stat-item selected 표시
  document.querySelectorAll('.stat-item').forEach(el => el.classList.remove('selected'));
  if (s) {
    const el = document.getElementById('sf-'+s);
    if (el) el.classList.add('selected');
  }
  render();
}

function filterType(btn) {
  filterTypeVal = btn.dataset.type;
  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  filterUrgentOnly = false;
  document.getElementById('sf-임박')?.classList.remove('selected');
  render();
}

function filterUrgent() {
  filterUrgentOnly = !filterUrgentOnly;
  const el = document.getElementById('sf-임박');
  if (filterUrgentOnly) {
    el?.classList.add('selected');
    filterStatusVal = '미처리';
    document.querySelectorAll('.stat-item').forEach(e => e.classList.remove('selected'));
    el?.classList.add('selected');
  } else {
    el?.classList.remove('selected');
    filterStatusVal = '';
  }
  render();
}

function onSearch() {
  const q = document.getElementById('q').value;
  document.getElementById('clear-q').classList.toggle('hidden', !q);
  render();
}
function clearSearch() {
  document.getElementById('q').value = '';
  document.getElementById('clear-q').classList.add('hidden');
  render();
}

function getFilteredGroups() {
  const q  = document.getElementById('q').value.toLowerCase();
  const fs = filterStatusVal;
  const ft = filterTypeVal;

  return allGroups.filter(g => {
    if (fs && g.status !== fs) return false;
    if (ft && g.request_type !== ft) return false;
    if (filterUrgentOnly && !isUrgentDeadline(g.deadline)) return false;
    if (q) {
      const hay = [
        g.pharmacy_name, g.rep_name, g.tracking_numbers,
        g.unique_id, g.notes,
        ...(g.patients||[]).map(p => p.patient_name + ' ' + p.patient_dob)
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════
// "2548-6785-8173"        → 1박스
// "2548-6785-8173 외 3"   → 4박스 (3+1)
function parseBoxCount(tracking) {
  if (!tracking) return 1;
  const m = tracking.match(/외\s*(\d+)/);
  return m ? parseInt(m[1], 10) + 1 : 1;
}

// 마감기한 파싱 — "2026.03.06", "2026-03-06", "26.03.06" 등 지원
function parseDeadline(str) {
  if (!str) return null;
  // 숫자만 추출
  const nums = str.replace(/\s/g,'').match(/(\d{2,4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!nums) return null;
  let [, y, m, d] = nums;
  if (y.length === 2) y = '20' + y;
  return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
}

// 오늘 포함 3일 이내 마감이면 true
function isUrgentDeadline(deadlineStr) {
  const dl = parseDeadline(deadlineStr);
  if (!dl) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = Math.floor((dl - today) / 86400000);
  return diff >= 0 && diff <= 2;  // 0(오늘), 1(내일), 2(모레)
}

// 마감까지 남은 일수 텍스트
function deadlineDiffText(deadlineStr) {
  const dl = parseDeadline(deadlineStr);
  if (!dl) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = Math.floor((dl - today) / 86400000);
  if (diff < 0)  return { text: `${Math.abs(diff)}일 초과`, over: true };
  if (diff === 0) return { text: '오늘 마감', urgent: true };
  if (diff === 1) return { text: '내일 마감', urgent: true };
  if (diff === 2) return { text: '모레 마감', urgent: true };
  return { text: `${diff}일 후`, urgent: false };
}

// ════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════
function render() {
  updateStats();
  const groups = getFilteredGroups();
  const board  = document.getElementById('board');

  if (!groups.length) {
    board.innerHTML = `<div class="empty-state"><div class="ico">🔍</div><p>검색 결과가 없습니다</p></div>`;
    return;
  }

  // 섹션별 그룹핑
  const byStatus = {};
  SECTIONS.forEach(s => byStatus[s.key] = []);
  groups.forEach(g => {
    const key = g.status || '미처리';
    if (byStatus[key]) byStatus[key].push(g);
    else byStatus['미처리'].push(g);
  });

  let html = '<div class="board">';
  SECTIONS.forEach(sec => {
    const items = byStatus[sec.key];
    if (!items.length) return;

    const isOpen = activeSections.has(sec.key);
    html += `
      <div class="status-section" id="sec-${sec.key}">
        <div class="section-hd" onclick="toggleSection('${sec.key}')">
          <span class="section-hd-badge ${sec.cls}">${sec.icon} ${sec.label}</span>
          <span class="section-count">${items.length}건</span>
          <span class="section-toggle ${isOpen?'':'collapsed'}">▼</span>
        </div>
        <div class="section-body ${isOpen?'':'hidden'}">
          ${renderTypeGroups(items)}
        </div>
      </div>`;
  });
  html += '</div>';
  board.innerHTML = html;
}

function renderTypeGroups(items) {
  // 유형별로 묶기
  const byType = {};
  TYPE_ORDER.forEach(t => byType[t] = []);
  items.forEach(g => {
    const t = g.request_type || '처방전 요청';
    if (!byType[t]) byType[t] = [];
    byType[t].push(g);
  });

  let html = '';
  TYPE_ORDER.forEach(type => {
    const list = byType[type];
    if (!list || !list.length) return;
    const meta = getMeta(type);
    html += `
      <div class="type-group">
        <div class="type-group-hd">
          <span class="type-badge ${meta.badge}">${meta.icon} ${type}</span>
          <span style="font-size:11px;color:var(--text3)">${list.length}건</span>
        </div>
        ${list.map(g => renderCard(g, meta)).join('')}
      </div>`;
  });
  return html;
}

function renderCard(g, meta) {
  const opts = getStatusOpts(g.request_type);
  const optHtml = opts.map(o => `<option value="${o}" ${g.status===o?'selected':''}>${o}</option>`).join('');
  const statusClass = `s-${g.status||'미처리'}`;

  const patients = g.patients || [];
  const isMulti  = g.count > 1;
  const memberIds = JSON.stringify(g.member_ids||[g.id]);

  // 처방전 정보 블록
  let rxHtml = '';
  if (meta.showRx) {
    if (isMulti) {
      const rows = patients.map((p, i) => `
        <div class="pt-row">
          <div class="pt-num">${i+1}</div>
          <div class="pt-name">${p.patient_name||'—'}</div>
          <div class="pt-dob">${p.patient_dob||''}</div>
          <div class="pt-issue">${p.issue_date||''}</div>
          ${p.hospital_name?`<div class="pt-hospital">${p.hospital_name}</div>`:''}
        </div>`).join('');
      rxHtml = `
        <div class="prescription-table multi">
          <div class="pt-header">처방전 정보 — ${patients.length}명</div>
          ${rows}
        </div>`;
    } else {
      const p = patients[0] || {};
      rxHtml = `
        <div class="prescription-table">
          <div class="pt-header">처방전 정보</div>
          <div class="pt-single">
            <span class="pt-name">${p.patient_name||'—'}</span>
            <span class="pt-dob">${p.patient_dob||''}</span>
            <span class="pt-issue">${p.issue_date||''}</span>
            ${p.hospital_name?`<span class="pt-hospital">· ${p.hospital_name}</span>`:''}
          </div>
        </div>`;
    }
  }

  // 물류 정보
  const trackLines = (g.tracking_numbers||'').split('\n').filter(Boolean);
  const boxCount = parseBoxCount(g.tracking_numbers);
  const trackHtml = trackLines.join('<br>') || g.tracking_numbers || '—';
  const logisticsHtml = `
    <div class="logistics">
      <div class="logi-item">
        <span class="logi-label">물류 집하일</span>
        <span class="logi-value">${g.collection_date||'—'}</span>
      </div>
      <div class="logi-item">
        <span class="logi-label">배송 완료일</span>
        <span class="logi-value">${g.delivery_date||'—'}</span>
      </div>
      <div class="logi-item">
        <span class="logi-label">고유 ID</span>
        <span class="logi-value">${g.unique_id||'—'}</span>
      </div>
      <div class="logi-item">
        <span class="logi-label">운송장 (${boxCount}박스)</span>
        <span class="logi-value mono tracking">${trackHtml}</span>
      </div>
    </div>`;

  const noteClass = ['우선 스캔','재스캔'].includes(g.request_type) ? 'warn' : 'info';
  const noteHtml = g.notes
    ? `<div class="card-note ${noteClass}"><span>⚠️</span><span>${g.notes}</span></div>` : '';

  return `
    <div class="card" id="card-${g.id}">
      <div class="card-stripe ${meta.stripe}"></div>
      <div class="card-main">
        <div class="card-hd">
          <span class="card-pharmacy">${g.pharmacy_name}</span>
          <span class="card-rep">${g.rep_name?'('+g.rep_name+')':''}</span>
          ${isMulti?`<span class="card-count-pill">처방전 ${g.count}건</span>`:''}
          ${g.deadline ? (() => {
            const diff = deadlineDiffText(g.deadline);
            const isUrgent = diff?.urgent || diff?.over;
            return `<div class="deadline-badge ${isUrgent ? 'urgent' : 'normal'}">
              ${isUrgent ? '⚡' : '📅'} ${g.deadline}
              ${diff ? `<span style="font-size:10px;font-family:'Pretendard',sans-serif;font-weight:700;opacity:.75">${diff.text}</span>` : ''}
            </div>`;
          })() : ''}
          <div class="card-status-wrap">
            <select class="status-sel ${statusClass}"
              onchange="changeStatus('${g.id}',this.value,${memberIds},this)">
              ${optHtml}
            </select>
          </div>
        </div>
        <div class="card-body">
          ${rxHtml}
          ${logisticsHtml}
        </div>
        ${noteHtml}
        <div class="card-actions">
          <button class="act-btn" onclick="openEdit('${g.id}')">✏️ 수정</button>
          <button class="act-btn del" onclick="del('${g.id}')">🗑 삭제</button>
        </div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════
// SECTION TOGGLE
// ════════════════════════════════════════════════════════
function toggleSection(key) {
  if (activeSections.has(key)) activeSections.delete(key);
  else activeSections.add(key);

  const sec    = document.getElementById('sec-'+key);
  if (!sec) return;
  const body   = sec.querySelector('.section-body');
  const toggle = sec.querySelector('.section-toggle');
  const isOpen = activeSections.has(key);
  body.classList.toggle('hidden', !isOpen);
  toggle.classList.toggle('collapsed', !isOpen);
}

// ════════════════════════════════════════════════════════
// STATUS CHANGE
// ════════════════════════════════════════════════════════
async function changeStatus(id, newStatus, memberIds, selectEl) {
  const g = allGroups.find(x => x.id === id);
  if (!g) return;
  const old = g.status;

  // 낙관적 업데이트
  g.status = newStatus;
  g.member_ids?.forEach(mid => { const r = allData.find(x=>x.id===mid); if(r) r.status = newStatus; });
  if (selectEl) {
    selectEl.className = `status-sel s-${newStatus}`;
  }
  updateStats();

  const isGroup = memberIds.length > 1;
  const res = await apiPost(isGroup
    ? { action:'updateGroupStatus', ids:memberIds, status:newStatus }
    : { action:'updateStatus', id, status:newStatus }
  );

  if (res.error) {
    g.status = old;
    if (selectEl) {
      selectEl.value = old;
      selectEl.className = `status-sel s-${old}`;
    }
    updateStats();
    toast('상태 변경 실패', 'err');
  } else {
    toast(`✅ ${g.pharmacy_name}${isGroup?' ('+memberIds.length+'건)':''} → ${newStatus}`, 'ok');
    // 섹션이 바뀌면 리렌더
    if (old !== newStatus) {
      const moved = ['미처리','처리중'].includes(newStatus) !== ['미처리','처리중'].includes(old);
      if (moved || filterStatusVal) render();
      else {
        // 같은 섹션 안에서만 이동 — 카드 DOM만 업데이트
        render();
      }
    }
  }
}

// ════════════════════════════════════════════════════════
// ADD / EDIT
// ════════════════════════════════════════════════════════
function openAdd() {
  editingId = null;
  document.getElementById('modal-title').textContent = '새 요청 추가';
  document.getElementById('save-btn').textContent    = '저장';
  clearForm();
  document.getElementById('f-created').value = TODAY;
  // 신규: 약국명·대표명 입력 가능
  setPharmacyLock(false);
  onTypeChange();
  document.getElementById('overlay').classList.remove('hidden');
}

function openEdit(id) {
  const r = allData.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById('modal-title').textContent = `수정 — ${r.pharmacy_name}`;
  document.getElementById('save-btn').textContent    = '수정 저장';

  const map = {
    'f-deadline':  'deadline',
    'f-type':      'request_type',
    'f-pharmacy':  'pharmacy_name',
    'f-rep':       'rep_name',
    'f-issue':     'issue_date',
    'f-patient':   'patient_name',
    'f-dob':       'patient_dob',
    'f-hospital':  'hospital_name',
    'f-collect':   'collection_date',
    'f-deliver':   'delivery_date',
    'f-uid':       'unique_id',
    'f-tracking':  'tracking_numbers',
    'f-created':   'created_date',
    'f-notes':     'notes',
  };
  Object.entries(map).forEach(([elId, field]) => {
    const el = document.getElementById(elId);
    if (el) el.value = r[field] || '';
  });
  // 수정 시: 약국명·대표명 잠금
  setPharmacyLock(true);
  updateModalStatusOpts(r.request_type, r.status);
  toggleRxFields(r.request_type);
  document.getElementById('overlay').classList.remove('hidden');
}

function setPharmacyLock(locked) {
  const ph  = document.getElementById('f-pharmacy');
  const rep = document.getElementById('f-rep');
  const lph  = document.getElementById('lock-pharmacy');
  const lrep = document.getElementById('lock-rep');
  ph.readOnly  = locked;
  rep.readOnly = locked;
  lph?.classList.toggle('hidden', !locked);
  lrep?.classList.toggle('hidden', !locked);
}

function clearForm() {
  ['f-deadline','f-pharmacy','f-rep','f-issue','f-patient','f-dob',
   'f-hospital','f-collect','f-deliver','f-uid','f-tracking','f-notes']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f-type').value = '처방전 요청';
}

function onTypeChange() {
  const type = document.getElementById('f-type').value;
  updateModalStatusOpts(type, '미처리');
  toggleRxFields(type);
}

function updateModalStatusOpts(type, current) {
  const sel  = document.getElementById('f-status');
  const opts = getStatusOpts(type);
  sel.innerHTML = opts.map(o => `<option value="${o}" ${o===current?'selected':''}>${o}</option>`).join('');
}

function toggleRxFields(type) {
  const showRx = getMeta(type).showRx;
  document.querySelectorAll('.prescription-only').forEach(el => {
    el.classList.toggle('hidden', !showRx);
  });
}

async function save() {
  const pharmacy = document.getElementById('f-pharmacy').value.trim();
  const rep      = document.getElementById('f-rep').value.trim();
  if (!pharmacy) { toast('약국명은 필수입니다', 'err'); return; }
  if (!rep)      { toast('대표명은 필수입니다', 'err'); return; }

  const type   = document.getElementById('f-type').value;
  const showRx = getMeta(type).showRx;

  const record = {
    deadline:         document.getElementById('f-deadline').value || '',
    request_type:     type,
    pharmacy_name:    pharmacy,
    rep_name:         rep,
    issue_date:       showRx ? document.getElementById('f-issue').value.trim() : '',
    patient_name:     showRx ? document.getElementById('f-patient').value.trim() : '',
    patient_dob:      showRx ? document.getElementById('f-dob').value.trim() : '',
    hospital_name:    showRx ? document.getElementById('f-hospital').value.trim() : '',
    collection_date:  document.getElementById('f-collect').value.trim(),
    delivery_date:    document.getElementById('f-deliver').value.trim(),
    unique_id:        document.getElementById('f-uid').value.trim(),
    tracking_numbers: document.getElementById('f-tracking').value.trim(),
    created_date:     document.getElementById('f-created').value || TODAY,
    status:           document.getElementById('f-status').value,
    notes:            document.getElementById('f-notes').value.trim(),
  };

  const btn = document.getElementById('save-btn');
  btn.textContent = '저장 중…';
  btn.disabled = true;

  const res = await apiPost(editingId
    ? { action:'update', id:editingId, record }
    : { action:'add', record }
  );

  btn.textContent = editingId ? '수정 저장' : '저장';
  btn.disabled = false;

  if (res.error) { toast('저장 실패: '+res.error,'err'); return; }
  toast(editingId ? '✅ 수정되었습니다' : '✅ 저장되었습니다','ok');
  closeModal();

  // 캐시 무효화 후 새로 로드
  sessionStorage.removeItem(CACHE_KEY);
  await fetchData(true);
}

// ════════════════════════════════════════════════════════
// DELETE
// ════════════════════════════════════════════════════════
async function del(id) {
  const g = allGroups.find(x => x.id === id);
  if (!confirm(`[${g?.pharmacy_name}] 항목을 삭제하시겠습니까?`)) return;
  const pw = prompt('관리자 비밀번호를 입력하세요.');
  if (pw === null) return;
  if (pw !== 'admin') { toast('비밀번호가 올바르지 않습니다', 'err'); return; }
  const res = await apiPost({ action:'delete', id });
  if (res.error) { toast('삭제 실패','err'); return; }
  toast('삭제되었습니다','ok');
  sessionStorage.removeItem(CACHE_KEY);
  await fetchData(true);
}

// ════════════════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════════════════
function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
}
function handleOverlayClick(e) {
  if (e.target.id === 'overlay') closeModal();
}

// ════════════════════════════════════════════════════════
// PRINT VIEW
// ════════════════════════════════════════════════════════
const PRINT_CFG = {
  '처방전 요청': { stripe:'#2563eb', numBg:'#2563eb', badgeBg:'#eff6ff', badgeColor:'#1d4ed8', badgeBorder:'#bfdbfe', label:'🔵 처방전 확인 요청' },
  '우선 스캔':   { stripe:'#dc2626', numBg:'#dc2626', badgeBg:'#fff1f1', badgeColor:'#dc2626', badgeBorder:'#fecaca', label:'🔴 긴급 — 우선 스캔' },
  '재스캔':      { stripe:'#7c3aed', numBg:'#7c3aed', badgeBg:'#f5f3ff', badgeColor:'#7c3aed', badgeBorder:'#ddd6fe', label:'🔁 재스캔' },
  '박스 찾기':   { stripe:'#b45309', numBg:'#b45309', badgeBg:'#fffbeb', badgeColor:'#b45309', badgeBorder:'#fde68a', label:'🟡 박스 확보 후 전달' },
  '박스 회수':   { stripe:'#7c3aed', numBg:'#7c3aed', badgeBg:'#f5f3ff', badgeColor:'#7c3aed', badgeBorder:'#ddd6fe', label:'🟣 박스 회수' },
};
const PRINT_TYPE_ORDER = ['우선 스캔','재스캔','박스 찾기','박스 회수','처방전 요청'];

const PRINT_STATUS_CFG = {
  '미처리': { label:'미처리',  color:'#dc2626', bg:'#fff1f1', border:'#fecaca' },
  '처리중': { label:'처리중',  color:'#b45309', bg:'#fffbeb', border:'#fde68a' },
};

// 1) 출력 버튼 → 상태 선택 피커 표시
function showPrint() {
  // 현재 필터 기준 건수 계산
  const base = getFilteredGroups();
  const c미처리 = base.filter(g => (g.status||'미처리') === '미처리').length;
  const c처리중 = base.filter(g => (g.status||'미처리') === '처리중').length;
  document.getElementById('pc-미처리').textContent = c미처리 + '건';
  document.getElementById('pc-처리중').textContent = c처리중 + '건';
  document.getElementById('pc-both').textContent   = (c미처리 + c처리중) + '건';
  document.getElementById('print-picker').classList.remove('hidden');
}

// 2) 피커에서 선택 → 실제 출력 렌더
function startPrint(statusFilter) {
  document.getElementById('print-picker').classList.add('hidden');

  // 선택한 상태 목록
  const statuses = statusFilter === 'both' ? ['미처리','처리중'] : [statusFilter];

  // 현재 검색/유형 필터 적용된 그룹 중 선택 상태만
  const baseGroups = getFilteredGroups().filter(g => statuses.includes(g.status || '미처리'));

  if (!baseGroups.length) {
    toast('출력할 데이터가 없습니다', 'err');
    return;
  }

  const today = new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const totalCount = baseGroups.length;

  // 상태 섹션별로 렌더
  let allSectionsHtml = '';
  let globalNum = 0;

  statuses.forEach(status => {
    const groups = baseGroups.filter(g => (g.status||'미처리') === status);
    if (!groups.length) return;

    const sCfg = PRINT_STATUS_CFG[status];

    // 상태 섹션 헤더
    allSectionsHtml += `
      <div class="print-status-section">
        <div class="print-status-hd">
          <span class="print-status-badge" style="background:${sCfg.bg};color:${sCfg.color};border:1.5px solid ${sCfg.border}">
            ${status === '미처리' ? '● 미처리' : '◑ 처리중'}
          </span>
          <span style="font-size:11px;color:#888;margin-left:6px">${groups.length}건</span>
        </div>`;

    // 유형별로 다시 묶기
    const byType = {};
    PRINT_TYPE_ORDER.forEach(t => byType[t] = []);
    groups.forEach(g => {
      const t = g.request_type || '처방전 요청';
      if (!byType[t]) byType[t] = [];
      byType[t].push(g);
    });

    PRINT_TYPE_ORDER.forEach(type => {
      const items = byType[type];
      if (!items?.length) return;
      const cfg  = PRINT_CFG[type] || PRINT_CFG['처방전 요청'];
      const meta = getMeta(type);

      const cards = items.map(g => {
        globalNum++;
        const patients  = g.patients || [];
        const isMulti   = g.count > 1;
        const lines     = (g.tracking_numbers||'').split('\n').filter(Boolean);
        const boxCount  = parseBoxCount(g.tracking_numbers);
        const trackHtml = lines.join('<br>') || g.tracking_numbers || '—';

        const rxHtml = meta.showRx ? (isMulti
          ? `<div class="pc-patients">
              ${patients.map((p,pi)=>`
                <div class="pc-pt">
                  <div class="pc-pt-num" style="background:${cfg.numBg}">${pi+1}</div>
                  <span class="pc-pt-name">${p.patient_name||'—'}</span>
                  <span class="pc-pt-dob" style="margin-left:5px">${p.patient_dob?'('+p.patient_dob+')':''}</span>
                  ${p.hospital_name?`<span class="pc-pt-hosp">· ${p.hospital_name}</span>`:''}
                  <span class="pc-pt-issue">${p.issue_date||''}</span>
                </div>`).join('')}
             </div>`
          : `<div class="pc-grid" style="margin-bottom:4px">
              <div><div class="pcfl">환자명</div><div class="pcfv">${patients[0]?.patient_name||'—'}</div></div>
              <div><div class="pcfl">생년월일</div><div class="pcfv">${patients[0]?.patient_dob||'—'}</div></div>
              <div><div class="pcfl">교부일자</div><div class="pcfv">${patients[0]?.issue_date||'—'}</div></div>
              ${patients[0]?.hospital_name?`<div style="grid-column:1/-1"><div class="pcfl">병원</div><div class="pcfv">${patients[0].hospital_name}</div></div>`:''}
             </div>`) : '';

        const warnHtml = g.notes
          ? `<div class="pc-warn ${['우선 스캔','재스캔'].includes(type)?'red':'amber'}">⚠️ ${g.notes}</div>` : '';

        return `<div class="print-card">
          <div class="pc-stripe" style="background:${cfg.stripe}"></div>
          <div class="pc-body">
            <div class="pc-hd">
              <div class="pc-num" style="background:${cfg.numBg}">${globalNum}</div>
              <span class="pc-name">${g.pharmacy_name}</span>
              <span class="pc-mgr">${g.rep_name?'('+g.rep_name+')':''}</span>
              ${isMulti?`<span class="pc-count-pill">처방전 ${g.count}건</span>`:''}
            </div>
            ${rxHtml}
            <div class="pc-grid">
              <div><div class="pcfl">집하일</div><div class="pcfv">${g.collection_date||'—'}</div></div>
              <div><div class="pcfl">배송완료</div><div class="pcfv">${g.delivery_date||'—'}</div></div>
              <div><div class="pcfl">고유 ID</div><div class="pcfv">${g.unique_id||'—'}</div></div>
              <div style="grid-column:1/-1"><div class="pcfl">운송장 (${boxCount}박스)</div><div class="pcfv mono">${trackHtml}</div></div>
            </div>
          </div>
          ${warnHtml}
        </div>`;
      }).join('');

      allSectionsHtml += `
        <div class="print-section">
          <div class="print-section-hd">
            <span class="print-section-badge" style="background:${cfg.badgeBg};color:${cfg.badgeColor};border:1.5px solid ${cfg.badgeBorder}">${cfg.label}</span>
            <span style="font-size:11px;color:#888">${items.length}건</span>
          </div>
          ${cards}
        </div>`;
    });

    allSectionsHtml += `</div>`; // .print-status-section
  });

  const statusTitle = statusFilter === 'both' ? '미처리 + 처리중' :
                      statusFilter === '미처리' ? '미처리' : '처리중';

  document.getElementById('print-body').innerHTML = `
    <div class="print-page">
      <div class="print-ph">
        <div>
          <div class="print-ph-title">📋 처방전 작업 요청서</div>
          <div class="print-ph-sub">수신: 스캔팀 · 발신: 운영팀 · 상태: ${statusTitle} · 총 ${totalCount}건</div>
        </div>
        <div class="print-ph-date">${today}</div>
      </div>
      ${allSectionsHtml}
      <div class="print-foot">
        <span class="pfi"><span class="pfd" style="background:#dc2626"></span>긴급 스캔</span>
        <span class="pfi"><span class="pfd" style="background:#7c3aed"></span>재스캔 / 박스 회수</span>
        <span class="pfi"><span class="pfd" style="background:#b45309"></span>박스 확보 후 전달</span>
        <span class="pfi"><span class="pfd" style="background:#2563eb"></span>처방전 확인 요청</span>
      </div>
    </div>`;

  document.getElementById('main').classList.add('hidden');
  document.getElementById('print-view').classList.remove('hidden');
}

function hidePrint() {
  document.getElementById('print-view').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
}

// ════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════
function toast(msg, type='def') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

