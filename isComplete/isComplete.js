const {
    CodeBuildClient,
    ListBuildsForProjectCommand,
    BatchGetBuildsCommand,
} = require('@aws-sdk/client-codebuild');
const {
    CloudWatchLogsClient,
    GetLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const {
    ECRClient,
    DescribeImagesCommand,
} = require('@aws-sdk/client-ecr');

exports.handler = async (event) => {
    console.log('--- isComplete Handler Invoked ---');
    console.log('AWS_REGION:', process.env.AWS_REGION);
    console.log('Event:', JSON.stringify(event, null, 2));

    const region = process.env.AWS_REGION;
    const codebuildClient = new CodeBuildClient({ region });
    const logsClient = new CloudWatchLogsClient({ region });
    const ecrClient = new ECRClient({ region });

    try {
        const projectName = event.ResourceProperties?.ProjectName;
        console.log('ProjectName from ResourceProperties:', projectName);

        if (!projectName) {
            throw new Error('Missing ProjectName in ResourceProperties');
        }

        // Handle Delete requests gracefully
        if (event.RequestType === 'Delete') {
            console.log('Delete request detected. Marking resource as complete.');
            return { IsComplete: true };
        }

        // 1) Retrieve the latest build ID for this project
        console.log('Querying CodeBuild for the most recent build...');
        const listResp = await codebuildClient.send(
            new ListBuildsForProjectCommand({
                projectName,
                sortOrder: 'DESCENDING',
                maxResults: 1,
            })
        );
        console.log('ListBuildsForProjectCommand response:', JSON.stringify(listResp, null, 2));

        if (!listResp.ids || listResp.ids.length === 0) {
            throw new Error(`No builds found for project: ${projectName}`);
        }

        const buildId = listResp.ids[0];
        console.log(`Identified latest Build ID: ${buildId}`);

        // 2) Get details about that specific build
        const batchResp = await codebuildClient.send(
            new BatchGetBuildsCommand({ ids: [buildId] })
        );
        console.log('BatchGetBuildsCommand response:', JSON.stringify(batchResp, null, 2));

        const build = batchResp.builds?.[0];
        if (!build) {
            throw new Error(`Build details not found for Build ID: ${buildId}`);
        }

        const buildStatus = build.buildStatus;
        console.log(`The build status for ID ${buildId} is: ${buildStatus}`);

        // Check for in-progress status
        if (buildStatus === 'IN_PROGRESS') {
            console.log('Build is still in progress. Requesting more time...');
            return { IsComplete: false };
        }

        // If build succeeded, query ECR for the image digest of the just-pushed
        // tag. We return the digest (sha256:...) so consumers can pin to it.
        // Tags are mutable; digests are content-addressable and immutable.
        if (buildStatus === 'SUCCEEDED') {
            const imageTag = event.ResourceProperties?.ImageTag || process.env.IMAGE_TAG;
            const repositoryName = event.ResourceProperties?.RepositoryName;

            if (!repositoryName) {
                throw new Error('Missing RepositoryName in ResourceProperties');
            }

            console.log(`Querying ECR for digest of ${repositoryName}:${imageTag}...`);
            const describeResp = await ecrClient.send(
                new DescribeImagesCommand({
                    repositoryName,
                    imageIds: [{ imageTag }],
                }),
            );
            console.log('DescribeImagesCommand response:', JSON.stringify(describeResp, null, 2));

            const imageDetail = describeResp.imageDetails?.[0];
            if (!imageDetail || !imageDetail.imageDigest) {
                throw new Error(
                    `Image ${repositoryName}:${imageTag} was not found in ECR after a successful build. ` +
                    'This indicates the CodeBuild project did not push the image correctly.',
                );
            }

            const imageDigest = imageDetail.imageDigest;
            console.log(`Resolved digest: ${imageDigest}`);

            return {
                IsComplete: true,
                Data: {
                    ImageTag: imageTag,
                    ImageDigest: imageDigest,
                },
            };
        }

        if (['FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'].includes(buildStatus)) {
            const retainBuildLogs = event.ResourceProperties?.RetainBuildLogs === 'true';
            const logsInfo = build.logs;

            if (retainBuildLogs && logsInfo?.groupName) {
                throw new Error(
                    `Build ${buildStatus}. Full logs preserved in CW log group: ${logsInfo.groupName}`
                );
            }

            if (logsInfo?.groupName && logsInfo?.streamName) {
                console.log(`Retrieving last log events from ${logsInfo.groupName}/${logsInfo.streamName}`);
                const logResp = await logsClient.send(
                    new GetLogEventsCommand({
                        logGroupName: logsInfo.groupName,
                        logStreamName: logsInfo.streamName,
                        startFromHead: false,
                        limit: 5,
                    })
                );
                const logEvents = logResp.events || [];
                const lastFive = logEvents.map(e => e.message).reverse().join('\n');
                console.error('Last 5 build log lines:\n', lastFive);

                throw new Error(`Build ${buildStatus}. Last logs:\n${lastFive}`);
            }

            throw new Error(`Build ${buildStatus}, but no log info available.`);
        }

        // If we reach here, it's an unexpected status
        console.log(`Encountered unknown build status: ${buildStatus}`);
        throw new Error(`Unknown build status: ${buildStatus}`);

    } catch (error) {
        console.error('--- Caught an error in isComplete handler ---');
        console.error('Error details:', error);
        // re-throw for CloudFormation to see the error
        throw error;
    }
};
