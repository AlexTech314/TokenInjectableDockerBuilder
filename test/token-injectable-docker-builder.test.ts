import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Vpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { TokenInjectableDockerBuilder } from '../src';

describe('TokenInjectableDockerBuilder', () => {
  test('creates required resources with default properties', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'), // Path to Docker context
      buildArgs: { ENV: 'test' },
    });

    const template = Template.fromStack(stack);

    // Verify that an ECR repository is created
    template.resourceCountIs('AWS::ECR::Repository', 1);

    // Verify that a CodeBuild project is created with expected properties
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Environment: {
        ComputeType: 'BUILD_GENERAL1_SMALL',
        PrivilegedMode: true,
        Image: 'aws/codebuild/standard:7.0',
      },
      Source: {
        Type: 'S3',
      },
    });

    // Verify the Custom Resource is created with the expected service token
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
  });

  test('shares a single CR provider across multiple builders in the same stack', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new TokenInjectableDockerBuilder(stack, 'BuilderA', {
      path: path.resolve(__dirname, './blank'),
    });
    new TokenInjectableDockerBuilder(stack, 'BuilderB', {
      path: path.resolve(__dirname, './blank'),
    });

    const template = Template.fromStack(stack);

    // Two builders → two ECR repos and two CodeBuild projects...
    template.resourceCountIs('AWS::ECR::Repository', 2);
    template.resourceCountIs('AWS::CodeBuild::Project', 2);
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 2);

    // ...but only one shared singleton provider. The CDK Provider framework
    // emits 5 Lambdas total (onEvent + isComplete + framework.onEvent +
    // framework.isComplete + framework.onTimeout) — per-instance Lambdas
    // would double this to 10.
    template.resourceCountIs('AWS::Lambda::Function', 5);
  });

  test('creates resources with dockerLoginSecretArn', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const secretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:DockerLoginSecret';

    new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
      dockerLoginSecretArn: secretArn,
    });

    const template = Template.fromStack(stack);

    // Verify that the CodeBuild project has the secret ARN in its policies
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'secretsmanager:GetSecretValue',
            Resource: secretArn,
          }),
        ]),
      },
    });
  });

  test('creates resources with VPC configuration', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const vpc = new Vpc(stack, 'TestVPC');
    const securityGroup = new SecurityGroup(stack, 'TestSG', { vpc });

    new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
      vpc,
      securityGroups: [securityGroup],
      subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
    });

    const template = Template.fromStack(stack);

    // Verify that the CodeBuild project has VPC configuration
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      VpcConfig: {
        SecurityGroupIds: [
          {
            'Fn::GetAtt': [
              Match.stringLikeRegexp('TestSG.*'),
              'GroupId',
            ],
          },
        ],
        Subnets: Match.anyValue(),
        VpcId: {
          Ref: Match.stringLikeRegexp('TestVPC.*'),
        },
      },
    });
  });

  test('includes custom install and pre_build commands', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const installCommands = [
      'apt-get update -y',
      'apt-get install -y curl',
    ];

    const preBuildCommands = [
      'curl -o config.json https://api.example.com/config',
    ];

    new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
      installCommands,
      preBuildCommands,
    });

    const template = Template.fromStack(stack);

    // Verify that the CodeBuild project's BuildSpec includes the custom commands
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: {
        BuildSpec: Match.serializedJson(Match.objectLike({
          phases: {
            install: {
              commands: Match.arrayWith(installCommands),
            },
            pre_build: {
              commands: Match.arrayWith(preBuildCommands),
            },
          },
        })),
      },
    });
  });

  test('construct provides containerImage and dockerImageCode', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const builder = new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
    });

    expect(builder.containerImage).toBeDefined();
    expect(builder.dockerImageCode).toBeDefined();
  });

  test('dockerImageCodeFor throws on unknown region', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    const builder = new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });

    expect(() => builder.dockerImageCodeFor(stack, 'eu-west-1'))
      .toThrow(/not the primary region.*configured replicaRegions/i);
  });

  test('replicaRegions produces a single replication CR for multiple builders', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    new TokenInjectableDockerBuilder(stack, 'BuilderA', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });
    new TokenInjectableDockerBuilder(stack, 'BuilderB', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });

    const template = Template.fromStack(stack);

    // Singleton: exactly one replication CR even with multiple builders.
    template.resourceCountIs('Custom::TidbReplicationConfig', 1);
  });

  test('two builders importing the same replica region into the same scope do not collide', () => {
    const app = new cdk.App();
    const builderStack = new cdk.Stack(app, 'BuilderStack', {
      env: { account: '111111111111', region: 'us-east-1' },
      crossRegionReferences: true,
    });
    const consumerStack = new cdk.Stack(app, 'ConsumerStack', {
      env: { account: '111111111111', region: 'us-west-2' },
      crossRegionReferences: true,
    });

    const builderA = new TokenInjectableDockerBuilder(builderStack, 'BuilderA', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });
    const builderB = new TokenInjectableDockerBuilder(builderStack, 'BuilderB', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });

    // Each call should produce a fresh imported repo in the consumer stack.
    // If the child-id key collides, the second call returns the first
    // builder's repo and the cross-region reference points at the wrong ECR.
    const codeA = builderA.dockerImageCodeFor(consumerStack, 'us-west-2');
    const codeB = builderB.dockerImageCodeFor(consumerStack, 'us-west-2');

    expect(codeA).not.toBe(codeB);

    // The synthesized consumer stack should contain TWO distinct imported repos.
    const childIds = consumerStack.node.children
      .map((c) => c.node.id)
      .filter((id) => id.startsWith('ImportedRepo'));
    expect(new Set(childIds).size).toBe(2);
  });

  test('throws when total unique replica destinations exceed the ECR cap', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    // 26 distinct regions in a single builder — registry cap is 25.
    const tooManyRegions = Array.from({ length: 26 }, (_, i) => `region-${i}`);
    expect(() => new TokenInjectableDockerBuilder(stack, 'TestBuilder', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: tooManyRegions,
    })).toThrow(/at most 25 unique destinations/);
  });

  test('throws when unique destination sets exceed the 10-rules cap', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    // 10 builders with distinct single-region destination sets is fine.
    for (let i = 0; i < 10; i++) {
      new TokenInjectableDockerBuilder(stack, `Builder${i}`, {
        path: path.resolve(__dirname, './blank'),
        replicaRegions: [`region-${i}`],
      });
    }

    // The 11th builder with a new destination set crosses the 10-rule cap.
    expect(() => new TokenInjectableDockerBuilder(stack, 'Builder10', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['region-10'],
    })).toThrow(/at most 10 rules per registry/);
  });

  test('buildx cache-from uses ignore-error=true so first deploys do not fail on missing :cache tag', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new TokenInjectableDockerBuilder(stack, 'TestBuilder', {
      path: path.resolve(__dirname, './blank'),
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: {
        BuildSpec: Match.serializedJson(Match.objectLike({
          phases: {
            build: {
              commands: Match.arrayWith([
                Match.stringLikeRegexp('cache-from type=registry,ref=\\$ECR_REPO_URI:cache,ignore-error=true'),
              ]),
            },
          },
        })),
      },
    });
  });

  test('build CR uses BuildTriggerResourceV2 logical ID to allow v1→v2 serviceToken change', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new TokenInjectableDockerBuilder(stack, 'TestBuilder', {
      path: path.resolve(__dirname, './blank'),
    });

    const template = Template.fromStack(stack);
    const customResources = template.findResources('AWS::CloudFormation::CustomResource');
    const logicalIds = Object.keys(customResources);

    // The build CR must live under .../BuildTriggerResourceV2 so CFN does a
    // Replace (allowed) instead of an Update (forbidden when serviceToken
    // changes) when a v1-deployed stack is updated with v2 code.
    expect(logicalIds.some((id) => id.includes('BuildTriggerResourceV2'))).toBe(true);
    expect(logicalIds.some((id) => id.match(/BuildTriggerResource(?!V2)/))).toBe(false);
  });

  test('build CR includes ReplicaRegions and RepositoryName when replicaRegions is set', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    new TokenInjectableDockerBuilder(stack, 'TestDockerImageAsset', {
      path: path.resolve(__dirname, './blank'),
      replicaRegions: ['us-west-2'],
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      ReplicaRegions: '["us-west-2"]',
      RepositoryName: Match.anyValue(),
    });
  });
});
