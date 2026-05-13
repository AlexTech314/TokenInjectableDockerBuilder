# TokenInjectableDockerBuilder

The `TokenInjectableDockerBuilder` is a flexible AWS CDK construct that enables the usage of AWS CDK tokens in the building, pushing, and deployment of Docker images to Amazon Elastic Container Registry (ECR). It leverages AWS CodeBuild and Lambda custom resources.

---

## Why?

AWS CDK already provides mechanisms for creating deployable assets using Docker, such as [DockerImageAsset](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecr_assets.DockerImageAsset.html) and [DockerImageCode](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.DockerImageCode.html), but these constructs are limited because they cannot accept CDK tokens as build-args. The `TokenInjectableDockerBuilder` allows injecting CDK tokens as build-time arguments into Docker-based assets, enabling more dynamic dependency relationships.

For example, a Next.js frontend Docker image may require an API Gateway URL as an argument to create a reference from the UI to the associated API in a given deployment. With this construct, you can deploy the API Gateway first, then pass its URL as a build-time argument to the Next.js Docker image. As a result, your Next.js frontend can dynamically fetch data from the API Gateway without hardcoding the URL or needing multiple separate stacks.

---

## Features

- **Build and Push Docker Images**: Automatically builds and pushes Docker images to ECR.
- **Token Support**: Supports custom build arguments for Docker builds, including CDK tokens resolved at deployment time.
- **Per-stack Lambda singleton**: Every builder in a stack automatically shares one pair of `onEvent` / `isComplete` Lambdas via `TokenInjectableDockerBuilderProvider`. Two builders cost the same Lambda overhead as one.
- **Cross-region replication**: Pass `replicaRegions: ['us-west-2', ...]` to replicate the built image to additional regions via ECR's native replication. Use `builder.dockerImageCodeFor(scope, region)` / `builder.containerImageFor(scope, region)` in a consumer stack in another region. The custom resource waits for replicas to land before signalling complete, so downstream stacks deploy safely.
- **Custom Install and Pre-Build Commands**: Allows specifying custom commands to run during the `install` and `pre_build` phases of the CodeBuild build process.
- **VPC Configuration**: Supports deploying the CodeBuild project within a VPC, with customizable security groups and subnet selection.
- **Docker Login**: Supports Docker login using credentials stored in AWS Secrets Manager.
- **Safe ECR retention by default**: Untagged images expire after 30 days; tagged images are never deleted (Lambda pins by digest, so deleting an in-use tag would break the next config update).
- **Integration with ECS and Lambda**: Provides outputs for use in AWS ECS and AWS Lambda.
- **Configurable Build Polling**: Tune how often the provider checks for build completion via `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })` (defaults to 30 seconds).
- **Custom Dockerfile**: Specify a custom Dockerfile name via the `file` property (e.g. `Dockerfile.production`), allowing multiple Docker images from the same source directory.
- **ECR Docker Layer Caching**: By default, builds use `docker buildx` with ECR as a remote cache backend, reducing build times by reusing layers across deploys. Set `cacheDisabled: true` to force a clean build from scratch.
- **Platform Support**: Build images for `linux/amd64` (x86_64) or `linux/arm64` (Graviton) using native CodeBuild instances — no emulation, no QEMU. ARM builds are faster and cheaper.
- **Persistent Build Logs**: Pass `buildLogGroup` with a log group that has RETAIN removal policy so build logs survive rollbacks and stack deletion for debugging.
- **ECR Pull-Through Cache**: When your Dockerfile uses base images from ECR pull-through cache (e.g. `docker-hub/library/node:20-slim`, `ghcr/org/image:tag`), pass `ecrPullThroughCachePrefixes` to grant the CodeBuild role pull access to those cache prefixes.

---

## Installation

### For NPM

Install the construct using NPM:

```bash
npm install token-injectable-docker-builder
```

### For Python

Install the construct using pip:

```bash
pip install token-injectable-docker-builder
```

---

## API Reference

### `TokenInjectableDockerBuilderProvider`

A singleton construct that creates the `onEvent` and `isComplete` Lambda functions once per stack. Every `TokenInjectableDockerBuilder` in the same stack automatically reuses this singleton, so two builders cost the same Lambda overhead as one. You only need to call this yourself if you want to customize `queryInterval`.

#### Static Methods

| Method | Description |
|---|---|
| `getOrCreate(scope, props?)` | Returns the existing provider for the stack, or creates one if it doesn't exist. Called automatically by every `TokenInjectableDockerBuilder`. |

#### Properties in `TokenInjectableDockerBuilderProviderProps`

| Property | Type | Required | Description |
|---|---|---|---|
| `queryInterval` | `Duration` | No | How often the provider polls for build completion. Defaults to `Duration.seconds(30)`. To override, call `getOrCreate` explicitly **before** creating any builders. |

#### Instance Properties

| Property | Type | Description |
|---|---|---|
| `serviceToken` | `string` | The service token used by CustomResource instances. |

#### Instance Methods

| Method | Description |
|---|---|
| `registerProject(project, ecrRepo, encryptionKey?)` | Grants the shared Lambdas permission to start builds and access ECR for a specific CodeBuild project. Called automatically by `TokenInjectableDockerBuilder`'s constructor. |

---

### `TokenInjectableDockerBuilder`

#### Parameters

- **`scope`**: The construct's parent scope.
- **`id`**: The construct ID.
- **`props`**: Configuration properties.

#### Properties in `TokenInjectableDockerBuilderProps`

| Property                   | Type                        | Required | Description                                                                                                                                                                                                                                                                                     |
|----------------------------|-----------------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `path`                     | `string`                    | Yes      | The file path to the Dockerfile or source code directory.                                                                                                                                                                                                                                       |
| `buildArgs`                | `{ [key: string]: string }` | No       | Build arguments to pass to the Docker build process. These are transformed into `--build-arg` flags. To use in Dockerfile, leverage the `ARG` keyword. For more details, please see the [official Docker docs](https://docs.docker.com/build/building/variables/).                             |
| `provider`                 | `TokenInjectableDockerBuilderProvider` | No | Shared provider for the custom resource Lambdas. Defaults to the per-stack singleton — `TokenInjectableDockerBuilderProvider.getOrCreate(this)`. Only pass this explicitly when you need a non-default `queryInterval`. |
| `dockerLoginSecretArn`     | `string`                    | No       | ARN of an AWS Secrets Manager secret for Docker credentials. Skips login if not provided.                                                                                                                                                                                                        |
| `vpc`                      | `IVpc`                      | No       | The VPC in which the CodeBuild project will be deployed. If provided, the CodeBuild project will be launched within the specified VPC.                                                                                                                                                           |
| `securityGroups`           | `ISecurityGroup[]`          | No       | The security groups to attach to the CodeBuild project. These should define the network access rules for the CodeBuild project.                                                                                                                                                                  |
| `subnetSelection`          | `SubnetSelection`           | No       | The subnet selection to specify which subnets to use within the VPC. Allows the user to select private, public, or isolated subnets.                                                                                                                                                             |
| `installCommands`          | `string[]`                  | No       | Custom commands to run during the `install` phase of the CodeBuild build process. Will be executed before the Docker image is built. Useful for installing necessary dependencies for running pre-build scripts.                                                                                 |
| `preBuildCommands`         | `string[]`                  | No       | Custom commands to run during the `pre_build` phase of the CodeBuild build process. Will be executed before the Docker image is built. Useful for running pre-build scripts, such as fetching configs.                                                                                           |
| `kmsEncryption`            | `boolean`                   | No       | Whether to enable KMS encryption for the ECR repository. If `true`, a KMS key will be created for encrypting ECR images; otherwise, AES-256 encryption is used. Defaults to `false`.                                                                                                          |
| `exclude`                  | `string[]`                  | No       | A list of file paths in the Docker directory to exclude from the S3 asset bundle. If a `.dockerignore` file is present in the source directory, its contents will be used if this prop is not set. Defaults to an empty list or `.dockerignore` contents.                                    |
| `file`                     | `string`                    | No       | The name of the Dockerfile to use for the build. Passed as `--file` to `docker build`. Useful when a project has multiple Dockerfiles (e.g. `Dockerfile.production`, `Dockerfile.admin`). Defaults to `Dockerfile`.                                                                        |
| `cacheDisabled`           | `boolean`                   | No       | When `true`, disables Docker layer caching. Every build runs from scratch. Use for debugging, corrupted cache, or major dependency changes. Defaults to `false`.                                                                                                                          |
| `platform`                 | `'linux/amd64' \| 'linux/arm64'` | No  | Target platform for the Docker image. When set to `'linux/arm64'`, uses a native ARM/Graviton CodeBuild instance for fast builds without emulation. Defaults to `'linux/amd64'`.                                                                                                      |
| `buildLogGroup`            | `ILogGroup`                 | No       | CloudWatch log group for CodeBuild build logs. When provided with RETAIN removal policy, logs survive rollbacks and stack deletion. If not provided, CodeBuild uses default logging (logs are deleted on rollback).                                                                          |
| `retainBuildLogs`          | `boolean`                   | No       | When `true`, the construct creates a CloudWatch log group at `/docker-builder/<projectName>` **outside** of CloudFormation and routes CodeBuild output there. Because the log group is managed imperatively, it survives stack rollbacks. 7-day retention applies. Defaults to `false`. |
| `ecrPullThroughCachePrefixes` | `string[]`               | No       | ECR pull-through cache repository prefixes to grant pull access to. Use when your Dockerfile references base images from ECR pull-through cache (e.g. `docker-hub/library/node:20-slim`, `ghcr/org/image:tag`). The CodeBuild role is granted `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, and `ecr:BatchCheckLayerAvailability` on repositories matching each prefix. Example: `['docker-hub', 'ghcr']`. Defaults to no pull-through cache access. |
| `replicaRegions`           | `string[]`                  | No       | Additional regions to replicate the image to via ECR's native registry replication. Enables `dockerImageCodeFor(scope, region)` / `containerImageFor(scope, region)` for consumer stacks in those regions. See [Cross-Region Replication](#cross-region-replication) for details and caveats. Defaults to `[]` (no replication). |

#### Instance Properties

| Property | Type | Description |
|---|---|---|
| `containerImage` | `ContainerImage` | An ECS-compatible container image referencing the built Docker image **in the primary region**. |
| `dockerImageCode` | `DockerImageCode` | A Lambda-compatible Docker image code referencing the built Docker image **in the primary region**. |
| `repositoryName` | `string` | The ECR repository name (same name across all replica regions). |
| `imageTag` | `string` | The resolved image tag (CFN token; available at deploy time). |

#### Instance Methods (cross-region)

| Method | Description |
|---|---|
| `containerImageFor(scope, region)` | Returns an ECS `ContainerImage` pointing at the same tag in `region`. Requires the region to be the primary or in `replicaRegions`. |
| `dockerImageCodeFor(scope, region)` | Returns a Lambda `DockerImageCode` pointing at the same tag in `region`. Same constraints as above. |
| `repositoryUriFor(region)` | Returns the regional ECR URI `<account>.dkr.ecr.<region>.amazonaws.com/<repoName>` as a string token. |

---

## Usage Examples

### Multiple Images in One Stack

Builders in the same stack automatically share a single pair of `onEvent` / `isComplete` Lambdas — there is no per-builder Lambda overhead. Just instantiate as many builders as you need.

#### TypeScript/NPM Example

```typescript
import * as cdk from 'aws-cdk-lib';
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export class MultiImageStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Each builder reuses the same per-stack provider automatically.
    const apiBuilder = new TokenInjectableDockerBuilder(this, 'ApiImage', {
      path: './src/api',
    });

    const workerBuilder = new TokenInjectableDockerBuilder(this, 'WorkerImage', {
      path: './src/worker',
    });

    new TokenInjectableDockerBuilder(this, 'FrontendImage', {
      path: './src/frontend',
      buildArgs: { API_URL: 'https://api.example.com' },
      platform: 'linux/arm64', // Build natively on Graviton
    });

    // Use in ECS task definitions
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef');
    taskDef.addContainer('api', { image: apiBuilder.containerImage });
    taskDef.addContainer('worker', { image: workerBuilder.containerImage });
  }
}
```

#### Python Example

```python
from aws_cdk import aws_ecs as ecs, core as cdk
from token_injectable_docker_builder import TokenInjectableDockerBuilder

class MultiImageStack(cdk.Stack):
    def __init__(self, scope: cdk.App, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        # Each builder reuses the same per-stack provider automatically.
        api_builder = TokenInjectableDockerBuilder(self, "ApiImage",
            path="./src/api",
        )

        worker_builder = TokenInjectableDockerBuilder(self, "WorkerImage",
            path="./src/worker",
        )

        TokenInjectableDockerBuilder(self, "FrontendImage",
            path="./src/frontend",
            build_args={"API_URL": "https://api.example.com"},
        )
```

#### Overriding `queryInterval`

If you need to tune how often the provider polls for build completion, create the provider singleton explicitly **before** instantiating any builders:

```typescript
import { Duration } from 'aws-cdk-lib';
import {
  TokenInjectableDockerBuilder,
  TokenInjectableDockerBuilderProvider,
} from 'token-injectable-docker-builder';

const provider = TokenInjectableDockerBuilderProvider.getOrCreate(this, {
  queryInterval: Duration.seconds(15),
});

new TokenInjectableDockerBuilder(this, 'ApiImage', {
  path: './src/api',
  provider, // optional — the builder would resolve the same singleton anyway
});
```

### Simple Usage Example

This example demonstrates the basic usage of the `TokenInjectableDockerBuilder`, where a Next.js frontend Docker image requires an API Gateway URL as a build argument to create a reference from the UI to the associated API in a given deployment.

#### TypeScript/NPM Example

```typescript
import * as cdk from 'aws-cdk-lib';
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class SimpleStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create your API Gateway
    const api = new apigateway.RestApi(this, 'MyApiGateway', {
      restApiName: 'MyService',
    });

    // Create the Docker builder
    const dockerBuilder = new TokenInjectableDockerBuilder(this, 'SimpleDockerBuilder', {
      path: './nextjs-app', // Path to your Next.js app Docker context
      buildArgs: {
        API_URL: api.url, // Pass the API Gateway URL as a build argument
      },
    });

    // Use in ECS
    const cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: new ec2.Vpc(this, 'Vpc'),
    });

    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: new ecs.FargateTaskDefinition(this, 'TaskDef', {
        cpu: 512,
        memoryLimitMiB: 1024,
      }).addContainer('Container', {
        image: dockerBuilder.containerImage,
        logging: ecs.LogDriver.awsLogs({ streamPrefix: 'MyApp' }),
      }),
    });

    service.node.addDependency(dockerBuilder);
  }
}
```

#### Python Example

```python
from aws_cdk import (
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_apigateway as apigateway,
    Duration,
    core as cdk,
)
from token_injectable_docker_builder import TokenInjectableDockerBuilder

class SimpleStack(cdk.Stack):

    def __init__(self, scope: cdk.App, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        # Create your API Gateway
        api = apigateway.RestApi(self, "MyApiGateway",
            rest_api_name="MyService",
        )

        # Create the Docker builder
        docker_builder = TokenInjectableDockerBuilder(self, "SimpleDockerBuilder",
            path="./nextjs-app",  # Path to your Next.js app Docker context
            build_args={
                "API_URL": api.url,  # Pass the API Gateway URL as a build argument
            },
        )

        # Use in ECS
        vpc = ec2.Vpc(self, "Vpc")
        cluster = ecs.Cluster(self, "EcsCluster", vpc=vpc)

        task_definition = ecs.FargateTaskDefinition(self, "TaskDef",
            cpu=512,
            memory_limit_mib=1024,
        )

        task_definition.node.add_dependency(docker_builder)

        task_definition.add_container("Container",
            image=docker_builder.container_image,
            logging=ecs.LogDriver.aws_logs(stream_prefix="MyApp"),
        )

        ecs.FargateService(self, "FargateService",
            cluster=cluster,
            task_definition=task_definition,
        )
```

---

### Advanced Usage Example

Building on the previous example, this advanced usage demonstrates how to include additional configurations, such as fetching private API endpoints and configuration files during the build process.

#### TypeScript/NPM Example

```typescript
import * as cdk from 'aws-cdk-lib';
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class AdvancedStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create your API Gateway
    const api = new apigateway.RestApi(this, 'MyApiGateway', {
      restApiName: 'MyService',
    });

    // VPC and Security Group for CodeBuild
    const vpc = new ec2.Vpc(this, 'MyVpc');
    const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
      vpc,
    });

    // Create the Docker builder with additional pre-build commands
    const dockerBuilder = new TokenInjectableDockerBuilder(this, 'AdvancedDockerBuilder', {
      path: './nextjs-app',
      buildArgs: {
        API_URL: api.url,
      },
      vpc,
      securityGroups: [securityGroup],
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      installCommands: [
        'echo "Updating package lists..."',
        'apt-get update -y',
        'echo "Installing necessary packages..."',
        'apt-get install -y curl',
      ],
      preBuildCommands: [
        'echo "Fetching private API configuration..."',
        // Replace with your actual command to fetch configs
        'curl -o config.json https://internal-api.example.com/config',
      ],
    });

    // Use in ECS
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: new ecs.FargateTaskDefinition(this, 'TaskDef', {
        cpu: 512,
        memoryLimitMiB: 1024,
      }).addContainer('Container', {
        image: dockerBuilder.containerImage,
        logging: ecs.LogDriver.awsLogs({ streamPrefix: 'MyApp' }),
      }),
    });

    service.node.addDependency(dockerBuilder);
  }
}
```

#### Python Example

```python
from aws_cdk import (
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_apigateway as apigateway,
    Duration,
    core as cdk,
)
from token_injectable_docker_builder import TokenInjectableDockerBuilder

class AdvancedStack(cdk.Stack):

    def __init__(self, scope: cdk.App, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)

        # Create your API Gateway
        api = apigateway.RestApi(self, "MyApiGateway",
            rest_api_name="MyService",
        )

        # VPC and Security Group for CodeBuild
        vpc = ec2.Vpc(self, "MyVpc")
        security_group = ec2.SecurityGroup(self, "MySecurityGroup", vpc=vpc)

        # Create the Docker builder with additional pre-build commands
        docker_builder = TokenInjectableDockerBuilder(self, "AdvancedDockerBuilder",
            path="./nextjs-app",
            build_args={
                "API_URL": api.url,
            },
            vpc=vpc,
            security_groups=[security_group],
            subnet_selection=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            install_commands=[
                'echo "Updating package lists..."',
                'apt-get update -y',
                'echo "Installing necessary packages..."',
                'apt-get install -y curl',
            ],
            pre_build_commands=[
                'echo "Fetching private API configuration..."',
                # Replace with your actual command to fetch configs
                'curl -o config.json https://internal-api.example.com/config',
            ],
        )

        # Use in ECS
        cluster = ecs.Cluster(self, "EcsCluster", vpc=vpc)

        task_definition = ecs.FargateTaskDefinition(self, "TaskDef",
            cpu=512,
            memory_limit_mib=1024,
        )

        task_definition.node.add_dependency(docker_builder)

        task_definition.add_container("Container",
            image=docker_builder.container_image,
            logging=ecs.LogDriver.aws_logs(stream_prefix="MyApp"),
        )

        ecs.FargateService(self, "FargateService",
            cluster=cluster,
            task_definition=task_definition,
        )
```

### ECR Pull-Through Cache Example

When your Dockerfile uses base images from an ECR pull-through cache (e.g. to avoid Docker Hub rate limits), pass `ecrPullThroughCachePrefixes` so the CodeBuild role can pull those images:

```typescript
import * as cdk from 'aws-cdk-lib';
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class PullThroughCacheStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const node20Slim = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/docker-hub/library/node:20-slim`;

    const apiImage = new TokenInjectableDockerBuilder(this, 'ApiImage', {
      path: './src',
      file: 'api/Dockerfile',
      platform: 'linux/arm64',
      buildArgs: { NODE_20_SLIM: node20Slim },
      ecrPullThroughCachePrefixes: ['docker-hub', 'ghcr'],
    });

    new lambda.DockerImageFunction(this, 'ApiLambda', {
      code: apiImage.dockerImageCode,
      architecture: lambda.Architecture.ARM_64,
    });
  }
}
```

---

In this advanced example:

- **VPC Configuration**: The CodeBuild project is configured to run inside a VPC with specified security groups and subnet selection, allowing it to access internal resources such as a private API endpoint.
- **Custom Install and Pre-Build Commands**: The `installCommands` and `preBuildCommands` properties are used to install necessary packages and fetch configuration files from a private API before building the Docker image.
- **Access to Internal APIs**: By running inside a VPC and configuring the security groups appropriately, the CodeBuild project can access private endpoints not accessible over the public internet.

---

### Cross-Region Replication

Set `replicaRegions` to make the built image available in additional regions, then reference it from a consumer stack in any of those regions.

```typescript
import * as cdk from 'aws-cdk-lib';
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder';
import * as lambda from 'aws-cdk-lib/aws-lambda';

const app = new cdk.App();

// Builder stack — us-east-1
const builderStack = new cdk.Stack(app, 'BuilderStack', {
  env: { account: '123456789012', region: 'us-east-1' },
  crossRegionReferences: true,
});

const apiImage = new TokenInjectableDockerBuilder(builderStack, 'ApiImage', {
  path: './src/api',
  replicaRegions: ['us-west-2', 'eu-west-1'],
});

// Consumer stack — us-west-2
const consumerStack = new cdk.Stack(app, 'ConsumerStack', {
  env: { account: '123456789012', region: 'us-west-2' },
  crossRegionReferences: true,
});

new lambda.DockerImageFunction(consumerStack, 'ApiLambda', {
  code: apiImage.dockerImageCodeFor(consumerStack, 'us-west-2'),
});
```

**How it works**

1. The builder pushes to its primary-region ECR repository as usual.
2. The provider singleton manages a single registry-replication custom resource that calls `PutReplicationConfiguration` with merged rules (one rule per unique destination set, filtered to each managed repository name).
3. ECR asynchronously replicates the image to every region in `replicaRegions`. Most images replicate in under 30 minutes; rare cases take longer.
4. The build's `isComplete` Lambda polls each replica region's ECR via `BatchGetImage` and only returns `IsComplete=true` once every replica has the tag. The Provider's `totalTimeout` is bumped to 1 hour to accommodate replication lag.
5. The consumer stack's `dockerImageCodeFor` / `containerImageFor` imports the replicated repository by name in the consumer's region and references the tag via CDK's cross-region SSM mechanism.

**Caveats to read before enabling**

- **Stacks must have a concrete `env`**: env-agnostic stacks (where `region` is a token) don't work with `crossRegionReferences`. Pass `env: { account, region }` explicitly on both builder and consumer stacks.
- **Replicas don't inherit settings**: ECR replication does NOT copy encryption (KMS), lifecycle policies, or repository policies. Replicated repos default to AES-256 encryption with no lifecycle rules. If you need stricter replica configuration, set up [ECR repository creation templates](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-creation-templates.html) separately.
- **Replicas persist on stack delete**: AWS does NOT auto-delete replicated repositories when the source replication rule is removed. After `cdk destroy`, manually delete leftover repos: `aws ecr delete-repository --region <replica> --repository-name <name> --force`.
- **Registry-level limits enforced at synth time**: ECR allows 10 rules per registry and 25 unique destinations across all rules per AWS account. The construct enforces both caps **at synth time** — `cdk synth` will throw a clear error if the union of `replicaRegions` across all builders in the stack would exceed either limit, instead of failing at deploy time inside the replication CR. Rule-grouping by destination set keeps you under the 10-rules cap until you have more than 10 *distinct* destination sets (e.g. ten builders each replicating to a different single region). Note that this is a best-effort check: rules created outside this construct (other stacks, manual setup) aren't visible at synth time, so the runtime API can still surface them.
- **Cross-partition is unsupported**: e.g. `us-east-1` → `cn-north-1` won't work. The construct will throw at synth time when both partition values are concrete and differ.
- **Replication latency**: deploys can extend by up to ~30 min in rare cases while `isComplete` waits for replicas. The CDK Provider framework caps `totalTimeout` at 2 hours.

---

## How It Works

1. **Docker Source**: Packages the source code or Dockerfile specified in the `path` property as an S3 asset.
2. **CodeBuild Project**:
   - Uses the packaged asset and `buildArgs` to build the Docker image.
   - Executes any custom `installCommands` and `preBuildCommands` during the build process.
   - Pushes the image to an ECR repository.
   - By default, uses `docker buildx` with ECR registry cache to speed up builds.
3. **Custom Resource** (one pair of Lambdas per stack):
   - Triggers the build using `onEvent`.
   - Monitors build status using `isComplete`, polling at the interval set on the provider singleton (defaults to 30 seconds; override via `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })`).
   - The same Lambda pair handles every builder in the stack — they are not duplicated per builder.
4. **Outputs**:
   - `.containerImage`: Returns the Docker image for ECS.
   - `.dockerImageCode`: Returns the Docker image code for Lambda.

### Resource Comparison

The provider singleton means a stack's Lambda overhead is fixed — adding more builders only adds CodeBuild projects and ECR repositories.

| Scenario | Lambdas (total) | CodeBuild Projects | ECR Repos |
|---|---|---|---|
| 1 image | 5 (2 user + 3 framework) | 1 | 1 |
| 5 images | 5 | 5 | 5 |
| 10 images | 5 | 10 | 10 |

The 3 framework Lambdas are CDK's [`Provider`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources.Provider.html) framework internals (`framework.onEvent`, `framework.isComplete`, `framework.onTimeout`).

---

## IAM Permissions

The construct automatically grants permissions for:

- **CodeBuild**:
  - Pull and push images to ECR.
  - Pull from ECR pull-through cache prefixes when `ecrPullThroughCachePrefixes` is provided (e.g. `['docker-hub', 'ghcr']`).
  - Access to AWS Secrets Manager if `dockerLoginSecretArn` is provided.
  - Access to the KMS key for encryption.
- **Shared Provider Lambdas** (one pair per stack):
  - Start and monitor CodeBuild builds.
  - Access CloudWatch Logs.
  - Access to the KMS key for encryption.
  - Pull and push images to ECR.

Every new builder calls `provider.registerProject()` under the hood, incrementally adding `codebuild:StartBuild` for its project ARN and `ecr:PullPush` for its repository.

---

## Notes

- **Provider Singleton**: One pair of `onEvent` / `isComplete` Lambdas is created the first time a builder is instantiated in a stack and reused by every subsequent builder in the same stack. You generally do not need to touch `TokenInjectableDockerBuilderProvider` directly — only call `getOrCreate` yourself if you want to change `queryInterval`.
- **Build Arguments**: Pass custom arguments via `buildArgs` as `--build-arg` flags. CDK tokens can be used to inject dynamic values resolved at deployment time.
- **Custom Commands**: Use `installCommands` and `preBuildCommands` to run custom shell commands during the build process. This can be useful for installing dependencies or fetching configuration files.
- **VPC Configuration**: If your build process requires access to resources within a VPC, you can specify the VPC, security groups, and subnet selection.
- **Docker Login**: If you need to log in to a private Docker registry before building the image, provide the ARN of a secret in AWS Secrets Manager containing the Docker credentials.
- **ECR Retention (safe by default)**: Tagged images are kept indefinitely; untagged images are removed after 30 days. There is no count-based expiration — Lambda pins images by digest internally and count-based deletion would silently remove an image that an in-use Lambda is still pinned to, breaking the next config update with `Image ID cannot be found`.
- **Build Query Interval**: Tune polling frequency with `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })`. Call this **before** instantiating any builders, otherwise the builder will create the singleton with the default 30 second interval.
- **Custom Dockerfile**: Use the `file` property to specify a Dockerfile other than the default `Dockerfile`. This is passed as the `--file` flag to `docker build`.
- **Docker Layer Caching**: By default, builds use ECR as a remote cache backend (via `docker buildx`), which can reduce build times by up to 25%. Set `cacheDisabled: true` when you need a clean build—for example, when debugging, the cache is corrupted, or after major dependency upgrades.
- **Platform / Architecture**: Set `platform: 'linux/arm64'` to build ARM64/Graviton images using a native ARM CodeBuild instance. Defaults to `'linux/amd64'` (x86_64). Native builds are faster and cheaper than cross-compilation with QEMU.
- **Build Log Retention**: Pass `buildLogGroup` with a log group that has RETAIN removal policy, or set `retainBuildLogs: true` to let the construct manage a `/docker-builder/<projectName>` log group imperatively (survives rollbacks; 7-day retention).
- **ECR Pull-Through Cache**: When using ECR pull-through cache for base images (e.g. to avoid Docker Hub rate limits), pass `ecrPullThroughCachePrefixes: ['docker-hub', 'ghcr']` so the CodeBuild role can pull from those cached repositories. Your ECR registry must have a pull-through cache rule and registry policy configured separately.

### Migrating from v1

**Recipe for the common case** (you're on `^1.x` and want to move to `^2.x`):

```bash
npm install token-injectable-docker-builder@^2
```

That's the entire required code change for most users. The construct handles the CFN-level migration internally.

**What happens on the first `cdk deploy` after upgrading:**

1. Every `BuildTriggerResource` in your stack is **replaced** by `BuildTriggerResourceV2`. CFN does this because the construct deliberately renames its internal custom resource between v1 and v2 — this is what sidesteps CFN's `Modifying service token is not allowed` rule when the CR's serviceToken changes from v1's per-instance provider to v2's singleton provider. **Without this rename, the upgrade would fail at the CFN level for users who didn't pass `provider` explicitly in v1.**
2. Each replacement triggers **one fresh CodeBuild run per builder** (5–10 min each in parallel). Image tags transition from v1's random-UUID style to v2's deterministic-hash style.
3. Downstream `DockerImageFunction` / `FargateTaskDefinition` resources update in place to the new tag. Lambda's blue/green update is transparent; ECS does a normal rolling deploy.
4. v1's per-instance `OnEventHandlerFunction` / `IsCompleteHandlerFunction` / `CustomResourceProvider` Lambdas (one set per builder) are deleted. The singleton at `<Stack>/TokenInjectableDockerBuilderProvider/...` is the only provider left.
5. ECR repositories keep their logical IDs and contents — **no images are lost**.

**Behavior changes that come for free (no code edit needed):**

- ECR retention switches from "keep 3 tagged images" (v1 default with `maxImageCount: 3`) to "keep all tagged images, untagged-after-30-days only". v1's count-based expiration could silently delete an image a Lambda was pinned to.
- `imageTag` is now a deterministic SHA-256 hash of all build inputs. v1 regenerated a UUID on every synth, causing a build on every deploy; v2 only rebuilds when source / buildArgs / platform / commands actually change.

**Breaking changes that may require a source edit:**

- **`completenessQueryInterval`** was removed from `TokenInjectableDockerBuilderProps`. If you set it, move the value to `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })` (call before any builder; it now applies stack-wide). If you didn't set it, no edit needed.
- **`maxImageCount`** was removed entirely. If you set it, just delete the prop from your builder props (no replacement; the behavior is now non-configurable).

**This migration path is exercised end-to-end by `npm run integ-migration`** — see `test/migration/before-v1.ts` and `test/migration/after-v2.ts` for the executable recipe. The literal source-code diff between the two files is the import path; everything else is identical.

---

## Troubleshooting

1. **Build Errors**: Check the CodeBuild logs in CloudWatch Logs for detailed error messages. If you pass `buildLogGroup` with RETAIN removal policy, or set `retainBuildLogs: true`, logs persist even after rollbacks. Otherwise, logs are deleted when the CodeBuild project is removed during rollback.
2. **Lambda Errors**: Check the singleton `onEvent` and `isComplete` Lambda function logs in CloudWatch Logs (under `TokenInjectableDockerBuilderProvider/...`). All builders in the stack flow through the same Lambdas — filter by `ProjectName` in the logs to isolate a specific builder.
3. **"Image manifest, config or layer media type not supported" (Lambda)**: Docker Buildx v0.10+ adds provenance attestations by default, producing OCI image indexes that Lambda rejects. This construct disables them with `--provenance=false --sbom=false` so images are Lambda-compatible. If you see this error, ensure you're using a recent version of the construct.
4. **Permissions**: Ensure IAM roles have the required permissions for CodeBuild, ECR, Secrets Manager, and KMS if applicable. `registerProject()` is called automatically by the builder's constructor — you do not need to call it manually.
5. **Network Access**: If the build requires network access (e.g., to download dependencies or access internal APIs), ensure that the VPC configuration allows necessary network connectivity, and adjust security group rules accordingly.

---

## Support

For issues or feature requests, please open an issue on [GitHub](https://github.com/AlexTech314/TokenInjectableDockerBuilder).

---

## Reference Links

[![View on Construct Hub](https://constructs.dev/badge?package=token-injectable-docker-builder)](https://constructs.dev/packages/token-injectable-docker-builder)

---

## License

This project is licensed under the terms of the MIT license.

---

## Acknowledgements

- Inspired by the need for more dynamic Docker asset management in AWS CDK.
- Thanks to the AWS CDK community for their continuous support and contributions.

---

Feel free to reach out if you have any questions or need further assistance!
