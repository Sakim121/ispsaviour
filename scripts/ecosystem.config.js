// ecosystem.config.js - pm2 process config
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: "olt-scanner",
      script: "olt-scanner.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/olt-scanner.log",
      error_file: "./logs/olt-scanner.error.log",
      time: true,
    },
  ],
};
