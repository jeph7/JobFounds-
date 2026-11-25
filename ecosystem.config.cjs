module.exports = {
  apps: [
    {
      name: 'jobfounds',
      script: 'node_modules/.bin/tsx',
      args: 'server.ts',
      cwd: __dirname,
      // Keep instances at 1 so SQLite WAL + the autonomous background worker loop run cleanly without lock contention
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      min_uptime: '10s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
