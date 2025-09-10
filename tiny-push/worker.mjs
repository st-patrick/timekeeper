// Tiny Push Worker (Cloudflare)
// Requires: KV binding "SUBS", secrets VAPID_PUBLIC, VAPID_PRIVATE, and APP_URL
import { buildPushPayload } from "@block65/webcrypto-web-push"; // Workers-compatible lib

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/subscribe') {
      const sub = await req.json();
      const id = crypto.randomUUID();
      await env.SUBS.put(id, JSON.stringify(sub));
      return new Response('ok', { headers: cors(req) });
    }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });

    if (url.pathname === '/send-now') {
      const results = await sendToAll(env, pingPayload(env));
      return new Response(JSON.stringify(results), {
        headers: { ...cors(req), 'content-type': 'application/json' }
      });
    }

    return new Response('not found', { status: 404, headers: cors(req) });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendToAll(env, pingPayload(env)));
  }
};

function cors(req) {
  const o = req.headers.get('origin') || '*';
  return {
    'access-control-allow-origin': o,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

function pingPayload(env) {
  const base = (env.APP_URL || '').replace(/\/$/, '');
  return {
    title: 'What are you doing?',
    body: 'Tap to jot a one-liner.',
    url: base ? `${base}/?ping=1` : '/?ping=1'
  };
}

async function sendToAll(env, payload) {
  const results = [];
  const vapid = {
    subject: "mailto:you@example.com",
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE
  };

  let cursor;
  do {
    const list = await env.SUBS.list({ cursor });
    cursor = list.cursor;

    for (const { name } of list.keys) {
      const raw = await env.SUBS.get(name);
      if (!raw) continue;

      const sub = JSON.parse(raw); // {endpoint, keys:{p256dh,auth}, ...}
      try {
        // Build a signed Web Push request for this subscription
        const requestInit = await buildPushPayload(
          { data: JSON.stringify(payload), options: { ttl: 900 } }, // expire in 15m
          sub,
          vapid
        );
        const res = await fetch(sub.endpoint, requestInit);
        if (res.status === 201) {
          results.push([name, 'ok']);
        } else {
          // prune 404/410 and similar "gone"
          if (res.status === 404 || res.status === 410) await env.SUBS.delete(name);
          results.push([name, `err:${res.status}`]);
        }
      } catch (e) {
        const msg = String(e);
        if (msg.includes('404') || msg.includes('410') || msg.includes('gone'))
          await env.SUBS.delete(name);
        results.push([name, 'err']);
      }
    }
  } while (cursor);

  return results;
}
