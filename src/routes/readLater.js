// src/routes/readLater.js
import express from 'express';
import crypto from 'crypto';
import { authRequired } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();
const keyFor = (link) => crypto.createHash('sha1').update(String(link||'')).digest('hex');

// Get saved list (auto-expire after 7 days)
router.get('/', authRequired, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.json({ items: [] });

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const beforePruneCount = user.savedNews.length;
  user.savedNews = (user.savedNews || []).filter(n => {
    const savedTs = n.savedAt ? new Date(n.savedAt).getTime() : (n.isoDate ? new Date(n.isoDate).getTime() : Date.now());
    return savedTs >= sevenDaysAgo;
  });
  if (user.savedNews.length !== beforePruneCount) await user.save();

  // Return newest first
  const items = [...user.savedNews].sort((a,b) => (new Date(b.savedAt||b.isoDate||0)) - (new Date(a.savedAt||a.isoDate||0)));
  res.json({ items });
});

// Save an item (auto-expire and cap)
router.post('/', authRequired, async (req, res) => {
  const { title='', summary='', link='', isoDate=null, image='', source='', category='others' } = req.body || {};
  if (!link) return res.status(400).json({ error: 'link required' });
  const key = keyFor(link);

  const user = await User.findById(req.user.id);
  // Prune older than 7 days before saving
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  user.savedNews = (user.savedNews || []).filter(n => {
    const savedTs = n.savedAt ? new Date(n.savedAt).getTime() : (n.isoDate ? new Date(n.isoDate).getTime() : Date.now());
    return savedTs >= sevenDaysAgo;
  });

  const exists = user.savedNews.find(n => n.key === key);
  if (!exists) {
    user.savedNews.unshift({ key, title, summary, link, isoDate, image, source, category, savedAt: new Date() });
    user.savedNews = user.savedNews.slice(0, 500); // cap
    await user.save();
  }
  res.json({ ok: true });
});

// Remove an item
router.delete('/:key', authRequired, async (req, res) => {
  const { key } = req.params;
  const user = await User.findById(req.user.id);
  user.savedNews = user.savedNews.filter(n => n.key !== key);
  await user.save();
  res.json({ ok: true });
});

export default router;
