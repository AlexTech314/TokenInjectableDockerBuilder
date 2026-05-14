/**
 * Cross-region redeploy integ test.
 *
 * Reproduces the production wedge where any code change in the asset source
 * (changes the deterministic `imageTag`) caused CDK's auto-generated
 * `CrossRegionExportWriter` to fail consumer-region SSM updates with
 * "Some exports have changed!" — leaving the producer stack stuck in
 * `UPDATE_ROLLBACK_FAILED` and requiring manual `continue-update-rollback
 * --resources-to-skip` recovery.
 *
 * The repro: same app, deployed twice with the same stack names but a
 * different `BUILD_ARG_TOKEN` (controlled via `BUILDER_BUILD_ARG`). Different
 * buildArg → different `imageTag` → triggers the writer's safety check on
 * the second deploy.
 *
 * Run via `npm run integ-redeploy`. The script invokes this file three
 * times: deploy phase=v1, deploy phase=v2, destroy. Phase 2 is the regression
 * guard.
 */
import * as path from 'path';

import { App, Duration, Stack } from 'aws-cdk-lib';
import {
  Architecture,
  DockerImageFunction,
} from 'aws-cdk-lib/aws-lambda';

import { TokenInjectableDockerBuilder, TokenInjectableDockerBuilderProvider } from '../../src';
import { IntegAssertions } from '../shared/integ-assertions';

const LAMBDA_IMAGE_PATH = path.resolve(__dirname, '../../test-docker/lambda-image');

const PRIMARY_REGION = 'us-east-1';
const REPLICA_REGION = 'us-west-2';
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '328174020207';

// Per-phase buildArg. The two phases use the same stack names but different
// values here, so the imageTag changes between deploys.
const BUILD_ARG = process.env.BUILDER_BUILD_ARG ?? 'v1';

const app = new App();

const builderStack = new Stack(app, 'TidbRedeployStack', {
  env: { account: ACCOUNT, region: PRIMARY_REGION },
  crossRegionReferences: true,
});

const builderProvider = TokenInjectableDockerBuilderProvider.getOrCreate(builderStack);

const builder = new TokenInjectableDockerBuilder(builderStack, 'RedeployBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: BUILD_ARG },
  provider: builderProvider,
  replicaRegions: [REPLICA_REGION],
});

const primaryFn = new DockerImageFunction(builderStack, 'PrimaryFn', {
  code: builder.dockerImageCode,
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'primary-env' },
  timeout: Duration.seconds(30),
});

new IntegAssertions(builderStack, 'PrimaryAssertions', {
  lambdaTargets: [
    {
      region: PRIMARY_REGION,
      functionName: primaryFn.functionName,
      // BUILD_ARG_TOKEN is baked into the image at build time, so the
      // assertion reads back whatever phase last deployed.
      expected: { buildArgToken: BUILD_ARG, envVar: 'primary-env', arch: 'x64' },
    },
  ],
  ecsTargets: [],
  dependsOn: [primaryFn],
});

// Consumer stack in the replica region. This is the stack that, in the
// current implementation, triggers CDK to wrap `builder.imageTag` in a
// CrossRegionExportWriter — and that writer is what wedges on phase 2.
const consumerStack = new Stack(app, 'TidbRedeployConsumerStack', {
  env: { account: ACCOUNT, region: REPLICA_REGION },
  crossRegionReferences: true,
});

const consumerFn = new DockerImageFunction(consumerStack, 'ConsumerFn', {
  code: builder.dockerImageCodeFor(consumerStack, REPLICA_REGION),
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'consumer-env' },
  timeout: Duration.seconds(30),
});

new IntegAssertions(consumerStack, 'ConsumerAssertions', {
  lambdaTargets: [
    {
      region: REPLICA_REGION,
      functionName: consumerFn.functionName,
      expected: { buildArgToken: BUILD_ARG, envVar: 'consumer-env', arch: 'x64' },
    },
  ],
  ecsTargets: [],
  dependsOn: [consumerFn],
});
