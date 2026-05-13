import * as path from 'path';

import { CustomResource, Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface LambdaTarget {
  readonly region: string;
  readonly functionName: string;
  readonly expected: { buildArgToken: string; envVar: string; arch: 'x64' | 'arm64' };
}

export interface EcsTarget {
  readonly region: string;
  readonly clusterArn: string;
  readonly taskDefinitionArn: string;
  readonly containerName: string;
  readonly subnetIds: string[];
  readonly securityGroupId: string;
  readonly assignPublicIp: boolean;
  readonly logGroupName: string;
  readonly logStreamPrefix: string;
  readonly envOverrides: { [k: string]: string };
  readonly expected: { buildArgToken: string; envVar: string; arch: 'x64' };
}

export interface IntegAssertionsProps {
  readonly lambdaTargets: LambdaTarget[];
  readonly ecsTargets: EcsTarget[];
  readonly dependsOn: Construct[];
}

/**
 * In-stack assertion runner. A Lambda invokes each target (in its own region)
 * and validates payloads; failures throw, which fails CloudFormation.
 */
export class IntegAssertions extends Construct {
  constructor(scope: Construct, id: string, props: IntegAssertionsProps) {
    super(scope, id);

    const assertionFn = new Function(this, 'AssertionFn', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'integAssertions.handler',
      code: Code.fromAsset(path.resolve(__dirname, '../../integAssertions')),
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    if (props.lambdaTargets.length > 0) {
      assertionFn.addToRolePolicy(new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: ['*'],
      }));
    }

    if (props.ecsTargets.length > 0) {
      assertionFn.addToRolePolicy(new PolicyStatement({
        actions: ['ecs:RunTask', 'ecs:DescribeTasks'],
        resources: ['*'],
      }));
      assertionFn.addToRolePolicy(new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: ['*'],
      }));
      assertionFn.addToRolePolicy(new PolicyStatement({
        actions: ['logs:GetLogEvents'],
        resources: ['*'],
      }));
    }

    const provider = new Provider(this, 'Provider', {
      onEventHandler: assertionFn,
    });

    const cr = new CustomResource(this, 'Runner', {
      serviceToken: provider.serviceToken,
      properties: {
        LambdaTargets: JSON.stringify(props.lambdaTargets),
        EcsTargets: JSON.stringify(props.ecsTargets),
        Nonce: Date.now().toString(),
      },
    });

    for (const dep of props.dependsOn) {
      cr.node.addDependency(dep);
    }
  }
}
