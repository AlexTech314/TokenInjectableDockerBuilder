import { Duration } from 'aws-cdk-lib';
import { Repository, RepositoryEncryption, TagStatus } from 'aws-cdk-lib/aws-ecr';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface BuilderEcrRepositoryOptions {
  readonly kmsEncryption: boolean;
  readonly encryptionKey?: Key;
}

/**
 * Create an ECR repository for a builder.
 *
 * SAFETY: tagged images are never deleted. Lambda pins images by digest
 * internally, so deleting an in-use tagged image would make the next Lambda
 * config update fail with "Image ID cannot be found". Untagged images are
 * cleaned up after 30 days.
 */
export function createBuilderEcrRepository(
  scope: Construct,
  id: string,
  options: BuilderEcrRepositoryOptions,
): Repository {
  const { kmsEncryption, encryptionKey } = options;

  return new Repository(scope, id, {
    lifecycleRules: [
      {
        rulePriority: 1,
        description: 'Remove untagged images after 30 days',
        tagStatus: TagStatus.UNTAGGED,
        maxImageAge: Duration.days(30),
      },
    ],
    encryption: kmsEncryption ? RepositoryEncryption.KMS : RepositoryEncryption.AES_256,
    encryptionKey: kmsEncryption ? encryptionKey : undefined,
    imageScanOnPush: true,
  });
}
