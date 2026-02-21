const { CodeBuildClient, StartBuildCommand } = require('@aws-sdk/client-codebuild');
const {
    CloudWatchLogsClient,
    CreateLogGroupCommand,
    PutRetentionPolicyCommand,
    DeleteLogGroupCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const crypto = require('crypto');

function buildLogGroupName(projectName) {
    return `/docker-builder/${projectName}`;
}

async function ensureLogGroup(logsClient, logGroupName) {
    try {
        await logsClient.send(new CreateLogGroupCommand({ logGroupName }));
        console.log(`Created log group: ${logGroupName}`);
    } catch (error) {
        if (error.name === 'ResourceAlreadyExistsException') {
            console.log(`Log group already exists: ${logGroupName}`);
        } else {
            throw error;
        }
    }

    await logsClient.send(new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays: 7,
    }));
    console.log(`Set 7-day retention on: ${logGroupName}`);
}

async function deleteLogGroup(logsClient, logGroupName) {
    try {
        await logsClient.send(new DeleteLogGroupCommand({ logGroupName }));
        console.log(`Deleted log group: ${logGroupName}`);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.log(`Log group does not exist, nothing to delete: ${logGroupName}`);
        } else {
            throw error;
        }
    }
}

exports.handler = async (event, context) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    const region = process.env.AWS_REGION;
    const codebuildClient = new CodeBuildClient({ region });
    const logsClient = new CloudWatchLogsClient({ region });

    let physicalResourceId = event.PhysicalResourceId || event.LogicalResourceId;

    const projectName = event.ResourceProperties.ProjectName;
    const retainBuildLogs = event.ResourceProperties.RetainBuildLogs === 'true';
    const logGroupName = buildLogGroupName(projectName);

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
        if (retainBuildLogs) {
            await ensureLogGroup(logsClient, logGroupName);
        } else {
            await deleteLogGroup(logsClient, logGroupName);
        }

        const params = {
            projectName,
            idempotencyToken: crypto.randomUUID(),
            ...(retainBuildLogs && {
                logsConfigOverride: {
                    cloudWatchLogs: {
                        status: 'ENABLED',
                        groupName: logGroupName,
                    },
                },
            }),
        };

        try {
            const command = new StartBuildCommand(params);
            const build = await codebuildClient.send(command);
            console.log('Started build:', JSON.stringify(build, null, 2));
        } catch (error) {
            console.error('Error starting build:', error);

            return {
                PhysicalResourceId: physicalResourceId,
                Data: {},
                Reason: error.message,
            };
        }
    } else if (event.RequestType === 'Delete') {
        await deleteLogGroup(logsClient, logGroupName);
        console.log('Delete request received. Cleaned up log group.');
    }

    return {
        PhysicalResourceId: physicalResourceId,
        Data: {},
    };
};
