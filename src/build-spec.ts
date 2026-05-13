import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse a .dockerignore file at `sourcePath` (if present) and combine it with
 * a user-supplied exclude list. The Dockerfile itself is never excluded —
 * `.dockerignore` patterns matching `dockerFile` are filtered out so the
 * S3 asset always contains the Dockerfile.
 */
export function resolveExcludes(
  sourcePath: string,
  dockerFile: string,
  exclude: string[] | undefined,
): string[] | undefined {
  let effective = exclude;
  if (!effective) {
    const dockerignorePath = path.join(sourcePath, '.dockerignore');
    if (fs.existsSync(dockerignorePath)) {
      const fileContent = fs.readFileSync(dockerignorePath, 'utf8');
      effective = fileContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    }
  }

  if (!effective) return undefined;

  return effective.filter((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return !regex.test(dockerFile);
  });
}

export interface BuildSpecOptions {
  readonly imageTag: string;
  readonly dockerFile?: string;
  readonly buildArgs?: { [key: string]: string };
  readonly dockerLoginSecretArn?: string;
  readonly installCommands?: string[];
  readonly preBuildCommands?: string[];
  readonly cacheDisabled: boolean;
  readonly platform: 'linux/amd64' | 'linux/arm64';
}

/**
 * Assemble the plain buildspec object that the construct passes to
 * `BuildSpec.fromObject`. Pure function — easy to unit test.
 */
export function buildBuildSpec(opts: BuildSpecOptions): Record<string, unknown> {
  const {
    imageTag,
    dockerFile,
    buildArgs,
    dockerLoginSecretArn,
    installCommands,
    preBuildCommands,
    cacheDisabled,
    platform,
  } = opts;

  const buildArgsString = buildArgs
    ? Object.entries(buildArgs)
      .map(([k, v]) => `--build-arg ${k}=${v}`)
      .join(' ')
    : '';

  const dockerFileFlag = dockerFile ? `-f $CODEBUILD_SRC_DIR/${dockerFile}` : '';

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

  const platformFlag = `--platform ${platform}`;

  // --provenance=false --sbom=false: Docker Buildx v0.10+ adds attestations by default,
  // producing OCI image indexes that AWS Lambda does not support.
  const buildCommand = cacheDisabled
    ? `docker build ${platformFlag} ${dockerFileFlag} ${buildArgsString} -t $ECR_REPO_URI:${imageTag} $CODEBUILD_SRC_DIR`
    : `docker buildx build --push ${platformFlag} --provenance=false --sbom=false --cache-from type=registry,ref=$ECR_REPO_URI:cache --cache-to type=registry,ref=$ECR_REPO_URI:cache,mode=max,image-manifest=true ${dockerFileFlag} ${buildArgsString} -t $ECR_REPO_URI:${imageTag} $CODEBUILD_SRC_DIR`;

  return {
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
}
