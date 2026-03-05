const SHEET_ID   = '1BLOMLTiKTs3YJgqNqh2im0VWlU0b1vu3Hk8cuYCKF3U';
const SHEET_NAME = '처방전관리';

const COLS = [
  'id',               // A
  'deadline',         // B 필요기한
  'request_type',     // C 유형
  'pharmacy_name',    // D 약국명
  'rep_name',         // E 대표명
  'issue_date',       // F 교부일자
  'patient_name',     // G 환자명
  'patient_dob',      // H 생년월일
  'hospital_name',    // I 병원이름
  'collection_date',  // J 물류집하일
  'delivery_date',    // K 배송완료일
  'tracking_numbers', // L 송장번호
  'unique_id',        // M 고유ID
  'created_date',     // N 작성일자
  'status',           // O 처리여부
  'notes',            // P 비고
];

// ── GET: 데이터 읽기 + 쓰기 액션 통합 ───────────────────────
function doGet(e) {
  try {
    const p = e.parameter || {};

    // action 파라미터가 있으면 쓰기 작업
    if (p.action) {
      const sheet = getSheet();
      switch (p.action) {
        case 'add':
          return addRow(sheet, JSON.parse(p.record));
        case 'update':
          return updateRow(sheet, p.id, JSON.parse(p.record));
        case 'updateStatus':
          return patchStatus(sheet, p.id, p.status);
        case 'updateGroupStatus':
          return patchGroupStatus(sheet, JSON.parse(p.ids), p.status);
        case 'delete':
          return deleteRow(sheet, p.id);
        default:
          return respond({ error: '알 수 없는 action' });
      }
    }

    // action 없으면 전체 데이터 읽기
    const sheet = getSheet();
    const rows  = sheet.getDataRange().getValues();
    if (rows.length <= 1) return respond({ data: [], groups: [] });

    const data = rows.slice(1)
      .map((row, i) => {
        const obj = {};
        COLS.forEach((c, ci) => obj[c] = String(row[ci] ?? '').trim());
        obj._rowIndex = i + 2;
        return obj;
      })
      .filter(r => r.pharmacy_name !== '');

    const groupMap  = new Map();
    const groupKeys = [];

    data.forEach(r => {
      const key = `${r.pharmacy_name}__${r.unique_id}__${r.tracking_numbers}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
        groupKeys.push(key);
      }
      groupMap.get(key).push(r);
    });

    const groups = groupKeys.map(key => {
      const members = groupMap.get(key);
      const rep     = members[0];
      const patients = members
        .filter(m => m.patient_name)
        .map(m => ({
          id:            m.id,
          issue_date:    m.issue_date,
          patient_name:  m.patient_name,
          patient_dob:   m.patient_dob,
          hospital_name: m.hospital_name,
          status:        m.status,
        }));

      return {
        group_key:        key,
        count:            members.length,
        id:               rep.id,
        deadline:         rep.deadline,
        request_type:     rep.request_type,
        pharmacy_name:    rep.pharmacy_name,
        rep_name:         rep.rep_name,
        collection_date:  rep.collection_date,
        delivery_date:    rep.delivery_date,
        tracking_numbers: rep.tracking_numbers,
        unique_id:        rep.unique_id,
        created_date:     rep.created_date,
        status:           rep.status,
        notes:            rep.notes,
        patients:         patients,
        member_ids:       members.map(m => m.id),
      };
    });

    return respond({ data, groups });

  } catch(e) {
    return respond({ error: e.message });
  }
}

// ── doPost는 하위 호환용으로 유지 ────────────────────────────
function doPost(e) {
  try {
    const body  = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    switch (body.action) {
      case 'add':               return addRow(sheet, body.record);
      case 'update':            return updateRow(sheet, body.id, body.record);
      case 'updateStatus':      return patchStatus(sheet, body.id, body.status);
      case 'updateGroupStatus': return patchGroupStatus(sheet, body.ids, body.status);
      case 'delete':            return deleteRow(sheet, body.id);
      default:                  return respond({ error: '알 수 없는 action' });
    }
  } catch(e) {
    return respond({ error: e.message });
  }
}

// ── 행 추가 ──────────────────────────────────────────────────
function addRow(sheet, record) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const newId = String(sheet.getLastRow());
  record.id           = newId;
  record.created_date = record.created_date || today;
  record.status       = record.status || '미처리';
  sheet.appendRow(COLS.map(c => record[c] ?? ''));
  return respond({ success: true, id: newId });
}

// ── 행 수정 ──────────────────────────────────────────────────
function updateRow(sheet, id, record) {
  const ri = findRow(sheet, id);
  if (!ri) return respond({ error: '행 없음' });
  COLS.forEach((c, i) => {
    if (c !== 'id' && record[c] !== undefined)
      sheet.getRange(ri, i + 1).setValue(record[c]);
  });
  return respond({ success: true });
}

// ── 상태 단일 변경 ───────────────────────────────────────────
function patchStatus(sheet, id, status) {
  const ri = findRow(sheet, id);
  if (!ri) return respond({ error: '행 없음' });
  sheet.getRange(ri, COLS.indexOf('status') + 1).setValue(status);
  return respond({ success: true });
}

// ── 상태 그룹 일괄 변경 ──────────────────────────────────────
function patchGroupStatus(sheet, ids, status) {
  const statusCol = COLS.indexOf('status') + 1;
  const idVals = sheet.getRange('A:A').getValues();
  ids.forEach(id => {
    for (let i = 1; i < idVals.length; i++) {
      if (String(idVals[i][0]).trim() === String(id)) {
        sheet.getRange(i + 1, statusCol).setValue(status);
        break;
      }
    }
  });
  return respond({ success: true });
}

// ── 행 삭제 ──────────────────────────────────────────────────
function deleteRow(sheet, id) {
  const ri = findRow(sheet, id);
  if (!ri) return respond({ error: '행 없음' });
  sheet.deleteRow(ri);
  return respond({ success: true });
}

// ── 유틸 ─────────────────────────────────────────────────────
function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function findRow(sheet, id) {
  const vals = sheet.getRange('A:A').getValues();
  for (let i = 1; i < vals.length; i++)
    if (String(vals[i][0]).trim() === String(id)) return i + 1;
  return null;
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh   = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  const labels = [
    'ID','필요기한','유형','약국명','대표명','교부일자',
    '환자명','생년월일','병원이름','물류집하일','배송완료일',
    '송장번호','고유ID','작성일자','처리여부','비고'
  ];
  const hr = sh.getRange(1, 1, 1, labels.length);
  hr.setValues([labels]);
  hr.setFontWeight('bold').setBackground('#1a2f5e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  Logger.log('✅ 시트 세팅 완료!');
}
