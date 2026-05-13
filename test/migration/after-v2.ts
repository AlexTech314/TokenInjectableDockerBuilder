/**
 * Phase 2 of the v1 → v2 migration integ test.
 *
 * Re-deploys `TidbMigrationStack` (already created by `before-v1.ts`) using
 * the v2 source in `../../src`. Construct IDs match `before-v1.ts` exactly,
 * so CloudFormation treats this as an UPDATE of the existing stack — that's
 * the whole point: prove that a v1-deployed stack upgrades cleanly to v2.
 *
 * **This file is the executable migration recipe.** It is intentionally a
 * near-copy of `before-v1.ts` — the diff demonstrates the *minimum source
 * edits* a real consumer has to make. Currently that diff is:
 *   1. Change the import path from `'token-injectable-docker-builder-v1'`
 *      to `'token-injectable-docker-builder'` (i.e. bump the dep version).
 *
 * Anything beyond that is on the construct, not on the consumer. v2 handles
 * the v1 → v2 CFN-level migration internally by renaming the build CR's
 * logical ID (`BuildTriggerResource` → `BuildTriggerResourceV2`) so that
 * CFN treats the CR as a Replace, not an in-place Update. That sidesteps
 * CFN's "Modifying service token is not allowed" rule, which would
 * otherwise block the provider-naive (no-`provider`-prop) upgrade path.
 */
import * as path from 'path';

import { App, Duration, Stack } from 'aws-cdk-lib';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Architecture, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';

import { TokenInjectableDockerBuilder, TokenInjectableDockerBuilderProvider } from '../../src';
import { IntegAssertions, LambdaTarget } from '../shared/integ-assertions';

const LAMBDA_IMAGE_PATH = path.resolve(__dirname, '../../test-docker/lambda-image');

const REGION = 'us-east-1';
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '328174020207';

const app = new App();
const stack = new Stack(app, 'TidbMigrationStack', {
  env: { account: ACCOUNT, region: REGION },
});

const provider = TokenInjectableDockerBuilderProvider.getOrCreate(stack);

const sharedApiBuilder = new TokenInjectableDockerBuilder(stack, 'SharedApiBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'shared-api-v1' },
  platform: 'linux/arm64',
  provider,
  ecrPullThroughCachePrefixes: ['docker-hub'],
  retainBuildLogs: true,
});
const sharedApiFn = new DockerImageFunction(stack, 'SharedApiFn', {
  code: sharedApiBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'shared-api-env' },
  timeout: Duration.seconds(30),
});

const sharedWorkerBuilder = new TokenInjectableDockerBuilder(stack, 'SharedWorkerBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'shared-worker-v1' },
  platform: 'linux/arm64',
  provider,
  ecrPullThroughCachePrefixes: ['docker-hub'],
  retainBuildLogs: true,
});
const sharedWorkerFn = new DockerImageFunction(stack, 'SharedWorkerFn', {
  code: sharedWorkerBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'shared-worker-env' },
  timeout: Duration.seconds(30),
});

const migrationVpc = new Vpc(stack, 'MigrationVpc', { maxAzs: 2, natGateways: 1 });
const migrationSg = new SecurityGroup(stack, 'MigrationSg', {
  vpc: migrationVpc,
  allowAllOutbound: true,
});
const sharedVpcBuilder = new TokenInjectableDockerBuilder(stack, 'SharedVpcBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'shared-vpc-v1' },
  platform: 'linux/arm64',
  provider,
  vpc: migrationVpc,
  securityGroups: [migrationSg],
  subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
  retainBuildLogs: true,
});
const sharedVpcFn = new DockerImageFunction(stack, 'SharedVpcFn', {
  code: sharedVpcBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'shared-vpc-env' },
  timeout: Duration.seconds(30),
});

const naiveBuilder = new TokenInjectableDockerBuilder(stack, 'NaiveBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'naive-v1' },
  platform: 'linux/arm64',
  ecrPullThroughCachePrefixes: ['docker-hub'],
});
const naiveFn = new DockerImageFunction(stack, 'NaiveFn', {
  code: naiveBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'naive-env' },
  timeout: Duration.seconds(30),
});

const targets: LambdaTarget[] = [
  {
    region: REGION,
    functionName: sharedApiFn.functionName,
    expected: { buildArgToken: 'shared-api-v1', envVar: 'shared-api-env', arch: 'arm64' },
  },
  {
    region: REGION,
    functionName: sharedWorkerFn.functionName,
    expected: { buildArgToken: 'shared-worker-v1', envVar: 'shared-worker-env', arch: 'arm64' },
  },
  {
    region: REGION,
    functionName: sharedVpcFn.functionName,
    expected: { buildArgToken: 'shared-vpc-v1', envVar: 'shared-vpc-env', arch: 'arm64' },
  },
  {
    region: REGION,
    functionName: naiveFn.functionName,
    expected: { buildArgToken: 'naive-v1', envVar: 'naive-env', arch: 'arm64' },
  },
];

new IntegAssertions(stack, 'MigrationAssertions', {
  lambdaTargets: targets,
  ecsTargets: [],
  dependsOn: [sharedApiFn, sharedWorkerFn, sharedVpcFn, naiveFn],
});
