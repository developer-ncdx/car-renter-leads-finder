module.exports = {
  apps: [
    {
      name: "fb-group-lead-sniper",
      cwd: __dirname,
      script: "server.js",
      node_args: "--env-file=.env.local",
      autorestart: true,
      watch: false,
      restart_delay: 2000,
      max_memory_restart: "256M",
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
