# 🗃️ DBWebpage

> A lightweight database data visualization tool for PostgreSQL 🐘 and MySQL 🐬.

<p align="center">
  <img src="https://unpkg.com/db-webpage@latest/dbpage-view-data.png" width="700" alt="DBWebpage Preview">
</p>

## Install

```bash
npm install -g db-webpage
```

## Usage

After global installation, simply run:

```bash
dbw
```

This will start the server on port **12301** and automatically open your browser.

### Custom Port

```bash
dbw -p 8080
```

## Features

- 🔌 **Connection Management** — Create, edit, and delete database connections
- 🗄️ **Multi-Database Support** — PostgreSQL and MySQL
- 📊 **Data Browsing** — Browse table data with pagination
- 📝 **SQL Execution** — Execute arbitrary SQL queries
- 💾 **State Persistence** — Saves last used database, table, and SQL per connection

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Backend     | Node.js + Express              |
| Frontend    | HTML + CSS + JavaScript        |
| PostgreSQL  | `pg`                           |
| MySQL       | `mysql2`                       |

## Configuration

Connection settings and state are stored in `~/.db-webpage/dbw-cache.json`.

## License

MIT
