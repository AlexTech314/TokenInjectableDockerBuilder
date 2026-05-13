/**
 * Phase 1 of the v1 → v2 migration integ test.
 *
 * Deploys `TidbMigrationStack` using v1.x of the construct (the
 * `token-injectable-docker-builder-v1` aliased devDep). Scenarios mirror
 * the prop combinations actually used by real downstream consumers
 * (`fca-cdk`, `Hydra`, `CorridomeWebScraper`) so the upgrade path is
 * exercised against realistic shapes, not toy ones.
 *
 * Construct IDs in this file MUST match `after-v2.ts` exactly. Stable IDs
 * are what makes the second `cdk deploy` an UPDATE rather than a replace,
 * which is the migration we want to test.
 */
import * as path from 'path';

import { App, Duration, Stack } from 'aws-cdk-lib';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Architecture, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import {
  TokenInjectableDockerBuilder,
  TokenInjectableDockerBuilderProvider,
} from 'token-injectable-docker-builder-v1';

import { IntegAssertions, LambdaTarget } from '../shared/integ-assertions';

const LAMBDA_IMAGE_PATH = path.resolve(__dirname, '../../test-docker/lambda-image');

const REGION = 'us-east-1';
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '328174020207';

const app = new App();
const stack = new Stack(app, 'TidbMigrationStack', {
  env: { account: ACCOUNT, region: REGION },
});

// Pattern A (singleton-aware, fca-cdk style) — provider is created via
// getOrCreate and explicitly passed to each builder. v1's CR serviceToken
// already points at the singleton, so v1 → v2 won't fail on a serviceToken
// change for these builders.
const provider = TokenInjectableDockerBuilderProvider.getOrCreate(stack);

// Scenario 1 (Pattern A): arm64 builder with pull-through cache + retained
// logs, matching the fca-cdk api/email/leadgen pattern.
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

// Scenario 2 (Pattern A): a second singleton-aware builder. Proves multiple
// builders on the same singleton survive the v1 → v2 upgrade together
// (no logical-ID collisions, no race conditions in the singleton's CR).
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

// Scenario 3 (Pattern A + VPC): builder running inside a VPC. Matches
// fca-cdk's stateful + flagship-web pattern (vpc + subnetSelection +
// singleton-aware provider + retained logs).
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

// Scenario 4 (Pattern B, provider-naive): no `provider` prop. v1 emits
// per-instance Lambdas for this builder and the CR's serviceToken points at
// those. This is the path that originally surfaced the "Modifying service
// token is not allowed" failure — kept in the test as a regression guard.
// Matches Hydra and CorridomeWebScraper.
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
