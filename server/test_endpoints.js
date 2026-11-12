const http = require('http');

function request(path, method='GET', body=null, headers={}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0, ...headers },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  try {
    console.log('=== TEST 1: Health ===');
    const h = await request('/api/health');
    console.log('Status:', h.status, 'Body:', h.body);

    console.log('\\n=== TEST 2: Login (admin/admin123) ===');
    const l = await request('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
    console.log('Status:', l.status, 'Body:', l.body);
    const adminToken = l.body.token || l.body.access_token || l.body.auth_token;
    console.log('Token present:', !!adminToken);

    console.log('\\n=== TEST 3: Protected route (no token) ===');
    const np = await request('/api/documents', 'GET');
    console.log('Status:', np.status, 'Body:', np.body);

    if (adminToken) {
      console.log('\\n=== TEST 4: Protected route (with token) ===');
      const pt = await request('/api/documents', 'GET', null, { 'Authorization': 'Bearer ' + adminToken });
      console.log('Status:', pt.status, 'Body:', pt.body);

      console.log('\\n=== TEST 5: Ingest file ===');
      const ingest = await request('/api/ingest', 'POST', {
        name: 'test.txt',
        path: 'D:/Develop/knowledge-app/test.txt',
        sizeBytes: 10,
        kind: 'txt',
        accessPolicy: 'restricted',
        metadata: {}
      }, { 'Authorization': 'Bearer ' + adminToken });
      console.log('Status:', ingest.status, 'Body:', ingest.body);
    }
  } catch (e) {
    console.error('Test suite error:', e.message);
  }
}

runTests().catch(e => console.error('Fatal:', e.message));
