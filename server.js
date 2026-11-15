const path = require('path');
// Carga siempre el .env ubicado junto a server.js, aunque Node se ejecute desde otra carpeta.
const envPath = path.join(__dirname, '.env');
// El .env del proyecto tiene prioridad sobre variables heredadas de Windows/terminal.
const envLoad = require('dotenv').config({ path: envPath, override: true });
if (envLoad.error && envLoad.error.code !== 'ENOENT') {
  console.error('No se pudo leer el archivo .env:', envLoad.error.message);
}
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('En producción configura SESSION_SECRET con al menos 32 caracteres en .env.');
}
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'business.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const PERMISSIONS = {
  'dashboard.view': 'Ver dashboard y estadísticas',
  'sales.view_all': 'Ver todas las ventas',
  'sales.view_own': 'Ver sus propias ventas',
  'sales.create': 'Registrar ventas',
  'sales.cancel': 'Anular ventas',
  'inventory.view': 'Consultar productos y stock',
  'inventory.manage': 'Crear/editar productos y ajustar stock',
  'cash.open': 'Abrir caja',
  'cash.close': 'Cerrar caja',
  'cash.view_all': 'Ver todas las cajas y movimientos',
  'cash.move': 'Registrar ingresos y egresos',
  'users.manage': 'Crear usuarios y administrar permisos',
  'reports.view': 'Consultar y exportar reportes',
  'settings.manage': 'Modificar configuración del negocio'
};
const ALL_PERMISSIONS = Object.keys(PERMISSIONS);
const ROLE_DEFAULTS = {
  ADMINISTRADOR: ['dashboard.view','sales.view_all','sales.cancel','inventory.view','inventory.manage','cash.open','cash.close','cash.view_all','cash.move','reports.view'],
  VENDEDOR: ['sales.view_own','sales.create','inventory.view','cash.open','cash.close','cash.move']
};

 db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('OWNER','ADMINISTRADOR','VENDEDOR')),
 permissions TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL CHECK(price>=0),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), tag TEXT DEFAULT '', description TEXT DEFAULT '',
 image TEXT DEFAULT '', images TEXT DEFAULT '[]', original_price REAL, active INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cash_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), opening_amount REAL NOT NULL CHECK(opening_amount>=0),
 closed_at TEXT, closing_amount REAL, expected_amount REAL, difference REAL, status TEXT NOT NULL DEFAULT 'OPEN'
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_cash_per_user ON cash_sessions(user_id) WHERE status='OPEN';
CREATE TABLE IF NOT EXISTS sales (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
 cash_session_id INTEGER REFERENCES cash_sessions(id), subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0,
 total REAL NOT NULL, payment_method TEXT NOT NULL, customer_name TEXT DEFAULT '', customer_phone TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'COMPLETED', notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sale_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL,
 product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
 user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('INCOME','EXPENSE')),
 category TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>0),
 sale_id INTEGER REFERENCES sales(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 type TEXT NOT NULL, quantity INTEGER NOT NULL, before_stock INTEGER NOT NULL, after_stock INTEGER NOT NULL,
 reason TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
 entity TEXT NOT NULL, entity_id TEXT, details TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

function log(userId, action, entity, entityId, details='') {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)')
    .run(userId || null, action, entity, entityId == null ? null : String(entityId), details);
}
function safeUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role,
    permissions: row.role === 'OWNER' ? ALL_PERMISSIONS : JSON.parse(row.permissions || '[]'), active: !!row.active };
}
function hasPermission(user, permission) {
  return !!user && (user.role === 'OWNER' || user.permissions.includes(permission));
}
function auth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  const row = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!row) { req.session.destroy(()=>{}); return res.status(401).json({ error: 'La sesión ya no es válida.' }); }
  req.user = safeUser(row); next();
}
function permit(permission) {
  return (req, res, next) => hasPermission(req.user, permission)
    ? next() : res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
}
function activeCash(userId) { return db.prepare("SELECT * FROM cash_sessions WHERE user_id=? AND status='OPEN'").get(userId); }
function productFromRow(p) { return { ...p, images: JSON.parse(p.images || '[]'), originalPrice: p.original_price }; }
function getProducts() {
  return db.prepare('SELECT * FROM products WHERE active=1 ORDER BY rowid').all().map(productFromRow);
}

const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
const insertProduct = db.prepare(`INSERT OR IGNORE INTO products(id,name,category,price,stock,tag,description,image,images,original_price)
 VALUES(@id,@name,@category,@price,@stock,@tag,@description,@image,@images,@originalPrice)`);
const seedProducts = db.transaction(items => items.forEach(p => insertProduct.run({ ...p, images: JSON.stringify(p.images || []), originalPrice: p.originalPrice ?? null })));
seedProducts(seed);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR, concurrentDB: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', maxAge: 1000*60*60*10 }
}));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.' } });

app.get('/api/health', (req,res)=>res.json({ ok:true, service:'Xinyuan sales backend' }));
app.get('/api/products', (req,res)=>res.json(getProducts()));
app.get('/api/setup/status', (req,res)=>res.json({ needsOwner: !db.prepare("SELECT id FROM users WHERE role='OWNER' LIMIT 1").get() }));
app.post('/api/setup', loginLimiter, async (req,res)=>{
  // El registro inicial solo está disponible mientras todavía no exista una cuenta OWNER.
  const { username, password } = req.body;
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username || '') || typeof password !== 'string' || password.length < 10)
    return res.status(400).json({ error:'Usa un nombre de usuario de 3 a 32 caracteres y una contraseña de al menos 10 caracteres.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    // La comprobación y creación se realizan juntas para evitar dos OWNER simultáneos.
    const result = db.transaction(() => {
      const exists = db.prepare("SELECT id FROM users WHERE role='OWNER' LIMIT 1").get();
      if (exists) return null;
      return db.prepare("INSERT INTO users(username,name,password_hash,role,permissions) VALUES(?,?,?,'OWNER',?)")
        .run(username, username, hash, JSON.stringify(ALL_PERMISSIONS));
    })();
    if (!result) return res.status(409).json({ error:'La cuenta OWNER ya fue configurada.' });
    req.session.userId = result.lastInsertRowid;
    log(result.lastInsertRowid,'OWNER_CREATED','user',result.lastInsertRowid);
    res.status(201).json({ user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error:'Ese nombre de usuario ya existe.' });
    throw error;
  }
});
app.post('/api/auth/login', loginLimiter, async (req,res)=>{
  const { username, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').get(String(username||''));
  if (!row || !await bcrypt.compare(String(password||''), row.password_hash))
    return res.status(401).json({ error:'Usuario o contraseña incorrectos.' });
  req.session.regenerate(err=>{
    if (err) return res.status(500).json({error:'No se pudo iniciar sesión.'});
    req.session.userId = row.id;
    log(row.id,'LOGIN','session',row.id);
    res.json({ user: safeUser(row) });
  });
});
app.post('/api/auth/logout', auth, (req,res)=>{
  log(req.user.id,'LOGOUT','session',req.user.id);
  req.session.destroy(()=>res.json({ ok:true }));
});
app.get('/api/auth/me', auth, (req,res)=>res.json({ user:req.user }));
app.post('/api/auth/password', auth, async (req,res)=>{
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(!await bcrypt.compare(String(req.body.currentPassword||''),row.password_hash)) return res.status(400).json({error:'La contraseña actual no coincide.'});
  if(String(req.body.newPassword||'').length<12) return res.status(400).json({error:'La nueva contraseña debe tener al menos 12 caracteres.'});
  const hash=await bcrypt.hash(req.body.newPassword,12); db.prepare('UPDATE users SET password_hash=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(hash,req.user.id);
  log(req.user.id,'PASSWORD_CHANGED','user',req.user.id); res.json({ok:true});
});

// Usuarios y permisos: únicamente OWNER posee users.manage por defecto.
app.get('/api/permissions', auth, permit('users.manage'), (req,res)=>res.json({ permissions:PERMISSIONS, roles:ROLE_DEFAULTS }));
app.get('/api/users', auth, permit('users.manage'), (req,res)=>{
  const rows=db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(rows.map(r=>({ ...safeUser(r), createdAt:r.created_at })));
});
app.post('/api/users', auth, permit('users.manage'), async (req,res)=>{
  const { username,password,name,role,permissions }=req.body;
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username||'') || (password||'').length<10 || !String(name||'').trim() || !['ADMINISTRADOR','VENDEDOR'].includes(role))
    return res.status(400).json({error:'Datos inválidos. La contraseña debe tener al menos 10 caracteres.'});
  const selected=Array.isArray(permissions)?[...new Set(permissions.filter(p=>ALL_PERMISSIONS.includes(p)))]:ROLE_DEFAULTS[role];
  if (selected.includes('users.manage') || selected.includes('settings.manage')) return res.status(400).json({error:'Solo OWNER puede administrar usuarios y configuración.'});
  try {
    const hash=await bcrypt.hash(password,12);
    const r=db.prepare('INSERT INTO users(username,name,password_hash,role,permissions) VALUES(?,?,?,?,?)').run(username,String(name).trim(),hash,role,JSON.stringify(selected));
    log(req.user.id,'USER_CREATED','user',r.lastInsertRowid,role);
    res.status(201).json({user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid))});
  } catch(e) { res.status(409).json({error:'Ese nombre de usuario ya existe.'}); }
});
app.patch('/api/users/:id', auth, permit('users.manage'), async (req,res)=>{
  const target=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!target) return res.status(404).json({error:'Usuario no encontrado.'});
  if(target.role==='OWNER') return res.status(403).json({error:'La cuenta OWNER principal está protegida.'});
  const name=req.body.name===undefined?target.name:String(req.body.name).trim();
  const role=req.body.role===undefined?target.role:req.body.role;
  if(!['ADMINISTRADOR','VENDEDOR'].includes(role)) return res.status(400).json({error:'Rol inválido.'});
  const permissions=Array.isArray(req.body.permissions)?[...new Set(req.body.permissions.filter(p=>ALL_PERMISSIONS.includes(p)))]:JSON.parse(target.permissions);
  if(permissions.includes('users.manage')||permissions.includes('settings.manage')) return res.status(400).json({error:'Solo OWNER puede administrar usuarios y configuración.'});
  const active=req.body.active===undefined?target.active:(req.body.active?1:0);
  const hash=req.body.password && req.body.password.length>=10 ? await bcrypt.hash(req.body.password,12) : target.password_hash;
  db.prepare('UPDATE users SET name=?,role=?,permissions=?,active=?,password_hash=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
    .run(name,role,JSON.stringify(permissions),active,hash,target.id);
  log(req.user.id,'USER_UPDATED','user',target.id,JSON.stringify({role,active}));
  res.json({user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id))});
});

// Productos e inventario.
app.get('/api/inventory', auth, permit('inventory.view'), (req,res)=>res.json(getProducts()));
app.post('/api/products', auth, permit('inventory.manage'), (req,res)=>{
  const p=req.body;
  if(!p.id||!p.name||!p.category||!Number.isFinite(Number(p.price))||Number(p.price)<0||!Number.isInteger(Number(p.stock))||Number(p.stock)<0)
    return res.status(400).json({error:'Completa código, nombre, categoría, precio y stock válido.'});
  try {
    db.prepare(`INSERT INTO products(id,name,category,price,stock,tag,description,image,images,original_price) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(String(p.id),String(p.name),String(p.category),Number(p.price),Number(p.stock),p.tag||'',p.description||'',p.image||'',JSON.stringify(p.images||[p.image].filter(Boolean)),p.originalPrice??null);
    log(req.user.id,'PRODUCT_CREATED','product',p.id);
    res.status(201).json({product:productFromRow(db.prepare('SELECT * FROM products WHERE id=?').get(p.id))});
  } catch(e){res.status(409).json({error:'El código del producto ya existe.'});}
});
app.patch('/api/products/:id', auth, permit('inventory.manage'), (req,res)=>{
  const old=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if(!old) return res.status(404).json({error:'Producto no encontrado.'});
  const p={...old,...req.body};
  if(Number(p.price)<0||!Number.isFinite(Number(p.price))||!Number.isInteger(Number(p.stock))||Number(p.stock)<0) return res.status(400).json({error:'Precio o stock inválido.'});
  db.prepare(`UPDATE products SET name=?,category=?,price=?,stock=?,tag=?,description=?,image=?,images=?,original_price=?,active=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(p.name,p.category,Number(p.price),Number(p.stock),p.tag||'',p.description||'',p.image||'',JSON.stringify(p.images||JSON.parse(old.images||'[]')),p.originalPrice??p.original_price??null,p.active===false?0:1,old.id);
  if(Number(p.stock)!==old.stock) db.prepare('INSERT INTO stock_movements(product_id,user_id,type,quantity,before_stock,after_stock,reason) VALUES(?,?,?,?,?,?,?)')
    .run(old.id,req.user.id,'ADJUSTMENT',Number(p.stock)-old.stock,old.stock,Number(p.stock),req.body.stockReason||'Ajuste desde inventario');
  log(req.user.id,'PRODUCT_UPDATED','product',old.id);
  res.json({product:productFromRow(db.prepare('SELECT * FROM products WHERE id=?').get(old.id))});
});
app.post('/api/inventory/:id/adjust', auth, permit('inventory.manage'), (req,res)=>{
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id); const q=Number(req.body.quantity);
  if(!p||!Number.isInteger(q)||q===0||p.stock+q<0) return res.status(400).json({error:'Movimiento inválido o stock insuficiente.'});
  db.prepare('UPDATE products SET stock=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(p.stock+q,p.id);
  db.prepare('INSERT INTO stock_movements(product_id,user_id,type,quantity,before_stock,after_stock,reason) VALUES(?,?,?,?,?,?,?)')
    .run(p.id,req.user.id,q>0?'IN':'OUT',q,p.stock,p.stock+q,String(req.body.reason||'Movimiento manual'));
  log(req.user.id,'STOCK_ADJUSTED','product',p.id,String(q));
  res.json({stock:p.stock+q});
});

// Caja.
app.get('/api/cash/current', auth, (req,res)=>{
  const canAll=hasPermission(req.user,'cash.view_all');
  const rows=db.prepare(`SELECT c.*,u.name AS user_name FROM cash_sessions c JOIN users u ON u.id=c.user_id WHERE c.status='OPEN' ${canAll?'':'AND c.user_id=?'} ORDER BY c.opened_at DESC`)
    .all(...(canAll?[]:[req.user.id]));
  res.json(rows.map(c=>({ ...c, movements:db.prepare('SELECT COALESCE(SUM(CASE WHEN type=\'INCOME\' THEN amount ELSE -amount END),0) AS net FROM cash_movements WHERE cash_session_id=?').get(c.id).net })));
});
app.post('/api/cash/open', auth, permit('cash.open'), (req,res)=>{
  const amount=Number(req.body.openingAmount);
  if(!Number.isFinite(amount)||amount<0) return res.status(400).json({error:'El monto inicial no es válido.'});
  if(activeCash(req.user.id)) return res.status(409).json({error:'Ya tienes una caja abierta.'});
  const r=db.prepare('INSERT INTO cash_sessions(user_id,opening_amount) VALUES(?,?)').run(req.user.id,amount);
  log(req.user.id,'CASH_OPENED','cash',r.lastInsertRowid,String(amount));
  res.status(201).json({cash:db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(r.lastInsertRowid)});
});
app.post('/api/cash/movement', auth, permit('cash.move'), (req,res)=>{
  const cash=activeCash(req.user.id); const {type,category,description}=req.body; const amount=Number(req.body.amount);
  if(!cash) return res.status(409).json({error:'Debes abrir tu caja primero.'});
  if(!['INCOME','EXPENSE'].includes(type)||!Number.isFinite(amount)||amount<=0||!String(description||'').trim()) return res.status(400).json({error:'Movimiento inválido.'});
  const r=db.prepare('INSERT INTO cash_movements(cash_session_id,user_id,type,category,description,amount) VALUES(?,?,?,?,?,?)')
    .run(cash.id,req.user.id,type,category||'OTRO',String(description).trim(),amount);
  log(req.user.id,'CASH_MOVEMENT','cash_movement',r.lastInsertRowid,`${type} ${amount}`);
  res.status(201).json({id:r.lastInsertRowid});
});
app.get('/api/cash/movements', auth, permit('cash.view_all'), (req,res)=>{
  const rows=db.prepare(`SELECT m.*,u.name AS user_name FROM cash_movements m JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC LIMIT 300`).all();res.json(rows);
});
app.post('/api/cash/:id/close', auth, permit('cash.close'), (req,res)=>{
  const cash=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(req.params.id);
  if(!cash||cash.status!=='OPEN'||(cash.user_id!==req.user.id&&!hasPermission(req.user,'cash.view_all'))) return res.status(404).json({error:'Caja abierta no encontrada o sin autorización.'});
  const net=db.prepare("SELECT COALESCE(SUM(CASE WHEN type='INCOME' THEN amount ELSE -amount END),0) AS net FROM cash_movements WHERE cash_session_id=?").get(cash.id).net;
  const expected=Number((cash.opening_amount+net).toFixed(2)); const counted=Number(req.body.closingAmount);
  if(!Number.isFinite(counted)||counted<0) return res.status(400).json({error:'El efectivo contado no es válido.'});
  const diff=Number((counted-expected).toFixed(2));
  db.prepare("UPDATE cash_sessions SET status='CLOSED',closed_at=datetime('now','localtime'),closing_amount=?,expected_amount=?,difference=? WHERE id=?")
    .run(counted,expected,diff,cash.id);
  log(req.user.id,'CASH_CLOSED','cash',cash.id,JSON.stringify({counted,expected,diff}));
  res.json({expected,closingAmount:counted,difference:diff});
});

// Ventas.
app.get('/api/sales', auth, (req,res)=>{
  if(!hasPermission(req.user,'sales.view_all')&&!hasPermission(req.user,'sales.view_own')&&!hasPermission(req.user,'sales.create')) return res.status(403).json({error:'No tienes permiso para consultar ventas.'});
  const own=!hasPermission(req.user,'sales.view_all');
  const sales=db.prepare(`SELECT s.*,u.name AS seller_name FROM sales s JOIN users u ON u.id=s.user_id ${own?'WHERE s.user_id=?':''} ORDER BY s.created_at DESC LIMIT 500`)
    .all(...(own?[req.user.id]:[]));
  res.json(sales.map(s=>({...s,items:db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(s.id)})));
});
app.post('/api/sales', auth, permit('sales.create'), (req,res)=>{
  const {items,paymentMethod,customerName,customerPhone,notes}=req.body;
  if(!Array.isArray(items)||!items.length||!['EFECTIVO','YAPE','PLIN','TRANSFERENCIA','TARJETA','OTRO'].includes(paymentMethod)) return res.status(400).json({error:'Agrega productos y selecciona un método de pago.'});
  const cash=activeCash(req.user.id);
  if(!cash) return res.status(409).json({error:'Abre tu caja antes de registrar una venta.'});
  try {
    const result=db.transaction(()=>{
      let total=0; const normalized=[]; const requested=new Map();
      for(const item of items){
        const quantity=Number(item.quantity);
        if(!item.productId||!Number.isInteger(quantity)||quantity<1) throw new Error('Producto o cantidad inválida.');
        requested.set(String(item.productId),(requested.get(String(item.productId))||0)+quantity);
      }
      for(const [productId,quantity] of requested){
        const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
        if(!p) throw new Error('Uno de los productos ya no está disponible.');
        if(p.stock<quantity) throw new Error(`Stock insuficiente para ${p.name}. Disponible: ${p.stock}.`);
        normalized.push({p,quantity}); total+=p.price*quantity;
      }
      total=Number(total.toFixed(2));
      const code=`V-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const sale=db.prepare('INSERT INTO sales(code,user_id,cash_session_id,subtotal,total,payment_method,customer_name,customer_phone,notes) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(code,req.user.id,cash.id,total,total,paymentMethod,String(customerName||''),String(customerPhone||''),String(notes||''));
      for(const {p,quantity} of normalized){
        db.prepare('INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)')
          .run(sale.lastInsertRowid,p.id,p.name,quantity,p.price,Number((p.price*quantity).toFixed(2)));
        db.prepare('UPDATE products SET stock=stock-?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(quantity,p.id);
        db.prepare('INSERT INTO stock_movements(product_id,user_id,type,quantity,before_stock,after_stock,reason) VALUES(?,?,?,?,?,?,?)')
          .run(p.id,req.user.id,'SALE',-quantity,p.stock,p.stock-quantity,`Venta ${code}`);
      }
      if(paymentMethod==='EFECTIVO') db.prepare("INSERT INTO cash_movements(cash_session_id,user_id,type,category,description,amount,sale_id) VALUES(?,?,'INCOME','VENTA',?,?,?)")
        .run(cash.id,req.user.id,`Venta ${code}`,total,sale.lastInsertRowid);
      log(req.user.id,'SALE_CREATED','sale',sale.lastInsertRowid,code);
      return {id:sale.lastInsertRowid,code,total};
    })();
    res.status(201).json({sale:result});
  } catch(e){res.status(400).json({error:e.message||'No se pudo registrar la venta.'});}
});
app.get('/api/sales/:id/receipt', auth, (req,res)=>{
  const sale=db.prepare(`SELECT s.*,u.name AS seller_name FROM sales s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(req.params.id);
  if(!sale) return res.status(404).json({error:'No se encontró la venta.'});
  const canAll=hasPermission(req.user,'sales.view_all');
  const canOwn=hasPermission(req.user,'sales.view_own') || hasPermission(req.user,'sales.create');
  if(!canAll && !(canOwn && sale.user_id===req.user.id)) return res.status(403).json({error:'No tienes permiso para ver este ticket.'});
  const items=db.prepare('SELECT product_name,quantity,unit_price,line_total FROM sale_items WHERE sale_id=?').all(sale.id);
  res.json({...sale,items});
});
app.post('/api/sales/:id/cancel', auth, permit('sales.cancel'), (req,res)=>{
  const sale=db.prepare("SELECT * FROM sales WHERE id=? AND status='COMPLETED'").get(req.params.id);
  if(!sale) return res.status(404).json({error:'Venta no encontrada o ya anulada.'});
  db.transaction(()=>{
    const items=db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(sale.id);
    for(const item of items){const p=db.prepare('SELECT stock FROM products WHERE id=?').get(item.product_id);if(p){db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);db.prepare('INSERT INTO stock_movements(product_id,user_id,type,quantity,before_stock,after_stock,reason) VALUES(?,?,?,?,?,?,?)').run(item.product_id,req.user.id,'SALE_CANCEL',item.quantity,p.stock,p.stock+item.quantity,`Anulación ${sale.code}`);}}
    db.prepare("UPDATE sales SET status='CANCELLED' WHERE id=?").run(sale.id);
    if(sale.payment_method==='EFECTIVO'&&sale.cash_session_id){
      const current=db.prepare("SELECT status FROM cash_sessions WHERE id=?").get(sale.cash_session_id);
      if(current&&current.status==='OPEN') db.prepare("INSERT INTO cash_movements(cash_session_id,user_id,type,category,description,amount,sale_id) VALUES(?,?,'EXPENSE','ANULACIÓN',?,?,?)").run(sale.cash_session_id,req.user.id,`Reverso ${sale.code}`,sale.total,sale.id);
    }
    log(req.user.id,'SALE_CANCELLED','sale',sale.id,sale.code);
  })();res.json({ok:true});
});

app.get('/api/dashboard', auth, permit('dashboard.view'), (req,res)=>{
  const own=!hasPermission(req.user,'sales.view_all');
  const where=own?'WHERE user_id=?':''; const args=own?[req.user.id]:[];
  const totals=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue FROM sales ${where} ${where?'AND':'WHERE'} status='COMPLETED' AND date(created_at)=date('now','localtime')`).get(...args);
  const month=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue FROM sales ${where} ${where?'AND':'WHERE'} status='COMPLETED' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')`).get(...args);
  const stock=db.prepare('SELECT COUNT(*) AS products,COALESCE(SUM(stock),0) AS units FROM products WHERE active=1').get();
  const cash=db.prepare("SELECT COUNT(*) AS open FROM cash_sessions WHERE status='OPEN'").get();
  const sellers=hasPermission(req.user,'sales.view_all')?db.prepare("SELECT u.name,COUNT(s.id) AS sales,COALESCE(SUM(s.total),0) AS total FROM users u LEFT JOIN sales s ON s.user_id=u.id AND s.status='COMPLETED' AND date(s.created_at)>=date('now','start of month','localtime') WHERE u.role='VENDEDOR' GROUP BY u.id ORDER BY total DESC").all():[];
  res.json({today:totals,month,stock,cash,sellers});
});
app.get('/api/reports/summary', auth, permit('reports.view'), (req,res)=>{
  const byDay=db.prepare("SELECT date(created_at) AS day,COUNT(*) AS sales,COALESCE(SUM(total),0) AS revenue FROM sales WHERE status='COMPLETED' AND created_at>=datetime('now','-29 days','localtime') GROUP BY date(created_at) ORDER BY day").all();
  const payment=db.prepare("SELECT payment_method,COUNT(*) AS sales,COALESCE(SUM(total),0) AS total FROM sales WHERE status='COMPLETED' GROUP BY payment_method").all();
  const cash=db.prepare("SELECT COALESCE(SUM(CASE WHEN type='INCOME' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount ELSE 0 END),0) AS expense FROM cash_movements").get();
  res.json({byDay,payment,cash});
});
app.get('/api/audit', auth, permit('users.manage'), (req,res)=>res.json(db.prepare('SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 300').all()));
app.get('/api/cash/history', auth, permit('cash.view_all'), (req,res)=>res.json(db.prepare('SELECT c.*,u.name AS user_name FROM cash_sessions c JOIN users u ON u.id=c.user_id ORDER BY c.opened_at DESC LIMIT 200').all()));

app.use('/api', (req,res)=>res.status(404).json({error:'Ruta API no encontrada.'}));
// Inyecta el inventario de la base de datos antes de ejecutar el catálogo público.
app.get(['/', '/index.html', '/producto.html'], (req,res)=>{
  const file = req.path === '/producto.html' ? 'producto.html' : 'index.html';
  const html = fs.readFileSync(path.join(__dirname,file),'utf8');
  const safeProducts = JSON.stringify(getProducts()).replace(/</g,'\\u003c');
  res.type('html').send(html.replace('<script src="app.js"></script>', `<script>window.__INITIAL_PRODUCTS__=${safeProducts};</script><script src="app.js"></script>`));
});
app.use('/data', (req,res)=>res.status(404).send('Not found'));
app.use('/server.js', (req,res)=>res.status(404).send('Not found'));
app.use(express.static(__dirname, { dotfiles: 'deny' }));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Xinyuan backend listo en http://localhost:${PORT}`));
