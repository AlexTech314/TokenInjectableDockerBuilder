import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Project, Source, LinuxBuildImage, BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { IVpc, ISecurityGroup, SubnetSelection } from 'aws-cdk-lib/aws-ec2';
import { Repository, RepositoryEncryption, TagStatus } from 'aws-cdk-lib/aws-ecr';
import { ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Runtime, Code, DockerImageCode, Function } from 'aws-cdk-lib/aws-lambda';
import { ILogGroup } from 'aws-cdk-lib/aws-logs';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const PROVIDER_SINGLETON_ID = 'TokenInjectableDockerBuilderProvider';

/**
 * Options for creating a `TokenInjectableDockerBuilderProvider`.
 */
export interface TokenInjectableDockerBuilderProviderProps {
  /**
   * How often the provider polls for build completion.
   *
   * @default Duration.seconds(30)
   */
  readonly queryInterval?: Duration;
}

/**
 * Shared provider for `TokenInjectableDockerBuilder` instances.
 *
 * Creates the onEvent and isComplete Lambda functions once per stack.
 * Each builder instance registers its CodeBuild project ARN so the
 * shared Lambdas have permission to start builds and read logs.
 */
export class TokenInjectableDockerBuilderProvider extends Construct {
  /**
   * Get or create the singleton provider for this stack.
   * All `TokenInjectableDockerBuilder` instances in the same stack
   * share a single pair of Lambda functions.
   */
  public static getOrCreate(scope: Construct, props?: TokenInjectableDockerBuilderProviderProps): TokenInjectableDockerBuilderProvider {
    const stack = Stack.of(scope);
    const existing = stack.node.tryFindChild(PROVIDER_SINGLETON_ID) as TokenInjectableDockerBuilderProvider | undefined;
    if (existing) return existing;
    return new TokenInjectableDockerBuilderProvider(stack, PROVIDER_SINGLETON_ID, props);
  }

  /** The service token used by CustomResource instances. */
  public readonly serviceToken: string;

  private readonly onEventHandlerFunction: Function;
  private readonly isCompleteHandlerFunction: Function;

  private constructor(scope: Construct, id: string, props?: TokenInjectableDockerBuilderProviderProps) {
    super(scope, id);

    this.onEventHandlerFunction = new Function(this, 'OnEventHandler', {
      runtime: Runtime.NODEJS_22_X,
      code: Code.fromAsset(path.resolve(__dirname, '../onEvent')),
      handler: 'onEvent.handler',
      timeout: Duration.minutes(15),
    });

    this.isCompleteHandlerFunction = new Function(this, 'IsCompleteHandler', {
      runtime: Runtime.NODEJS_22_X,
      code: Code.fromAsset(path.resolve(__dirname, '../isComplete')),
      handler: 'isComplete.handler',
      timeout: Duration.minutes(15),
    });
    this.isCompleteHandlerFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'codebuild:BatchGetBuilds',
          'codebuild:ListBuildsForProject',
          'logs:GetLogEvents',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
        ],
        resources: ['*'],
      }),
    );

    const provider = new Provider(this, 'Provider', {
      onEventHandler: this.onEventHandlerFunction,
      isCompleteHandler: this.isCompleteHandlerFunction,
      queryInterval: props?.queryInterval ?? Duration.seconds(30),
    });

    this.serviceToken = provider.serviceToken;
  }

  /**
   * Grant the shared Lambdas permission to start builds for a specific
   * CodeBuild project and pull/push to its ECR repository.
   */
  public registerProject(project: Project, ecrRepo: Repository, encryptionKey?: Key): void {
    this.onEventHandlerFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['codebuild:StartBuild'],
        resources: [project.projectArn],
      }),
    );
    ecrRepo.grantPullPush(this.onEventHandlerFunction);
    ecrRepo.grantPullPush(this.isCompleteHandlerFunction);

    if (encryptionKey) {
      encryptionKey.grantEncryptDecrypt(this.onEventHandlerFunction);
      encryptionKey.grantEncryptDecrypt(this.isCompleteHandlerFunction);
    }
  }
}

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
   * This secret should store a JSON object with the following structure:
   * ```json
   * {
   *   "username": "my-docker-username",
   *   "password": "my-docker-password"
   * }
   * ```
   * If not provided (or not needed), the construct will skip Docker Hub login.
   *
   * **Note**: The secret must be in the same region as the stack.
   *
   * @example 'arn:aws:secretsmanager:us-east-1:123456789012:secret:DockerLoginSecret'
   */
  readonly dockerLoginSecretArn?: string;

  /**
   * The VPC in which the CodeBuild project will be deployed.
   * If provided, the CodeBuild project will be launched within the specified VPC.
   *
   * @default - No VPC is attached, and the CodeBuild project will use public internet.
   */
  readonly vpc?: IVpc;

  /**
   * The security groups to attach to the CodeBuild project.
   * These define the network access rules for the CodeBuild project.
   *
   * @default - No security groups are attached.
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * The subnet selection to specify which subnets to use within the VPC.
   * Allows the user to select private, public, or isolated subnets.
   *
   * @default - All subnets in the VPC are used.
   */
  readonly subnetSelection?: SubnetSelection;

  /**
   * Custom commands to run during the install phase of CodeBuild.
   *
   * **Example**:
   * ```ts
   * installCommands: [
   *   'echo "Updating package lists..."',
   *   'apt-get update -y',
   *   'echo "Installing required packages..."',
   *   'apt-get install -y curl dnsutils',
   * ],
   * ```
   * @default - No additional install commands.
   */
  readonly installCommands?: string[];

  /**
   * Custom commands to run during the pre_build phase of CodeBuild.
   *
   * **Example**:
   * ```ts
   * preBuildCommands: [
   *   'echo "Fetching configuration from private API..."',
   *   'curl -o config.json https://api.example.com/config',
   * ],
   * ```
   * @default - No additional pre-build commands.
   */
  readonly preBuildCommands?: string[];

  /**
   * Whether to enable KMS encryption for the ECR repository.
   * If `true`, a KMS key will be created for encrypting ECR images.
   * If `false`, the repository will use AES-256 encryption.
   *
   * @default - false
   */
  readonly kmsEncryption?: boolean;

  /**
   * The query interval for checking if the CodeBuild project has completed.
   * This determines how frequently the custom resource polls for build completion.
   *
   * @default - Duration.seconds(30)
   */
  readonly completenessQueryInterval?: Duration;

  /**
   * A list of file paths in the Docker directory to exclude from build.
   * Will use paths in .dockerignore file if present.
   *
   * @default - No file path exclusions
   */
  readonly exclude?: string[];

  /**
   * The name of the Dockerfile to use for the build.
   * Passed as `--file` to `docker build`.
   *
   * @example 'Dockerfile.production'
   * @default 'Dockerfile'
   */
  readonly file?: string;

  /**
   * When `true`, disables Docker layer caching. Every build runs from scratch.
   * Use for debugging, corrupted cache, or major dependency changes.
   *
   * @default false
   */
  readonly cacheDisabled?: boolean;

  /**
   * CloudWatch log group for CodeBuild build logs.
   * When provided with a RETAIN removal policy, build logs survive rollbacks
   * and stack deletion for debugging.
   *
   * @default - CodeBuild default logging (logs are deleted on rollback)
   */
  readonly buildLogGroup?: ILogGroup;

  /**
   * Shared provider for the custom resource Lambdas.
   * Use `TokenInjectableDockerBuilderProvider.getOrCreate(this)` to create
   * a singleton that is shared across all builders in the same stack.
   *
   * When omitted, each builder creates its own Lambdas (original behavior).
   *
   * @default - A new provider is created per builder instance
   */
  readonly provider?: TokenInjectableDockerBuilderProvider;
}

/**
 * A CDK construct to build and push Docker images to an ECR repository using
 * CodeBuild and Lambda custom resources, **then** retrieve the final image tag
 * so that ECS/Lambda references use the exact digest.
 */
export class TokenInjectableDockerBuilder extends Construct {
  /**
   * The ECR repository that stores the resulting Docker image.
   */
  private readonly ecrRepository: Repository;

  /**
   * An ECS-compatible container image referencing the tag
   * of the built Docker image.
   */
  public readonly containerImage: ContainerImage;

  /**
   * A Lambda-compatible DockerImageCode referencing the tag
   * of the built Docker image.
   */
  public readonly dockerImageCode: DockerImageCode;

  /**
   * Creates a new `TokenInjectableDockerBuilder`.
   *
   * @param scope The scope in which to define this construct.
   * @param id The scoped construct ID.
   * @param props Configuration for building and pushing the Docker image.
   */
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
      completenessQueryInterval,
      exclude,
      file: dockerFile,
      cacheDisabled = false,
      buildLogGroup: buildLogGroupProp,
      provider: sharedProvider,
    } = props;

    // Generate an ephemeral tag for CodeBuild
    const imageTag = crypto.randomUUID();

    // Optionally define a KMS key for ECR encryption if requested
    let encryptionKey: Key | undefined;
    if (kmsEncryption) {
      encryptionKey = new Key(this, 'EcrEncryptionKey', {
        enableKeyRotation: true,
      });
    }

    // Create an ECR repository (optionally with KMS encryption)
    this.ecrRepository = new Repository(this, 'ECRRepository', {
      lifecycleRules: [
        {
          rulePriority: 1,
          description: 'Remove untagged images after 1 day',
          tagStatus: TagStatus.UNTAGGED,
          maxImageAge: Duration.days(1),
        },
      ],
      encryption: kmsEncryption ? RepositoryEncryption.KMS : RepositoryEncryption.AES_256,
      encryptionKey: kmsEncryption ? encryptionKey : undefined,
      imageScanOnPush: true,
    });

    let effectiveExclude = exclude;
    if (!effectiveExclude) {
      const dockerignorePath = path.join(sourcePath, '.dockerignore');
      if (fs.existsSync(dockerignorePath)) {
        const fileContent = fs.readFileSync(dockerignorePath, 'utf8');
        effectiveExclude = fileContent
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0 && !line.startsWith('#'));
      }
    }

    // Ensure the target Dockerfile is never excluded (handles globs like "Dockerfile*")
    const dockerFileName = dockerFile ?? 'Dockerfile';
    if (effectiveExclude) {
      effectiveExclude = effectiveExclude.filter((pattern: string) => {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
        return !regex.test(dockerFileName);
      });
    }

    // Wrap the source folder as an S3 asset for CodeBuild to use
    const sourceAsset = new Asset(this, 'SourceAsset', {
      path: sourcePath,
      exclude: effectiveExclude,
    });

    // Convert buildArgs to a CLI-friendly string
    const buildArgsString = buildArgs
      ? Object.entries(buildArgs)
        .map(([k, v]) => `--build-arg ${k}=${v}`)
        .join(' ')
      : '';

    const dockerFileFlag = dockerFile ? `-f $CODEBUILD_SRC_DIR/${dockerFile}` : '';

    // Optional DockerHub login, if a secret ARN is provided
    const dockerLoginCommands = dockerLoginSecretArn
      ? [
        'echo "Retrieving Docker credentials..."',
        'apt-get update -y && apt-get install -y jq',
        `DOCKER_USERNAME=$(aws secretsmanager get-secret-value --secret-id ${dockerLoginSecretArn} --query SecretString --output text | jq -r .username)`,
        `DOCKER_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${dockerLoginSecretArn} --query SecretString --output text | jq -r .password)`,
        'echo "Logging in to Docker Hub..."',
        'echo $DOCKER_PASSWORD | docker login --username $DOCKER_USERNAME --password-stdin',
      ]
      : ['echo "No Docker credentials. Skipping Docker Hub login."'];

    const buildxInstallCommands = cacheDisabled
      ? []
      : [
        'echo "Setting up Docker buildx for ECR layer cache..."',
        'docker buildx create --driver docker-container --name ecr-cache-builder --use 2>/dev/null || docker buildx use ecr-cache-builder',
      ];

    const buildCommand = cacheDisabled
      ? `docker build ${dockerFileFlag} ${buildArgsString} -t $ECR_REPO_URI:${imageTag} $CODEBUILD_SRC_DIR`
      : `docker buildx build --push --cache-from type=registry,ref=$ECR_REPO_URI:cache --cache-to type=registry,ref=$ECR_REPO_URI:cache,mode=max,image-manifest=true ${dockerFileFlag} ${buildArgsString} -t $ECR_REPO_URI:${imageTag} $CODEBUILD_SRC_DIR`;

    const buildSpecObj = {
      version: '0.2',
      phases: {
        install: {
          commands: [
            'echo "Beginning install phase..."',
            ...(installCommands ?? []),
            ...buildxInstallCommands,
          ],
        },
        pre_build: {
          commands: [
            ...(preBuildCommands ?? []),
            ...dockerLoginCommands,
            'echo "Retrieving AWS Account ID..."',
            'export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)',
            'echo "Logging into Amazon ECR..."',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
          ],
        },
        build: {
          commands: [
            `echo "Building Docker image with tag ${imageTag}..."`,
            buildCommand,
          ],
        },
        ...(cacheDisabled && {
          post_build: {
            commands: [
              `echo "Pushing Docker image with tag ${imageTag}..."`,
              `docker push $ECR_REPO_URI:${imageTag}`,
            ],
          },
        }),
      },
    };

    // Create the CodeBuild project
    const codeBuildProject = new Project(this, 'CodeBuildProject', {
      source: Source.s3({
        bucket: sourceAsset.bucket,
        path: sourceAsset.s3ObjectKey,
      }),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      environmentVariables: {
        ECR_REPO_URI: { value: this.ecrRepository.repositoryUri },
      },
      buildSpec: BuildSpec.fromObject(buildSpecObj),
      ...(buildLogGroupProp && {
        logging: {
          cloudWatch: {
            logGroup: buildLogGroupProp,
          },
        },
      }),
      vpc,
      securityGroups,
      subnetSelection,
    });

    // Grant CodeBuild the ability to interact with ECR
    this.ecrRepository.grantPullPush(codeBuildProject);
    codeBuildProject.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
        ],
        resources: ['*'],
      }),
    );
    if (dockerLoginSecretArn) {
      codeBuildProject.addToRolePolicy(
        new PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [dockerLoginSecretArn],
        }),
      );
    }

    // Conditionally grant KMS encrypt/decrypt if a key is used
    if (encryptionKey) {
      encryptionKey.grantEncryptDecrypt(codeBuildProject.role!);
    }

    // Resolve the service token: shared provider or per-instance Lambdas
    let serviceToken: string;
    if (sharedProvider) {
      sharedProvider.registerProject(codeBuildProject, this.ecrRepository, encryptionKey);
      serviceToken = sharedProvider.serviceToken;
    } else {
      const onEventHandlerFunction = new Function(this, 'OnEventHandlerFunction', {
        runtime: Runtime.NODEJS_22_X,
        code: Code.fromAsset(path.resolve(__dirname, '../onEvent')),
        handler: 'onEvent.handler',
        timeout: Duration.minutes(15),
      });
      onEventHandlerFunction.addToRolePolicy(
        new PolicyStatement({
          actions: ['codebuild:StartBuild'],
          resources: [codeBuildProject.projectArn],
        }),
      );

      const isCompleteHandlerFunction = new Function(this, 'IsCompleteHandlerFunction', {
        runtime: Runtime.NODEJS_22_X,
        code: Code.fromAsset(path.resolve(__dirname, '../isComplete')),
        environment: {
          IMAGE_TAG: imageTag,
        },
        handler: 'isComplete.handler',
        timeout: Duration.minutes(15),
      });
      isCompleteHandlerFunction.addToRolePolicy(
        new PolicyStatement({
          actions: [
            'codebuild:BatchGetBuilds',
            'codebuild:ListBuildsForProject',
            'logs:GetLogEvents',
            'logs:DescribeLogStreams',
            'logs:DescribeLogGroups',
          ],
          resources: ['*'],
        }),
      );

      if (encryptionKey) {
        encryptionKey.grantEncryptDecrypt(onEventHandlerFunction);
        encryptionKey.grantEncryptDecrypt(isCompleteHandlerFunction);
      }
      this.ecrRepository.grantPullPush(onEventHandlerFunction);
      this.ecrRepository.grantPullPush(isCompleteHandlerFunction);

      const provider = new Provider(this, 'CustomResourceProvider', {
        onEventHandler: onEventHandlerFunction,
        isCompleteHandler: isCompleteHandlerFunction,
        queryInterval: completenessQueryInterval ?? Duration.seconds(30),
      });
      serviceToken = provider.serviceToken;
    }

    // Custom Resource that triggers the CodeBuild and waits for completion
    const buildTriggerResource = new CustomResource(this, 'BuildTriggerResource', {
      serviceToken,
      properties: {
        ProjectName: codeBuildProject.projectName,
        ImageTag: imageTag,
        Trigger: sourceAsset.assetHash,
      },
    });
    buildTriggerResource.node.addDependency(codeBuildProject);

    // Retrieve the final Docker image tag from Data.ImageTag
    const imageTagRef = buildTriggerResource.getAttString('ImageTag');
    this.containerImage = ContainerImage.fromEcrRepository(this.ecrRepository, imageTagRef);
    this.dockerImageCode = DockerImageCode.fromEcr(this.ecrRepository, {
      tagOrDigest: imageTagRef,
    });
  }
}
