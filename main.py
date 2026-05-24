import os
import json
import psycopg2
import pymysql
from psycopg2.extras import RealDictCursor
from pymysql.cursors import DictCursor
from fastapi import FastAPI, Request, Form, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI(title="DBPage")
app.add_middleware(SessionMiddleware, secret_key="dbpage-secret-key-2024")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

CONNECTIONS_FILE = "connections.json"


def load_connections():
    if not os.path.exists(CONNECTIONS_FILE):
        return []
    with open(CONNECTIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_connections(conns):
    with open(CONNECTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(conns, f, ensure_ascii=False, indent=2)


def get_db_connection(conn_type, host, port, user, password, dbname=None):
    if conn_type == "mysql":
        kwargs = dict(host=host, port=port, user=user, password=password, cursorclass=DictCursor)
        if dbname:
            kwargs["database"] = dbname
        return pymysql.connect(**kwargs)
    return psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname=dbname or "postgres",
        cursor_factory=RealDictCursor,
    )


def get_conn_params(request: Request):
    return {
        "conn_type": request.session.get("conn_type", "postgresql"),
        "host": request.session.get("db_host"),
        "port": request.session.get("db_port"),
        "user": request.session.get("db_user"),
        "password": request.session.get("db_password"),
    }


def quote_identifier(conn_type, name):
    if conn_type == "mysql":
        return f"`{name}`"
    return f'"{name}"'


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/connections")
async def list_connections():
    return {"connections": load_connections()}


@app.post("/api/connections")
async def create_connection(
    name: str = Form(...),
    conn_type: str = Form("postgresql"),
    host: str = Form(...),
    port: int = Form(...),
    user: str = Form(...),
    password: str = Form(...),
):
    conns = load_connections()
    new_id = str(max([int(c["id"]) for c in conns if c["id"].isdigit()], default=0) + 1)
    conns.append({"id": new_id, "name": name, "type": conn_type, "host": host, "port": port, "user": user, "password": password})
    save_connections(conns)
    return {"success": True, "id": new_id}


@app.put("/api/connections/{conn_id}")
async def update_connection(
    conn_id: str,
    name: str = Form(...),
    conn_type: str = Form("postgresql"),
    host: str = Form(...),
    port: int = Form(...),
    user: str = Form(...),
    password: str = Form(...),
):
    conns = load_connections()
    for c in conns:
        if c["id"] == conn_id:
            c.update({"name": name, "type": conn_type, "host": host, "port": port, "user": user, "password": password})
            save_connections(conns)
            return {"success": True}
    raise HTTPException(status_code=404, detail="连接不存在")


@app.delete("/api/connections/{conn_id}")
async def delete_connection(conn_id: str):
    conns = load_connections()
    conns = [c for c in conns if c["id"] != conn_id]
    save_connections(conns)
    return {"success": True}


@app.post("/api/connections/{conn_id}/use")
async def use_connection(request: Request, conn_id: str):
    conns = load_connections()
    conn = next((c for c in conns if c["id"] == conn_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")
    try:
        db = get_db_connection(
            conn.get("type", "postgresql"),
            conn["host"], conn["port"], conn["user"], conn["password"],
            dbname=None
        )
        db.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    request.session["conn_id"] = conn_id
    request.session["conn_type"] = conn.get("type", "postgresql")
    request.session["db_host"] = conn["host"]
    request.session["db_port"] = conn["port"]
    request.session["db_user"] = conn["user"]
    request.session["db_password"] = conn["password"]
    return {"success": True}


@app.get("/api/databases")
async def list_databases(request: Request):
    params = get_conn_params(request)
    if not params["host"]:
        raise HTTPException(status_code=400, detail="未选择连接")
    conn = get_db_connection(**params, dbname="postgres" if params["conn_type"] == "postgresql" else None)
    try:
        with conn.cursor() as cur:
            if params["conn_type"] == "mysql":
                cur.execute("SHOW DATABASES")
                rows = cur.fetchall()
                exclude = {"information_schema", "mysql", "performance_schema", "sys"}
                return {"databases": [r.get("Database") or r.get("database") for r in rows if (r.get("Database") or r.get("database")) not in exclude]}
            else:
                cur.execute(
                    "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname"
                )
                rows = cur.fetchall()
                return {"databases": [r["datname"] for r in rows]}
    finally:
        conn.close()


@app.get("/api/tables")
async def list_tables(request: Request, db: str = Query(...)):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        with conn.cursor() as cur:
            if params["conn_type"] == "mysql":
                cur.execute("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
                rows = cur.fetchall()
                return {"tables": [list(r.values())[0] for r in rows]}
            else:
                cur.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
                )
                rows = cur.fetchall()
                return {"tables": [r["table_name"] for r in rows]}
    finally:
        conn.close()


@app.get("/api/data")
async def get_data(
    request: Request,
    db: str = Query(...),
    table: str = Query(...),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=1000),
):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        with conn.cursor() as cur:
            q = quote_identifier(params["conn_type"], table)
            cur.execute(f"SELECT COUNT(*) as total FROM {q}")
            total = cur.fetchone()["total"]
            offset = (page - 1) * size
            cur.execute(f"SELECT * FROM {q} LIMIT %s OFFSET %s", (size, offset))
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description] if cur.description else []
            return {
                "columns": columns,
                "data": [dict(r) for r in rows],
                "total": total,
                "page": page,
                "size": size,
                "pages": (total + size - 1) // size,
            }
    finally:
        conn.close()


@app.post("/api/query")
async def execute_query(request: Request, db: str = Form(...), sql: str = Form(...)):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description:
                rows = cur.fetchall()
                columns = [desc[0] for desc in cur.description]
                return {
                    "columns": columns,
                    "data": [dict(r) for r in rows],
                    "rowcount": len(rows),
                }
            else:
                if params["conn_type"] == "postgresql":
                    conn.commit()
                else:
                    conn.commit()
                return {"columns": [], "data": [], "rowcount": cur.rowcount}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
