const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const db       = require('./db');

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fechafacil-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// âââââââââââââââââââââââââââââââââââââââââ
//  MIDDLEWARE DE AUTH
// âââââââââââââââââââââââââââââââââââââââââ
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'NÃ£o autorizado' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invÃ¡lido' });
  }
}

// âââââââââââââââââââââââââââââââââââââââââ
//  AUTH
// âââââââââââââââââââââââââââââââââââââââââ

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, profession, city, phone, email, password } = req.body;
    if (!name || !email || !password || !profession || !city || !phone)
      return res.status(400).json({ error: 'Preencha todos os campos' });

    const existing = await db.users.findOne({ email });
    if (existing) return res.status(400).json({ error: 'E-mail jÃ¡ cadastrado' });

    const password_hash = await bcrypt.hash(password, 10);
    const slug = name.toLowerCase()
      .normalize('NFD').replace(/[Ì-Í¯]/g, '')
      .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).slice(2, 6);

    const user = await db.users.insert({
      name, profession, city, phone, email, password_hash, bio: '', slug,
      created_at: new Date().toISOString()
    });

    // ServiÃ§os padrÃ£o
    const defaults = getDefaultServices(profession);
    for (let i = 0; i < defaults.length; i++) {
      await db.services.insert({ user_id: user._id, name: defaults[i].name, price: defaults[i].price, description: '', active: true, sort_order: i });
    }

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safe } = user;
    res.json({ token, user: { ...safe, id: user._id } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash, ...safe } = user;
    res.json({ token, user: { ...safe, id: user._id } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me', auth, async (req, res) => {
  const user = await db.users.findOne({ _id: req.user.id });
  if (!user) return res.status(404).json({ error: 'UsuÃ¡rio nÃ£o encontrado' });
  const { password_hash, ...safe } = user;
  res.json({ ...safe, id: user._id });
});

app.put('/api/me', auth, async (req, res) => {
  try {
    const { name, profession, city, phone, bio } = req.body;
    await db.users.update({ _id: req.user.id }, { $set: { name, profession, city, phone, bio: bio || '' } });
    const user = await db.users.findOne({ _id: req.user.id });
    const { password_hash, ...safe } = user;
    res.json({ ...safe, id: user._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// âââââââââââââââââââââââââââââââââââââââââ
//  SERVIÃOS
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/services', auth, async (req, res) => {
  const rows = await db.services.find({ user_id: req.user.id }).sort({ sort_order: 1, name: 1 });
  res.json(rows.map(s => ({ ...s, id: s._id })));
});

app.post('/api/services', auth, async (req, res) => {
  try {
    const { name, description, price } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'Nome e preÃ§o obrigatÃ³rios' });
    const s = await db.services.insert({ user_id: req.user.id, name, description: description || '', price: Number(price), active: true, sort_order: 99 });
    res.json({ ...s, id: s._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/services/:id', auth, async (req, res) => {
  try {
    const { name, description, price, active } = req.body;
    await db.services.update({ _id: req.params.id, user_id: req.user.id }, { $set: { name, description: description || '', price: Number(price), active: !!active } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/services/:id', auth, async (req, res) => {
  await db.services.remove({ _id: req.params.id, user_id: req.user.id });
  res.json({ ok: true });
});

// âââââââââââââââââââââââââââââââââââââââââ
//  CLIENTES
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/clients', auth, async (req, res) => {
  const clients = await db.clients.find({ user_id: req.user.id }).sort({ name: 1 });
  // Enriquecer com contagem de orÃ§amentos
  const enriched = await Promise.all(clients.map(async c => {
    const quotes = await db.quotes.find({ client_id: c._id }).sort({ created_at: -1 });
    return {
      ...c, id: c._id,
      quote_count: quotes.length,
      last_quote: quotes[0]?.created_at || null
    };
  }));
  res.json(enriched);
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone obrigatÃ³rios' });
    const c = await db.clients.insert({ user_id: req.user.id, name, phone, email: email || '', address: address || '', notes: notes || '', created_at: new Date().toISOString() });
    res.json({ ...c, id: c._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', auth, async (req, res) => {
  const client = await db.clients.findOne({ _id: req.params.id, user_id: req.user.id });
  if (!client) return res.status(404).json({ error: 'Cliente nÃ£o encontrado' });
  const quotes = await db.quotes.find({ client_id: client._id }).sort({ created_at: -1 });
  res.json({ ...client, id: client._id, quotes: quotes.map(q => ({ ...q, id: q._id })) });
});

app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    await db.clients.update({ _id: req.params.id, user_id: req.user.id }, { $set: { name, phone, email: email || '', address: address || '', notes: notes || '' } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// âââââââââââââââââââââââââââââââââââââââââ
//  ORÃAMENTOS
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/quotes', auth, async (req, res) => {
  const quotes = await db.quotes.find({ user_id: req.user.id }).sort({ created_at: -1 });
  res.json(quotes.map(q => ({ ...q, id: q._id })));
});

app.post('/api/quotes', auth, async (req, res) => {
  try {
    // Accept both camelCase (new frontend) and snake_case (legacy)
    const clientId    = req.body.clientId    || req.body.client_id;
    const clientName  = req.body.clientName  || req.body.client_name;
    const clientPhone = req.body.clientPhone || req.body.client_phone;
    const items       = req.body.items;
    const notes       = req.body.notes || '';
    const validUntil  = req.body.validUntil  || req.body.valid_until;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Adicione pelo menos um serviÃ§o' });
    if (!clientName) return res.status(400).json({ error: 'Cliente obrigatÃ³rio' });

    // Items can be {name, price} (new) or {description, quantity, unit_price} (legacy)
    const normalizedItems = items.map(it => ({
      name:       it.name || it.description || '',
      price:      Number(it.price != null ? it.price : (it.unit_price * (it.quantity || 1))) || 0,
      description: it.description && it.name ? it.description : ''
    }));

    const total = req.body.total != null
      ? Number(req.body.total)
      : normalizedItems.reduce((s, i) => s + i.price, 0);

    const token = uuidv4().replace(/-/g, '').slice(0, 12);

    const quote = await db.quotes.insert({
      user_id:     req.user.id,
      client_id:   clientId || null,
      client_name: clientName,
      client_phone: clientPhone || '',
      token,
      status:      'sent',
      total,
      notes,
      valid_until: validUntil || new Date(Date.now() + 7*864e5).toISOString().split('T')[0],
      created_at:  new Date().toISOString()
    });

    // Inserir itens
    for (const it of normalizedItems) {
      await db.quote_items.insert({
        quote_id:    quote._id,
        name:        it.name,
        description: it.description,
        price:       it.price
      });
    }

    res.json({ ...quote, id: quote._id, token, link: `/q/${token}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quotes/:id', auth, async (req, res) => {
  const quote = await db.quotes.findOne({ _id: req.params.id, user_id: req.user.id });
  if (!quote) return res.status(404).json({ error: 'OrÃ§amento nÃ£o encontrado' });
  const items = await db.quote_items.find({ quote_id: quote._id });
  res.json({ ...quote, id: quote._id, items: items.map(i => ({ ...i, id: i._id })) });
});

app.put('/api/quotes/:id/cancel', auth, async (req, res) => {
  await db.quotes.update({ _id: req.params.id, user_id: req.user.id }, { $set: { status: 'cancelled' } });
  res.json({ ok: true });
});

// âââââââââââââââââââââââââââââââââââââââââ
//  ORÃAMENTO PÃBLICO (sem auth)
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/q/:token', async (req, res) => {
  try {
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'OrÃ§amento nÃ£o encontrado' });

    // Checar expiraÃ§Ã£o
    if (quote.valid_until && new Date(quote.valid_until) < new Date() && quote.status === 'sent') {
      await db.quotes.update({ _id: quote._id }, { $set: { status: 'expired' } });
      quote.status = 'expired';
    }

    const items = await db.quote_items.find({ quote_id: quote._id });
    const user  = await db.users.findOne({ _id: quote.user_id });
    const { password_hash, ...safeUser } = user;
    const pro = { ...safeUser, id: user._id };

    // Return format expected by quote-public.html: { quote, pro, items }
    res.json({
      quote: { ...quote, id: quote._id },
      pro,
      items: items.map(i => ({ ...i, id: i._id }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// New unified endpoint: POST /api/q/:token with { action: 'accepted'|'rejected' }
app.post('/api/q/:token', async (req, res) => {
  try {
    const { action } = req.body;
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'OrÃ§amento nÃ£o encontrado' });
    if (quote.status !== 'sent') return res.status(400).json({ error: 'Este orÃ§amento nÃ£o pode ser alterado' });

    const newStatus = action === 'accepted' ? 'accepted' : 'rejected';
    await db.quotes.update({ token: req.params.token }, { $set: { status: newStatus, responded_at: new Date().toISOString() } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy endpoints (kept for backward compatibility)
app.post('/api/q/:token/approve', async (req, res) => {
  try {
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'OrÃ§amento nÃ£o encontrado' });
    await db.quotes.update({ token: req.params.token }, { $set: { status: 'accepted', responded_at: new Date().toISOString() } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/q/:token/decline', async (req, res) => {
  try {
    const quote = await db.quotes.findOne({ token: req.params.token });
    if (!quote) return res.status(404).json({ error: 'NÃ£o encontrado' });
    await db.quotes.update({ token: req.params.token }, { $set: { status: 'rejected', responded_at: new Date().toISOString() } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// âââââââââââââââââââââââââââââââââââââââââ
//  DASHBOARD
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const allQuotes   = await db.quotes.find({ user_id: uid });
    const monthQuotes = allQuotes.filter(q => q.created_at?.startsWith(month));
    const approved    = monthQuotes.filter(q => q.status === 'approved');
    const pending     = allQuotes.filter(q => q.status === 'sent');
    const clients     = await db.clients.find({ user_id: uid });
    const recent      = allQuotes.sort((a, b) => b.created_at > a.created_at ? 1 : -1).slice(0, 5);

    res.json({
      month_quotes:   monthQuotes.length,
      month_approved: approved.length,
      month_revenue:  approved.reduce((s, q) => s + q.total, 0),
      conversion:     monthQuotes.length > 0 ? Math.round((approved.length / monthQuotes.length) * 100) : 0,
      pending_quotes: pending.length,
      total_clients:  clients.length,
      recent_quotes:  recent.map(q => ({ ...q, id: q._id }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// âââââââââââââââââââââââââââââââââââââââââ
//  MINI-SITE DO PROFISSIONAL
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/api/minisite/:slug', async (req, res) => {
  try {
    const user = await db.users.findOne({ slug: req.params.slug });
    if (!user) return res.status(404).json({ error: 'Profissional nÃ£o encontrado' });
    const services = await db.services.find({ user_id: user._id }).sort({ sort_order: 1 });
    const { password_hash, ...safe } = user;
    res.json({ user: { ...safe, id: user._id }, services: services.map(s => ({ ...s, id: s._id })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// âââââââââââââââââââââââââââââââââââââââââ
//  ROTAS DO FRONTEND
// âââââââââââââââââââââââââââââââââââââââââ

app.get('/q/:token',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'quote-public.html')));
app.get('/:slug',     (req,  res) => {
  const known = ['dashboard.html','quotes.html','quote-new.html','clients.html','profile.html','minisite.html'];
  if (!known.includes(req.params.slug) && !req.params.slug.includes('.'))
    return res.sendFile(path.join(__dirname, 'public', 'minisite.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// âââââââââââââââââââââââââââââââââââââââââ
//  START
// âââââââââââââââââââââââââââââââââââââââââ

app.listen(PORT, () => {
  console.log(`ð FechaFÃ¡cil rodando em http://localhost:${PORT}`);
  console.log(`   Banco de dados: ./data/`);
});

// âââââââââââââââââââââââââââââââââââââââââ
//  HELPERS
// âââââââââââââââââââââââââââââââââââââââââ

function getDefaultServices(profession) {
  const map = {
    'Eletricista': [
      { name: 'InstalaÃ§Ã£o de tomadas (un.)', price: 60 },
      { name: 'Troca de disjuntor', price: 80 },
      { name: 'InstalaÃ§Ã£o de interruptores', price: 50 },
      { name: 'InstalaÃ§Ã£o de lustres / luminÃ¡rias', price: 90 },
      { name: 'Passagem de fiaÃ§Ã£o (m)', price: 25 },
      { name: 'Quadro de distribuiÃ§Ã£o', price: 200 },
      { name: 'MÃ£o de obra', price: 100 },
    ],
    'Encanador': [
      { name: 'Desentupimento de pia', price: 150 },
      { name: 'Troca de torneira', price: 80 },
      { name: 'Conserto de vaso sanitÃ¡rio', price: 100 },
      { name: 'InstalaÃ§Ã£o de chuveiro', price: 120 },
      { name: 'Vazamento em tubulaÃ§Ã£o', price: 180 },
      { name: 'MÃ£o de obra', price: 100 },
    ],
    'Pintor': [
      { name: 'Pintura interna (m2)', price: 15 },
      { name: 'Pintura externa (m2)', price: 20 },
      { name: 'Lijamento e massa (m2)', price: 12 },
      { name: 'Tinta (galao) - fornecedo', price: 70 },
      { name: 'Pintura de madeira / metal', price: 250 },
      { name: 'M obra', price: 100 },
    ],
    'Pedreiro': [
      { name: 'Assentamento de azlejos (m2)', price: 50 },
      { name: 'Contrapiso (m2)', price: 30 },
      { name: 'Reboco (m2)', price: 25 },
      { name: 'DemoliÃ§Ã£o', price: 200 },
      { name: 'Chapa de gesso (m2)', price: 60 },
      { name: 'MÃ£o de obra', price: 100 },
    ],
    'MÃªcanico': [
      { name: 'RevisÃ£o'ulho', price: 200 },
      { name: 'Troca de oleo', price: 150 },
      { name: 'Alinhamento e balanceamento', price: 120 },
      { name: 'Troca de pastilhas', price: 250 },
      { name: 'ServiåÃ§o de ar condicionado', price: 180 },
      { name: 'MÃ£o de obra', price: 100 },
    ],
  };
  return map[profession] || [
    { name: 'ServiåÃ§o padrÃ£o', price: 100 },
    { name: 'MÃ£o de obra', price: 100 },
  ];
}
