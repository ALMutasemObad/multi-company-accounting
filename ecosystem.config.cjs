const currentDirectory = process.env.MCAP_CURRENT_DIR || '/opt/mcap/current';

module.exports = {
  apps: [{
    name: 'mcap-finance-api',
    cwd: currentDirectory,
    script: 'apps/api/dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '750M',
    kill_timeout: 12000,
    listen_timeout: 10000,
    env: { NODE_ENV: 'production' },
  }],
};
