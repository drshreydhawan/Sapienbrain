// Daily reminder push — invoked by Vercel Cron (see vercel.json) at 02:30 UTC = 08:00 IST.
// Uses the service role key (server-only) to read every user's due tasks and stored
// push subscriptions, then Web-Pushes a summary to each device.
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Due dates are plain YYYY-MM-DD strings; "today" is IST because this is a
// single-user app whose user lives in IST. Revisit if that ever changes.
function todayIST() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  webpush.setVapidDetails(
    'mailto:drshreydhawan@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = todayIST();

  const { data: actions, error: aErr } = await db
    .from('actions')
    .select('user_id, text, due, status')
    .in('status', ['open', 'waiting'])
    .not('due', 'is', null)
    .lte('due', today);
  if (aErr) return res.status(500).json({ error: aErr.message });

  const byUser = {};
  for (const a of actions || []) {
    (byUser[a.user_id] = byUser[a.user_id] || []).push(a);
  }
  const userIds = Object.keys(byUser);
  if (!userIds.length) return res.status(200).json({ users: 0, sent: 0, note: 'nothing due' });

  const { data: subs, error: sErr } = await db
    .from('push_subscriptions')
    .select('id, user_id, subscription')
    .in('user_id', userIds);
  if (sErr) return res.status(500).json({ error: sErr.message });

  let sent = 0, expired = 0;
  for (const row of subs || []) {
    const tasks = byUser[row.user_id];
    const overdue = tasks.filter(t => t.due < today).length;
    const dueToday = tasks.length - overdue;
    const title = 'Recall — ' +
      [dueToday ? dueToday + ' due today' : '', overdue ? overdue + ' overdue' : '']
        .filter(Boolean).join(', ');
    const body = tasks.slice(0, 3).map(t => '• ' + t.text).join('\n') +
      (tasks.length > 3 ? '\n…and ' + (tasks.length - 3) + ' more' : '');
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url: '/' }));
      sent++;
    } catch (e) {
      // 404/410 = the browser dropped this subscription (app uninstalled, permissions revoked)
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', row.id);
        expired++;
      }
    }
  }
  return res.status(200).json({ users: userIds.length, subscriptions: (subs || []).length, sent, expired });
}
