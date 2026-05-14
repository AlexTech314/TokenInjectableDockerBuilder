/**
 * Cross-stack redeploy integ test.
 *
 * Exercises every public consumer code-path under a tag-mutating redeploy,
 * so any regression that wedges deploys when `imageTag` changes between
 * runs is caught here. Three phases, run via `npm run integ-redeploy`:
 *
 *   1. Deploy with `BUILDER_BUILD_ARG=v1`
 *   2. Redeploy the same stacks with `BUILDER_BUILD_ARG=v2` (different imageTag)
 *   3. Destroy
 *
 * Phase 2 is the regression guard.
 *
 * Scenarios in one app:
 *   Same-stack consumers (use `imageTag` CFN token directly)
 *     - Minimal Lambda    — no replication, simplest possible use of the construct
 *     - Lambda            — builder with replication, same-stack Lambda
 *     - Lambda (arm64)    — different platform / arch
 *     - Lambda (VPC)      — builder runs CodeBuild in a VPC
 *     - ECS task          — `containerImage` for Fargate
 *
 *   Same-region cross-stack consumers (v2.0.4 fix: plain string, no Fn::Export)
 *     - Lambda            — `dockerImageCodeFor(scope, primaryRegion)` from another stack
 *     - ECS task          — `containerImageFor(scope, primaryRegion)` from another stack
 *
 *   Cross-region cross-stack consumers (v2.0.3 fix: plain string, no CrossRegionExportWriter)
 *     - Lambda            — `dockerImageCodeFor(scope, replicaRegion)`
 *     - ECS task          — `containerImageFor(scope, replicaRegion)`
 *
 * Pre-fix, phase 2 wedges with either "Some exports have changed!" (cross-region
 * writer) or "Cannot update export ... as it is in use" (same-region CFN export).
 * Post-fix, every scenario must redeploy and destroy cleanly.
 */
import * as path from 'path';

import { App, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerDefinition,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import {
  Architecture,
  DockerImageFunction,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

import { TokenInjectableDockerBuilder, TokenInjectableDockerBuilderProvider } from '../../src';
import { IntegAssertions } from '../shared/integ-assertions';

const LAMBDA_IMAGE_PATH = path.resolve(__dirname, '../../test-docker/lambda-image');
const ECS_IMAGE_PATH = path.resolve(__dirname, '../../test-docker/ecs-image');

const PRIMARY_REGION = 'us-east-1';
const REPLICA_REGION = 'us-west-2';
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '328174020207';

// Per-phase buildArg. The two phases use the same stack names but different
// values here, so the imageTag changes between deploys and exercises the
// wedge-prone code paths.
const BUILD_ARG = process.env.BUILDER_BUILD_ARG ?? 'v1';

const app = new App();

// =============================================================================
// Builder stack — primary region (us-east-1)
// =============================================================================

const builderStack = new Stack(app, 'TidbRedeployStack', {
  env: { account: ACCOUNT, region: PRIMARY_REGION },
  crossRegionReferences: true,
});

const builderProvider = TokenInjectableDockerBuilderProvider.getOrCreate(builderStack);
const builderVpc = new Vpc(builderStack, 'RedeployVpc', { maxAzs: 2, natGateways: 1 });
const builderCluster = new Cluster(builderStack, 'RedeployCluster', { vpc: builderVpc });

// --- Scenario A: minimal — no replication, same-stack Lambda (simplest use).
const minimalBuilder = new TokenInjectableDockerBuilder(builderStack, 'MinimalBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: `${BUILD_ARG}-minimal` },
  provider: builderProvider,
});
const minimalFn = new DockerImageFunction(builderStack, 'MinimalFn', {
  code: minimalBuilder.dockerImageCode,
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'minimal-env' },
  timeout: Duration.seconds(30),
});

// --- Scenario B: amd64 builder with cross-region replication + same-stack Lambda.
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

// --- Scenario C: arm64 builder + same-stack arm64 Lambda. Different platform,
// catches any tag/platform interaction in the deterministic hash.
const armBuilder = new TokenInjectableDockerBuilder(builderStack, 'ArmBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: `${BUILD_ARG}-arm` },
  platform: 'linux/arm64',
  provider: builderProvider,
});
const armFn = new DockerImageFunction(builderStack, 'ArmFn', {
  code: armBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'arm-env' },
  timeout: Duration.seconds(30),
});

// --- Scenario D: VPC-attached builder + same-stack Lambda. Covers the
// VPC / SG / subnet-selection wiring under redeploy.
const vpcBuilderSg = new SecurityGroup(builderStack, 'VpcBuilderSg', {
  vpc: builderVpc,
  allowAllOutbound: true,
});
const vpcBuilder = new TokenInjectableDockerBuilder(builderStack, 'VpcBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: `${BUILD_ARG}-vpc` },
  provider: builderProvider,
  vpc: builderVpc,
  securityGroups: [vpcBuilderSg],
  subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
});
const vpcFn = new DockerImageFunction(builderStack, 'VpcFn', {
  code: vpcBuilder.dockerImageCode,
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'vpc-env' },
  timeout: Duration.seconds(30),
});

// --- Scenario E: ECS builder + same-stack Fargate task (uses `containerImage`).
const ecsBuilder = new TokenInjectableDockerBuilder(builderStack, 'EcsBuilder', {
  path: ECS_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: `${BUILD_ARG}-ecs` },
  provider: builderProvider,
  replicaRegions: [REPLICA_REGION],
});
const ecsLogGroup = new LogGroup(builderStack, 'EcsLogs', {
  retention: RetentionDays.ONE_WEEK,
  removalPolicy: RemovalPolicy.DESTROY,
});
const ecsTaskDef = new FargateTaskDefinition(builderStack, 'EcsTaskDef', {
  cpu: 256,
  memoryLimitMiB: 512,
  runtimePlatform: {
    cpuArchitecture: CpuArchitecture.X86_64,
    operatingSystemFamily: OperatingSystemFamily.LINUX,
  },
});
const ecsContainerName = 'app';
const ecsContainer: ContainerDefinition = ecsTaskDef.addContainer(ecsContainerName, {
  image: ecsBuilder.containerImage,
  logging: LogDriver.awsLogs({ streamPrefix: 'ecs', logGroup: ecsLogGroup }),
});
void ecsContainer;
const ecsTaskSg = new SecurityGroup(builderStack, 'EcsTaskSg', {
  vpc: builderVpc,
  allowAllOutbound: true,
});

new IntegAssertions(builderStack, 'PrimaryAssertions', {
  lambdaTargets: [
    {
      region: PRIMARY_REGION,
      functionName: minimalFn.functionName,
      expected: { buildArgToken: `${BUILD_ARG}-minimal`, envVar: 'minimal-env', arch: 'x64' },
    },
    {
      region: PRIMARY_REGION,
      functionName: primaryFn.functionName,
      expected: { buildArgToken: BUILD_ARG, envVar: 'primary-env', arch: 'x64' },
    },
    {
      region: PRIMARY_REGION,
      functionName: armFn.functionName,
      expected: { buildArgToken: `${BUILD_ARG}-arm`, envVar: 'arm-env', arch: 'arm64' },
    },
    {
      region: PRIMARY_REGION,
      functionName: vpcFn.functionName,
      expected: { buildArgToken: `${BUILD_ARG}-vpc`, envVar: 'vpc-env', arch: 'x64' },
    },
  ],
  ecsTargets: [
    {
      region: PRIMARY_REGION,
      clusterArn: builderCluster.clusterArn,
      taskDefinitionArn: ecsTaskDef.taskDefinitionArn,
      containerName: ecsContainerName,
      subnetIds: builderVpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupId: ecsTaskSg.securityGroupId,
      assignPublicIp: false,
      logGroupName: ecsLogGroup.logGroupName,
      logStreamPrefix: 'ecs',
      envOverrides: { RUNTIME_ENV_VAR: 'ecs-env' },
      expected: { buildArgToken: `${BUILD_ARG}-ecs`, envVar: 'ecs-env', arch: 'x64' },
    },
  ],
  dependsOn: [minimalFn, primaryFn, armFn, vpcFn, ecsTaskDef],
});

// =============================================================================
// Cross-region cross-stack consumer (us-west-2)
// Exercises v2.0.3 fix: `dockerImageCodeFor` / `containerImageFor` route
// through `imageTagPlain` to avoid CrossRegionExportWriter wedges.
// =============================================================================

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

const consumerVpc = new Vpc(consumerStack, 'ConsumerVpc', { maxAzs: 2, natGateways: 1 });
const consumerCluster = new Cluster(consumerStack, 'ConsumerCluster', { vpc: consumerVpc });
const consumerEcsLogs = new LogGroup(consumerStack, 'ConsumerEcsLogs', {
  retention: RetentionDays.ONE_WEEK,
  removalPolicy: RemovalPolicy.DESTROY,
});
const consumerTaskDef = new FargateTaskDefinition(consumerStack, 'ConsumerTaskDef', {
  cpu: 256,
  memoryLimitMiB: 512,
  runtimePlatform: {
    cpuArchitecture: CpuArchitecture.X86_64,
    operatingSystemFamily: OperatingSystemFamily.LINUX,
  },
});
const consumerContainerName = 'app';
const consumerContainer: ContainerDefinition = consumerTaskDef.addContainer(consumerContainerName, {
  image: ecsBuilder.containerImageFor(consumerStack, REPLICA_REGION),
  logging: LogDriver.awsLogs({ streamPrefix: 'consumer', logGroup: consumerEcsLogs }),
});
void consumerContainer;
const consumerEcsSg = new SecurityGroup(consumerStack, 'ConsumerEcsSg', {
  vpc: consumerVpc,
  allowAllOutbound: true,
});

new IntegAssertions(consumerStack, 'ConsumerAssertions', {
  lambdaTargets: [
    {
      region: REPLICA_REGION,
      functionName: consumerFn.functionName,
      // buildArgToken is baked at image build time and travels with replication;
      // envVar is set by the consumer-side Lambda config.
      expected: { buildArgToken: BUILD_ARG, envVar: 'consumer-env', arch: 'x64' },
    },
  ],
  ecsTargets: [
    {
      region: REPLICA_REGION,
      clusterArn: consumerCluster.clusterArn,
      taskDefinitionArn: consumerTaskDef.taskDefinitionArn,
      containerName: consumerContainerName,
      subnetIds: consumerVpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupId: consumerEcsSg.securityGroupId,
      assignPublicIp: false,
      logGroupName: consumerEcsLogs.logGroupName,
      logStreamPrefix: 'consumer',
      envOverrides: { RUNTIME_ENV_VAR: 'consumer-ecs-env' },
      expected: { buildArgToken: `${BUILD_ARG}-ecs`, envVar: 'consumer-ecs-env', arch: 'x64' },
    },
  ],
  dependsOn: [consumerFn, consumerTaskDef],
});

// =============================================================================
// Same-region cross-stack consumer (us-east-1)
// Exercises v2.0.4 fix: `dockerImageCodeFor` / `containerImageFor` for a
// same-region different-stack consumer route through `imageTagPlain` too,
// so no CFN `Fn::Export` / `Fn::ImportValue` for the imageTag is generated
// (which would wedge with "Cannot update export ... as it is in use" on any
// tag change).
// =============================================================================

const sameRegionConsumerStack = new Stack(app, 'TidbRedeploySameRegionConsumerStack', {
  env: { account: ACCOUNT, region: PRIMARY_REGION },
});

const sameRegionConsumerFn = new DockerImageFunction(sameRegionConsumerStack, 'SameRegionConsumerFn', {
  code: builder.dockerImageCodeFor(sameRegionConsumerStack, PRIMARY_REGION),
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'same-region-consumer-env' },
  timeout: Duration.seconds(30),
});

const sameRegionEcsLogs = new LogGroup(sameRegionConsumerStack, 'SameRegionEcsLogs', {
  retention: RetentionDays.ONE_WEEK,
  removalPolicy: RemovalPolicy.DESTROY,
});
const sameRegionTaskDef = new FargateTaskDefinition(sameRegionConsumerStack, 'SameRegionTaskDef', {
  cpu: 256,
  memoryLimitMiB: 512,
  runtimePlatform: {
    cpuArchitecture: CpuArchitecture.X86_64,
    operatingSystemFamily: OperatingSystemFamily.LINUX,
  },
});
const sameRegionContainerName = 'app';
const sameRegionContainer: ContainerDefinition = sameRegionTaskDef.addContainer(sameRegionContainerName, {
  image: ecsBuilder.containerImageFor(sameRegionConsumerStack, PRIMARY_REGION),
  logging: LogDriver.awsLogs({ streamPrefix: 'sameRegion', logGroup: sameRegionEcsLogs }),
});
void sameRegionContainer;
const sameRegionEcsSg = new SecurityGroup(sameRegionConsumerStack, 'SameRegionEcsSg', {
  vpc: builderVpc,
  allowAllOutbound: true,
});

new IntegAssertions(sameRegionConsumerStack, 'SameRegionConsumerAssertions', {
  lambdaTargets: [
    {
      region: PRIMARY_REGION,
      functionName: sameRegionConsumerFn.functionName,
      expected: { buildArgToken: BUILD_ARG, envVar: 'same-region-consumer-env', arch: 'x64' },
    },
  ],
  ecsTargets: [
    {
      region: PRIMARY_REGION,
      clusterArn: builderCluster.clusterArn,
      taskDefinitionArn: sameRegionTaskDef.taskDefinitionArn,
      containerName: sameRegionContainerName,
      subnetIds: builderVpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupId: sameRegionEcsSg.securityGroupId,
      assignPublicIp: false,
      logGroupName: sameRegionEcsLogs.logGroupName,
      logStreamPrefix: 'sameRegion',
      envOverrides: { RUNTIME_ENV_VAR: 'same-region-ecs-env' },
      expected: { buildArgToken: `${BUILD_ARG}-ecs`, envVar: 'same-region-ecs-env', arch: 'x64' },
    },
  ],
  dependsOn: [sameRegionConsumerFn, sameRegionTaskDef],
});
