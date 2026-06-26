#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const configDir = path.join(os.homedir(), '.db-webpage');
const initFile = path.join(configDir, 'init.json');
const bundledInit = path.join(__dirname, '..', 'init.json');

try {
    fs.mkdirSync(configDir, { recursive: true });
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
