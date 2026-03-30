module.exports = {
    apps: [
        {
            port: 3000,
            name: 'hautgesund-kochen',
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm Z',
            script: 'server.js',
            watch: false,
            instances: 1,
            exec_mode: 'fork',
            output: './logs/pm2.log',
            error: './logs/error.log',
            env: {
                NODE_ENV: 'production',
                TZ: 'Europe/Berlin',
            },
        },
    ],
};
