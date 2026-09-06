#!/usr/bin/env node

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('pg');
const mysql = require('mysql2/promise');
const open = require('open').default;

const app = express();
const VERSION = require('../package.json').version;
const DEFAULT_PORT = 12301;
const CONFIG_DIR = path.join(os.homedir(), '.db-webpage');
const INIT_FILE = path.join(CONFIG_DIR, 'dbw-cache.json');
const LEGACY_FILE = path.join(CONFIG_DIR, 'init.json');

function printUsage() {
    console.log(`DBWebpage ${VERSION} - a lightweight database data visualization tool

Usage:
  dbw                  Start server on default port ${DEFAULT_PORT}
  dbw -p, --port <port>  Start server on specified port
  dbw -v, --version    Show version
  dbw -h, --help       Show this help message`);
}

function argError(message) {
    console.error(`dbw: ${message}`);
    console.error('Run \'dbw --help\' for usage.');
    process.exit(1);
}

function parsePort(value) {
    if (!/^\d+$/.test(String(value || ''))) {
        return null;
    }
    const port = parseInt(value, 10);
    return port >= 1 && port <= 65535 ? port : null;
}

function parseCliArgs(argv) {
    const args = argv.slice(2);
    const first = args[0];

    if (first === undefined) {
        return { port: null };
    }

    if (first === '-v' || first === '--version') {
        if (args.length > 1) {
            argError(`unexpected extra argument '${args[1]}' after '${first}'`);
        }
        console.log(`db-webpage v${VERSION}`);
        process.exit(0);
    }

    if (first === '-h' || first === '--help') {
        if (args.length > 1) {
            argError(`unexpected extra argument '${args[1]}' after '${first}'`);
        }
        printUsage();
        process.exit(0);
    }

    if (first === '-p' || first === '--port') {
        if (args.length === 1) {
            argError(`'${first}' requires a port number`);
        }
        if (args.length > 2) {
            argError(`unexpected extra argument '${args[2]}'`);
        }
        const port = parsePort(args[1]);
        if (!port) {
            argError(`invalid port '${args[1]}', must be an integer between 1 and 65535`);
        }
        return { port };
    }

    argError(`unknown argument '${first}'`);
}

function defaultInit() {
    return { connections: [], states: {} };
}

function ensureInitFile() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // 旧版 init.json 自动迁移为 dbw-cache.json
    if (!fs.existsSync(INIT_FILE) && fs.existsSync(LEGACY_FILE)) {
        fs.copyFileSync(LEGACY_FILE, INIT_FILE);
    }
    if (!fs.existsSync(INIT_FILE)) {
        const bundledInit = path.join(__dirname, '..', 'dbw-cache.json');
        if (fs.existsSync(bundledInit)) {
            fs.copyFileSync(bundledInit, INIT_FILE);
        } else {
            fs.writeFileSync(INIT_FILE, JSON.stringify(defaultInit(), null, 2), 'utf-8');
        }
    }
}

const { port: cliPort } = parseCliArgs(process.argv);
const envPort = process.env.PORT ? parsePort(process.env.PORT) : null;
const PORT = cliPort || envPort || DEFAULT_PORT;

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'dbpage-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use('/static', express.static(path.join(__dirname, '..', 'static')));

function loadInit() {
    ensureInitFile();
    if (!fs.existsSync(INIT_FILE)) {
        return defaultInit();
    }
    try {
        const data = JSON.parse(fs.readFileSync(INIT_FILE, 'utf-8'));
        if (!data.states) {
            data.states = {};
            const oldConnId = data.last_conn_id;
            if (oldConnId) {
                data.states[oldConnId] = {
                    db: data.last_db || null,
                    table: data.last_table || null,
                    sql: data.last_sql || null
                };
                delete data.last_conn_id;
                delete data.last_db;
                delete data.last_table;
                delete data.last_sql;
            }
        }
        return data;
    } catch (e) {
        return defaultInit();
    }
}

function saveInit(data) {
    ensureInitFile();
    fs.writeFileSync(INIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function getDbConnection(conn_type, host, port, user, password, dbname) {
    if (conn_type === 'mysql') {
        return mysql.createConnection({
            host,
            port: parseInt(port, 10),
            user,
            password,
            database: dbname || undefined
        });
    } else {
        const client = new Client({
            host,
            port: parseInt(port, 10),
            user,
            password,
            database: dbname || 'postgres'
        });
        await client.connect();
        return client;
    }
}

function getConnParams(req) {
    return {
        conn_type: req.session.conn_type || 'postgresql',
        host: req.session.db_host,
        port: req.session.db_port,
        user: req.session.db_user,
        password: req.session.db_password
    };
}

function quoteIdentifier(conn_type, name) {
    if (conn_type === 'mysql') return `\`${name}\``;
    return `"${name}"`;
}

async function getPkColumn(conn, conn_type, table) {
    /* 返回单列主键的列名；无主键或复合主键时返回 null */
    try {
        if (conn_type === 'mysql') {
            const [rows] = await conn.query(
                "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? " +
                "AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
                [table]
            );
            const keys = rows.map(r => r.COLUMN_NAME);
            return keys.length === 1 && keys[0] ? keys[0] : null;
        } else {
            const result = await conn.query(
                "SELECT kcu.column_name FROM information_schema.table_constraints tc " +
                "JOIN information_schema.key_column_usage kcu " +
                "ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema " +
                "WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' " +
                "AND tc.table_name = $1 ORDER BY kcu.ordinal_position",
                [table]
            );
            const keys = result.rows.map(r => r.column_name);
            return keys.length === 1 && keys[0] ? keys[0] : null;
        }
    } catch (_) {
        return null;
    }
}

/* ===== 路由 ===== */

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'templates', 'index.html'));
});

app.get('/api/init', (req, res) => {
    res.json(loadInit());
});

app.get('/api/connections', (req, res) => {
    res.json({ connections: loadInit().connections });
});

app.post('/api/connections', (req, res) => {
    const { name, conn_type, host, port, user, password } = req.body;
    const data = loadInit();
    const conns = data.connections;
    const maxId = conns
        .filter(c => /^\d+$/.test(c.id))
        .map(c => parseInt(c.id, 10))
        .reduce((a, b) => Math.max(a, b), 0);
    const newId = String(maxId + 1);
    conns.push({ id: newId, name, type: conn_type || 'postgresql', host, port: parseInt(port, 10), user, password });
    data.connections = conns;
    saveInit(data);
    res.json({ success: true, id: newId });
});

app.put('/api/connections/:conn_id', (req, res) => {
    const { conn_id } = req.params;
    const { name, conn_type, host, port, user, password } = req.body;
    const data = loadInit();
    const conns = data.connections;
    const conn = conns.find(c => c.id === conn_id);
    if (!conn) {
        return res.status(404).json({ detail: '连接不存在' });
    }
    conn.name = name;
    conn.type = conn_type || 'postgresql';
    conn.host = host;
    conn.port = parseInt(port, 10);
    conn.user = user;
    conn.password = password;
    data.connections = conns;
    saveInit(data);
    res.json({ success: true });
});

app.delete('/api/connections/:conn_id', (req, res) => {
    const { conn_id } = req.params;
    const data = loadInit();
    data.connections = data.connections.filter(c => c.id !== conn_id);
    saveInit(data);
    res.json({ success: true });
});

app.post('/api/connections/:conn_id/use', async (req, res) => {
    const { conn_id } = req.params;
    const data = loadInit();
    const conn = data.connections.find(c => c.id === conn_id);
    if (!conn) {
        return res.status(404).json({ detail: '连接不存在' });
    }
    try {
        const db = await getDbConnection(
            conn.type || 'postgresql',
            conn.host,
            conn.port,
            conn.user,
            conn.password,
            null
        );
        await db.end();
    } catch (e) {
        return res.status(400).json({ detail: e.message });
    }
    req.session.conn_id = conn_id;
    req.session.conn_type = conn.type || 'postgresql';
    req.session.db_host = conn.host;
    req.session.db_port = conn.port;
    req.session.db_user = conn.user;
    req.session.db_password = conn.password;
    saveInit(data);
    res.json({ success: true });
});

app.post('/api/state', (req, res) => {
    const conn_id = req.session.conn_id;
    if (!conn_id) {
        return res.status(400).json({ detail: '未选择连接' });
    }
    const { db, table, sql } = req.body;
    const data = loadInit();
    if (!data.states[conn_id]) {
        data.states[conn_id] = {};
    }
    const st = data.states[conn_id];
    if (db !== undefined) st.db = db || null;
    if (table !== undefined) st.table = table || null;
    if (sql !== undefined) st.sql = sql || null;
    saveInit(data);
    res.json({ success: true });
});

app.get('/api/databases', async (req, res) => {
    const params = getConnParams(req);
    if (!params.host) {
        return res.status(400).json({ detail: '未选择连接' });
    }
    let conn;
    try {
        conn = await getDbConnection(
            params.conn_type,
            params.host,
            params.port,
            params.user,
            params.password,
            params.conn_type === 'postgresql' ? 'postgres' : null
        );
        if (params.conn_type === 'mysql') {
            const [rows] = await conn.query('SHOW DATABASES');
            const exclude = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
            const databases = rows
                .map(r => r.Database || r.database)
                .filter(d => !exclude.has(d));
            res.json({ databases });
        } else {
            const result = await conn.query(
                "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname"
            );
            res.json({ databases: result.rows.map(r => r.datname) });
        }
    } catch (e) {
        res.status(400).json({ detail: e.message });
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_) {}
        }
    }
});

app.get('/api/tables', async (req, res) => {
    const { db } = req.query;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        if (params.conn_type === 'mysql') {
            const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
            res.json({ tables: rows.map(r => Object.values(r)[0]) });
        } else {
            const result = await conn.query(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
            );
            res.json({ tables: result.rows.map(r => r.table_name) });
        }
    } catch (e) {
        res.status(400).json({ detail: e.message });
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_) {}
        }
    }
});

app.get('/api/data', async (req, res) => {
    const { db, table, page = 1, size = 10 } = req.query;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        const q = quoteIdentifier(params.conn_type, table);
        const limit = parseInt(size, 10);
        const offset = (parseInt(page, 10) - 1) * limit;

        if (params.conn_type === 'mysql') {
            const [[countRows]] = await conn.query(`SELECT COUNT(*) as total FROM ${q}`);
            const total = countRows.total;
            const [rows] = await conn.query(`SELECT * FROM ${q} LIMIT ? OFFSET ?`, [limit, offset]);
            let columns = [];
            if (rows.length > 0) {
                columns = Object.keys(rows[0]);
            } else {
                const [desc] = await conn.query(`DESCRIBE ${q}`);
                columns = desc.map(d => d.Field);
            }
            const pk = await getPkColumn(conn, 'mysql', table);
            res.json({
                columns,
                data: rows,
                total,
                page: parseInt(page, 10),
                size: limit,
                pages: Math.ceil(total / limit),
                pk
            });
        } else {
            const countResult = await conn.query(`SELECT COUNT(*) as total FROM ${q}`);
            const total = parseInt(countResult.rows[0].total, 10);
            const result = await conn.query(`SELECT * FROM ${q} LIMIT $1 OFFSET $2`, [limit, offset]);
            let columns = [];
            if (result.rows.length > 0) {
                columns = Object.keys(result.rows[0]);
            } else {
                const descResult = await conn.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
                    [table]
                );
                columns = descResult.rows.map(r => r.column_name);
            }
            const pk = await getPkColumn(conn, 'postgresql', table);
            res.json({
                columns,
                data: result.rows,
                total,
                page: parseInt(page, 10),
                size: limit,
                pages: Math.ceil(total / limit),
                pk
            });
        }
    } catch (e) {
        res.status(400).json({ detail: e.message });
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_) {}
        }
    }
});

app.put('/api/data', async (req, res) => {
    const { db, table, pk_col, pk_val, column, value } = req.body;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        const q_table = quoteIdentifier(params.conn_type, table);
        const q_col = quoteIdentifier(params.conn_type, column);
        const q_pk_col = quoteIdentifier(params.conn_type, pk_col);

        if (params.conn_type === 'mysql') {
            const [result] = await conn.query(
                `UPDATE ${q_table} SET ${q_col} = ? WHERE ${q_pk_col} = ?`,
                [value, pk_val]
            );
            res.json({ success: true, rowcount: result.affectedRows });
        } else {
            const result = await conn.query(
                `UPDATE ${q_table} SET ${q_col} = $1 WHERE ${q_pk_col} = $2`,
                [value, pk_val]
            );
            res.json({ success: true, rowcount: result.rowCount });
        }
    } catch (e) {
        res.status(400).json({ detail: e.message });
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_) {}
        }
    }
});

app.post('/api/query', async (req, res) => {
    const { db, sql: sqlStr } = req.body;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);

        if (params.conn_type === 'mysql') {
            const hasResult = !/^(\s*INSERT\s+|\s*UPDATE\s+|\s*DELETE\s+|\s*CREATE\s+|\s*DROP\s+|\s*ALTER\s+|\s*TRUNCATE\s+)/i.test(sqlStr);
            if (hasResult) {
                const [rows, fields] = await conn.query(sqlStr);
                const columns = fields ? fields.map(f => f.name) : [];
                res.json({ columns, data: rows, rowcount: rows.length });
            } else {
                const [result] = await conn.query(sqlStr);
                res.json({ columns: [], data: [], rowcount: result.affectedRows || 0 });
            }
        } else {
            const result = await conn.query(sqlStr);
            if (result.rows && result.fields) {
                const columns = result.fields.map(f => f.name);
                res.json({ columns, data: result.rows, rowcount: result.rows.length });
            } else {
                res.json({ columns: [], data: [], rowcount: result.rowCount || 0 });
            }
        }
    } catch (e) {
        res.status(400).json({ detail: e.message });
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_) {}
        }
    }
});

app.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`DBPage running at ${url}`);
    open(url).catch(() => {});
});
