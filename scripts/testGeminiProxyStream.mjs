const url = (process.env.GEMINI_PROXY_URL || '').trim().replace(/\/$/, '');
const token = (process.env.FIREBASE_ID_TOKEN || '').trim();

if (!url) {
  throw new Error('Missing GEMINI_PROXY_URL');
}
if (!token) {
  throw new Error('Missing FIREBASE_ID_TOKEN');
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    modelId: 'gemini-1.5-flash',
    request: {
      contents: [{ role: 'user', parts: [{ text: 'Dis bonjour en 5 mots.' }] }],
      generationConfig: { maxOutputTokens: 64 },
    },
  }),
});

if (!res.ok) {
  const text = await res.text();
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
}

const decoder = new TextDecoder();
const reader = res.body.getReader();
let buf = '';
let acc = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  while (true) {
    const idx = buf.indexOf('\n\n');
    if (idx === -1) break;
    const block = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload) continue;
      const evt = JSON.parse(payload);
      if (evt.type === 'delta') {
        acc += evt.text || '';
        process.stdout.write(evt.text || '');
      }
      if (evt.type === 'done') {
        process.stdout.write('\n');
        process.stdout.write(acc.trim() ? '' : String(evt.text || ''));
        process.stdout.write('\n');
        process.exit(0);
      }
      if (evt.type === 'error') {
        throw new Error(evt.error || 'proxy_error');
      }
    }
  }
}

