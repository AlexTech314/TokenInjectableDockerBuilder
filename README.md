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
- **Custom Install and Pre-Build Commands**: Allows specifying custom commands to run during the `install` and `pre_build` phases of the CodeBuild build process.
- **VPC Configuration**: Supports deploying the CodeBuild project within a VPC, with customizable security groups and subnet selection.
- **Docker Login**: Supports Docker login using credentials stored in AWS Secrets Manager.
- **ECR Repository Management**: Creates an ECR repository with lifecycle rules and encryption.
- **Integration with ECS and Lambda**: Provides outputs for use in AWS ECS and AWS Lambda.
- **Custom Build Query Interval**: Configure how frequently the custom resource polls for build completion using the `completenessQueryInterval` property (defaults to 30 seconds).
- **Custom Dockerfile**: Specify a custom Dockerfile name via the `file` property (e.g. `Dockerfile.production`), allowing multiple Docker images from the same source directory.
- **ECR Docker Layer Caching**: By default, builds use `docker buildx` with ECR as a remote cache backend, reducing build times by reusing layers across deploys. Set `cacheDisabled: true` to force a clean build from scratch.
- **Persistent Build Logs**: Pass `buildLogGroup` with a log group that has RETAIN removal policy so build logs survive rollbacks and stack deletion for debugging.

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

## Constructor

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
| `dockerLoginSecretArn`     | `string`                    | No       | ARN of an AWS Secrets Manager secret for Docker credentials. Skips login if not provided.                                                                                                                                                                                                        |
| `vpc`                      | `IVpc`                      | No       | The VPC in which the CodeBuild project will be deployed. If provided, the CodeBuild project will be launched within the specified VPC.                                                                                                                                                           |
| `securityGroups`           | `ISecurityGroup[]`          | No       | The security groups to attach to the CodeBuild project. These should define the network access rules for the CodeBuild project.                                                                                                                                                                  |
| `subnetSelection`          | `SubnetSelection`           | No       | The subnet selection to specify which subnets to use within the VPC. Allows the user to select private, public, or isolated subnets.                                                                                                                                                             |
| `installCommands`          | `string[]`                  | No       | Custom commands to run during the `install` phase of the CodeBuild build process. Will be executed before the Docker image is built. Useful for installing necessary dependencies for running pre-build scripts.                                                                                 |
| `preBuildCommands`         | `string[]`                  | No       | Custom commands to run during the `pre_build` phase of the CodeBuild build process. Will be executed before the Docker image is built. Useful for running pre-build scripts, such as fetching configs.                                                                                           |
| `kmsEncryption`            | `boolean`                   | No       | Whether to enable KMS encryption for the ECR repository. If `true`, a KMS key will be created for encrypting ECR images; otherwise, AES-256 encryption is used. Defaults to `false`.                                                                                                          |
| `completenessQueryInterval`| `Duration`                  | No       | The query interval for checking if the CodeBuild project has completed. This determines how frequently the custom resource polls for build completion. Defaults to `Duration.seconds(30)`.                                                                                                   |
| `exclude`                  | `string[]`                  | No       | A list of file paths in the Docker directory to exclude from the S3 asset bundle. If a `.dockerignore` file is present in the source directory, its contents will be used if this prop is not set. Defaults to an empty list or `.dockerignore` contents.                                    |
| `file`                     | `string`                    | No       | The name of the Dockerfile to use for the build. Passed as `--file` to `docker build`. Useful when a project has multiple Dockerfiles (e.g. `Dockerfile.production`, `Dockerfile.admin`). Defaults to `Dockerfile`.                                                                        |
| `cacheDisabled`           | `boolean`                   | No       | When `true`, disables Docker layer caching. Every build runs from scratch. Use for debugging, corrupted cache, or major dependency changes. Defaults to `false`.                                                                                                                          |
| `buildLogGroup`            | `ILogGroup`                 | No       | CloudWatch log group for CodeBuild build logs. When provided with RETAIN removal policy, logs survive rollbacks and stack deletion. If not provided, CodeBuild uses default logging (logs are deleted on rollback).                                                                          |

---

## Usage Examples

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
      // Optionally override the default completeness query interval:
      // completenessQueryInterval: cdk.Duration.seconds(45),
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
            # Optionally override the default completeness query interval:
            # completeness_query_interval=Duration.seconds(45)
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
      // Optionally override the default completeness query interval:
      // completenessQueryInterval: cdk.Duration.seconds(45),
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
            # Optionally override the default completeness query interval:
            # completeness_query_interval=Duration.seconds(45)
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

In this advanced example:

- **VPC Configuration**: The CodeBuild project is configured to run inside a VPC with specified security groups and subnet selection, allowing it to access internal resources such as a private API endpoint.
- **Custom Install and Pre-Build Commands**: The `installCommands` and `preBuildCommands` properties are used to install necessary packages and fetch configuration files from a private API before building the Docker image.
- **Access to Internal APIs**: By running inside a VPC and configuring the security groups appropriately, the CodeBuild project can access private endpoints not accessible over the public internet.

---

## How It Works

1. **Docker Source**: Packages the source code or Dockerfile specified in the `path` property as an S3 asset.
2. **CodeBuild Project**:
   - Uses the packaged asset and `buildArgs` to build the Docker image.
   - Executes any custom `installCommands` and `preBuildCommands` during the build process.
   - Pushes the image to an ECR repository.
3. **Custom Resource**:
   - Triggers the build process using a Lambda function (`onEvent`).
   - Monitors the build status using another Lambda function (`isComplete`) which polls at the interval specified by `completenessQueryInterval` (defaulting to 30 seconds if not provided).
4. **Outputs**:
   - `.containerImage`: Returns the Docker image for ECS.
   - `.dockerImageCode`: Returns the Docker image code for Lambda.

---

## IAM Permissions

The construct automatically grants permissions for:

- **CodeBuild**:
  - Pull and push images to ECR.
  - Access to AWS Secrets Manager if `dockerLoginSecretArn` is provided.
  - Access to the KMS key for encryption.
- **Lambda Functions**:
  - Start and monitor CodeBuild builds.
  - Access CloudWatch Logs.
  - Access to the KMS key for encryption.
  - Pull and push images to ECR.

---

## Notes

- **Build Arguments**: Pass custom arguments via `buildArgs` as `--build-arg` flags. CDK tokens can be used to inject dynamic values resolved at deployment time.
- **Custom Commands**: Use `installCommands` and `preBuildCommands` to run custom shell commands during the build process. This can be useful for installing dependencies or fetching configuration files.
- **VPC Configuration**: If your build process requires access to resources within a VPC, you can specify the VPC, security groups, and subnet selection.
- **Docker Login**: If you need to log in to a private Docker registry before building the image, provide the ARN of a secret in AWS Secrets Manager containing the Docker credentials.
- **ECR Repository**: Automatically creates an ECR repository with lifecycle rules to manage image retention, encryption with a KMS key, and image scanning on push.
- **Build Query Interval**: The polling frequency for checking build completion can be customized via the `completenessQueryInterval` property.
- **Custom Dockerfile**: Use the `file` property to specify a Dockerfile other than the default `Dockerfile`. This is passed as the `--file` flag to `docker build`.
- **Docker Layer Caching**: By default, builds use ECR as a remote cache backend (via `docker buildx`), which can reduce build times by up to 25%. Set `cacheDisabled: true` when you need a clean build—for example, when debugging, the cache is corrupted, or after major dependency upgrades.
- **Build Log Retention**: Pass `buildLogGroup` with a log group that has RETAIN removal policy to ensure build logs survive CloudFormation rollbacks and stack deletion.

---

## Troubleshooting

1. **Build Errors**: Check the CodeBuild logs in CloudWatch Logs for detailed error messages. If you pass `buildLogGroup` with RETAIN removal policy, logs persist even after rollbacks. Otherwise, logs are deleted when the CodeBuild project is removed during rollback.
2. **Lambda Errors**: Check the `onEvent` and `isComplete` Lambda function logs in CloudWatch Logs.
3. **Permissions**: Ensure IAM roles have the required permissions for CodeBuild, ECR, Secrets Manager, and KMS if applicable.
4. **Network Access**: If the build requires network access (e.g., to download dependencies or access internal APIs), ensure that the VPC configuration allows necessary network connectivity, and adjust security group rules accordingly.

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
