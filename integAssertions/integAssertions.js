const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { ECSClient, RunTaskCommand, DescribeTasksCommand } = require('@aws-sdk/client-ecs');
const { CloudWatchLogsClient, GetLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

const defaultRegion = process.env.AWS_REGION;
const lambdaClients = new Map();
const ecsClients = new Map();
const logsClients = new Map();

function getLambdaClient(region) {
    const r = region || defaultRegion;
    if (!lambdaClients.has(r)) lambdaClients.set(r, new LambdaClient({ region: r }));
    return lambdaClients.get(r);
}
function getEcsClient(region) {
    const r = region || defaultRegion;
    if (!ecsClients.has(r)) ecsClients.set(r, new ECSClient({ region: r }));
    return ecsClients.get(r);
}
function getLogsClient(region) {
    const r = region || defaultRegion;
    if (!logsClients.has(r)) logsClients.set(r, new CloudWatchLogsClient({ region: r }));
    return logsClients.get(r);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepEqual(actual, expected) {
    const keys = Object.keys(expected);
    for (const key of keys) {
        if (actual?.[key] !== expected[key]) {
            return { ok: false, key, actual: actual?.[key], expected: expected[key] };
        }
    }
    return { ok: true };
}

async function assertLambda(target) {
    const client = getLambdaClient(target.region);
    console.log(`Invoking Lambda ${target.functionName} in ${target.region || defaultRegion}...`);
    const resp = await client.send(new InvokeCommand({
        FunctionName: target.functionName,
        Payload: Buffer.from('{}'),
    }));
    if (resp.FunctionError) {
        const errBody = resp.Payload ? Buffer.from(resp.Payload).toString() : '<no payload>';
        throw new Error(`Lambda ${target.functionName} returned FunctionError=${resp.FunctionError}: ${errBody}`);
    }
    const payload = JSON.parse(Buffer.from(resp.Payload).toString());
    const result = deepEqual(payload, target.expected);
    if (!result.ok) {
        throw new Error(
            `Lambda ${target.functionName} payload mismatch on key="${result.key}". ` +
            `Expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}. ` +
            `Full payload: ${JSON.stringify(payload)}`,
        );
    }
    console.log(`Lambda ${target.functionName} OK: ${JSON.stringify(payload)}`);
}

async function waitForTaskStop(region, clusterArn, taskArn) {
    const client = getEcsClient(region);
    const maxWaitMs = 10 * 60 * 1000;
    const start = Date.now();
    let lastStatus;
    while (Date.now() - start < maxWaitMs) {
        const resp = await client.send(new DescribeTasksCommand({
            cluster: clusterArn,
            tasks: [taskArn],
        }));
        const task = resp.tasks?.[0];
        if (!task) throw new Error(`Task ${taskArn} not found`);
        lastStatus = task.lastStatus;
        if (lastStatus === 'STOPPED') return task;
        await sleep(5000);
    }
    throw new Error(`Task ${taskArn} did not reach STOPPED within timeout (last status: ${lastStatus})`);
}

async function readContainerLogJson(region, logGroupName, logStreamName) {
    const client = getLogsClient(region);
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const resp = await client.send(new GetLogEventsCommand({
                logGroupName,
                logStreamName,
                startFromHead: true,
                limit: 100,
            }));
            const messages = (resp.events || []).map((e) => e.message);
            for (let i = messages.length - 1; i >= 0; i--) {
                const line = messages[i].trim();
                if (line.startsWith('{') && line.endsWith('}')) {
                    try {
                        return JSON.parse(line);
                    } catch (_) {
                        // not JSON, keep looking
                    }
                }
            }
        } catch (err) {
            if (err.name !== 'ResourceNotFoundException') throw err;
        }
        await sleep(2000);
    }
    throw new Error(`No JSON log line found in ${logGroupName}/${logStreamName}`);
}

async function assertEcs(target) {
    const ecsClient = getEcsClient(target.region);
    console.log(`Running ECS task on cluster ${target.clusterArn} in ${target.region || defaultRegion}...`);
    const runResp = await ecsClient.send(new RunTaskCommand({
        cluster: target.clusterArn,
        taskDefinition: target.taskDefinitionArn,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: target.subnetIds,
                securityGroups: [target.securityGroupId],
                assignPublicIp: target.assignPublicIp ? 'ENABLED' : 'DISABLED',
            },
        },
        overrides: {
            containerOverrides: [{
                name: target.containerName,
                environment: Object.entries(target.envOverrides || {}).map(([name, value]) => ({ name, value })),
            }],
        },
    }));
    if (runResp.failures && runResp.failures.length > 0) {
        throw new Error(`RunTask failures: ${JSON.stringify(runResp.failures)}`);
    }
    const taskArn = runResp.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error('RunTask returned no task ARN');
    console.log(`Started ECS task ${taskArn}, waiting for STOPPED...`);

    const task = await waitForTaskStop(target.region, target.clusterArn, taskArn);
    const container = task.containers?.find((c) => c.name === target.containerName);
    const exitCode = container?.exitCode;
    if (exitCode !== 0) {
        const reason = container?.reason || task.stoppedReason || '<no reason>';
        throw new Error(`ECS task exited with code=${exitCode}, reason=${reason}`);
    }

    const taskId = taskArn.split('/').pop();
    const logStreamName = `${target.logStreamPrefix}/${target.containerName}/${taskId}`;
    console.log(`Reading log stream ${target.logGroupName}/${logStreamName}`);
    const payload = await readContainerLogJson(target.region, target.logGroupName, logStreamName);
    const result = deepEqual(payload, target.expected);
    if (!result.ok) {
        throw new Error(
            `ECS task payload mismatch on key="${result.key}". ` +
            `Expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}. ` +
            `Full payload: ${JSON.stringify(payload)}`,
        );
    }
    console.log(`ECS task OK: ${JSON.stringify(payload)}`);
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    const physicalResourceId = event.PhysicalResourceId || event.LogicalResourceId;

    if (event.RequestType === 'Delete') {
        return { PhysicalResourceId: physicalResourceId };
    }

    const lambdaTargets = JSON.parse(event.ResourceProperties.LambdaTargets || '[]');
    const ecsTargets = JSON.parse(event.ResourceProperties.EcsTargets || '[]');

    for (const target of lambdaTargets) {
        await assertLambda(target);
    }
    for (const target of ecsTargets) {
        await assertEcs(target);
    }

    return {
        PhysicalResourceId: physicalResourceId,
        Data: {
            LambdaAssertionsPassed: String(lambdaTargets.length),
            EcsAssertionsPassed: String(ecsTargets.length),
        },
    };
};
