const payload = {
    buildArgToken: process.env.BUILD_ARG_TOKEN,
    envVar: process.env.RUNTIME_ENV_VAR,
    arch: process.arch,
};
console.log(JSON.stringify(payload));
