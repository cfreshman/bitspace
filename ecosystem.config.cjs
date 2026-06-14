module.exports = {
  apps: [
    {
      name: process.env.BITSPACE_PM2_NAME || "bitspace",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: process.env.BITSPACE_PORT || process.env.PORT || 7023
      }
    }
  ]
};
