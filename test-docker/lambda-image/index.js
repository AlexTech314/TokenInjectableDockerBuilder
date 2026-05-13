exports.handler = async () => ({
    buildArgToken: process.env.BUILD_ARG_TOKEN,
    envVar: process.env.RUNTIME_ENV_VAR,
    arch: process.arch,
});
