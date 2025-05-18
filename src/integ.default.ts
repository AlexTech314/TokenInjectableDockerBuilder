import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { TokenInjectableDockerBuilder } from './index';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'IntegTestingStack');

const builder = new TokenInjectableDockerBuilder(stack, 'Builder1', {
  path: path.resolve(__dirname, '../test-docker/public-internet'),
  buildArgs: {
    SAMPLE_ARG_1: 'SAMPLE_VALUE_1',
    SAMPLE_ARG_2: 'SAMPLE_VALUE_2',
    SAMPLE_ARG_3: 'SAMPLE_VALUE_3',
    SAMPLE_ARG_4: 'SAMPLE_VALUE_4',
    SAMPLE_ARG_5: 'SAMPLE_VALUE_5',
    SAMPLE_ARG_6: 'SAMPLE_VALUE_6',
  },
});


new DockerImageFunction(stack, 'PublicNoLoginTestLambda', {
  code: builder.dockerImageCode,
  environment: {
    TEST_ENV_VAR: 'HelloFromNoLoginBuilder',
  },
});