const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'students.json');
const LOG_FILE = path.join(DATA_DIR, 'audit-log.json');

const SPECIALISTS = [
  { englishName: 'oil-refining-and-gas-processing', arabicShortName: 'نفط', arabicName: 'تكرير النفط ومعالجة الغاز', ar_code: 'ن', en_code: 'OP' },
  { englishName: 'medical-device-maintenance', arabicShortName: 'طبية', arabicName: 'صيانة الاجهزة الطبية', ar_code: 'ط', en_code: 'MD' },
  { englishName: 'electricity', arabicShortName: 'كهرباء', arabicName: 'الكهرباء', ar_code: 'ك', en_code: 'EL' },
  { englishName: 'mechanics', arabicShortName: 'ميكانيك', arabicName: 'الميكانيك', ar_code: 'م', en_code: 'MC' },
  { englishName: 'cars-engineering', arabicShortName: 'سيارات', arabicName: 'السيارات', ar_code: 'س', en_code: 'VC' },
  { englishName: 'air-conditioning-and-refrigeration', arabicShortName: 'تبريد', arabicName: 'تكييف الهواء والتثليج', ar_code: 'ت', en_code: 'AR' },
  { englishName: 'welding-and-metal-forming', arabicShortName: 'معادن', arabicName: 'اللحام وتشكيل المعادن', ar_code: 'ل', en_code: 'WF' },
  { englishName: 'carpentry', arabicShortName: 'نجارة', arabicName: 'النجارة', ar_code: 'ج', en_code: 'CY' },
  { englishName: 'Textile', arabicShortName: 'نسيج', arabicName: 'النسيج', ar_code: 'ي', en_code: 'TE' }
];
const REGISTRY_TYPES = { صباحي: 'R', كورسات: 'C', مسائي: 'E' };
const ROLES = { writer: 1, supervisor: 2, admin: 3 };

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ students: [], pending: [], specialists: SPECIALISTS }, null, 2));
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function readAudit() {
  return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
}
function writeAudit(logs) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

function normalizeArabic(text = '') {
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FF\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function twoDigitYear(dateStr) {
  const y = new Date(dateStr).getFullYear();
  return String(y).slice(-2);
}

function pad(value, len) {
  return String(value).padStart(len, '0');
}

function parseDateOrDefault(dateInput) {
  if (!dateInput) return '';
  if (/^\d{4}$/.test(dateInput)) return `${dateInput}-07-01`;
  if (/^\d{4}-\d{2}$/.test(dateInput)) return `${dateInput}-01`;
  return dateInput;
}

function generateRollId(student, specialists) {
  const spec = specialists.find((s) => s.arabicShortName === student.Specialist || s.englishName === student.Specialist || s.arabicName === student.Specialist);
  const enCode = spec ? spec.en_code : 'XX';
  const birthYY = twoDigitYear(student.DoB);
  const rType = REGISTRY_TYPES[student.RegistryType] || student.RegistryType || 'R';
  return `${enCode}${birthYY}${rType}${pad(student.RegistryNumber, 3)}${pad(student.RegistryPage, 5)}`;
}

function logAction(user, role, action, payload) {
  const logs = readAudit();
  logs.push({ at: new Date().toISOString(), user, role, action, payload });
  writeAudit(logs);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({ raw: data });
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(JSON.stringify(body));
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(',').map((h) => h.trim());
  return lines.map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (values[i] || '').trim()));
    return obj;
  });
}

function toCsv(items) {
  if (!items.length) return '';
  const headers = Object.keys(items[0]);
  const rows = [headers.join(',')];
  for (const item of items) rows.push(headers.map((h) => String(item[h] ?? '').replace(/,/g, ' ')).join(','));
  return rows.join('\n');
}

function requireRole(req, minRole) {
  const role = req.headers['x-role'] || 'writer';
  return (ROLES[role] || 0) >= ROLES[minRole];
}

function getUser(req) {
  return req.headers['x-user'] || 'anonymous';
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, 'public', reqPath.split('?')[0]);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);res.end('Forbidden');return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Role, X-User', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const db = readDb();
    if (url.pathname === '/api/meta') return send(res, 200, { specialists: db.specialists, registryTypes: REGISTRY_TYPES, school: 'اعدادية الديوانية الصناعية' });

    if (url.pathname === '/api/students/search') {
      const q = normalizeArabic(url.searchParams.get('q') || '');
      const results = db.students.filter((s) => !s.archived && normalizeArabic([s.FirstName, s.FatherName, s.GrandFatherName, s.FourthName].join(' ')).includes(q));
      return send(res, 200, { items: results.slice(0, 100) });
    }

    if (url.pathname === '/api/students' && req.method === 'GET') return send(res, 200, { items: db.students.filter((s) => !s.archived) });

    if (url.pathname === '/api/students' && req.method === 'POST') {
      const body = await parseBody(req);
      const required = ['FirstName', 'FatherName', 'Gender', 'DoB', 'RegistryType', 'RegistryNumber', 'RegistryPage', 'Specialist'];
      for (const field of required) if (!body[field]) return send(res, 400, { error: `Missing ${field}` });

      body.DoB = parseDateOrDefault(body.DoB);
      ['FirstName', 'FatherName', 'GrandFatherName', 'FourthName', 'MotherName'].forEach((f) => (body[f] = normalizeArabic(body[f] || '')));
      body.StudentStatus = Array.isArray(body.StudentStatus) ? body.StudentStatus : [];
      body.RollNumberID = generateRollId(body, db.specialists);
      body.id = crypto.randomUUID();
      body.archived = false;

      const user = getUser(req); const role = req.headers['x-role'] || 'writer';
      if (role === 'writer') {
        db.pending.push({ type: 'create', payload: body, requestedBy: user, at: new Date().toISOString() });
        writeDb(db);
        logAction(user, role, 'request_create', { roll: body.RollNumberID });
        return send(res, 202, { message: 'Pending supervisor approval' });
      }

      db.students.push(body);
      writeDb(db);
      logAction(user, role, 'create_student', body);
      return send(res, 201, body);
    }

    if (url.pathname.startsWith('/api/students/') && req.method === 'PUT') {
      const id = url.pathname.split('/').pop();
      const body = await parseBody(req);
      const idx = db.students.findIndex((s) => s.id === id);
      if (idx === -1) return send(res, 404, { error: 'Not found' });
      const user = getUser(req); const role = req.headers['x-role'] || 'writer';
      const updated = { ...db.students[idx], ...body };
      ['FirstName', 'FatherName', 'GrandFatherName', 'FourthName', 'MotherName'].forEach((f) => (updated[f] = normalizeArabic(updated[f] || '')));
      updated.DoB = parseDateOrDefault(updated.DoB);
      updated.RollNumberID = generateRollId(updated, db.specialists);
      if (role === 'writer') {
        db.pending.push({ type: 'update', studentId: id, payload: updated, requestedBy: user, at: new Date().toISOString() });
        writeDb(db);
        logAction(user, role, 'request_update', { id });
        return send(res, 202, { message: 'Pending supervisor approval' });
      }
      db.students[idx] = updated;
      writeDb(db);
      logAction(user, role, 'update_student', updated);
      return send(res, 200, updated);
    }

    if (url.pathname === '/api/pending/approve' && req.method === 'POST') {
      if (!requireRole(req, 'supervisor')) return send(res, 403, { error: 'Forbidden' });
      const body = await parseBody(req);
      const idx = Number(body.index);
      const item = db.pending[idx];
      if (!item) return send(res, 404, { error: 'No pending item' });
      if (item.type === 'create') db.students.push(item.payload);
      if (item.type === 'update') {
        const sidx = db.students.findIndex((s) => s.id === item.studentId);
        if (sidx !== -1) db.students[sidx] = item.payload;
      }
      db.pending.splice(idx, 1);
      writeDb(db);
      logAction(getUser(req), req.headers['x-role'] || '', 'approve_pending', item);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/pending' && req.method === 'GET') {
      if (!requireRole(req, 'supervisor')) return send(res, 403, { error: 'Forbidden' });
      return send(res, 200, { items: db.pending });
    }

    if (url.pathname.startsWith('/api/students/') && url.pathname.endsWith('/archive') && req.method === 'PATCH') {
      if (!requireRole(req, 'admin')) return send(res, 403, { error: 'Forbidden' });
      const id = url.pathname.split('/')[3];
      const s = db.students.find((x) => x.id === id);
      if (!s) return send(res, 404, { error: 'Not found' });
      s.archived = true;
      writeDb(db);
      logAction(getUser(req), 'admin', 'archive_student', { id });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      if (!requireRole(req, 'admin')) return send(res, 403, { error: 'Forbidden' });
      const body = await parseBody(req);
      const rows = parseCsv(body.csv || '');
      const imported = [];
      for (const row of rows) {
        row.DoB = parseDateOrDefault(row.DoB);
        ['FirstName', 'FatherName', 'GrandFatherName', 'FourthName', 'MotherName'].forEach((f) => (row[f] = normalizeArabic(row[f] || '')));
        row.StudentStatus = row.StudentStatus ? row.StudentStatus.split('|') : [];
        row.RollNumberID = generateRollId(row, db.specialists);
        row.id = crypto.randomUUID();
        row.archived = false;
        db.students.push(row);
        imported.push(row);
      }
      writeDb(db);
      logAction(getUser(req), 'admin', 'import_csv', { count: imported.length });
      return send(res, 200, { imported: imported.length });
    }

    if (url.pathname === '/api/export' && req.method === 'GET') {
      if (!requireRole(req, 'admin')) return send(res, 403, { error: 'Forbidden' });
      const csv = toCsv(db.students.map((s) => ({ ...s, StudentStatus: (s.StudentStatus || []).join('|') })));
      return send(res, 200, { csv });
    }

    if (url.pathname === '/api/audit' && req.method === 'GET') {
      if (!requireRole(req, 'supervisor')) return send(res, 403, { error: 'Forbidden' });
      return send(res, 200, { items: readAudit().slice(-500).reverse() });
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const body = await parseBody(req);
      const results = [];
      for (const op of body.operations || []) {
        if (op.type === 'create') {
          const fakeReq = { method: 'POST', headers: req.headers };
          const tempDb = readDb();
          op.payload.RollNumberID = generateRollId(op.payload, tempDb.specialists);
          op.payload.id = crypto.randomUUID();
          tempDb.students.push(op.payload);
          writeDb(tempDb);
          results.push({ opId: op.opId, ok: true });
          logAction(getUser(req), req.headers['x-role'] || '', 'offline_sync_create', op.payload);
        }
      }
      return send(res, 200, { results });
    }

    return send(res, 404, { error: 'Unknown API route' });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
