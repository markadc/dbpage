let state = { db: '', table: '', page: 1, size: 10, total: 0, pages: 1 };
let connections = [];
let currentConnId = null;
let currentConnType = 'postgresql';
let initData = {};

async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || '请求失败'); }
    return r.json();
}

/* ===== 连接卡片 ===== */
async function loadConnections() {
    const data = await fetchJSON('/api/connections');
    connections = data.connections;
    renderCards();
}

function renderCards() {
    const grid = document.getElementById('conn-cards');
    if (!connections.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">暂无连接，点击右上角「新建连接」</div>';
        return;
    }
    grid.innerHTML = connections.map(c => {
        const icon = c.type === 'mysql' ? '🐬' : '🐘';
        return `
        <div class="conn-card" data-id="${escapeHtml(c.id)}">
            <div class="card-header">
                <div class="card-icon">${icon}</div>
                <div class="card-actions">
                    <button class="btn-icon edit" title="编辑">✏️</button>
                    <button class="btn-icon delete" title="删除">🗑️</button>
                </div>
            </div>
            <div class="card-name">${escapeHtml(c.name)}</div>
            <div class="card-meta">${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}</div>
        </div>
    `}).join('');

    grid.querySelectorAll('.conn-card').forEach(card => {
        const id = card.dataset.id;
        card.addEventListener('click', async (e) => {
            if (e.target.closest('.btn-icon')) return;
            await useConnection(id);
        });
        card.querySelector('.edit').addEventListener('click', () => openEditModal(id));
        card.querySelector('.delete').addEventListener('click', async () => {
            if (!confirm('确定删除此连接？')) return;
            await fetchJSON(`/api/connections/${id}`, { method: 'DELETE' });
            await loadConnections();
        });
    });
}

async function useConnection(id) {
    await fetchJSON(`/api/connections/${id}/use`, { method: 'POST' });
    currentConnId = id;
    const conn = connections.find(c => c.id === id);
    currentConnType = conn?.type || 'postgresql';
    showDataView();
    const hist = initData.states?.[id] || {};
    if (hist.sql) document.getElementById('sql-input').value = hist.sql;
    state.db = hist.db || '';
    state.table = hist.table || '';
    await loadDatabases();
    await loadTables();
    await loadData();
}

function showConnectionsView() {
    document.getElementById('connections-view').classList.remove('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.add('hidden');
    state.db = '';
    state.table = '';
    state.page = 1;
    currentConnId = null;
    currentConnType = 'postgresql';
}

function showDataView() {
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.remove('hidden');
    document.getElementById('sql-view').classList.add('hidden');
}

function showSqlView() {
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.remove('hidden');
    loadSqlDatabases();
}

/* ===== 连接弹窗 ===== */
function openAddModal() {
    document.getElementById('modal-title').textContent = '新建连接';
    document.getElementById('modal-conn-id').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-type').value = 'postgresql';
    document.getElementById('modal-host').value = 'localhost';
    document.getElementById('modal-port').value = '5432';
    document.getElementById('modal-user').value = 'wangtuo';
    document.getElementById('modal-password').value = 'admin0';
    document.getElementById('conn-modal').classList.remove('hidden');
}

function openEditModal(id) {
    const c = connections.find(x => x.id === id);
    if (!c) return;
    document.getElementById('modal-title').textContent = '编辑连接';
    document.getElementById('modal-conn-id').value = c.id;
    document.getElementById('modal-name').value = c.name;
    document.getElementById('modal-type').value = c.type || 'postgresql';
    document.getElementById('modal-host').value = c.host;
    document.getElementById('modal-port').value = c.port;
    document.getElementById('modal-user').value = c.user;
    document.getElementById('modal-password').value = c.password;
    document.getElementById('conn-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('conn-modal').classList.add('hidden');
}

async function saveModal() {
    const id = document.getElementById('modal-conn-id').value;
    const body = new URLSearchParams();
    body.append('name', document.getElementById('modal-name').value);
    body.append('conn_type', document.getElementById('modal-type').value);
    body.append('host', document.getElementById('modal-host').value);
    body.append('port', document.getElementById('modal-port').value);
    body.append('user', document.getElementById('modal-user').value);
    body.append('password', document.getElementById('modal-password').value);

    if (id) {
        await fetchJSON(`/api/connections/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } else {
        await fetchJSON('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    }
    closeModal();
    await loadConnections();
}

/* ===== 数据查询 ===== */
async function loadDatabases() {
    const sel = document.getElementById('db-select');
    sel.innerHTML = '<option value="">选择数据库</option>';
    try {
        const data = await fetchJSON('/api/databases');
        data.databases.forEach(db => {
            const opt = document.createElement('option');
            opt.value = db; opt.textContent = db;
            if (db === state.db) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载数据库失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
}

async function loadTables() {
    const sel = document.getElementById('table-select');
    sel.innerHTML = '<option value="">选择表</option>';
    if (!state.db) return;
    try {
        const data = await fetchJSON(`/api/tables?db=${encodeURIComponent(state.db)}`);
        data.tables.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = t;
            if (t === state.table) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载表失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
}

async function loadData() {
    const thead = document.querySelector('#data-table thead');
    const tbody = document.querySelector('#data-table tbody');
    const pagination = document.getElementById('pagination');
    if (!state.db || !state.table) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="100" class="empty">请选择数据库和表</td></tr>';
        pagination.classList.add('hidden');
        return;
    }
    const data = await fetchJSON(`/api/data?db=${encodeURIComponent(state.db)}&table=${encodeURIComponent(state.table)}&page=${state.page}&size=${state.size}`);
    thead.innerHTML = '<tr>' + data.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
    if (!data.data.length) {
        tbody.innerHTML = '<tr><td colspan="100" class="empty">暂无数据</td></tr>';
    } else {
        tbody.innerHTML = data.data.map(row => '<tr>' + data.columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>').join('');
    }
    state.total = data.total;
    state.pages = data.pages;
    document.getElementById('page-num').textContent = state.page;
    document.getElementById('page-total').textContent = state.pages;
    document.getElementById('row-total').textContent = state.total;
    renderPageNumbers();
    pagination.classList.remove('hidden');
}

function renderPageNumbers() {
    document.getElementById('btn-prev').disabled = state.page <= 1;
    document.getElementById('btn-first').disabled = state.page <= 1;
    document.getElementById('btn-next').disabled = state.page >= state.pages;
    document.getElementById('btn-last').disabled = state.page >= state.pages;

    const container = document.getElementById('page-numbers');
    container.innerHTML = '';
    let start = 1;
    let end = state.pages;
    if (state.pages > 5) {
        if (state.page <= 3) { start = 1; end = 5; }
        else if (state.page >= state.pages - 2) { start = state.pages - 4; end = state.pages; }
        else { start = state.page - 2; end = state.page + 2; }
    }
    for (let i = start; i <= end; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = i;
        if (i === state.page) btn.classList.add('active');
        btn.addEventListener('click', async () => {
            if (i !== state.page) { state.page = i; await loadData(); }
        });
        container.appendChild(btn);
    }
}

/* ===== SQL 查询 ===== */
async function loadSqlDatabases() {
    const sel = document.getElementById('sql-db-select');
    sel.innerHTML = '<option value="">选择数据库</option>';
    try {
        const data = await fetchJSON('/api/databases');
        data.databases.forEach(db => {
            const opt = document.createElement('option');
            opt.value = db; opt.textContent = db;
            if (db === state.db) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载数据库失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
}

async function saveState() {
    const body = new URLSearchParams();
    if (state.db) body.append('db', state.db);
    if (state.table) body.append('table', state.table);
    const sql = document.getElementById('sql-input').value.trim();
    if (sql) body.append('sql', sql);
    try {
        await fetchJSON('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (!initData.states) initData.states = {};
        initData.states[currentConnId] = {
            db: state.db || null,
            table: state.table || null,
            sql: sql || null
        };
    } catch (e) {
        console.error('保存状态失败:', e);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ===== 事件绑定 ===== */
document.querySelector('.brand').addEventListener('click', showConnectionsView);
document.getElementById('btn-add-conn').addEventListener('click', openAddModal);
document.getElementById('btn-cancel-conn').addEventListener('click', closeModal);
document.getElementById('btn-save-conn').addEventListener('click', saveModal);
document.getElementById('btn-back').addEventListener('click', showConnectionsView);

document.getElementById('modal-type').addEventListener('change', (e) => {
    document.getElementById('modal-port').value = e.target.value === 'mysql' ? '3306' : '5432';
});

document.getElementById('db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    state.table = '';
    state.page = 1;
    if (!state.db) {
        document.querySelector('#data-table thead').innerHTML = '';
        document.querySelector('#data-table tbody').innerHTML = '<tr><td colspan="100" class="empty">请选择数据库和表</td></tr>';
        document.getElementById('pagination').classList.add('hidden');
    }
    await loadTables();
    await loadData();
    await saveState();
});

document.getElementById('table-select').addEventListener('change', async (e) => {
    state.table = e.target.value;
    state.page = 1;
    await loadData();
    await saveState();
});

document.getElementById('page-size').addEventListener('change', async (e) => {
    state.size = parseInt(e.target.value, 10);
    state.page = 1;
    await loadData();
});

document.getElementById('btn-first').addEventListener('click', async () => { if (state.page > 1) { state.page = 1; await loadData(); } });
document.getElementById('btn-prev').addEventListener('click', async () => { if (state.page > 1) { state.page--; await loadData(); } });
document.getElementById('btn-next').addEventListener('click', async () => { if (state.page < state.pages) { state.page++; await loadData(); } });
document.getElementById('btn-last').addEventListener('click', async () => { if (state.page < state.pages) { state.page = state.pages; await loadData(); } });

document.getElementById('btn-new-query').addEventListener('click', () => {
    showSqlView();
    const hist = initData.states?.[currentConnId] || {};
    if (hist.sql) {
        document.getElementById('sql-input').value = hist.sql;
    } else if (state.table) {
        const q = currentConnType === 'mysql' ? `\`${state.table}\`` : `"${state.table}"`;
        document.getElementById('sql-input').value = `SELECT * FROM ${q} LIMIT 10`;
    } else {
        document.getElementById('sql-input').value = 'SELECT * FROM ... LIMIT 10';
    }
});

document.getElementById('btn-back-data').addEventListener('click', () => {
    showDataView();
});

document.getElementById('sql-db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    await saveState();
});

document.getElementById('btn-run-sql').addEventListener('click', async () => {
    const sql = document.getElementById('sql-input').value.trim();
    const errorEl = document.getElementById('sql-error');
    if (!sql) return;
    if (!state.db) { errorEl.textContent = '请先选择数据库'; errorEl.classList.remove('hidden'); return; }
    errorEl.classList.add('hidden');
    try {
        const body = new URLSearchParams();
        body.append('db', state.db);
        body.append('sql', sql);
        const data = await fetchJSON('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const thead = document.querySelector('#sql-result-table thead');
        const tbody = document.querySelector('#sql-result-table tbody');
        if (data.columns.length) {
            thead.innerHTML = '<tr>' + data.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
            tbody.innerHTML = data.data.map(row => '<tr>' + data.columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>').join('');
        } else {
            thead.innerHTML = '';
            tbody.innerHTML = `<tr><td colspan="100" class="empty">执行成功，影响 ${data.rowcount} 行</td></tr>`;
        }
        await saveState();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
});

/* ===== 初始化 ===== */
async function init() {
    await loadConnections();
    initData = await fetchJSON('/api/init');
}
init();
