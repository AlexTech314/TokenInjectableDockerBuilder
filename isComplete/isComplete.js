const {
    CodeBuildClient,
    BatchGetBuildsCommand,
} = require('@aws-sdk/client-codebuild');
const {
    CloudWatchLogsClient,
    GetLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const {
    ECRClient,
    BatchGetImageCommand,
} = require('@aws-sdk/client-ecr');

async function checkReplicaAvailability(repositoryName, imageTag, replicaRegions) {
    for (const region of replicaRegions) {
        const ecr = new ECRClient({ region });
        try {
            const resp = await ecr.send(new BatchGetImageCommand({
                repositoryName,
                imageIds: [{ imageTag }],
            }));
            const images = resp.images || [];
            if (images.length === 0) {
                console.log(`Replica ${region}: repo exists but tag ${imageTag} not yet present.`);
                return false;
            }
            console.log(`Replica ${region}: image present.`);
        } catch (err) {
            if (err.name === 'RepositoryNotFoundException') {
                console.log(`Replica ${region}: destination repo not yet created by ECR replication.`);
                return false;
            }
            throw err;
        }
    }
    return true;
}

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

        // The build ID is passed through from onEvent via Data.BuildId
        // (the CDK Provider framework merges onEvent's response into the
        // event passed to isComplete — see createResponseEvent in
        // aws-cdk-lib/custom-resources/.../framework.js).
        //
        // We deliberately do NOT fall back to ListBuildsForProject here:
        // its eventual-consistency window can return a previous SUCCEEDED
        // build before the just-started one appears, causing isComplete
        // to signal success with the new (not-yet-pushed) image tag and
        // breaking the downstream Lambda/ECS update with "Source image
        // does not exist".
        const buildId = event.Data?.BuildId;
        if (!buildId) {
            // onEvent's catch block returns Data:{} and Reason:<error.message>
            // when StartBuild fails (e.g. AccountSuspendedException,
            // permission denial, regional service health). The framework
            // forwards Reason into our event, so surface it here instead of
            // burying the real cause behind a misleading "Missing field"
            // message — without this, the operator has to dig through the
            // onEvent Lambda's CloudWatch logs to find why the build never
            // started.
            const upstreamReason = event.Reason;
            if (upstreamReason) {
                throw new Error(
                    `onEvent failed to start a CodeBuild build: ${upstreamReason}`
                );
            }
            throw new Error(
                'Missing Data.BuildId in isComplete event and no Reason ' +
                'provided by onEvent. Confirm you are running a matched ' +
                'onEvent + isComplete pair (both shipped in the same ' +
                'token-injectable-docker-builder release).'
            );
        }
        console.log(`Polling Build ID from onEvent: ${buildId}`);

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

        // If build succeeded, optionally wait for cross-region replicas to land
        // before signalling complete. ECR replication is async (most images
        // <30 min, rare cases longer) — without this, a consumer stack in
        // another region may try to pull the image before it's been
        // replicated and fail with "Source image does not exist".
        if (buildStatus === 'SUCCEEDED') {
            const imageTag = event.ResourceProperties?.ImageTag || process.env.IMAGE_TAG;
            const repositoryName = event.ResourceProperties?.RepositoryName;
            const replicaRegions = JSON.parse(event.ResourceProperties?.ReplicaRegions || '[]');

            if (replicaRegions.length > 0 && repositoryName) {
                const ready = await checkReplicaAvailability(repositoryName, imageTag, replicaRegions);
                if (!ready) {
                    console.log('Build succeeded; waiting for replicas to catch up.');
                    return { IsComplete: false };
                }
            }

            return {
                IsComplete: true,
                Data: {
                    ImageTag: imageTag,
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
