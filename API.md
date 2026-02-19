# API Reference <a name="API Reference" id="api-reference"></a>

## Constructs <a name="Constructs" id="Constructs"></a>

### TokenInjectableDockerBuilder <a name="TokenInjectableDockerBuilder" id="token-injectable-docker-builder.TokenInjectableDockerBuilder"></a>

A CDK construct to build and push Docker images to an ECR repository using CodeBuild and Lambda custom resources, **then** retrieve the final image tag so that ECS/Lambda references use the exact digest.

#### Initializers <a name="Initializers" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer"></a>

```typescript
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder'

new TokenInjectableDockerBuilder(scope: Construct, id: string, props: TokenInjectableDockerBuilderProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | The scope in which to define this construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.id">id</a></code> | <code>string</code> | The scoped construct ID. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.props">props</a></code> | <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps">TokenInjectableDockerBuilderProps</a></code> | Configuration for building and pushing the Docker image. |

---

##### `scope`<sup>Required</sup> <a name="scope" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

The scope in which to define this construct.

---

##### `id`<sup>Required</sup> <a name="id" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.id"></a>

- *Type:* string

The scoped construct ID.

---

##### `props`<sup>Required</sup> <a name="props" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.props"></a>

- *Type:* <a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps">TokenInjectableDockerBuilderProps</a>

Configuration for building and pushing the Docker image.

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.toString">toString</a></code> | Returns a string representation of this construct. |

---

##### `toString` <a name="toString" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### ~~`isConstruct`~~ <a name="isConstruct" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct"></a>

```typescript
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder'

TokenInjectableDockerBuilder.isConstruct(x: any)
```

Checks if `x` is a construct.

###### `x`<sup>Required</sup> <a name="x" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.containerImage">containerImage</a></code> | <code>aws-cdk-lib.aws_ecs.ContainerImage</code> | An ECS-compatible container image referencing the tag of the built Docker image. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.dockerImageCode">dockerImageCode</a></code> | <code>aws-cdk-lib.aws_lambda.DockerImageCode</code> | A Lambda-compatible DockerImageCode referencing the tag of the built Docker image. |

---

##### `node`<sup>Required</sup> <a name="node" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `containerImage`<sup>Required</sup> <a name="containerImage" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.containerImage"></a>

```typescript
public readonly containerImage: ContainerImage;
```

- *Type:* aws-cdk-lib.aws_ecs.ContainerImage

An ECS-compatible container image referencing the tag of the built Docker image.

---

##### `dockerImageCode`<sup>Required</sup> <a name="dockerImageCode" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.dockerImageCode"></a>

```typescript
public readonly dockerImageCode: DockerImageCode;
```

- *Type:* aws-cdk-lib.aws_lambda.DockerImageCode

A Lambda-compatible DockerImageCode referencing the tag of the built Docker image.

---


## Structs <a name="Structs" id="Structs"></a>

### TokenInjectableDockerBuilderProps <a name="TokenInjectableDockerBuilderProps" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps"></a>

Properties for the `TokenInjectableDockerBuilder` construct.

#### Initializer <a name="Initializer" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.Initializer"></a>

```typescript
import { TokenInjectableDockerBuilderProps } from 'token-injectable-docker-builder'

const tokenInjectableDockerBuilderProps: TokenInjectableDockerBuilderProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.path">path</a></code> | <code>string</code> | The path to the directory containing the Dockerfile or source code. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.buildArgs">buildArgs</a></code> | <code>{[ key: string ]: string}</code> | Build arguments to pass to the Docker build process. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.completenessQueryInterval">completenessQueryInterval</a></code> | <code>aws-cdk-lib.Duration</code> | The query interval for checking if the CodeBuild project has completed. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.dockerLoginSecretArn">dockerLoginSecretArn</a></code> | <code>string</code> | The ARN of the AWS Secrets Manager secret containing Docker login credentials. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.exclude">exclude</a></code> | <code>string[]</code> | A list of file paths in the Docker directory to exclude from build. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.file">file</a></code> | <code>string</code> | The name of the Dockerfile to use for the build. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.installCommands">installCommands</a></code> | <code>string[]</code> | Custom commands to run during the install phase of CodeBuild. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.kmsEncryption">kmsEncryption</a></code> | <code>boolean</code> | Whether to enable KMS encryption for the ECR repository. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.preBuildCommands">preBuildCommands</a></code> | <code>string[]</code> | Custom commands to run during the pre_build phase of CodeBuild. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.securityGroups">securityGroups</a></code> | <code>aws-cdk-lib.aws_ec2.ISecurityGroup[]</code> | The security groups to attach to the CodeBuild project. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.subnetSelection">subnetSelection</a></code> | <code>aws-cdk-lib.aws_ec2.SubnetSelection</code> | The subnet selection to specify which subnets to use within the VPC. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.vpc">vpc</a></code> | <code>aws-cdk-lib.aws_ec2.IVpc</code> | The VPC in which the CodeBuild project will be deployed. |

---

##### `path`<sup>Required</sup> <a name="path" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.path"></a>

```typescript
public readonly path: string;
```

- *Type:* string

The path to the directory containing the Dockerfile or source code.

---

##### `buildArgs`<sup>Optional</sup> <a name="buildArgs" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.buildArgs"></a>

```typescript
public readonly buildArgs: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}

Build arguments to pass to the Docker build process.

These are transformed into `--build-arg KEY=VALUE` flags.

---

*Example*

```typescript
{
  TOKEN: 'my-secret-token',
  ENV: 'production'
}
```


##### `completenessQueryInterval`<sup>Optional</sup> <a name="completenessQueryInterval" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.completenessQueryInterval"></a>

```typescript
public readonly completenessQueryInterval: Duration;
```

- *Type:* aws-cdk-lib.Duration
- *Default:* Duration.seconds(30)

The query interval for checking if the CodeBuild project has completed.

This determines how frequently the custom resource polls for build completion.

---

##### `dockerLoginSecretArn`<sup>Optional</sup> <a name="dockerLoginSecretArn" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.dockerLoginSecretArn"></a>

```typescript
public readonly dockerLoginSecretArn: string;
```

- *Type:* string

The ARN of the AWS Secrets Manager secret containing Docker login credentials.

This secret should store a JSON object with the following structure:
```json
{
  "username": "my-docker-username",
  "password": "my-docker-password"
}
```
If not provided (or not needed), the construct will skip Docker Hub login.

**Note**: The secret must be in the same region as the stack.

---

*Example*

```typescript
'arn:aws:secretsmanager:us-east-1:123456789012:secret:DockerLoginSecret'
```


##### `exclude`<sup>Optional</sup> <a name="exclude" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.exclude"></a>

```typescript
public readonly exclude: string[];
```

- *Type:* string[]
- *Default:* No file path exclusions

A list of file paths in the Docker directory to exclude from build.

Will use paths in .dockerignore file if present.

---

##### `file`<sup>Optional</sup> <a name="file" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.file"></a>

```typescript
public readonly file: string;
```

- *Type:* string
- *Default:* 'Dockerfile'

The name of the Dockerfile to use for the build.

Passed as `--file` to `docker build`.

---

*Example*

```typescript
'Dockerfile.production'
```


##### `installCommands`<sup>Optional</sup> <a name="installCommands" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.installCommands"></a>

```typescript
public readonly installCommands: string[];
```

- *Type:* string[]
- *Default:* No additional install commands.

Custom commands to run during the install phase of CodeBuild.

**Example**:
```ts
installCommands: [
  'echo "Updating package lists..."',
  'apt-get update -y',
  'echo "Installing required packages..."',
  'apt-get install -y curl dnsutils',
],
```

---

##### `kmsEncryption`<sup>Optional</sup> <a name="kmsEncryption" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.kmsEncryption"></a>

```typescript
public readonly kmsEncryption: boolean;
```

- *Type:* boolean
- *Default:* false

Whether to enable KMS encryption for the ECR repository.

If `true`, a KMS key will be created for encrypting ECR images.
If `false`, the repository will use AES-256 encryption.

---

##### `preBuildCommands`<sup>Optional</sup> <a name="preBuildCommands" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.preBuildCommands"></a>

```typescript
public readonly preBuildCommands: string[];
```

- *Type:* string[]
- *Default:* No additional pre-build commands.

Custom commands to run during the pre_build phase of CodeBuild.

**Example**:
```ts
preBuildCommands: [
  'echo "Fetching configuration from private API..."',
  'curl -o config.json https://api.example.com/config',
],
```

---

##### `securityGroups`<sup>Optional</sup> <a name="securityGroups" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.securityGroups"></a>

```typescript
public readonly securityGroups: ISecurityGroup[];
```

- *Type:* aws-cdk-lib.aws_ec2.ISecurityGroup[]
- *Default:* No security groups are attached.

The security groups to attach to the CodeBuild project.

These define the network access rules for the CodeBuild project.

---

##### `subnetSelection`<sup>Optional</sup> <a name="subnetSelection" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.subnetSelection"></a>

```typescript
public readonly subnetSelection: SubnetSelection;
```

- *Type:* aws-cdk-lib.aws_ec2.SubnetSelection
- *Default:* All subnets in the VPC are used.

The subnet selection to specify which subnets to use within the VPC.

Allows the user to select private, public, or isolated subnets.

---

##### `vpc`<sup>Optional</sup> <a name="vpc" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.vpc"></a>

```typescript
public readonly vpc: IVpc;
```

- *Type:* aws-cdk-lib.aws_ec2.IVpc
- *Default:* No VPC is attached, and the CodeBuild project will use public internet.

The VPC in which the CodeBuild project will be deployed.

If provided, the CodeBuild project will be launched within the specified VPC.

---



