import { awscdk } from 'projen';
import { NodePackageManager } from 'projen/lib/javascript';

const project = new awscdk.AwsCdkConstructLibrary({
  author: 'AlexTech314',
  authorAddress: 'alest314@gmail.com',
  majorVersion: 2,
  cdkVersion: '2.238.0',
  defaultReleaseBranch: 'main',
  packageManager: NodePackageManager.NPM,
  jsiiVersion: '~5.9.27',
  name: 'token-injectable-docker-builder',
  projenrcTs: true,
  repositoryUrl: 'https://github.com/AlexTech314/TokenInjectableDockerBuilder.git',
  description: 'The TokenInjectableDockerBuilder is a flexible AWS CDK construct that enables the usage of AWS CDK tokens in the building, pushing, and deployment of Docker images to Amazon Elastic Container Registry (ECR). It leverages AWS CodeBuild and Lambda custom resources.',
  packageName: 'token-injectable-docker-builder',
  keywords: [
    'aws',
    'cdk',
    'aws-cdk',
    'docker',
    'ecr',
    'lambda',
    'custom-resource',
    'docker-build',
    'codebuild',
    'token-injection',
    'docker-image',
    'aws-codebuild',
    'aws-ecr',
    'docker-builder',
    'cdk-construct',
    'lambda-custom-resource',
    'container-image',
    'aws-lambda',
    'aws-cdk-lib',
    'cloud-development-kit',
    'ci-cd',
    'aws-ci-cd',
    'infrastructure-as-code',
    'awscdk',
  ],
  devDeps: [
    'jsii-docgen@^10.11.0',
    '@aws-cdk/integ-tests-alpha@2.238.0-alpha.0',
    '@aws-cdk/integ-runner@^2.197.0',
    // v1 of ourself, aliased so the migration integ test (test/migration/before-v1.ts)
    // can import the previous major version side-by-side with `../src` (v2).
    'token-injectable-docker-builder-v1@npm:token-injectable-docker-builder@^1.13.0',
  ],
  license: 'MIT',
  publishToPypi: {
    distName: 'token-injectable-docker-builder',
    module: 'token_injectable_docker_builder',
  },
});

const common_exclude = ['cdk.out', 'cdk.context.json', 'coverage'];

project.gitignore.exclude(...common_exclude);
project.npmignore!.exclude(
  ...common_exclude,
  'test-docker',
  'integAssertions',
);

project.npmignore!.include('isComplete/*.js', 'onEvent/*.js', 'ecrReplication/*.js');

project.addScripts({
  'local-deploy': 'npx cdk deploy --all --app "npx ts-node test/integ.default.ts"',
  'local-deploy-no-rollback': 'npx cdk deploy --all --no-rollback --app "npx ts-node test/integ.default.ts"',
  'local-destroy': 'npx cdk destroy --all --app "npx ts-node test/integ.default.ts"',
  'local-synth': 'npx cdk synth --app "npx ts-node test/integ.default.ts"',
  'integ': 'npx integ-runner --update-on-failed --directory test',
  // v1→v2 upgrade simulation: deploy a stack with v1, then re-deploy the
  // same stack with v2 (no destroy in between), then tear down.
  'integ-migration':
    'npx cdk deploy TidbMigrationStack --app "npx ts-node test/migration/before-v1.ts" --require-approval=never && '
    + 'npx cdk deploy TidbMigrationStack --app "npx ts-node test/migration/after-v2.ts" --require-approval=never && '
    + 'npx cdk destroy TidbMigrationStack --app "npx ts-node test/migration/after-v2.ts" --force',
  // Cross-stack redeploy regression test for the imageTag wedge. Exercises
  // three scenarios in one app so phase 2 (the regression guard) catches
  // every flavour of the bug at once:
  //   - Same-stack consumer  (keeps the CFN-token form, preserves CR dep)
  //   - Same-region cross-stack consumer (v2.0.4 fix: plain string, no Fn::Export)
  //   - Cross-region cross-stack consumer (v2.0.3 fix: plain string, no writer)
  // Deploys with BUILD_ARG=v1, redeploys with BUILD_ARG=v2 (different imageTag),
  // then tears down. Pre-fix, phase 2 fails with either "Some exports have
  // changed" or "Cannot update export ... as it is in use"; post-fix it must
  // succeed.
  'integ-redeploy':
    'BUILDER_BUILD_ARG=v1 npx cdk deploy TidbRedeployStack TidbRedeployConsumerStack TidbRedeploySameRegionConsumerStack --app "npx ts-node test/redeploy/redeploy.ts" --require-approval=never && '
    + 'BUILDER_BUILD_ARG=v2 npx cdk deploy TidbRedeployStack TidbRedeployConsumerStack TidbRedeploySameRegionConsumerStack --app "npx ts-node test/redeploy/redeploy.ts" --require-approval=never && '
    + 'BUILDER_BUILD_ARG=v2 npx cdk destroy TidbRedeployStack TidbRedeployConsumerStack TidbRedeploySameRegionConsumerStack --app "npx ts-node test/redeploy/redeploy.ts" --force',
});

project.synth();
