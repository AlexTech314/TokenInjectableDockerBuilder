const {
    CodeBuildClient,
    ListBuildsForProjectCommand,
    BatchGetBuildsCommand,
} = require('@aws-sdk/client-codebuild');
const {
    CloudWatchLogsClient,
    GetLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

exports.handler = async (event) => {
    console.log('--- isComplete Handler Invoked ---');
    console.log('AWS_REGION:', process.env.AWS_REGION);
    console.log('Event:', JSON.stringify(event, null, 2));

    const region = process.env.AWS_REGION;
    const codebuildClient = new CodeBuildClient({ region });
    const logsClient = new CloudWatchLogsClient({ region });

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

        // If build succeeded, return the image tag from the custom resource properties
        if (buildStatus === 'SUCCEEDED') {
            const imageTag = event.ResourceProperties?.ImageTag || process.env.IMAGE_TAG;
            return {
                IsComplete: true,
                Data: {
                    ImageTag: imageTag,
                },
            };
        }

        // If the build is in a failed status, retrieve CloudWatch logs
        if (['FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'].includes(buildStatus)) {
            console.log(`Build ended with status: ${buildStatus}. Attempting to retrieve last log lines...`);
            const logsInfo = build.logs;
            console.log('Logs info:', JSON.stringify(logsInfo, null, 2));

            if (logsInfo?.groupName && logsInfo?.streamName) {
                console.log(`Retrieving up to 5 log events from CloudWatch Logs in group ${logsInfo.groupName} stream ${logsInfo.streamName}`);
                const logResp = await logsClient.send(
                    new GetLogEventsCommand({
                        logGroupName: logsInfo.groupName,
                        logStreamName: logsInfo.streamName,
                        startFromHead: false,
                        limit: 5,
                    })
                );
                console.log('GetLogEventsCommand response:', JSON.stringify(logResp, null, 2));

                const logEvents = logResp.events || [];
                const lastFive = logEvents.map(e => e.message).reverse().join('\n');
                console.error('Last 5 build log lines:\n', lastFive);

                throw new Error(`Build failed with status ${buildStatus}. Last logs:\n${lastFive}`);
            } else {
                throw new Error(`Build failed with status: ${buildStatus}, but no logs found.`);
            }
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
