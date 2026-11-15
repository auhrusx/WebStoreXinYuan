const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(n||0));
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me=null, currentView='dashboard', products=[], users=[], permissions={}, roleDefaults={}, cashRows=[];
let saleCart=[];
function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='toast',3200)}
async function api(url,options={}){const r=await fetch('/api'+url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||'Ocurrió un error.');return data}
function can(p){return me?.role==='OWNER'||me?.permissions?.includes(p)}
function showAuth(setup=false){$('#authScreen').hidden=false;$('#appShell').hidden=true;$('#loginForm').hidden=setup;$('#setupForm').hidden=!setup;$('#authTitle').textContent=setup?'Configurar cuenta OWNER':'Iniciar sesión';$('#authSubtitle').textContent=setup?'Crea tu cuenta principal con un nombre de usuario y una contraseña.':'Acceso exclusivo para administradores y vendedores.'}
async function boot(){try{const status=await api('/setup/status');if(status.needsOwner){showAuth(true);return}const data=await api('/auth/me');me=data.user;startApp()}catch{showAuth(false)}}
function startApp(){ $('#authScreen').hidden=true;$('#appShell').hidden=false;$('#profileName').textContent=me.name||me.username;$('#profileRole').textContent=({OWNER:'OWNER',ADMIN:'ADMINISTRADOR',VENDEDOR:'VENTAS'}[me.role]||me.role);$('#accountMenu').hidden=true;$('#accountBtn').setAttribute('aria-expanded','false');$('#todayLabel').textContent=new Intl.DateTimeFormat('es-PE',{dateStyle:'full'}).format(new Date());
 const visibility={'dashboard':'dashboard.view','sales':'sales.view_all','inventory':'inventory.view','cash':'cash.open','users':'users.manage','reports':'reports.view','audit':'users.manage'};
 if(me.role==='VENDEDOR'){const salesNav=$('[data-view="sales"]');if(salesNav)salesNav.innerHTML='<span>＋</span>Punto de venta';}
 $$('.nav-item').forEach(b=>{const v=b.dataset.view;const allowed=v==='sales'?(can('sales.view_all')||can('sales.view_own')||can('sales.create')):v==='cash'?(can('cash.open')||can('cash.view_all')):can(visibility[v]);b.hidden=!allowed;b.classList.toggle('active',v==='dashboard')});
 if(!can('dashboard.view')){const first=$$('.nav-item').find(b=>!b.hidden);if(first) first.click();else $('#viewContent').innerHTML='<div class="panel empty">Tu cuenta todavía no tiene apartados habilitados. Solicita permisos al OWNER.</div>';return}
 navigate('dashboard');}
function navigate(view){const allowed=view==='sales'?(can('sales.view_all')||can('sales.view_own')||can('sales.create')):view==='cash'?(can('cash.open')||can('cash.view_all')):can(({'dashboard':'dashboard.view','inventory':'inventory.view','users':'users.manage','reports':'reports.view','audit':'users.manage'})[view]);if(!allowed)return;
 currentView=view;$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#pageTitle').textContent=({dashboard:'Resumen general',sales:me.role==='VENDEDOR'?'Punto de venta':'Ventas y operaciones',inventory:'Productos e inventario',cash:'Control de caja',users:'Usuarios y permisos',reports:'Reportes',audit:'Registro de actividad'})[view];
 ({dashboard:renderDashboard,sales:renderSales,inventory:renderInventory,cash:renderCash,users:renderUsers,reports:renderReports,audit:renderAudit}[view])();}
$('#sideNav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b&&!b.hidden)navigate(b.dataset.view)});
$('#refreshBtn').addEventListener('click',()=>navigate(currentView));
$('#accountBtn').addEventListener('click',()=>{const menu=$('#accountMenu');menu.hidden=!menu.hidden;$('#accountBtn').setAttribute('aria-expanded',String(!menu.hidden))});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST'})}finally{location.reload()}});
document.addEventListener('click',e=>{if(!e.target.closest('.account-wrap')){$('#accountMenu').hidden=true;$('#accountBtn').setAttribute('aria-expanded','false')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#accountMenu').hidden=true;$('#accountBtn').setAttribute('aria-expanded','false')}});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});location.reload()}catch(err){toast(err.message,true)}});
$('#setupForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const submit=form.querySelector('button[type="submit"]');const f=new FormData(form);submit.disabled=true;submit.textContent='Creando cuenta…';try{const result=await api('/setup',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});me=result.user;form.reset();toast('Cuenta OWNER creada. Bienvenido.');startApp()}catch(err){toast(err.message,true)}finally{submit.disabled=false;submit.textContent='Crear cuenta OWNER'}});

async function renderDashboard(){const d=await api('/dashboard');$('#viewContent').innerHTML=`<div class="stats-grid"><div class="stat-card"><small>Ventas de hoy</small><strong>${d.today.count}</strong><em>Operaciones completadas</em></div><div class="stat-card"><small>Ingresos de hoy</small><strong>${money(d.today.revenue)}</strong><em>Ventas registradas</em></div><div class="stat-card"><small>Ventas del mes</small><strong>${d.month.count}</strong><em>${money(d.month.revenue)} acumulados</em></div><div class="stat-card"><small>Stock disponible</small><strong>${d.stock.units}</strong><em>${d.stock.products} productos activos</em></div></div><div class="two-col"><section class="panel"><div class="panel-head"><h2>Actividad comercial</h2><span class="pill">En tiempo real</span></div><div class="seller-row"><span>Cajas abiertas</span><b>${d.cash.open}</b></div><div class="seller-row"><span>Ventas hoy</span><b>${d.today.count}</b></div><div class="seller-row"><span>Ingresos hoy</span><b>${money(d.today.revenue)}</b></div><div class="seller-row"><span>Ingresos del mes</span><b>${money(d.month.revenue)}</b></div></section><section class="panel"><div class="panel-head"><h2>Vendedores destacados</h2></div>${d.sellers.length?d.sellers.map(s=>`<div class="seller-row"><span>${esc(s.name)} <small>· ${s.sales} ventas</small></span><b>${money(s.total)}</b></div>`).join(''):'<div class="empty">Este resumen está disponible para cuentas con acceso global a ventas.</div>'}</section></div>`}

async function renderSales(){
 const [sales,inv]=await Promise.all([api('/sales'),api('/products')]);
 products=inv;
 const own=!can('sales.view_all');
 const available=products.filter(p=>p.stock>0);
 $('#viewContent').innerHTML=`
 ${can('sales.create')?`<div class="sales-intro">
   <div><span class="eyebrow">PUNTO DE VENTA</span><h2>${own?'Registrar una venta':'Nueva operación'}</h2><p>Busca el producto, añádelo al carrito y confirma el cobro.</p></div>
   <div class="sales-badge"><span class="sales-live-dot"></span> ${own?'Modo vendedor':'Caja de ventas'}</div>
 </div>
 <div class="pos-layout">
  <section class="panel pos-products">
   <div class="panel-head"><div><h2>1. Selecciona productos</h2><p class="sub">${available.length} productos con stock disponible</p></div><span class="step-number">01</span></div>
   <form id="saleForm">
    <div class="product-picker">
      <label class="field-label" for="saleProduct">Producto</label>
      <select id="saleProduct"><option value="">Buscar o seleccionar producto…</option>${available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${money(p.price)} · ${p.stock} disponibles</option>`).join('')}</select>
      <div class="picker-row"><label class="field-label" for="saleQty">Cantidad</label><div class="qty-control"><input id="saleQty" type="number" min="1" value="1"><button class="btn primary" type="button" id="addSaleItem">＋ Añadir al carrito</button></div></div>
    </div>
    <div class="panel-divider"></div>
    <div class="panel-head cart-heading"><div><h2>2. Tu carrito</h2><p class="sub">Revisa los artículos antes de cobrar.</p></div><span id="cartCount" class="cart-count">0 artículos</span></div>
    <div id="cartBox" class="cart-box"></div>
    <div class="sale-details">
      <div class="panel-head"><div><h2>3. Datos del cobro</h2><p class="sub">Completa el pago y los datos opcionales.</p></div><span class="step-number">03</span></div>
      <div class="form-grid">
       <label>Forma de pago<select name="paymentMethod" required><option value="EFECTIVO">Efectivo</option><option value="YAPE">Yape</option><option value="PLIN">Plin</option><option value="TRANSFERENCIA">Transferencia</option><option value="TARJETA">Tarjeta</option><option value="OTRO">Otro</option></select></label>
       <label>Nombre del cliente <small>(opcional)</small><input name="customerName" placeholder="Nombre del cliente"></label>
       <label>Teléfono <small>(opcional)</small><input name="customerPhone" placeholder="Número de contacto"></label>
       <label>Notas <small>(opcional)</small><input name="notes" placeholder="Observaciones de la venta"></label>
      </div>
    </div>
   </form>
  </section>
  <aside class="panel pos-summary">
   <span class="eyebrow">RESUMEN DE COMPRA</span><div class="summary-icon">🛍</div><h2>Tu venta</h2><p class="sub">El importe se actualiza al añadir productos.</p>
   <div class="summary-line"><span>Artículos</span><b id="summaryItems">0</b></div>
   <div class="summary-line"><span>Subtotal</span><b id="summarySubtotal">${money(0)}</b></div>
   <div class="summary-total"><span>Total a cobrar</span><strong id="cartTotal">${money(0)}</strong></div>
   <button class="btn primary confirm-sale" type="submit" form="saleForm" id="confirmSale" disabled>Confirmar venta <span>→</span></button>
   <p class="summary-foot">El stock se descontará automáticamente al confirmar la venta.</p>
  </aside>
 </div>`:''}
 <section class="panel sales-history"><div class="panel-head"><div><h2>${own?'Mis ventas recientes':'Ventas recientes'}</h2><p class="sub">Consulta las operaciones registradas.</p></div><span class="history-count">${sales.length} registros</span></div>
  <div class="table-wrap"><table><thead><tr><th>Código</th><th>Fecha</th>${own?'':'<th>Vendedor</th>'}<th>Total</th><th>Pago</th><th>Estado</th>${can('sales.cancel')?'<th>Acciones</th>':''}</tr></thead><tbody>${sales.map(s=>`<tr><td><b>${esc(s.code)}</b></td><td>${esc(s.created_at)}</td>${own?'':`<td>${esc(s.seller_name)}</td>`}<td><b>${money(s.total)}</b></td><td>${esc(s.payment_method)}</td><td><span class="pill ${s.status==='CANCELLED'?'red':''}">${s.status==='COMPLETED'?'Completada':'Anulada'}</span></td>${can('sales.cancel')?`<td>${s.status==='COMPLETED'?`<button class="action danger" data-cancel-sale="${s.id}">Anular</button>`:'—'}</td>`:''}</tr>`).join('')||`<tr><td colspan="7" class="empty">Todavía no hay ventas registradas.</td></tr>`}</tbody></table></div>
 </section>`;
 if(!can('sales.create'))return;
 saleCart=[];renderCart();
 $('#addSaleItem').onclick=()=>{
  const id=$('#saleProduct').value,q=Number($('#saleQty').value),p=products.find(x=>x.id===id);
  if(!p||!Number.isInteger(q)||q<1||q>p.stock)return toast('Selecciona un producto y una cantidad disponible.',true);
  const existing=saleCart.find(x=>x.productId===id);
  if(existing){if(existing.quantity+q>p.stock)return toast('La cantidad supera el stock disponible.',true);existing.quantity+=q}else saleCart.push({productId:id,quantity:q});
  $('#saleProduct').value='';$('#saleQty').value=1;renderCart();
 };
 $('#saleForm').onsubmit=async e=>{
  e.preventDefault();
  if(!saleCart.length)return toast('Agrega al menos un producto al carrito.',true);
  const form=Object.fromEntries(new FormData(e.currentTarget));
  const submit=$('#confirmSale');submit.disabled=true;submit.textContent='Procesando…';
  // Abrir la pestaña dentro del gesto del usuario para evitar bloqueos del navegador.
  const receiptWindow=window.open('about:blank','_blank');
  try{
   const r=await api('/sales',{method:'POST',body:JSON.stringify({...form,items:saleCart})});
   const receipt=await api(`/sales/${r.sale.id}/receipt`);
   if(receiptWindow&&!receiptWindow.closed){
    receiptWindow.document.open();
    receiptWindow.document.write(buildReceiptHTML(receipt));
    receiptWindow.document.close();
   }else{
    toast('Venta registrada. El navegador bloqueó la pestaña del ticket; permite ventanas emergentes para imprimirlo.',true);
   }
   toast(`Venta ${r.sale.code} registrada.`);
   saleCart=[];
   await renderSales();
  }catch(err){
   if(receiptWindow&&!receiptWindow.closed)receiptWindow.close();
   toast(err.message,true);
   submit.disabled=false;submit.innerHTML='Confirmar venta <span>→</span>';
  }
 };
 $$('[data-cancel-sale]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Anular esta venta? Se repondrá el stock.'))return;try{await api(`/sales/${b.dataset.cancelSale}/cancel`,{method:'POST'});toast('Venta anulada.');renderSales()}catch(e){toast(e.message,true)}});
}

function buildReceiptHTML(sale){
 const logo=`${location.origin}/img/logo.png`;
 const date=new Date(String(sale.created_at||'').replace(' ','T'));
 const dateText=Number.isNaN(date.getTime())?esc(sale.created_at):date.toLocaleString('es-PE');
 const rows=(sale.items||[]).map(item=>`<tr><td>${esc(item.product_name)}</td><td>${item.quantity}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`).join('');
 return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${esc(sale.code)} · Xinyuan Import</title>
 <style>
 *{box-sizing:border-box}body{margin:0;padding:28px;background:#f1f3f6;color:#202b40;font:14px Arial,sans-serif}
 .ticket{width:min(100%,440px);margin:0 auto;background:#fff;border:1px solid #e7eaf0;border-radius:16px;padding:28px;box-shadow:0 12px 38px #17223812}
 .brand{text-align:center;padding-bottom:18px;border-bottom:1px dashed #d9dee7}.brand img{max-width:116px;max-height:74px;object-fit:contain}.brand h1{font-size:17px;letter-spacing:2px;margin:8px 0 3px}.brand p{margin:0;color:#8b1836;font-size:10px;letter-spacing:2px;font-weight:bold}
 .title{text-align:center;margin:20px 0}.title h2{margin:0 0 5px;font-size:17px}.title small{color:#7b8494}
 .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:13px 0;border-top:1px solid #edf0f4;border-bottom:1px solid #edf0f4;font-size:11px}.meta span{display:block;color:#8992a0;margin-bottom:4px}.meta b{font-size:11px}
 table{width:100%;border-collapse:collapse;margin:18px 0}th,td{text-align:left;padding:10px 5px;border-bottom:1px solid #edf0f4;font-size:10px}th{color:#8992a0;font-size:9px;text-transform:uppercase}td:nth-child(2),td:nth-child(3),td:nth-child(4),th:nth-child(2),th:nth-child(3),th:nth-child(4){text-align:right}
 .total{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:1px dashed #d9dee7;font-size:13px}.total strong{font-size:22px;color:#8b1836}
 .extra{font-size:10px;color:#6f798a;line-height:1.7}.thanks{text-align:center;margin:20px 0 0;padding-top:16px;border-top:1px dashed #d9dee7;font-size:11px;color:#6f798a}
 .actions{display:flex;gap:9px;justify-content:center;margin:18px auto 0}.actions button{border:0;border-radius:9px;padding:12px 18px;background:#8b1836;color:#fff;font-weight:bold;cursor:pointer}.actions .secondary{background:#e9edf2;color:#344056}
 @media print{body{padding:0;background:#fff}.ticket{box-shadow:none;border:0;border-radius:0;padding:12px;width:100%}.actions{display:none}}
 </style></head><body><main class="ticket">
 <header class="brand"><img src="${logo}" alt="Logo Xinyuan Import" onerror="this.style.display='none'"><h1>XINYUAN IMPORT</h1><p>GESTIÓN COMERCIAL</p></header>
 <div class="title"><h2>BOLETA / TICKET DE VENTA</h2><small>${esc(sale.code)}</small></div>
 <section class="meta"><div><span>Fecha</span><b>${dateText}</b></div><div><span>Atendido por</span><b>${esc(sale.seller_name||'—')}</b></div><div><span>Cliente</span><b>${esc(sale.customer_name||'Público general')}</b></div><div><span>Teléfono</span><b>${esc(sale.customer_phone||'—')}</b></div><div><span>Pago</span><b>${esc(sale.payment_method||'—')}</b></div><div><span>Estado</span><b>${sale.status==='COMPLETED'?'Completada':'Anulada'}</b></div></section>
 <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="total"><span>TOTAL</span><strong>${money(sale.total)}</strong></div>
 ${sale.notes?`<p class="extra"><b>Nota:</b> ${esc(sale.notes)}</p>`:''}
 <footer class="thanks">¡Gracias por tu compra!<br>Xinyuan Import</footer>
 </main><div class="actions"><button onclick="window.print()">Imprimir ticket</button><button class="secondary" onclick="window.close()">Cerrar</button></div></body></html>`;
}

function renderCart(){
 const box=$('#cartBox');if(!box)return;
 box.innerHTML=saleCart.length?saleCart.map(i=>{
  const p=products.find(x=>x.id===i.productId);
  return `<div class="cart-item"><div class="cart-product-icon">▣</div><div class="cart-product-info"><b>${esc(p.name)}</b><small>${money(p.price)} c/u · Stock ${p.stock}</small></div><span class="cart-qty">× ${i.quantity}</span><b class="cart-subtotal">${money(p.price*i.quantity)}</b><button class="remove-cart" type="button" data-remove-cart="${esc(i.productId)}" aria-label="Quitar producto">×</button></div>`;
 }).join(''):'<div class="cart-empty"><span>＋</span><b>Tu carrito está vacío</b><small>Selecciona un producto para comenzar la venta.</small></div>';
 const total=saleCart.reduce((a,i)=>a+products.find(p=>p.id===i.productId).price*i.quantity,0);
 const count=saleCart.reduce((a,i)=>a+i.quantity,0);
 $('#cartTotal').textContent=money(total);
 $('#summaryItems').textContent=count;
 $('#summarySubtotal').textContent=money(total);
 $('#cartCount').textContent=`${count} ${count===1?'artículo':'artículos'}`;
 $('#confirmSale').disabled=!saleCart.length;
 $$('[data-remove-cart]').forEach(b=>b.onclick=()=>{saleCart=saleCart.filter(i=>i.productId!==b.dataset.removeCart);renderCart()});
}
async function renderInventory(){products=await api('/inventory');$('#viewContent').innerHTML=`<section class="panel"><div class="panel-head"><div><h2>Inventario de productos</h2><p class="sub">El stock se sincroniza con el catálogo público.</p></div>${can('inventory.manage')?'<button class="btn primary" id="newProduct">+ Nuevo producto</button>':''}</div><div class="toolbar"><input id="productSearch" placeholder="Buscar por nombre o código…"></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th>${can('inventory.manage')?'<th>Acciones</th>':''}</tr></thead><tbody id="productRows">${products.map(productRow).join('')}</tbody></table></div></section>`;$('#productSearch').oninput=e=>$('#productRows').innerHTML=products.filter(p=>(p.name+' '+p.id).toLowerCase().includes(e.target.value.toLowerCase())).map(productRow).join('');if(can('inventory.manage')){$('#newProduct').onclick=()=>productModal();bindProductActions()}}
function productRow(p){return `<tr><td>${esc(p.id)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td><span class="pill ${p.stock===0?'red':p.stock<5?'gold':''}">${p.stock}</span></td>${can('inventory.manage')?`<td><button class="action" data-edit-product="${esc(p.id)}">Editar</button> <button class="action" data-adjust-product="${esc(p.id)}">Ajustar stock</button></td>`:''}</tr>`}
function bindProductActions(){$$('[data-edit-product]').forEach(b=>b.onclick=()=>productModal(products.find(p=>p.id===b.dataset.editProduct)));$$('[data-adjust-product]').forEach(b=>b.onclick=()=>adjustStock(b.dataset.adjustProduct))}
function modal(html){const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<section class="modal">${html}</section>`;wrap.addEventListener('click',e=>{if(e.target===wrap)wrap.remove()});document.body.append(wrap);return wrap}
$('#passwordBtn').onclick=()=>{const m=modal(`<h2>Cambiar contraseña</h2><form id="passwordForm"><label>Contraseña actual<input name="currentPassword" type="password" required></label><label>Nueva contraseña (mínimo 12 caracteres)<input name="newPassword" type="password" minlength="12" required></label><div class="modal-actions"><button type="button" class="btn light" data-close>Cancelar</button><button class="btn primary">Actualizar contraseña</button></div></form>`);$('[data-close]',m).onclick=()=>m.remove();$('#passwordForm',m).onsubmit=async e=>{e.preventDefault();try{await api('/auth/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});m.remove();toast('Contraseña actualizada.')}catch(err){toast(err.message,true)}}};
function productModal(p={}){const m=modal(`<h2>${p.id?'Editar producto':'Nuevo producto'}</h2><form id="productForm"><div class="form-grid"><label>Código<input name="id" value="${esc(p.id||'')}" ${p.id?'readonly':''} required></label><label>Nombre<input name="name" value="${esc(p.name||'')}" required></label><label>Categoría<input name="category" value="${esc(p.category||'Accesorios')}" required></label><label>Precio (S/)<input name="price" type="number" step="0.01" min="0" value="${p.price??''}" required></label><label>Stock<input name="stock" type="number" min="0" step="1" value="${p.stock??0}" required></label><label>Etiqueta<input name="tag" value="${esc(p.tag||'')}"></label><label>Imagen principal<input name="image" value="${esc(p.image||'')}"></label><label>Precio anterior (opcional)<input name="originalPrice" type="number" step="0.01" value="${p.originalPrice??''}"></label></div><label>Descripción<textarea name="description" rows="3">${esc(p.description||'')}</textarea></label><div class="modal-actions"><button type="button" class="btn light" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('[data-close]',m).onclick=()=>m.remove();$('#productForm',m).onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));data.price=Number(data.price);data.stock=Number(data.stock);data.originalPrice=data.originalPrice?Number(data.originalPrice):null;try{await api(p.id?`/products/${encodeURIComponent(p.id)}`:'/products',{method:p.id?'PATCH':'POST',body:JSON.stringify(data)});m.remove();toast('Producto guardado.');renderInventory()}catch(err){toast(err.message,true)}}}
async function adjustStock(id){const p=products.find(x=>x.id===id),q=prompt(`Stock actual: ${p.stock}\nIngresa la variación (+ para entrada, - para salida):`);if(q===null)return;const quantity=Number(q);const reason=prompt('Motivo del movimiento:')||'Ajuste manual';try{await api(`/inventory/${encodeURIComponent(id)}/adjust`,{method:'POST',body:JSON.stringify({quantity,reason})});toast('Stock actualizado.');renderInventory()}catch(e){toast(e.message,true)}}

async function renderCash(){const [opened]=await Promise.all([api('/cash/current')]);cashRows=opened;const myCash=opened.find(c=>c.user_id===me.id);const movements=can('cash.view_all')?await api('/cash/movements'):[];const history=can('cash.view_all')?await api('/cash/history'):[];$('#viewContent').innerHTML=`<div class="stats-grid"><div class="stat-card"><small>Estado de mi caja</small><strong>${myCash?'Abierta':'Cerrada'}</strong><em>${myCash?'Turno en curso':'Abre caja para operar'}</em></div><div class="stat-card"><small>Fondo inicial</small><strong>${myCash?money(myCash.opening_amount):'—'}</strong><em>Saldo al abrir</em></div><div class="stat-card"><small>Movimientos netos</small><strong>${myCash?money(myCash.movements):'—'}</strong><em>Ingresos menos egresos</em></div><div class="stat-card"><small>Cajas abiertas</small><strong>${opened.length}</strong><em>Turnos activos visibles</em></div></div><section class="panel"><div class="panel-head"><h2>Mi turno de caja</h2></div>${myCash?`<p class="sub">Apertura: ${esc(myCash.opened_at)} · Fondo inicial ${money(myCash.opening_amount)}</p><div class="toolbar">${can('cash.move')?'<button class="btn light" id="incomeBtn">+ Registrar ingreso</button><button class="btn light" id="expenseBtn">− Registrar egreso</button>':''}${can('cash.close')?'<button class="btn primary" id="closeCashBtn">Cerrar caja</button>':''}</div>`:can('cash.open')?`<p class="sub">No tienes una caja abierta. Registra el efectivo inicial para comenzar tu turno.</p><button class="btn primary" id="openCashBtn">Abrir caja</button>`:'<p class="sub">No tienes permiso para abrir caja.</p>'}</section>${can('cash.view_all')?`<section class="panel"><div class="panel-head"><h2>Cajas abiertas del equipo</h2></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Apertura</th><th>Fondo inicial</th><th>Movimientos netos</th><th>Acción</th></tr></thead><tbody>${opened.map(c=>`<tr><td>${esc(c.user_name)}</td><td>${esc(c.opened_at)}</td><td>${money(c.opening_amount)}</td><td>${money(c.movements)}</td><td>${can('cash.close')?`<button class="action danger" data-close-cash="${c.id}">Cerrar caja</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No hay cajas abiertas.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Movimientos recientes</h2></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Concepto</th><th>Monto</th></tr></thead><tbody>${movements.map(m=>`<tr><td>${esc(m.created_at)}</td><td>${esc(m.user_name)}</td><td><span class="pill ${m.type==='EXPENSE'?'red':''}">${m.type==='INCOME'?'Ingreso':'Egreso'}</span></td><td>${esc(m.description)}</td><td>${money(m.amount)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sin movimientos.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Historial de cajas</h2></div><div class="table-wrap"><table><thead><tr><th>Vendedor</th><th>Apertura</th><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>Estado</th></tr></thead><tbody>${history.map(c=>`<tr><td>${esc(c.user_name)}</td><td>${esc(c.opened_at)}</td><td>${esc(c.closed_at||'—')}</td><td>${c.expected_amount==null?'—':money(c.expected_amount)}</td><td>${c.closing_amount==null?'—':money(c.closing_amount)}</td><td>${c.difference==null?'—':money(c.difference)}</td><td>${c.status}</td></tr>`).join('')}</tbody></table></div></section>`:''}`;
 if($('#openCashBtn'))$('#openCashBtn').onclick=async()=>{const v=prompt('Efectivo inicial en soles:','0');if(v===null)return;try{await api('/cash/open',{method:'POST',body:JSON.stringify({openingAmount:Number(v)})});toast('Caja abierta.');renderCash()}catch(e){toast(e.message,true)}};
 if($('#closeCashBtn'))$('#closeCashBtn').onclick=async()=>{const v=prompt('Efectivo contado al cierre (S/):');if(v===null)return;try{const r=await api(`/cash/${myCash.id}/close`,{method:'POST',body:JSON.stringify({closingAmount:Number(v)})});toast(`Caja cerrada. Diferencia: ${money(r.difference)}`);renderCash()}catch(e){toast(e.message,true)}};
 if($('#incomeBtn'))$('#incomeBtn').onclick=()=>movementModal('INCOME');if($('#expenseBtn'))$('#expenseBtn').onclick=()=>movementModal('EXPENSE');
 $$('[data-close-cash]').forEach(b=>b.onclick=async()=>{const amount=prompt('Efectivo contado al cierre (S/):');if(amount===null)return;try{const r=await api(`/cash/${b.dataset.closeCash}/close`,{method:'POST',body:JSON.stringify({closingAmount:Number(amount)})});toast(`Caja cerrada. Diferencia: ${money(r.difference)}`);renderCash()}catch(e){toast(e.message,true)}});}
function movementModal(type){const m=modal(`<h2>${type==='INCOME'?'Registrar ingreso':'Registrar egreso'}</h2><form id="movementForm"><label>Concepto<input name="description" required></label><label>Categoría<select name="category"><option>OTRO</option><option>VENTA</option><option>COMPRA</option><option>GASTO OPERATIVO</option><option>RETIRO</option><option>AJUSTE</option></select></label><label>Monto (S/)<input name="amount" type="number" min="0.01" step="0.01" required></label><div class="modal-actions"><button type="button" class="btn light" data-close>Cancelar</button><button class="btn primary">Guardar movimiento</button></div></form>`);$('[data-close]',m).onclick=()=>m.remove();$('#movementForm',m).onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));d.type=type;d.amount=Number(d.amount);try{await api('/cash/movement',{method:'POST',body:JSON.stringify(d)});m.remove();toast('Movimiento registrado.');renderCash()}catch(err){toast(err.message,true)}}}

async function renderUsers(){const [u,p]=await Promise.all([api('/users'),api('/permissions')]);users=u;permissions=p.permissions;roleDefaults=p.roles;$('#viewContent').innerHTML=`<section class="panel"><div class="panel-head"><div><h2>Cuentas del equipo</h2><p class="sub">Crea administradores o vendedores y define sus permisos individuales.</p></div><button class="btn primary" id="newUser">+ Crear cuenta</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Permisos</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td>${u.role}</td><td><span class="pill ${u.active?'':'red'}">${u.active?'Activa':'Suspendida'}</span></td><td>${u.role==='OWNER'?'Todos':u.permissions.length}</td><td>${u.role==='OWNER'?'Protegida':`<button class="action" data-edit-user="${u.id}">Editar</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;$('#newUser').onclick=()=>userModal();$$('[data-edit-user]').forEach(b=>b.onclick=()=>userModal(users.find(u=>u.id===Number(b.dataset.editUser))))}
function userModal(u={}){const role=u.role||'VENDEDOR',selected=u.permissions||roleDefaults[role]||[];const m=modal(`<h2>${u.id?'Editar cuenta':'Crear cuenta'}</h2><form id="userForm"><div class="form-grid"><label>Nombre completo<input name="name" value="${esc(u.name||'')}" required></label><label>Nombre de usuario<input name="username" value="${esc(u.username||'')}" ${u.id?'disabled':''} required></label><label>Rol<select name="role"><option value="ADMINISTRADOR" ${role==='ADMINISTRADOR'?'selected':''}>Administrador</option><option value="VENDEDOR" ${role==='VENDEDOR'?'selected':''}>Vendedor</option></select></label><label>${u.id?'Nueva contraseña (opcional)':'Contraseña (mínimo 10 caracteres)'}<input name="password" type="password" ${u.id?'':'required minlength="10"'}></label></div><label>Permisos individuales</label><div class="permission-list">${Object.entries(permissions).filter(([key])=>!['users.manage','settings.manage'].includes(key)).map(([key,label])=>`<label><input type="checkbox" name="permissions" value="${key}" ${selected.includes(key)?'checked':''}> ${esc(label)}</label>`).join('')}</div>${u.id?`<label><input type="checkbox" name="active" ${u.active?'checked':''} style="display:inline;width:auto"> Cuenta activa</label>`:''}<div class="modal-actions"><button type="button" class="btn light" data-close>Cancelar</button><button class="btn primary">Guardar cuenta</button></div></form>`);$('[data-close]',m).onclick=()=>m.remove();const roleSelect=$('[name=role]',m);roleSelect.onchange=()=>{$$('input[name=permissions]',m).forEach(c=>c.checked=(roleDefaults[roleSelect.value]||[]).includes(c.value))};$('#userForm',m).onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),data={name:fd.get('name'),role:fd.get('role'),permissions:fd.getAll('permissions'),active:u.id?fd.has('active'):true};if(!u.id){data.username=fd.get('username');data.password=fd.get('password')}else if(fd.get('password'))data.password=fd.get('password');try{await api(u.id?`/users/${u.id}`:'/users',{method:u.id?'PATCH':'POST',body:JSON.stringify(data)});m.remove();toast('Cuenta guardada.');renderUsers()}catch(err){toast(err.message,true)}}}

async function renderReports(){const r=await api('/reports/summary');const max=Math.max(1,...r.byDay.map(x=>x.revenue));$('#viewContent').innerHTML=`<div class="stats-grid"><div class="stat-card"><small>Ingresos de caja</small><strong>${money(r.cash.income)}</strong></div><div class="stat-card"><small>Egresos de caja</small><strong>${money(r.cash.expense)}</strong></div><div class="stat-card"><small>Balance neto de caja</small><strong>${money(r.cash.income-r.cash.expense)}</strong></div><div class="stat-card"><small>Métodos de pago</small><strong>${r.payment.length}</strong></div></div><section class="panel"><div class="panel-head"><h2>Ventas de los últimos 30 días</h2></div><div class="chart-bars">${r.byDay.map(d=>`<div class="bar-item" title="${esc(d.day)}: ${money(d.revenue)}"><div class="bar" style="height:${Math.max(3,d.revenue/max*130)}px"></div><small>${esc(d.day.slice(5))}</small></div>`).join('')||'<div class="empty">Aún no hay datos.</div>'}</div></section><section class="panel"><div class="panel-head"><h2>Ventas por método de pago</h2></div><div class="table-wrap"><table><thead><tr><th>Método</th><th>Número de ventas</th><th>Total</th></tr></thead><tbody>${r.payment.map(p=>`<tr><td>${esc(p.payment_method)}</td><td>${p.sales}</td><td>${money(p.total)}</td></tr>`).join('')}</tbody></table></div><button class="btn light" id="exportSales">Exportar ventas CSV</button></section>`;$('#exportSales').onclick=exportSales}
async function exportSales(){const sales=await api('/sales');const rows=[['Código','Fecha','Vendedor','Total','Pago','Estado'],...sales.map(s=>[s.code,s.created_at,s.seller_name,s.total,s.payment_method,s.status])];const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='ventas-xinyuan.csv';a.click();URL.revokeObjectURL(a.href)}
async function renderAudit(){const logs=await api('/audit');$('#viewContent').innerHTML=`<section class="panel"><div class="panel-head"><h2>Últimas acciones del sistema</h2></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Elemento</th><th>Detalle</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${esc(l.created_at)}</td><td>${esc(l.user_name||'Sistema')}</td><td>${esc(l.action)}</td><td>${esc(l.entity)} ${esc(l.entity_id||'')}</td><td>${esc(l.details)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sin actividad registrada.</td></tr>'}</tbody></table></div></section>`}
boot();
