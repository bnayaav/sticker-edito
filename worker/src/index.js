// ComPhone Sticker Print Queue
// Cloudflare Worker — מתווך בין עורך נייד למחשב המדפיס.
// KV namespace binding: LABELS

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Job TTL — 10 דקות. אם המחשב לא קלט בזמן הזה, העבודה נעלמת.
const JOB_TTL = 600;
const MAX_QUEUE = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // POST /jobs — הנייד שולח מדבקה לתור
      if (path === '/jobs' && method === 'POST') {
        const { pin, label } = await request.json();
        if (!isValidPin(pin) || !label) return json({ error: 'bad request' }, 400);

        const key = `pin:${pin}`;
        const existing = (await env.LABELS.get(key, 'json')) || { jobs: [] };
        const job = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          label,
        };
        existing.jobs.push(job);
        // שמור עד MAX_QUEUE — אם הצטברו, זרוק ישנים
        existing.jobs = existing.jobs.slice(-MAX_QUEUE);
        await env.LABELS.put(key, JSON.stringify(existing), {
          expirationTtl: JOB_TTL,
        });
        return json({ ok: true, id: job.id, queued: existing.jobs.length });
      }

      // GET /jobs?pin=XXXX — המחשב עושה poll
      if (path === '/jobs' && method === 'GET') {
        const pin = url.searchParams.get('pin');
        if (!isValidPin(pin)) return json({ error: 'bad pin' }, 400);
        const data = (await env.LABELS.get(`pin:${pin}`, 'json')) || { jobs: [] };
        return json(data);
      }

      // DELETE /jobs/:id?pin=XXXX — המחשב מאשר שהדפיס
      if (path.startsWith('/jobs/') && method === 'DELETE') {
        const id = path.split('/')[2];
        const pin = url.searchParams.get('pin');
        if (!isValidPin(pin)) return json({ error: 'bad pin' }, 400);

        const key = `pin:${pin}`;
        const data = (await env.LABELS.get(key, 'json')) || { jobs: [] };
        const filtered = data.jobs.filter((j) => j.id !== id);

        if (filtered.length === 0) {
          await env.LABELS.delete(key);
        } else {
          await env.LABELS.put(key, JSON.stringify({ jobs: filtered }), {
            expirationTtl: JOB_TTL,
          });
        }
        return json({ ok: true });
      }

      // GET /templates?pin=XXXX — טמפלייטים שמורים
      if (path === '/templates' && method === 'GET') {
        const pin = url.searchParams.get('pin');
        if (!isValidPin(pin)) return json({ error: 'bad pin' }, 400);
        const data =
          (await env.LABELS.get(`tpl:${pin}`, 'json')) || { templates: [] };
        return json(data);
      }

      // PUT /templates — שמור רשימת טמפלייטים
      if (path === '/templates' && method === 'PUT') {
        const { pin, templates } = await request.json();
        if (!isValidPin(pin) || !Array.isArray(templates))
          return json({ error: 'bad request' }, 400);
        // הגבלה — עד 50 טמפלייטים, עד 100KB
        const trimmed = templates.slice(0, 50);
        const payload = JSON.stringify({ templates: trimmed });
        if (payload.length > 100_000) return json({ error: 'too large' }, 413);
        await env.LABELS.put(`tpl:${pin}`, payload);
        return json({ ok: true, count: trimmed.length });
      }

      // GET / — ברירת מחדל
      if (path === '/' || path === '') {
        return new Response('ComPhone Sticker Queue ✓', {
          headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}
