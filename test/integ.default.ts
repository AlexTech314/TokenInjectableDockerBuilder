import * as path from 'path';

import { IntegTest } from '@aws-cdk/integ-tests-alpha';
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

import { TokenInjectableDockerBuilder, TokenInjectableDockerBuilderProvider } from '../src';
import { IntegAssertions } from './shared/integ-assertions';

const LAMBDA_IMAGE_PATH = path.resolve(__dirname, '../test-docker/lambda-image');
const ECS_IMAGE_PATH = path.resolve(__dirname, '../test-docker/ecs-image');

const PRIMARY_REGION = 'us-east-1';
const REPLICA_REGION = 'us-west-2';
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '328174020207';

const app = new App();

// =============================================================================
// Builder stack — primary region (us-east-1)
// =============================================================================

const builderStack = new Stack(app, 'TidbIntegStack', {
  env: { account: ACCOUNT, region: PRIMARY_REGION },
  crossRegionReferences: true,
});

const builderProvider = TokenInjectableDockerBuilderProvider.getOrCreate(builderStack);

const builderVpc = new Vpc(builderStack, 'IntegVpc', {
  maxAzs: 2,
  natGateways: 1,
});
const builderCluster = new Cluster(builderStack, 'IntegCluster', { vpc: builderVpc });

// Scenario 1: amd64 Lambda + cross-region replication to us-west-2.
const amd64Builder = new TokenInjectableDockerBuilder(builderStack, 'Amd64Builder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'amd64-token-xyz' },
  provider: builderProvider,
  replicaRegions: [REPLICA_REGION],
});
const amd64Fn = new DockerImageFunction(builderStack, 'Amd64Fn', {
  code: amd64Builder.dockerImageCode,
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'amd64-env' },
  timeout: Duration.seconds(30),
});

// Scenario 2: arm64 Lambda.
const armBuilder = new TokenInjectableDockerBuilder(builderStack, 'ArmBuilder', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'arm-token-abc' },
  platform: 'linux/arm64',
  provider: builderProvider,
});
const armFn = new DockerImageFunction(builderStack, 'ArmFn', {
  code: armBuilder.dockerImageCode,
  architecture: Architecture.ARM_64,
  environment: { RUNTIME_ENV_VAR: 'arm-env' },
  timeout: Duration.seconds(30),
});

// Scenario 3: shared-provider, second amd64 Lambda.
const sharedBuilder2 = new TokenInjectableDockerBuilder(builderStack, 'SharedBuilder2', {
  path: LAMBDA_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'shared-token-2' },
  provider: builderProvider,
});
const sharedFn2 = new DockerImageFunction(builderStack, 'SharedFn2', {
  code: sharedBuilder2.dockerImageCode,
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'shared-env-2' },
  timeout: Duration.seconds(30),
});

// Scenario 4: ECS Fargate task in the primary region + cross-region replica.
const ecsBuilder = new TokenInjectableDockerBuilder(builderStack, 'EcsBuilder', {
  path: ECS_IMAGE_PATH,
  buildArgs: { BUILD_ARG_TOKEN: 'ecs-token-qrs' },
  provider: builderProvider,
  replicaRegions: [REPLICA_REGION],
});

const ecsLogGroup = new LogGroup(builderStack, 'EcsTaskLogs', {
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
  logging: LogDriver.awsLogs({
    streamPrefix: 'ecs',
    logGroup: ecsLogGroup,
  }),
});
void ecsContainer;

const ecsSecurityGroup = new SecurityGroup(builderStack, 'EcsTaskSg', {
  vpc: builderVpc,
  allowAllOutbound: true,
});

new IntegAssertions(builderStack, 'IntegAssertions', {
  lambdaTargets: [
    {
      region: PRIMARY_REGION,
      functionName: amd64Fn.functionName,
      expected: { buildArgToken: 'amd64-token-xyz', envVar: 'amd64-env', arch: 'x64' },
    },
    {
      region: PRIMARY_REGION,
      functionName: armFn.functionName,
      expected: { buildArgToken: 'arm-token-abc', envVar: 'arm-env', arch: 'arm64' },
    },
    {
      region: PRIMARY_REGION,
      functionName: sharedFn2.functionName,
      expected: { buildArgToken: 'shared-token-2', envVar: 'shared-env-2', arch: 'x64' },
    },
  ],
  ecsTargets: [
    {
      region: PRIMARY_REGION,
      clusterArn: builderCluster.clusterArn,
      taskDefinitionArn: ecsTaskDef.taskDefinitionArn,
      containerName: ecsContainerName,
      subnetIds: builderVpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupId: ecsSecurityGroup.securityGroupId,
      assignPublicIp: false,
      logGroupName: ecsLogGroup.logGroupName,
      logStreamPrefix: 'ecs',
      envOverrides: { RUNTIME_ENV_VAR: 'ecs-env' },
      expected: { buildArgToken: 'ecs-token-qrs', envVar: 'ecs-env', arch: 'x64' },
    },
  ],
  dependsOn: [amd64Fn, armFn, sharedFn2, ecsTaskDef],
});

// =============================================================================
// Consumer stack — replica region (us-west-2)
// Uses the replicated image from amd64Builder via dockerImageCodeFor /
// containerImageFor. Runs its own IntegAssertions to validate locally.
// =============================================================================

const consumerStack = new Stack(app, 'TidbIntegConsumerStack', {
  env: { account: ACCOUNT, region: REPLICA_REGION },
  crossRegionReferences: true,
});

const consumerFn = new DockerImageFunction(consumerStack, 'CrossRegionFn', {
  code: amd64Builder.dockerImageCodeFor(consumerStack, REPLICA_REGION),
  architecture: Architecture.X86_64,
  environment: { RUNTIME_ENV_VAR: 'cross-region-env' },
  timeout: Duration.seconds(30),
});

const consumerVpc = new Vpc(consumerStack, 'ConsumerVpc', {
  maxAzs: 2,
  natGateways: 1,
});
const consumerCluster = new Cluster(consumerStack, 'ConsumerCluster', { vpc: consumerVpc });
const consumerEcsLogGroup = new LogGroup(consumerStack, 'ConsumerEcsLogs', {
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
  // Use the ECS-image builder (a real node:20-slim image), not the Lambda
  // runtime image, since this is a Fargate task.
  image: ecsBuilder.containerImageFor(consumerStack, REPLICA_REGION),
  logging: LogDriver.awsLogs({
    streamPrefix: 'consumer',
    logGroup: consumerEcsLogGroup,
  }),
});
void consumerContainer;
const consumerSg = new SecurityGroup(consumerStack, 'ConsumerEcsSg', {
  vpc: consumerVpc,
  allowAllOutbound: true,
});

new IntegAssertions(consumerStack, 'ConsumerIntegAssertions', {
  lambdaTargets: [
    {
      region: REPLICA_REGION,
      functionName: consumerFn.functionName,
      // BUILD_ARG_TOKEN is baked into the image at build time and travels
      // with replication; RUNTIME_ENV_VAR is set by THIS stack's Lambda
      // definition and proves the consumer-side wiring works end-to-end.
      expected: { buildArgToken: 'amd64-token-xyz', envVar: 'cross-region-env', arch: 'x64' },
    },
  ],
  ecsTargets: [
    {
      region: REPLICA_REGION,
      clusterArn: consumerCluster.clusterArn,
      taskDefinitionArn: consumerTaskDef.taskDefinitionArn,
      containerName: consumerContainerName,
      subnetIds: consumerVpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroupId: consumerSg.securityGroupId,
      assignPublicIp: false,
      logGroupName: consumerEcsLogGroup.logGroupName,
      logStreamPrefix: 'consumer',
      envOverrides: { RUNTIME_ENV_VAR: 'consumer-ecs-env' },
      expected: { buildArgToken: 'ecs-token-qrs', envVar: 'consumer-ecs-env', arch: 'x64' },
    },
  ],
  dependsOn: [consumerFn, consumerTaskDef],
});

// Wrap both stacks in a single IntegTest so integ-runner can orchestrate them.
new IntegTest(app, 'IntegTest', {
  testCases: [builderStack, consumerStack],
});
