#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const configDir = path.join(os.homedir(), '.db-webpage');
const initFile = path.join(configDir, 'dbw-cache.json');
const legacyFile = path.join(configDir, 'init.json');
const bundledInit = path.join(__dirname, '..', 'dbw-cache.json');

try {
    fs.mkdirSync(configDir, { recursive: true });
    // 旧版 init.json 自动迁移为 dbw-cache.json
    if (!fs.existsSync(initFile) && fs.existsSync(legacyFile)) {
        fs.copyFileSync(legacyFile, initFile);
    }
    if (!fs.existsSync(initFile)) {
        if (fs.existsSync(bundledInit)) {
            fs.copyFileSync(bundledInit, initFile);
        } else {
            fs.writeFileSync(initFile, JSON.stringify({ connections: [], states: {} }, null, 2), 'utf-8');
        }
    }
} catch (err) {
    console.warn(`db-webpage: could not initialize ${initFile}: ${err.message}`);
}
