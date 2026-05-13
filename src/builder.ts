import * as crypto from 'crypto';

import { CustomResource, Stack, Token } from 'aws-cdk-lib';
import {
  Project,
  Source,
  LinuxBuildImage,
  LinuxArmBuildImage,
  BuildSpec,
} from 'aws-cdk-lib/aws-codebuild';
import { IVpc, ISecurityGroup, SubnetSelection } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { DockerImageCode } from 'aws-cdk-lib/aws-lambda';
import { ILogGroup } from 'aws-cdk-lib/aws-logs';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';

import { buildBuildSpec, resolveExcludes } from './build-spec';
import { BUILD_LOG_GROUP_PREFIX } from './constants';
import { createBuilderEcrRepository } from './ecr';
import { TokenInjectableDockerBuilderProvider } from './provider';

/**
 * Properties for the `TokenInjectableDockerBuilder` construct.
 */
export interface TokenInjectableDockerBuilderProps {
  /**
   * The path to the directory containing the Dockerfile or source code.
   */
  readonly path: string;

  /**
   * Build arguments to pass to the Docker build process.
   * These are transformed into `--build-arg KEY=VALUE` flags.
   * @example
   * {
   *   TOKEN: 'my-secret-token',
   *   ENV: 'production'
   * }
   */
  readonly buildArgs?: { [key: string]: string };

  /**
   * The ARN of the AWS Secrets Manager secret containing Docker login credentials.
   * The secret must store a JSON object: `{"username":"...","password":"..."}`.
   * Must be in the same region as the stack.
   *
   * @default - No Docker Hub login.
   */
  readonly dockerLoginSecretArn?: string;

  /**
   * The VPC in which the CodeBuild project will be deployed.
   *
   * @default - CodeBuild uses public internet.
   */
  readonly vpc?: IVpc;

  /**
   * Security groups attached to the CodeBuild project.
   *
   * @default - No security groups attached.
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * Subnet selection within the VPC.
   *
   * @default - All subnets in the VPC.
   */
  readonly subnetSelection?: SubnetSelection;

  /**
   * Custom commands to run during the install phase of CodeBuild.
   *
   * @default - No additional install commands.
   */
  readonly installCommands?: string[];

  /**
   * Custom commands to run during the pre_build phase of CodeBuild.
   *
   * @default - No additional pre-build commands.
   */
  readonly preBuildCommands?: string[];

  /**
   * Whether to enable KMS encryption for the ECR repository.
   *
   * @default false
   */
  readonly kmsEncryption?: boolean;

  /**
   * File paths in the Docker directory to exclude from the build asset.
   * Falls back to `.dockerignore` if present.
   *
   * @default - No file path exclusions.
   */
  readonly exclude?: string[];

  /**
   * Name of the Dockerfile (passed as `-f`).
   *
   * @example 'Dockerfile.production'
   * @default 'Dockerfile'
   */
  readonly file?: string;

  /**
   * When `true`, disables Docker layer caching.
   *
   * @default false
   */
  readonly cacheDisabled?: boolean;

  /**
   * CloudWatch log group for CodeBuild build logs.
   *
   * @default - CodeBuild default logging.
   */
  readonly buildLogGroup?: ILogGroup;

  /**
   * Target platform for the Docker image.
   *
   * @default 'linux/amd64'
   */
  readonly platform?: 'linux/amd64' | 'linux/arm64';

  /**
   * Shared provider for the custom resource Lambdas.
   *
   * Pass `TokenInjectableDockerBuilderProvider.getOrCreate(this, { queryInterval })`
   * if you need a non-default query interval. Otherwise, the construct will
   * call `getOrCreate(this)` itself and reuse the per-stack singleton.
   *
   * @default - Per-stack singleton provider, created on first use.
   */
  readonly provider?: TokenInjectableDockerBuilderProvider;

  /**
   * ECR pull-through cache repository prefixes to grant pull access to.
   *
   * @example ['docker-hub', 'ghcr']
   * @default - No pull-through cache access.
   */
  readonly ecrPullThroughCachePrefixes?: string[];

  /**
   * When `true`, creates a CloudWatch log group outside of CloudFormation
   * (`/docker-builder/<projectName>`) and directs CodeBuild output there.
   * Survives stack rollbacks for debugging. 7-day retention.
   *
   * @default false
   */
  readonly retainBuildLogs?: boolean;

  /**
   * Additional AWS regions to replicate the built image to via ECR's
   * native registry replication. The image is pushed to the primary
   * region's ECR as usual; ECR asynchronously replicates the same
   * `repositoryName` + `imageTag` to each region listed here.
   *
   * Consumers in another region (a Lambda in `us-west-2` referencing an
   * image built in `us-east-1`) can use `dockerImageCodeFor(region)` or
   * `containerImageFor(region)` to import the replicated image.
   *
   * The custom resource waits for replication to complete before
   * signalling deploy-complete, so downstream stacks can safely deploy
   * immediately after.
   *
   * **Caveats:**
   * - Cross-region replication is not supported between AWS partitions.
   * - Replicas do **not** inherit the primary's encryption (defaults to
   *   AES-256), lifecycle policies, or repository policies.
   * - Replicated repositories persist on stack deletion — AWS does not
   *   auto-delete them. Clean up manually via the ECR console / CLI if
   *   needed.
   * - Both the builder stack and any consumer stack in another region
   *   must set `crossRegionReferences: true` for the image tag to flow.
   * - Stacks must have a concrete region (`env: { account, region }`),
   *   not the env-agnostic default.
   *
   * @example ['us-west-2', 'eu-west-1']
   * @default [] - no replication
   */
  readonly replicaRegions?: string[];
}

/**
 * A CDK construct to build and push Docker images to an ECR repository using
 * CodeBuild and Lambda custom resources, **then** retrieve the final image tag
 * so that ECS/Lambda references use the exact built image.
 */
export class TokenInjectableDockerBuilder extends Construct {
  /** The ECR repository that stores the resulting Docker image. */
  private readonly ecrRepository: Repository;

  /** ECS-compatible container image reference (primary region). */
  public readonly containerImage: ContainerImage;

  /** Lambda-compatible DockerImageCode reference (primary region). */
  public readonly dockerImageCode: DockerImageCode;

  /** The ECR repository name — preserved across replica regions. */
  public readonly repositoryName: string;

  /** The resolved image tag (CFN token; available at deploy time). */
  public readonly imageTag: string;

  private readonly primaryRegion: string;
  private readonly accountId: string;
  private readonly replicaRegions: string[];

  constructor(scope: Construct, id: string, props: TokenInjectableDockerBuilderProps) {
    super(scope, id);

    const {
      path: sourcePath,
      buildArgs,
      dockerLoginSecretArn,
      vpc,
      securityGroups,
      subnetSelection,
      installCommands,
      preBuildCommands,
      kmsEncryption = false,
      exclude,
      file: dockerFile,
      cacheDisabled = false,
      buildLogGroup,
      platform = 'linux/amd64',
      provider,
      ecrPullThroughCachePrefixes,
      retainBuildLogs = false,
      replicaRegions = [],
    } = props;

    const stack = Stack.of(this);
    this.primaryRegion = stack.region;
    this.accountId = stack.account;
    this.replicaRegions = [...replicaRegions];

    const encryptionKey = kmsEncryption
      ? new Key(this, 'EcrEncryptionKey', { enableKeyRotation: true })
      : undefined;

    this.ecrRepository = createBuilderEcrRepository(this, 'ECRRepository', {
      kmsEncryption,
      encryptionKey,
    });

    const dockerFileName = dockerFile ?? 'Dockerfile';
    const effectiveExclude = resolveExcludes(sourcePath, dockerFileName, exclude);

    const sourceAsset = new Asset(this, 'SourceAsset', {
      path: sourcePath,
      exclude: effectiveExclude,
    });

    // Deterministic image tag: a hash of every input that materially affects
    // the built image. Stable across synths → no spurious rebuilds, and
    // cross-region SSM exports don't churn between deploys (which used to
    // wedge the CDK CrossRegionExportReader/Writer when a deploy was retried
    // after a rollback).
    const imageTag = crypto.createHash('sha256').update(JSON.stringify({
      assetHash: sourceAsset.assetHash,
      dockerFile: dockerFileName,
      buildArgs: buildArgs ?? {},
      platform,
      installCommands: installCommands ?? [],
      preBuildCommands: preBuildCommands ?? [],
      cacheDisabled,
      dockerLoginSecretArn: dockerLoginSecretArn ?? null,
      ecrPullThroughCachePrefixes: ecrPullThroughCachePrefixes ?? [],
    })).digest('hex');

    const buildSpecObj = buildBuildSpec({
      imageTag,
      dockerFile,
      buildArgs,
      dockerLoginSecretArn,
      installCommands,
      preBuildCommands,
      cacheDisabled,
      platform,
    });

    const codeBuildImage = platform === 'linux/arm64'
      ? LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0
      : LinuxBuildImage.STANDARD_7_0;

    const codeBuildProject = new Project(this, 'CodeBuildProject', {
      source: Source.s3({
        bucket: sourceAsset.bucket,
        path: sourceAsset.s3ObjectKey,
      }),
      environment: {
        buildImage: codeBuildImage,
        privileged: true,
      },
      environmentVariables: {
        ECR_REPO_URI: { value: this.ecrRepository.repositoryUri },
      },
      buildSpec: BuildSpec.fromObject(buildSpecObj),
      ...(buildLogGroup && {
        logging: { cloudWatch: { logGroup: buildLogGroup } },
      }),
      vpc,
      securityGroups,
      subnetSelection,
    });

    this.grantBuildLogsAccess(codeBuildProject, retainBuildLogs);
    this.grantEcrAccess(codeBuildProject);
    this.grantPullThroughCacheAccess(codeBuildProject, ecrPullThroughCachePrefixes);

    if (dockerLoginSecretArn) {
      codeBuildProject.addToRolePolicy(
        new PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [dockerLoginSecretArn],
        }),
      );
    }

    if (encryptionKey) {
      encryptionKey.grantEncryptDecrypt(codeBuildProject.role!);
    }

    const effectiveProvider = provider ?? TokenInjectableDockerBuilderProvider.getOrCreate(this);
    effectiveProvider.registerProject(codeBuildProject, this.ecrRepository, encryptionKey);

    if (replicaRegions.length > 0) {
      this.validateReplicaRegions(replicaRegions);
      effectiveProvider.registerReplication(this.ecrRepository.repositoryName, replicaRegions);
    }

    // The CR's construct ID has a "V2" suffix so that a v1-deployed stack
    // upgrading to v2 sees a NEW resource (Replace), not an in-place update
    // of the old `BuildTriggerResource`. CloudFormation forbids modifying a
    // custom resource's `ServiceToken` in-place ("Modifying service token is
    // not allowed."), and the serviceToken changes from v1's per-instance
    // provider to v2's singleton provider. Replace dodges the constraint:
    // the old CR is deleted, and a new one is created with the singleton's
    // serviceToken — at the cost of one fresh build per builder on upgrade.
    const buildTriggerResource = new CustomResource(this, 'BuildTriggerResourceV2', {
      serviceToken: effectiveProvider.serviceToken,
      properties: {
        ProjectName: codeBuildProject.projectName,
        ImageTag: imageTag,
        Trigger: sourceAsset.assetHash,
        RetainBuildLogs: retainBuildLogs ? 'true' : 'false',
        RepositoryName: this.ecrRepository.repositoryName,
        ReplicaRegions: JSON.stringify(replicaRegions),
      },
    });
    buildTriggerResource.node.addDependency(codeBuildProject);

    // SAFETY: reference by tag, not digest. The lifecycle policy above never
    // deletes tagged images, so the digest behind this tag is guaranteed to
    // remain in ECR for the life of the repository.
    const imageTagRef = buildTriggerResource.getAttString('ImageTag');
    this.imageTag = imageTagRef;
    this.repositoryName = this.ecrRepository.repositoryName;
    this.containerImage = ContainerImage.fromEcrRepository(this.ecrRepository, imageTagRef);
    this.dockerImageCode = DockerImageCode.fromEcr(this.ecrRepository, {
      tagOrDigest: imageTagRef,
    });
  }

  /**
   * Format the ECR repository URI for a given region. The region must
   * be either the primary region or one of `replicaRegions`.
   */
  public repositoryUriFor(region: string): string {
    this.assertRegionIsKnown(region);
    return `${this.accountId}.dkr.ecr.${region}.amazonaws.com/${this.repositoryName}`;
  }

  /**
   * Import the replicated repository as an ECS-compatible
   * `ContainerImage` in a consumer scope (typically a stack in `region`).
   *
   * The consumer's stack must have `crossRegionReferences: true` when
   * `region` differs from the builder's region.
   */
  public containerImageFor(scope: Construct, region: string): ContainerImage {
    return ContainerImage.fromEcrRepository(
      this.importRepoFor(scope, region),
      this.imageTag,
    );
  }

  /**
   * Import the replicated repository as a Lambda-compatible
   * `DockerImageCode` in a consumer scope (typically a stack in `region`).
   *
   * The consumer's stack must have `crossRegionReferences: true` when
   * `region` differs from the builder's region.
   */
  public dockerImageCodeFor(scope: Construct, region: string): DockerImageCode {
    return DockerImageCode.fromEcr(this.importRepoFor(scope, region), {
      tagOrDigest: this.imageTag,
    });
  }

  private importRepoFor(scope: Construct, region: string): Repository {
    this.assertRegionIsKnown(region);
    if (region === this.primaryRegion) return this.ecrRepository;

    // Include the builder's own node.addr in the import id so two different
    // builders importing the same region into the same scope each get their
    // own Repository child (otherwise the second call would collide with the
    // first and return the wrong builder's repo).
    const importId = `ImportedRepo${region}${this.node.addr}`;
    const existing = scope.node.tryFindChild(importId);
    if (existing) return existing as Repository;

    return Repository.fromRepositoryAttributes(scope, importId, {
      repositoryName: this.repositoryName,
      repositoryArn: Stack.of(scope).formatArn({
        service: 'ecr',
        resource: 'repository',
        resourceName: this.repositoryName,
        region,
        account: this.accountId,
      }),
    }) as Repository;
  }

  private assertRegionIsKnown(region: string): void {
    if (region === this.primaryRegion) return;
    if (this.replicaRegions.includes(region)) return;
    throw new Error(
      `Region "${region}" is not the primary region (${this.primaryRegion}) ` +
      `or one of the configured replicaRegions (${this.replicaRegions.join(', ') || '<none>'}). ` +
      'Add the region to the builder\'s replicaRegions prop to make it available.',
    );
  }

  private validateReplicaRegions(replicaRegions: string[]): void {
    const stack = Stack.of(this);
    const primaryPartition = stack.partition;
    for (const region of replicaRegions) {
      if (region === this.primaryRegion) {
        throw new Error(
          `replicaRegions cannot include the primary region "${this.primaryRegion}". ` +
          'Remove it from the list.',
        );
      }
      // Partition cannot be cleanly inferred from region alone at synth time
      // (it's a CDK pseudo-parameter and may be a token). We do the best-effort
      // check: if both partition values are concrete and they differ, fail.
      // Cross-partition replication is unsupported by ECR.
      if (!Token.isUnresolved(primaryPartition)) {
        const expectedPartition = inferPartition(region);
        if (expectedPartition && expectedPartition !== primaryPartition) {
          throw new Error(
            'Cross-partition ECR replication is not supported. ' +
            `Primary partition is "${primaryPartition}" but replica region ` +
            `"${region}" appears to be in partition "${expectedPartition}".`,
          );
        }
      }
    }
  }

  private grantEcrAccess(project: Project): void {
    this.ecrRepository.grantPullPush(project);
    project.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      }),
    );
  }

  private grantPullThroughCacheAccess(project: Project, prefixes: string[] | undefined): void {
    if (!prefixes || prefixes.length === 0) return;
    const stack = Stack.of(this);
    project.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchImportUpstreamImage',
          'ecr:CreateRepository',
        ],
        resources: prefixes.map(
          (prefix) => `arn:aws:ecr:${stack.region}:${stack.account}:repository/${prefix}/*`,
        ),
      }),
    );
  }

  private grantBuildLogsAccess(project: Project, retainBuildLogs: boolean): void {
    if (!retainBuildLogs) return;
    const stack = Stack.of(this);
    project.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${stack.region}:${stack.account}:log-group:${BUILD_LOG_GROUP_PREFIX}${project.projectName}`,
          `arn:aws:logs:${stack.region}:${stack.account}:log-group:${BUILD_LOG_GROUP_PREFIX}${project.projectName}:*`,
        ],
      }),
    );
  }
}

/**
 * Best-effort partition inference from an AWS region name. Returns
 * undefined if the region doesn't look like a known partition prefix —
 * callers should treat that as "skip the partition check".
 */
function inferPartition(region: string): string | undefined {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  if (region.startsWith('us-iso-')) return 'aws-iso';
  if (region.startsWith('us-isob-')) return 'aws-iso-b';
  if (/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return 'aws';
  return undefined;
}
