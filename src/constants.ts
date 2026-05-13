import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export const LAMBDA_RUNTIME = Runtime.NODEJS_22_X;
export const LAMBDA_TIMEOUT = Duration.minutes(15);
export const DEFAULT_QUERY_INTERVAL = Duration.seconds(30);
export const BUILD_LOG_GROUP_PREFIX = '/docker-builder/';
export const PROVIDER_SINGLETON_ID = 'TokenInjectableDockerBuilderProvider';
