const base = location.pathname.replace(/\/$/, '') + '/api';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let current = null;

async function api(path, opts = {}) {
  const r = await fetch(base + path, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body instanceof FormData ? opts.body : opts.body && JSON.stringify(opts.body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { show(false); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function show(authed) { $('login').hidden = authed; $('app').hidden = !authed; }

$('lf').onsubmit = async (e) => {
  e.preventDefault(); $('lerr').textContent = '';
  try { await api('/login', { method: 'POST', body: { password: $('pw').value } }); show(true); load(); }
  catch (err) { $('lerr').textContent = err.message; }
};
$('out').onclick = async () => { await api('/logout', { method: 'POST' }); show(false); };

async function load() {
  const clients = await api('/clients');
  $('list').innerHTML = clients.map((c) => `<div class="client ${c.id === current ? 'on' : ''}" data-id="${c.id}"><span><i class="dot" style="background:${esc(c.accent)}"></i>${esc(c.name)}${c.published ? '' : ' <small>(مخفي)</small>'}</span><small>${c.video_count}</small></div>`).join('') || '<p class="mut">لا يوجد شيء بعد</p>';
  document.querySelectorAll('.client').forEach((el) => (el.onclick = () => { current = +el.dataset.id; load(); detail(); }));
}

$('nf').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const c = await api('/clients', { method: 'POST', body: { name: $('nname').value, description: $('ndesc').value, accent: $('ncol').value } });
    e.target.reset(); current = c.id; await load(); detail();
  } catch (err) { alert(err.message); }
};

async function detail() {
  if (!current) return;
  const c = await api('/clients/' + current);
  $('detail').innerHTML = `
    <div class="row" style="justify-content:space-between"><h2>${esc(c.name)}</h2>
      <div class="row"><button class="ghost" id="tog">${c.published ? 'إخفاء من الموقع' : 'نشر في الموقع'}</button><button class="danger" id="del">حذف الصفحة</button></div></div>
    <input id="ename" value="${esc(c.name)}"><textarea id="edesc" rows="2">${esc(c.description)}</textarea>
    <button class="ghost" id="save">حفظ التعديلات</button>
    <hr style="border-color:var(--line);margin:18px 0">
    <h2>رفع فيديو</h2>
    <form id="uf"><input id="vtitle" placeholder="عنوان الفيديو (اختياري)"><input id="vfile" type="file" accept="video/mp4,video/webm,video/quicktime" required>
    <progress id="pr" value="0" max="100" hidden></progress><button id="ub">رفع</button><p class="err" id="uerr"></p></form>
    <div class="vids">${c.videos.map((v) => `<div class="vid"><video src="${esc(v.url)}" controls preload="metadata" muted></video><div><span>${esc(v.title)}</span><button class="danger" data-v="${v.id}">حذف</button></div></div>`).join('') || '<p class="mut">لا توجد فيديوهات بعد</p>'}</div>`;
  $('save').onclick = async () => { await api('/clients/' + c.id, { method: 'PATCH', body: { name: $('ename').value, description: $('edesc').value } }); load(); detail(); };
  $('tog').onclick = async () => { await api('/clients/' + c.id, { method: 'PATCH', body: { published: !c.published } }); load(); detail(); };
  $('del').onclick = async () => { if (confirm('حذف الصفحة وكل فيديوهاتها؟')) { await api('/clients/' + c.id, { method: 'DELETE' }); current = null; $('detail').innerHTML = ''; load(); } };
  document.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => { if (confirm('حذف الفيديو؟')) { await api('/videos/' + b.dataset.v, { method: 'DELETE' }); load(); detail(); } }));
  $('uf').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(); fd.append('title', $('vtitle').value); fd.append('video', $('vfile').files[0]);
    const xhr = new XMLHttpRequest(); xhr.open('POST', `${base}/clients/${c.id}/videos`);
    $('pr').hidden = false; $('ub').disabled = true; $('uerr').textContent = '';
    xhr.upload.onprogress = (ev) => ev.lengthComputable && ($('pr').value = (ev.loaded / ev.total) * 100);
    xhr.onload = () => { if (xhr.status === 201) { load(); detail(); } else { $('ub').disabled = false; $('pr').hidden = true; $('uerr').textContent = (JSON.parse(xhr.responseText || '{}').error) || 'فشل الرفع'; } };
    xhr.onerror = () => { $('ub').disabled = false; $('uerr').textContent = 'خطأ في الشبكة'; };
    xhr.send(fd);
  };
}

api('/session').then((s) => { show(s.authed); if (s.authed) load(); });
