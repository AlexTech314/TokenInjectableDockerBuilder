# API Reference <a name="API Reference" id="api-reference"></a>

## Constructs <a name="Constructs" id="Constructs"></a>

### TokenInjectableDockerBuilder <a name="TokenInjectableDockerBuilder" id="token-injectable-docker-builder.TokenInjectableDockerBuilder"></a>

A CDK construct to build and push Docker images to an ECR repository using CodeBuild and Lambda custom resources, **then** retrieve the final image tag so that ECS/Lambda references use the exact built image.

#### Initializers <a name="Initializers" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer"></a>

```typescript
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder'

new TokenInjectableDockerBuilder(scope: Construct, id: string, props: TokenInjectableDockerBuilderProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | *No description.* |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.id">id</a></code> | <code>string</code> | *No description.* |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.props">props</a></code> | <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps">TokenInjectableDockerBuilderProps</a></code> | *No description.* |

---

##### `scope`<sup>Required</sup> <a name="scope" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

---

##### `id`<sup>Required</sup> <a name="id" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.id"></a>

- *Type:* string

---

##### `props`<sup>Required</sup> <a name="props" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.Initializer.parameter.props"></a>

- *Type:* <a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps">TokenInjectableDockerBuilderProps</a>

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.toString">toString</a></code> | Returns a string representation of this construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.with">with</a></code> | Applies one or more mixins to this construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.containerImageFor">containerImageFor</a></code> | Import the replicated repository as an ECS-compatible `ContainerImage` in a consumer scope (typically a stack in `region`). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.dockerImageCodeFor">dockerImageCodeFor</a></code> | Import the replicated repository as a Lambda-compatible `DockerImageCode` in a consumer scope (typically a stack in `region`). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.repositoryUriFor">repositoryUriFor</a></code> | Format the ECR repository URI for a given region. |

---

##### `toString` <a name="toString" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

##### `with` <a name="with" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.with"></a>

```typescript
public with(mixins: ...IMixin[]): IConstruct
```

Applies one or more mixins to this construct.

Mixins are applied in order. The list of constructs is captured at the
start of the call, so constructs added by a mixin will not be visited.
Use multiple `with()` calls if subsequent mixins should apply to added
constructs.

###### `mixins`<sup>Required</sup> <a name="mixins" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.with.parameter.mixins"></a>

- *Type:* ...constructs.IMixin[]

The mixins to apply.

---

##### `containerImageFor` <a name="containerImageFor" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.containerImageFor"></a>

```typescript
public containerImageFor(scope: Construct, region: string): ContainerImage
```

Import the replicated repository as an ECS-compatible `ContainerImage` in a consumer scope (typically a stack in `region`).

The consumer's stack must have `crossRegionReferences: true` when
`region` differs from the builder's region.

Cross-region consumers receive `imageTagPlain` (a synth-time string)
rather than `imageTag` (a CFN token). Using the token would cause CDK to
auto-create a `CrossRegionExportWriter` whose safety check wedges every
time the tag value changes — i.e. every real code change.

###### `scope`<sup>Required</sup> <a name="scope" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.containerImageFor.parameter.scope"></a>

- *Type:* constructs.Construct

---

###### `region`<sup>Required</sup> <a name="region" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.containerImageFor.parameter.region"></a>

- *Type:* string

---

##### `dockerImageCodeFor` <a name="dockerImageCodeFor" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.dockerImageCodeFor"></a>

```typescript
public dockerImageCodeFor(scope: Construct, region: string): DockerImageCode
```

Import the replicated repository as a Lambda-compatible `DockerImageCode` in a consumer scope (typically a stack in `region`).

The consumer's stack must have `crossRegionReferences: true` when
`region` differs from the builder's region.

Cross-region consumers receive `imageTagPlain` (a synth-time string)
rather than `imageTag` (a CFN token). Using the token would cause CDK to
auto-create a `CrossRegionExportWriter` whose safety check wedges every
time the tag value changes — i.e. every real code change.

###### `scope`<sup>Required</sup> <a name="scope" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.dockerImageCodeFor.parameter.scope"></a>

- *Type:* constructs.Construct

---

###### `region`<sup>Required</sup> <a name="region" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.dockerImageCodeFor.parameter.region"></a>

- *Type:* string

---

##### `repositoryUriFor` <a name="repositoryUriFor" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.repositoryUriFor"></a>

```typescript
public repositoryUriFor(region: string): string
```

Format the ECR repository URI for a given region.

The region must
be either the primary region or one of `replicaRegions`.

###### `region`<sup>Required</sup> <a name="region" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.repositoryUriFor.parameter.region"></a>

- *Type:* string

---

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### `isConstruct` <a name="isConstruct" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct"></a>

```typescript
import { TokenInjectableDockerBuilder } from 'token-injectable-docker-builder'

TokenInjectableDockerBuilder.isConstruct(x: any)
```

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

###### `x`<sup>Required</sup> <a name="x" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.containerImage">containerImage</a></code> | <code>aws-cdk-lib.aws_ecs.ContainerImage</code> | ECS-compatible container image reference (primary region). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.dockerImageCode">dockerImageCode</a></code> | <code>aws-cdk-lib.aws_lambda.DockerImageCode</code> | Lambda-compatible DockerImageCode reference (primary region). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.imageTag">imageTag</a></code> | <code>string</code> | The resolved image tag (CFN token; available at deploy time). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.imageTagPlain">imageTagPlain</a></code> | <code>string</code> | The deterministic image tag as a plain synth-time string (no CFN token). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilder.property.repositoryName">repositoryName</a></code> | <code>string</code> | The ECR repository name — preserved across replica regions. |

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

ECS-compatible container image reference (primary region).

---

##### `dockerImageCode`<sup>Required</sup> <a name="dockerImageCode" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.dockerImageCode"></a>

```typescript
public readonly dockerImageCode: DockerImageCode;
```

- *Type:* aws-cdk-lib.aws_lambda.DockerImageCode

Lambda-compatible DockerImageCode reference (primary region).

---

##### `imageTag`<sup>Required</sup> <a name="imageTag" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.imageTag"></a>

```typescript
public readonly imageTag: string;
```

- *Type:* string

The resolved image tag (CFN token; available at deploy time).

Safe to use anywhere the consumer is in the **same region** as the
builder (same stack or different stack). For cross-region consumers
use `imageTagPlain` — `imageTag` would trigger CDK's
`CrossRegionExportWriter` and wedge on any tag change.

---

##### `imageTagPlain`<sup>Required</sup> <a name="imageTagPlain" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.imageTagPlain"></a>

```typescript
public readonly imageTagPlain: string;
```

- *Type:* string

The deterministic image tag as a plain synth-time string (no CFN token).

Same value as `imageTag` but resolved immediately — useful for cross-region
consumers, where the CFN-token form would trigger CDK to auto-create a
`CrossRegionExportWriter`. That writer has an over-strict safety check
that fails any update where the tag value changes (i.e. every real code
change), wedging the stack in `UPDATE_ROLLBACK_FAILED`.

`containerImageFor` and `dockerImageCodeFor` use this string automatically
when the consumer region differs from the primary region, so callers
normally don't reference this property directly.

---

##### `repositoryName`<sup>Required</sup> <a name="repositoryName" id="token-injectable-docker-builder.TokenInjectableDockerBuilder.property.repositoryName"></a>

```typescript
public readonly repositoryName: string;
```

- *Type:* string

The ECR repository name — preserved across replica regions.

---


### TokenInjectableDockerBuilderProvider <a name="TokenInjectableDockerBuilderProvider" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider"></a>

Shared provider for `TokenInjectableDockerBuilder` instances.

Creates the onEvent and isComplete Lambda functions once per stack.
Each builder instance registers its CodeBuild project ARN so the
shared Lambdas have permission to start builds and read logs.

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.toString">toString</a></code> | Returns a string representation of this construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.with">with</a></code> | Applies one or more mixins to this construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerProject">registerProject</a></code> | Grant the shared Lambdas permission to start builds for a specific CodeBuild project and pull/push to its ECR repository. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerReplication">registerReplication</a></code> | Register a builder's replica regions with the singleton's replication-config custom resource. |

---

##### `toString` <a name="toString" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

##### `with` <a name="with" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.with"></a>

```typescript
public with(mixins: ...IMixin[]): IConstruct
```

Applies one or more mixins to this construct.

Mixins are applied in order. The list of constructs is captured at the
start of the call, so constructs added by a mixin will not be visited.
Use multiple `with()` calls if subsequent mixins should apply to added
constructs.

###### `mixins`<sup>Required</sup> <a name="mixins" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.with.parameter.mixins"></a>

- *Type:* ...constructs.IMixin[]

The mixins to apply.

---

##### `registerProject` <a name="registerProject" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerProject"></a>

```typescript
public registerProject(project: Project, ecrRepo: Repository, encryptionKey?: Key): void
```

Grant the shared Lambdas permission to start builds for a specific CodeBuild project and pull/push to its ECR repository.

###### `project`<sup>Required</sup> <a name="project" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerProject.parameter.project"></a>

- *Type:* aws-cdk-lib.aws_codebuild.Project

---

###### `ecrRepo`<sup>Required</sup> <a name="ecrRepo" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerProject.parameter.ecrRepo"></a>

- *Type:* aws-cdk-lib.aws_ecr.Repository

---

###### `encryptionKey`<sup>Optional</sup> <a name="encryptionKey" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerProject.parameter.encryptionKey"></a>

- *Type:* aws-cdk-lib.aws_kms.Key

---

##### `registerReplication` <a name="registerReplication" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerReplication"></a>

```typescript
public registerReplication(repoName: string, replicaRegions: string[]): void
```

Register a builder's replica regions with the singleton's replication-config custom resource.

Multiple builders contribute specs; the CR merges them into
a single registry-wide configuration on every deploy.

Also grants the `isComplete` Lambda permission to BatchGetImage on each
replica region's repo so it can poll for replication availability.

###### `repoName`<sup>Required</sup> <a name="repoName" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerReplication.parameter.repoName"></a>

- *Type:* string

---

###### `replicaRegions`<sup>Required</sup> <a name="replicaRegions" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.registerReplication.parameter.replicaRegions"></a>

- *Type:* string[]

---

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.getOrCreate">getOrCreate</a></code> | Get or create the singleton provider for this stack. |

---

##### `isConstruct` <a name="isConstruct" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.isConstruct"></a>

```typescript
import { TokenInjectableDockerBuilderProvider } from 'token-injectable-docker-builder'

TokenInjectableDockerBuilderProvider.isConstruct(x: any)
```

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

###### `x`<sup>Required</sup> <a name="x" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

##### `getOrCreate` <a name="getOrCreate" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.getOrCreate"></a>

```typescript
import { TokenInjectableDockerBuilderProvider } from 'token-injectable-docker-builder'

TokenInjectableDockerBuilderProvider.getOrCreate(scope: Construct, props?: TokenInjectableDockerBuilderProviderProps)
```

Get or create the singleton provider for this stack.

All `TokenInjectableDockerBuilder` instances in the same stack
share a single pair of Lambda functions.

###### `scope`<sup>Required</sup> <a name="scope" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.getOrCreate.parameter.scope"></a>

- *Type:* constructs.Construct

---

###### `props`<sup>Optional</sup> <a name="props" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.getOrCreate.parameter.props"></a>

- *Type:* <a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProviderProps">TokenInjectableDockerBuilderProviderProps</a>

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.property.serviceToken">serviceToken</a></code> | <code>string</code> | The service token used by CustomResource instances. |

---

##### `node`<sup>Required</sup> <a name="node" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `serviceToken`<sup>Required</sup> <a name="serviceToken" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProvider.property.serviceToken"></a>

```typescript
public readonly serviceToken: string;
```

- *Type:* string

The service token used by CustomResource instances.

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
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.buildLogGroup">buildLogGroup</a></code> | <code>aws-cdk-lib.aws_logs.ILogGroup</code> | CloudWatch log group for CodeBuild build logs. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.cacheDisabled">cacheDisabled</a></code> | <code>boolean</code> | When `true`, disables Docker layer caching. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.dockerLoginSecretArn">dockerLoginSecretArn</a></code> | <code>string</code> | The ARN of the AWS Secrets Manager secret containing Docker login credentials. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.ecrPullThroughCachePrefixes">ecrPullThroughCachePrefixes</a></code> | <code>string[]</code> | ECR pull-through cache repository prefixes to grant pull access to. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.exclude">exclude</a></code> | <code>string[]</code> | File paths in the Docker directory to exclude from the build asset. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.file">file</a></code> | <code>string</code> | Name of the Dockerfile (passed as `-f`). |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.installCommands">installCommands</a></code> | <code>string[]</code> | Custom commands to run during the install phase of CodeBuild. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.kmsEncryption">kmsEncryption</a></code> | <code>boolean</code> | Whether to enable KMS encryption for the ECR repository. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.platform">platform</a></code> | <code>string</code> | Target platform for the Docker image. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.preBuildCommands">preBuildCommands</a></code> | <code>string[]</code> | Custom commands to run during the pre_build phase of CodeBuild. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.provider">provider</a></code> | <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider">TokenInjectableDockerBuilderProvider</a></code> | Shared provider for the custom resource Lambdas. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.replicaRegions">replicaRegions</a></code> | <code>string[]</code> | Additional AWS regions to replicate the built image to via ECR's native registry replication. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.retainBuildLogs">retainBuildLogs</a></code> | <code>boolean</code> | When `true`, creates a CloudWatch log group outside of CloudFormation (`/docker-builder/<projectName>`) and directs CodeBuild output there. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.securityGroups">securityGroups</a></code> | <code>aws-cdk-lib.aws_ec2.ISecurityGroup[]</code> | Security groups attached to the CodeBuild project. |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.subnetSelection">subnetSelection</a></code> | <code>aws-cdk-lib.aws_ec2.SubnetSelection</code> | Subnet selection within the VPC. |
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


##### `buildLogGroup`<sup>Optional</sup> <a name="buildLogGroup" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.buildLogGroup"></a>

```typescript
public readonly buildLogGroup: ILogGroup;
```

- *Type:* aws-cdk-lib.aws_logs.ILogGroup
- *Default:* CodeBuild default logging.

CloudWatch log group for CodeBuild build logs.

---

##### `cacheDisabled`<sup>Optional</sup> <a name="cacheDisabled" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.cacheDisabled"></a>

```typescript
public readonly cacheDisabled: boolean;
```

- *Type:* boolean
- *Default:* false

When `true`, disables Docker layer caching.

---

##### `dockerLoginSecretArn`<sup>Optional</sup> <a name="dockerLoginSecretArn" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.dockerLoginSecretArn"></a>

```typescript
public readonly dockerLoginSecretArn: string;
```

- *Type:* string
- *Default:* No Docker Hub login.

The ARN of the AWS Secrets Manager secret containing Docker login credentials.

The secret must store a JSON object: `{"username":"...","password":"..."}`.
Must be in the same region as the stack.

---

##### `ecrPullThroughCachePrefixes`<sup>Optional</sup> <a name="ecrPullThroughCachePrefixes" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.ecrPullThroughCachePrefixes"></a>

```typescript
public readonly ecrPullThroughCachePrefixes: string[];
```

- *Type:* string[]
- *Default:* No pull-through cache access.

ECR pull-through cache repository prefixes to grant pull access to.

---

*Example*

```typescript
['docker-hub', 'ghcr']
```


##### `exclude`<sup>Optional</sup> <a name="exclude" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.exclude"></a>

```typescript
public readonly exclude: string[];
```

- *Type:* string[]
- *Default:* No file path exclusions.

File paths in the Docker directory to exclude from the build asset.

Falls back to `.dockerignore` if present.

---

##### `file`<sup>Optional</sup> <a name="file" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.file"></a>

```typescript
public readonly file: string;
```

- *Type:* string
- *Default:* 'Dockerfile'

Name of the Dockerfile (passed as `-f`).

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

---

##### `kmsEncryption`<sup>Optional</sup> <a name="kmsEncryption" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.kmsEncryption"></a>

```typescript
public readonly kmsEncryption: boolean;
```

- *Type:* boolean
- *Default:* false

Whether to enable KMS encryption for the ECR repository.

---

##### `platform`<sup>Optional</sup> <a name="platform" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.platform"></a>

```typescript
public readonly platform: string;
```

- *Type:* string
- *Default:* 'linux/amd64'

Target platform for the Docker image.

---

##### `preBuildCommands`<sup>Optional</sup> <a name="preBuildCommands" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.preBuildCommands"></a>

```typescript
public readonly preBuildCommands: string[];
```

- *Type:* string[]
- *Default:* No additional pre-build commands.

Custom commands to run during the pre_build phase of CodeBuild.

---

##### `provider`<sup>Optional</sup> <a name="provider" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.provider"></a>

```typescript
public readonly provider: TokenInjectableDockerBuilderProvider;
```

- *Type:* <a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProvider">TokenInjectableDockerBuilderProvider</a>
- *Default:* Per-stack singleton provider, created on first use.

Shared provider for the custom resource Lambdas.

Pass `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })`
if you need a non-default query interval. Otherwise, the construct will
call `getOrCreate(this)` itself and reuse the per-stack singleton.

---

##### `replicaRegions`<sup>Optional</sup> <a name="replicaRegions" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.replicaRegions"></a>

```typescript
public readonly replicaRegions: string[];
```

- *Type:* string[]
- *Default:* [] - no replication

Additional AWS regions to replicate the built image to via ECR's native registry replication.

The image is pushed to the primary
region's ECR as usual; ECR asynchronously replicates the same
`repositoryName` + `imageTag` to each region listed here.

Consumers in another region (a Lambda in `us-west-2` referencing an
image built in `us-east-1`) can use `dockerImageCodeFor(region)` or
`containerImageFor(region)` to import the replicated image.

The custom resource waits for replication to complete before
signalling deploy-complete, so downstream stacks can safely deploy
immediately after.

**Caveats:**
- Cross-region replication is not supported between AWS partitions.
- Replicas do **not** inherit the primary's encryption (defaults to
  AES-256), lifecycle policies, or repository policies.
- Replicated repositories persist on stack deletion — AWS does not
  auto-delete them. Clean up manually via the ECR console / CLI if
  needed.
- Both the builder stack and any consumer stack in another region
  must set `crossRegionReferences: true` for the image tag to flow.
- Stacks must have a concrete region (`env: { account, region }`),
  not the env-agnostic default.

---

*Example*

```typescript
['us-west-2', 'eu-west-1']
```


##### `retainBuildLogs`<sup>Optional</sup> <a name="retainBuildLogs" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.retainBuildLogs"></a>

```typescript
public readonly retainBuildLogs: boolean;
```

- *Type:* boolean
- *Default:* false

When `true`, creates a CloudWatch log group outside of CloudFormation (`/docker-builder/<projectName>`) and directs CodeBuild output there.

Survives stack rollbacks for debugging. 7-day retention.

---

##### `securityGroups`<sup>Optional</sup> <a name="securityGroups" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.securityGroups"></a>

```typescript
public readonly securityGroups: ISecurityGroup[];
```

- *Type:* aws-cdk-lib.aws_ec2.ISecurityGroup[]
- *Default:* No security groups attached.

Security groups attached to the CodeBuild project.

---

##### `subnetSelection`<sup>Optional</sup> <a name="subnetSelection" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.subnetSelection"></a>

```typescript
public readonly subnetSelection: SubnetSelection;
```

- *Type:* aws-cdk-lib.aws_ec2.SubnetSelection
- *Default:* All subnets in the VPC.

Subnet selection within the VPC.

---

##### `vpc`<sup>Optional</sup> <a name="vpc" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProps.property.vpc"></a>

```typescript
public readonly vpc: IVpc;
```

- *Type:* aws-cdk-lib.aws_ec2.IVpc
- *Default:* CodeBuild uses public internet.

The VPC in which the CodeBuild project will be deployed.

---

### TokenInjectableDockerBuilderProviderProps <a name="TokenInjectableDockerBuilderProviderProps" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProviderProps"></a>

Options for creating a `TokenInjectableDockerBuilderProvider`.

#### Initializer <a name="Initializer" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProviderProps.Initializer"></a>

```typescript
import { TokenInjectableDockerBuilderProviderProps } from 'token-injectable-docker-builder'

const tokenInjectableDockerBuilderProviderProps: TokenInjectableDockerBuilderProviderProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#token-injectable-docker-builder.TokenInjectableDockerBuilderProviderProps.property.queryInterval">queryInterval</a></code> | <code>aws-cdk-lib.Duration</code> | How often the provider polls for build completion. |

---

##### `queryInterval`<sup>Optional</sup> <a name="queryInterval" id="token-injectable-docker-builder.TokenInjectableDockerBuilderProviderProps.property.queryInterval"></a>

```typescript
public readonly queryInterval: Duration;
```

- *Type:* aws-cdk-lib.Duration
- *Default:* Duration.seconds(30)

How often the provider polls for build completion.

---



