// Weekly data backup — invoked by Vercel Cron (see vercel.json), Sunday 03:00 UTC.
// Snapshots every table to a private Blob file, keeping a rolling 6-week
// history so a bad backup can't overwrite the last known-good one.
import { createClient } from '@supabase/supabase-js';
import { put, list, del } from '@vercel/blob';

const KEEP = 6;

export default async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [folders, sessions, actions, expenses, pushSubs] = await Promise.all([
    db.from('folders').select('*'),
    db.from('sessions').select('*'),
    db.from('actions').select('*'),
    db.from('expenses').select('*'),
    db.from('push_subscriptions').select('id, user_id, endpoint, created_at'),
  ]);
  for (const [name, r] of Object.entries({ folders, sessions, actions, expenses, pushSubs })) {
    if (r.error) return res.status(500).json({ error: name + ': ' + r.error.message });
  }

  const snapshot = {
    takenAt: new Date().toISOString(),
    folders: folders.data,
    sessions: sessions.data,
    actions: actions.data,
    expenses: expenses.data,
    pushSubscriptions: pushSubs.data,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const { url } = await put('backups/backup-' + stamp + '.json', JSON.stringify(snapshot), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  const { blobs } = await list({ prefix: 'backups/' });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const stale = blobs.slice(KEEP);
  if (stale.length) await del(stale.map(b => b.url));

  return res.status(200).json({ saved: url, kept: Math.min(blobs.length, KEEP), pruned: stale.length });
}
