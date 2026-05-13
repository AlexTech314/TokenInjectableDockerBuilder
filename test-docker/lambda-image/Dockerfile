FROM public.ecr.aws/lambda/nodejs:20

ARG BUILD_ARG_TOKEN
ENV BUILD_ARG_TOKEN=${BUILD_ARG_TOKEN}

COPY index.js ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
