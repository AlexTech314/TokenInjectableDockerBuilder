import * as path from 'path';

import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Project } from 'aws-cdk-lib/aws-codebuild';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Code, Function } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

import {
  BUILD_LOG_GROUP_PREFIX,
  DEFAULT_QUERY_INTERVAL,
  LAMBDA_RUNTIME,
  LAMBDA_TIMEOUT,
  PROVIDER_SINGLETON_ID,
} from './constants';

const REPLICATION_TOTAL_TIMEOUT = Duration.hours(1);
const REPLICATION_CR_ID = 'ReplicationConfig';
const REPLICATION_FN_ID = 'ReplicationConfigHandler';

// ECR registry replication caps (per registry / per AWS account):
// https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html
const MAX_UNIQUE_DESTINATIONS = 25;
const MAX_RULES = 10;

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
  public static getOrCreate(
    scope: Construct,
    props?: TokenInjectableDockerBuilderProviderProps,
  ): TokenInjectableDockerBuilderProvider {
    const stack = Stack.of(scope);
    const existing = stack.node.tryFindChild(PROVIDER_SINGLETON_ID) as
      | TokenInjectableDockerBuilderProvider
      | undefined;
    if (existing) return existing;
    return new TokenInjectableDockerBuilderProvider(stack, PROVIDER_SINGLETON_ID, props);
  }

  /** The service token used by CustomResource instances. */
  public readonly serviceToken: string;

  private readonly onEventHandlerFunction: Function;
  private readonly isCompleteHandlerFunction: Function;

  // Replication-config CR is created lazily on first registerReplication call.
  private replicationFn?: Function;
  private replicationCr?: CustomResource;
  private readonly replicationSpecs: Array<{ repositoryName: string; destinations: Array<{ region: string; registryId: string }> }> = [];

  private constructor(
    scope: Construct,
    id: string,
    props?: TokenInjectableDockerBuilderProviderProps,
  ) {
    super(scope, id);

    this.onEventHandlerFunction = new Function(this, 'OnEventHandler', {
      runtime: LAMBDA_RUNTIME,
      code: Code.fromAsset(path.resolve(__dirname, '../onEvent')),
      handler: 'onEvent.handler',
      timeout: LAMBDA_TIMEOUT,
    });
    this.onEventHandlerFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:PutRetentionPolicy',
          'logs:DeleteLogGroup',
        ],
        resources: [`arn:aws:logs:*:*:log-group:${BUILD_LOG_GROUP_PREFIX}*`],
      }),
    );

    this.isCompleteHandlerFunction = new Function(this, 'IsCompleteHandler', {
      runtime: LAMBDA_RUNTIME,
      code: Code.fromAsset(path.resolve(__dirname, '../isComplete')),
      handler: 'isComplete.handler',
      timeout: LAMBDA_TIMEOUT,
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
      queryInterval: props?.queryInterval ?? DEFAULT_QUERY_INTERVAL,
      // ECR cross-region replication can take up to 30 min in rare cases.
      // The default 30 min totalTimeout is too tight when a builder uses
      // replicaRegions and isComplete is waiting for replicas to land.
      totalTimeout: REPLICATION_TOTAL_TIMEOUT,
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

  /**
   * Register a builder's replica regions with the singleton's replication-config
   * custom resource. Multiple builders contribute specs; the CR merges them into
   * a single registry-wide configuration on every deploy.
   *
   * Also grants the `isComplete` Lambda permission to BatchGetImage on each
   * replica region's repo so it can poll for replication availability.
   */
  public registerReplication(repoName: string, replicaRegions: string[]): void {
    if (replicaRegions.length === 0) return;
    const stack = Stack.of(this);
    const destinations = replicaRegions.map((r) => ({ region: r, registryId: stack.account }));
    this.replicationSpecs.push({ repositoryName: repoName, destinations });

    this.assertReplicationCapsWithinLimits();

    // Grant isComplete BatchGetImage on every replica repo ARN so it can
    // poll for the replicated image to appear.
    this.isCompleteHandlerFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['ecr:BatchGetImage', 'ecr:DescribeImages'],
        resources: replicaRegions.map(
          (r) => `arn:aws:ecr:${r}:${stack.account}:repository/${repoName}`,
        ),
      }),
    );

    this.ensureReplicationCr();

    // Refresh the CR's ManagedSpecs every time a builder registers. Custom
    // resource update detection diffs ResourceProperties — a new value here
    // triggers a CR update, which re-runs the merge in the replication Lambda.
    if (this.replicationCr) {
      const properties = (this.replicationCr.node.defaultChild as any);
      // CDK doesn't expose a public API to mutate CustomResource properties
      // after creation. Instead we use addPropertyOverride to write the
      // serialized state of all registered specs to date.
      properties.addPropertyOverride(
        'ManagedSpecs',
        JSON.stringify(this.replicationSpecs),
      );
    }
  }

  private ensureReplicationCr(): void {
    if (this.replicationCr) return;

    this.replicationFn = new Function(this, REPLICATION_FN_ID, {
      runtime: LAMBDA_RUNTIME,
      code: Code.fromAsset(path.resolve(__dirname, '../ecrReplication')),
      handler: 'ecrReplication.handler',
      timeout: LAMBDA_TIMEOUT,
    });
    this.replicationFn.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'ecr:DescribeRegistry',
          'ecr:PutReplicationConfiguration',
        ],
        resources: ['*'],
      }),
    );
    // First-ever PutReplicationConfiguration in an account creates a
    // service-linked role; idempotent if it already exists.
    this.replicationFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:CreateServiceLinkedRole'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'iam:AWSServiceName': 'replication.ecr.amazonaws.com',
          },
        },
      }),
    );

    const replicationProvider = new Provider(this, 'ReplicationProvider', {
      onEventHandler: this.replicationFn,
    });

    this.replicationCr = new CustomResource(this, REPLICATION_CR_ID, {
      serviceToken: replicationProvider.serviceToken,
      resourceType: 'Custom::TidbReplicationConfig',
      properties: {
        ManagedSpecs: JSON.stringify(this.replicationSpecs),
      },
    });
  }

  /**
   * Enforce ECR registry replication caps at synth time so users get a clear
   * error before deploy. Caps are per-registry (per AWS account), not
   * per-stack — but this construct can only see specs registered through
   * its own singletons. Cross-stack/cross-app rules outside this construct
   * are invisible here; the replication CR will still surface those at
   * deploy time via the ECR API's own error.
   */
  private assertReplicationCapsWithinLimits(): void {
    const uniqueDestinations = new Set<string>();
    const uniqueDestinationSets = new Set<string>();
    for (const spec of this.replicationSpecs) {
      for (const dest of spec.destinations) {
        uniqueDestinations.add(`${dest.region}:${dest.registryId}`);
      }
      const setKey = spec.destinations
        .map((d) => `${d.region}:${d.registryId}`)
        .sort()
        .join('|');
      uniqueDestinationSets.add(setKey);
    }

    if (uniqueDestinations.size > MAX_UNIQUE_DESTINATIONS) {
      throw new Error(
        `ECR registry replication supports at most ${MAX_UNIQUE_DESTINATIONS} unique ` +
        'destinations across all rules per AWS account, but this stack would create ' +
        `${uniqueDestinations.size}. Reduce the union of replicaRegions across all ` +
        'TokenInjectableDockerBuilder instances. (Limit is per-registry / per-account, ' +
        'so other stacks in the same account count too — but only specs registered ' +
        'through this construct are visible at synth time.)',
      );
    }

    if (uniqueDestinationSets.size > MAX_RULES) {
      throw new Error(
        `ECR registry replication supports at most ${MAX_RULES} rules per registry. ` +
        'The construct groups builders by their destination set into one rule each, ' +
        `but this stack has ${uniqueDestinationSets.size} unique destination sets. ` +
        'Consolidate builders to share destination sets (i.e. give them the same ' +
        'replicaRegions) so they share a rule.',
      );
    }
  }
}
